/**
 * Conversion Handler - Orchestrates the 4-phase EVM to CashScript conversion
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import type { RequestWithMetadata } from '../middleware/logger.js';
import type { DomainModel } from '../types/domain-model.js';
import type { UTXOArchitecture } from '../types/utxo-architecture.js';
import { ANTHROPIC_CONFIG } from '../config.js';
import { updateConversion, insertContract, generateHash, generateUUID } from '../database.js';
import {
  logConversionStart,
  logConversionComplete,
  logApiCallStart,
  logApiCallComplete,
} from '../services/logging.js';
import {
  executeDomainExtraction,
  executeArchitectureDesign,
  filterDocumentationOnlyContracts,
  outputSchema,
  retryOutputSchemaMulti,
  retryOutputSchemaSingle,
  validateContract,
  enhanceErrorMessage,
  normalizeContractNames,
  isPlaceholderContract,
  validateMultiContractResponse,
  applyNameMappingToTemplates,
  isMultiContractResponse,
  type ContractInfo
} from '../phases/index.js';

type SSEWriter = {
  sendEvent: (event: string, data: any) => void;
  endResponse: () => void;
  isDisconnected: () => boolean;
};

function createSSEWriter(res: Response): SSEWriter {
  let clientDisconnected = false;
  res.on('close', () => { clientDisconnected = true; });

  return {
    sendEvent: (event: string, data: any) => {
      if (!res.writable) throw new Error('AbortError: Client disconnected');
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    endResponse: () => {
      if (!res.writable) throw new Error('AbortError: Client disconnected');
      res.end();
    },
    isDisconnected: () => clientDisconnected
  };
}

function validateContractInput(contract: any): { valid: boolean; error?: string; statusCode?: number } {
  if (typeof contract !== 'string') {
    return { valid: false, error: 'Contract must be a string', statusCode: 400 };
  }
  if (!contract || contract.trim().length === 0) {
    return { valid: false, error: 'Contract cannot be empty', statusCode: 400 };
  }
  if (contract.length < 10) {
    return { valid: false, error: 'Contract must be at least 10 characters', statusCode: 400 };
  }
  if (contract.length > 50000) {
    return { valid: false, error: 'Contract too large. Maximum 50,000 characters allowed.', statusCode: 413 };
  }
  return { valid: true };
}

export async function handleConversion(
  req: RequestWithMetadata,
  res: Response,
  anthropic: Anthropic,
  systemPrompt: string
): Promise<void> {
  const startTime = Date.now();
  let conversionId: number | undefined;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sse = createSSEWriter(res);
  let sentContracts = new Set<string>();

  try {
    const { contract } = req.body;

    const validation = validateContractInput(contract);
    if (!validation.valid) {
      sse.sendEvent('error', { message: validation.error });
      sse.endResponse();
      return;
    }

    const metadata = req.metadata!;
    conversionId = logConversionStart(metadata, contract);

    // PHASE 1: Domain Extraction
    sse.sendEvent('phase1_start', { message: 'Extracting domain model...' });

    let domainModel: DomainModel;
    let domainModelJSON: string;

    try {
      if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

      const phase1Result = await executeDomainExtraction(anthropic, conversionId, contract);
      domainModel = phase1Result.domainModel;
      domainModelJSON = JSON.stringify(domainModel, null, 2);
      sse.sendEvent('phase1_complete', {
        message: 'Domain extraction complete',
        domain: domainModel.domain,
        entities: domainModel.entities.length,
        transitions: domainModel.transitions.length
      });
    } catch (phase1Error) {
      console.error('[Phase 1] Domain extraction failed:', phase1Error);
      sse.sendEvent('error', {
        phase: 1,
        message: 'Domain extraction failed',
        details: phase1Error instanceof Error ? phase1Error.message : String(phase1Error)
      });
      sse.endResponse();
      return;
    }

    // PHASE 2: UTXO Architecture Design
    sse.sendEvent('phase2_start', { message: 'Designing UTXO architecture...' });

    let utxoArchitecture: UTXOArchitecture;
    let utxoArchitectureJSON: string;

    try {
      if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

      const phase2Result = await executeArchitectureDesign(anthropic, conversionId, domainModel);
      utxoArchitecture = phase2Result.architecture;

      const { filtered, removedCount } = filterDocumentationOnlyContracts(utxoArchitecture);
      utxoArchitecture = filtered;

      utxoArchitectureJSON = JSON.stringify(utxoArchitecture, null, 2);

      const contractCount = Array.isArray(utxoArchitecture.contracts) ? utxoArchitecture.contracts.length : 0;
      const patternNames = Array.isArray(utxoArchitecture.patterns)
        ? utxoArchitecture.patterns.map(p => p?.name || 'unnamed')
        : [];

      sse.sendEvent('phase2_complete', {
        message: 'Architecture design complete',
        contracts: contractCount,
        patterns: patternNames,
        durationMs: phase2Result.durationMs
      });

      const transactionTemplates = Array.isArray(utxoArchitecture.transactionTemplates)
        ? utxoArchitecture.transactionTemplates
        : [];
      const contractSpecs = Array.isArray(utxoArchitecture.contracts)
        ? utxoArchitecture.contracts.map(c => ({ name: c.name, custodies: c.custodies, validates: c.validates }))
        : [];
      if (transactionTemplates.length > 0 || contractSpecs.length > 0) {
        sse.sendEvent('transactions_ready', {
          transactions: transactionTemplates,
          contractSpecs: contractSpecs
        });
      }
    } catch (phase2Error) {
      console.error('[Phase 2] Architecture design failed:', phase2Error);
      sse.sendEvent('error', {
        phase: 2,
        message: 'Architecture design failed',
        details: phase2Error instanceof Error ? phase2Error.message : String(phase2Error)
      });
      sse.endResponse();
      return;
    }

    // PHASE 3: Code Generation
    sse.sendEvent('phase3_start', { message: 'Generating CashScript...' });

    let parsed: any;
    let validationPassed = false;
    let validationError: string | undefined;
    let retryMessage: string = '';
    let savedValidContracts: any[] = [];
    let isMultiContractMode = false;
    let savedDeploymentGuide: any = null;
    let originalContractOrder: string[] = [];
    let contractAttempts: Map<string, number> = new Map();
    let totalExpectedContracts = 0;
    let expectedFailedNames: string[] = [];

    for (let attemptNumber = 1; attemptNumber <= ANTHROPIC_CONFIG.phase2.maxRetries; attemptNumber++) {
      if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

      const messageContent = attemptNumber === 1
        ? `DOMAIN MODEL (what the system does - platform-agnostic):
${domainModelJSON}

UTXO ARCHITECTURE (how to implement it):
${utxoArchitectureJSON}

Generate CashScript contracts based on the UTXO architecture above. Follow the contract specifications exactly:
- Use the contract names, roles, and validation purposes from the architecture
- Implement the functions as specified with their validation requirements
- Follow the transaction templates for input/output positions
- Apply the mandatory checklist from the system prompt

Every contract must validate something. Every function must add constraints. No placeholders.`
        : retryMessage;

      const apiCallStartTime = Date.now();
      const apiCallId = logApiCallStart(conversionId, attemptNumber, messageContent);

      if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

      let selectedSchema;
      if (attemptNumber === 1) {
        selectedSchema = outputSchema;
      } else {
        selectedSchema = isMultiContractMode ? retryOutputSchemaMulti : retryOutputSchemaSingle;
      }

      const message = await anthropic.beta.messages.create({
        model: ANTHROPIC_CONFIG.phase2.model,
        max_tokens: ANTHROPIC_CONFIG.phase2.maxTokens,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: ANTHROPIC_CONFIG.cache.type, ttl: ANTHROPIC_CONFIG.cache.ttl }
          }
        ],
        betas: [...ANTHROPIC_CONFIG.betas],
        output_format: selectedSchema,
        messages: [
          {
            role: 'user',
            content: messageContent
          }
        ]
      });

      const response = message.content[0].type === 'text' ? message.content[0].text : '';
      const usage = message.usage;

      try {
        parsed = JSON.parse(response);
      } catch (parseError) {
        sse.sendEvent('error', {
          phase: 3,
          message: 'Response truncated - contract too complex',
          details: parseError instanceof Error ? parseError.message : String(parseError)
        });
        sse.endResponse();
        return;
      }

      // Normalize and filter contracts
      if (parsed.contracts && Array.isArray(parsed.contracts)) {
        normalizeContractNames(parsed.contracts);

        const beforeFilter = parsed.contracts.length;
        parsed.contracts = parsed.contracts.filter((c: ContractInfo) => {
          if (isPlaceholderContract(c.code)) {
            console.log(`[Filter] Removing placeholder contract: ${c.name}`);
            return false;
          }
          return true;
        });
        const removed = beforeFilter - parsed.contracts.length;
        if (removed > 0) {
          console.log(`[Filter] Removed ${removed} placeholder contract(s)`);
        }
      }

      // After first attempt, track mode and start Phase 4
      if (attemptNumber === 1) {
        sse.sendEvent('phase3_complete', { message: 'Code generation complete' });
        sse.sendEvent('phase4_start', { message: 'Validating contracts... You\'ll be redirected to results as soon as we have something to show. We\'ll keep working on the rest in the background.' });

        isMultiContractMode = isMultiContractResponse(parsed);
        if (isMultiContractMode && parsed.deploymentGuide) {
          savedDeploymentGuide = parsed.deploymentGuide;
          originalContractOrder = parsed.contracts.map((c: any) => c.name);
          totalExpectedContracts = parsed.contracts.length;
          parsed.contracts.forEach((c: any) => {
            contractAttempts.set(c.name, 1);
          });
        } else if (!isMultiContractMode) {
          totalExpectedContracts = 1;
        }
      } else if (attemptNumber > 1 && isMultiContractMode) {
        // Merge saved valid contracts with newly fixed contracts
        const fixedContracts = parsed.contracts || [];

        if (fixedContracts.length > 0 && expectedFailedNames.length > 0) {
          const validNames = new Set(savedValidContracts.map((c: any) => c.name));

          for (const fixedContract of fixedContracts) {
            if (!validNames.has(fixedContract.name) && !expectedFailedNames.includes(fixedContract.name)) {
              const unmatchedExpected = expectedFailedNames.find(name =>
                !fixedContracts.some(c => c.name === name)
              );
              if (unmatchedExpected) {
                console.warn(`[Merge] Contract name changed during retry: "${fixedContract.name}" -> renaming to expected "${unmatchedExpected}"`);
                fixedContract.name = unmatchedExpected;
              } else {
                console.error(`[Merge] ERROR: Fixed contract "${fixedContract.name}" doesn't match any expected failed name: [${expectedFailedNames.join(', ')}]`);
              }
            }
          }
        }

        for (const fixedContract of fixedContracts) {
          contractAttempts.set(fixedContract.name, attemptNumber);
        }

        const contractMap = new Map();
        for (const contract of savedValidContracts) {
          const contractCopy = {
            ...contract,
            dependencies: contract.dependencies ? [...contract.dependencies] : [],
            constructorParams: contract.constructorParams ? [...contract.constructorParams] : []
          };
          contractMap.set(contract.name, contractCopy);
        }

        for (const fixedContract of fixedContracts) {
          const wasValidated = savedValidContracts.some(c => c.name === fixedContract.name);
          if (wasValidated) {
            console.warn(`[Merge] WARNING: AI returned already-validated contract "${fixedContract.name}" - ignoring AI version, keeping original`);
          } else {
            contractMap.set(fixedContract.name, fixedContract);
          }
        }

        const mergedContracts: any[] = [];
        for (const name of originalContractOrder) {
          const contract = contractMap.get(name);
          if (contract) {
            mergedContracts.push(contract);
          } else {
            console.error(`[Merge] ERROR: Contract "${name}" missing from merge`);
          }
        }

        parsed = {
          contracts: mergedContracts,
          deploymentGuide: savedDeploymentGuide
        };
      }

      // Validate contracts
      const isMultiContract = isMultiContractResponse(parsed);

      if (isMultiContract) {
        updateConversion(conversionId, {
          is_multi_contract: true,
          contract_count: parsed.contracts.length
        });

        const multiValidation = validateMultiContractResponse(parsed, sentContracts);
        validationPassed = multiValidation.allValid;
        validationError = multiValidation.firstError;

        const contractStatus = parsed.contracts.map((c: ContractInfo) => ({
          name: c.name,
          validated: c.validated || false,
          attempt: contractAttempts.get(c.name) || attemptNumber
        }));

        sse.sendEvent('validation', {
          passed: validationPassed,
          validCount: multiValidation.validCount,
          failedCount: multiValidation.failedCount,
          attempt: attemptNumber,
          maxAttempts: ANTHROPIC_CONFIG.phase2.maxRetries,
          contracts: contractStatus,
          isMultiContract: true
        });

        // Send contract_ready events for newly validated contracts
        for (const contract of parsed.contracts) {
          if (contract.validated && !sentContracts.has(contract.name)) {
            const contractReadyData: any = {
              contract: contract,
              totalExpected: totalExpectedContracts,
              readySoFar: sentContracts.size + 1
            };

            if (sentContracts.size === 0 && savedDeploymentGuide) {
              contractReadyData.deploymentGuide = savedDeploymentGuide;
            }

            sse.sendEvent('contract_ready', contractReadyData);
            sentContracts.add(contract.name);
          }
        }
      } else {
        const singleValidation = validateContract(parsed.primaryContract);
        validationPassed = singleValidation.valid;
        validationError = singleValidation.error ? enhanceErrorMessage(singleValidation.error, parsed.primaryContract) : singleValidation.error;

        sse.sendEvent('validation', {
          passed: validationPassed,
          attempt: attemptNumber,
          maxAttempts: ANTHROPIC_CONFIG.phase2.maxRetries,
          isMultiContract: false
        });

        if (validationPassed) {
          parsed.validated = true;
          parsed.bytecodeSize = singleValidation.bytecodeSize;
          parsed.artifact = singleValidation.artifact;
          updateConversion(conversionId, { contract_count: 1 });

          if (!sentContracts.has('primary')) {
            const contractNameMatch = parsed.primaryContract.match(/contract\s+(\w+)/);
            const contractName = contractNameMatch ? contractNameMatch[1] : 'Primary Contract';

            sse.sendEvent('contract_ready', {
              contract: {
                id: 'primary',
                name: contractName,
                code: parsed.primaryContract,
                validated: true,
                bytecodeSize: parsed.bytecodeSize,
                artifact: parsed.artifact,
                role: 'primary',
                deploymentOrder: 1,
                dependencies: [],
                constructorParams: []
              },
              totalExpected: 1,
              readySoFar: 1
            });
            sentContracts.add('primary');
          }
        }
      }

      // Save valid contracts for retries
      if (isMultiContract && !validationPassed) {
        savedValidContracts = parsed.contracts.filter((c: ContractInfo) => c.validated);
      }

      logApiCallComplete(
        apiCallId,
        apiCallStartTime,
        true,
        response,
        undefined,
        {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_tokens: usage.cache_read_input_tokens || 0,
          cache_write_tokens: usage.cache_creation_input_tokens || 0
        },
        isMultiContract ? 'multi' : 'single'
      );

      if (validationPassed) {
        // Store contracts in database
        if (isMultiContract) {
          for (const contract of parsed.contracts) {
            const contractUuid = generateUUID();
            const codeHash = generateHash(contract.code);
            const lineCount = contract.code.split('\n').length;

            insertContract({
              conversion_id: conversionId,
              contract_uuid: contractUuid,
              produced_by_attempt: attemptNumber,
              name: contract.name,
              role: contract.role,
              purpose: contract.purpose,
              cashscript_code: contract.code,
              code_hash: codeHash,
              deployment_order: contract.deploymentOrder,
              bytecode_size: contract.bytecodeSize,
              line_count: lineCount,
              is_validated: contract.validated || false
            });
          }
        } else {
          const contractUuid = generateUUID();
          const codeHash = generateHash(parsed.primaryContract);
          const lineCount = parsed.primaryContract.split('\n').length;

          insertContract({
            conversion_id: conversionId,
            contract_uuid: contractUuid,
            produced_by_attempt: attemptNumber,
            name: 'Primary Contract',
            role: 'primary',
            purpose: undefined,
            cashscript_code: parsed.primaryContract,
            code_hash: codeHash,
            deployment_order: 1,
            bytecode_size: parsed.bytecodeSize,
            line_count: lineCount,
            is_validated: parsed.validated || false
          });
        }

        sse.sendEvent('phase4_complete', { message: 'Validation complete' });

        // Check for name drift and update transaction templates
        if (isMultiContract && utxoArchitecture.transactionTemplates?.length > 0) {
          const nameMap = new Map<string, string>();
          const archContracts = utxoArchitecture.contracts || [];
          const validatedContracts = parsed.contracts || [];

          for (let i = 0; i < archContracts.length; i++) {
            const archName = archContracts[i]?.name;
            const validatedName = validatedContracts[i]?.name;
            if (archName && validatedName && archName !== validatedName) {
              console.log(`[Transactions] Name drift detected: "${archName}" → "${validatedName}"`);
              nameMap.set(archName, validatedName);
            }
          }

          if (nameMap.size > 0) {
            const updatedTemplates = applyNameMappingToTemplates(
              utxoArchitecture.transactionTemplates,
              nameMap
            );
            sse.sendEvent('transactions_ready', { transactions: updatedTemplates });
            console.log(`[Transactions] Sent updated templates with ${nameMap.size} name corrections`);
          }
        }

        break;
      }

      // Build retry message
      if (attemptNumber === ANTHROPIC_CONFIG.phase2.maxRetries) {
        sse.sendEvent('error', {
          phase: 4,
          message: `Contract validation failed after ${ANTHROPIC_CONFIG.phase2.maxRetries} attempts. This is not a deterministic system, so just try again - it's likely to work!`,
          details: validationError
        });
        sse.endResponse();
        return;
      }

      if (isMultiContract) {
        const failedContracts = parsed.contracts.filter((c: ContractInfo) => !c.validated);
        const failedContractNames = failedContracts.map((c: ContractInfo) => c.name).join(', ');
        expectedFailedNames = failedContracts.map((c: ContractInfo) => c.name);

        retryMessage = `Fix ONLY the specific compilation errors in the following ${failedContracts.length} ${failedContracts.length === 1 ? 'contract' : 'contracts'}:\n\n`;

        failedContracts.forEach((c: ContractInfo) => {
          retryMessage += `CONTRACT: ${c.name}\n`;
          retryMessage += `CURRENT CODE:\n${c.code}\n\n`;
          retryMessage += `COMPILATION ERROR:\n${c.validationError}\n\n`;
          retryMessage += `INSTRUCTIONS: Make MINIMAL changes to fix ONLY this specific error. Do NOT restructure the contract, change function logic, or modify working code. Only fix what the compiler is complaining about.\n\n`;
          retryMessage += `---\n\n`;
        });

        retryMessage += `CRITICAL RULES:\n`;
        retryMessage += `1. Return ONLY these ${failedContracts.length} ${failedContracts.length === 1 ? 'contract' : 'contracts'}: ${failedContractNames}\n`;
        retryMessage += `2. Do NOT include any already-validated contracts in your response\n`;
        retryMessage += `3. Make MINIMAL changes - only fix the specific compilation error\n`;
        retryMessage += `4. Do NOT change contract structure, logic, or working code\n`;
        retryMessage += `5. If the error is about an unused variable, remove ONLY that variable\n`;
        retryMessage += `6. If the error is about a missing parameter, add ONLY that parameter\n`;
        retryMessage += `7. Do NOT rewrite functions, change business logic, or alter contract behavior`;
      } else {
        retryMessage = `Fix the following compilation error:\n\n`;
        retryMessage += `CURRENT CODE:\n${parsed.primaryContract}\n\n`;
        retryMessage += `COMPILATION ERROR:\n${validationError}\n\n`;
        retryMessage += `INSTRUCTIONS:\n`;
        retryMessage += `Make MINIMAL changes to fix ONLY this specific error.\n`;
        retryMessage += `Do NOT restructure the contract or change its logic.\n`;
        retryMessage += `Only fix what the compiler is complaining about.\n\n`;
        retryMessage += `Return the corrected contract code.`;
      }
    }

    logConversionComplete(conversionId, startTime, 'success');
    sse.sendEvent('done', parsed);
    sse.endResponse();

  } catch (error) {
    console.error('[Conversion] Error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (conversionId) {
      logConversionComplete(conversionId, startTime, 'error');
    }

    if (sentContracts.size === 0) {
      sse.sendEvent('error', {
        message: 'Internal server error',
        details: errorMessage
      });
    } else {
      sse.sendEvent('done', { partialSuccess: true });
    }
    sse.endResponse();
  }
}
