/**
 * Conversion Handler - Orchestrates the 4-phase EVM to CashScript conversion
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import type { RequestWithMetadata } from '../middleware/logger.js';
import { ANTHROPIC_CONFIG } from '../config.js';
import { updateConversion, insertContract, generateHash, generateUUID } from '../database.js';
import {
  logConversionStart,
  logConversionComplete,
} from '../services/logging.js';
import {
  executeDomainExtraction,
  executeArchitectureDesign,
  applyNameMappingToTemplates,
  type ContractInfo,
} from '../phases/index.js';
import { ValidationOrchestrator } from '../phases/validation-orchestrator.js';

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

function validateContractInput(contract: any): { valid: boolean; error?: string } {
  if (typeof contract !== 'string') {
    return { valid: false, error: 'Contract must be a string' };
  }
  if (!contract || contract.trim().length === 0) {
    return { valid: false, error: 'Contract cannot be empty' };
  }
  if (contract.length < 10) {
    return { valid: false, error: 'Contract must be at least 10 characters' };
  }
  if (contract.length > 50000) {
    return { valid: false, error: 'Contract too large. Maximum 50,000 characters allowed.' };
  }
  return { valid: true };
}

function persistContracts(conversionId: number, contracts: ContractInfo[]): void {
  updateConversion(conversionId, {
    is_multi_contract: contracts.length > 1,
    contract_count: contracts.length,
  });

  for (const contract of contracts) {
    insertContract({
      conversion_id: conversionId,
      contract_uuid: generateUUID(),
      produced_by_attempt: 1, // Simplified - could track actual attempt
      name: contract.name,
      role: contract.role,
      purpose: contract.purpose,
      cashscript_code: contract.code,
      code_hash: generateHash(contract.code),
      deployment_order: contract.deploymentOrder,
      bytecode_size: contract.bytecodeSize,
      line_count: contract.code.split('\n').length,
      is_validated: contract.validated || false,
    });
  }
}

export async function handleConversion(
  req: RequestWithMetadata,
  res: Response,
  anthropic: Anthropic,
  systemPrompt: string
): Promise<void> {
  const startTime = Date.now();
  let conversionId: number | undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sse = createSSEWriter(res);

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

    if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

    const phase1Result = await executeDomainExtraction(anthropic, conversionId, contract);
    const domainModel = phase1Result.domainModel;
    const domainModelJSON = JSON.stringify(domainModel, null, 2);

    sse.sendEvent('phase1_complete', {
      message: 'Domain extraction complete',
      domain: domainModel.domain,
      entities: domainModel.entities.length,
      transitions: domainModel.transitions.length,
    });

    // PHASE 2: UTXO Architecture Design
    sse.sendEvent('phase2_start', { message: 'Designing UTXO architecture...' });

    if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

    const phase2Result = await executeArchitectureDesign(anthropic, conversionId, domainModel);
    const utxoArchitecture = phase2Result.architecture;
    const utxoArchitectureJSON = JSON.stringify(utxoArchitecture, null, 2);

    const contractCount = utxoArchitecture.contracts?.length || 0;
    const patternNames = utxoArchitecture.patterns?.map(p => p?.name || 'unnamed') || [];

    sse.sendEvent('phase2_complete', {
      message: 'Architecture design complete',
      contracts: contractCount,
      patterns: patternNames,
      durationMs: phase2Result.durationMs,
    });

    const transactionTemplates = utxoArchitecture.transactionTemplates || [];
    const contractSpecs = utxoArchitecture.contracts?.map(c => ({
      name: c.name,
      custodies: c.custodies,
      validates: c.validates,
    })) || [];

    if (transactionTemplates.length > 0 || contractSpecs.length > 0) {
      sse.sendEvent('transactions_ready', {
        transactions: transactionTemplates,
        contractSpecs,
      });
    }

    // PHASE 3 & 4: Code Generation with Validation
    sse.sendEvent('phase3_start', { message: 'Generating CashScript...' });

    if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

    const orchestrator = new ValidationOrchestrator(anthropic, systemPrompt);
    let finalContracts: ContractInfo[] = [];
    let finalDeploymentGuide: any = null;

    for await (const event of orchestrator.run(domainModelJSON, utxoArchitectureJSON)) {
      if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

      switch (event.type) {
        case 'generation_complete':
          sse.sendEvent('phase3_complete', { message: 'Code generation complete' });
          break;

        case 'validation_start':
          sse.sendEvent('phase4_start', {
            message: "Validating contracts... You'll be redirected to results as soon as we have something to show.",
          });
          break;

        case 'validation_progress':
          sse.sendEvent('validation', {
            passed: event.failedCount === 0,
            validCount: event.validCount,
            failedCount: event.failedCount,
            attempt: event.attempt,
            maxAttempts: ANTHROPIC_CONFIG.phase2.maxRetries,
            isMultiContract: true,
          });
          break;

        case 'contract_validated':
          sse.sendEvent('contract_ready', {
            contract: event.contract,
            totalExpected: event.totalExpected,
            readySoFar: event.readySoFar,
            ...(event.deploymentGuide ? { deploymentGuide: event.deploymentGuide } : {}),
          });
          break;

        case 'retrying':
          console.log(`[Orchestrator] Retry attempt ${event.attempt} for: ${event.failedNames.join(', ')}`);
          break;

        case 'complete':
          finalContracts = event.contracts;
          finalDeploymentGuide = event.deploymentGuide;
          break;

        case 'max_retries_exceeded':
          sse.sendEvent('error', {
            phase: 4,
            message: `Contract validation failed after ${ANTHROPIC_CONFIG.phase2.maxRetries} attempts. This is not a deterministic system, so just try again - it's likely to work!`,
            details: event.lastError,
          });
          sse.endResponse();
          return;
      }
    }

    // Persist to database
    persistContracts(conversionId, finalContracts);

    sse.sendEvent('phase4_complete', { message: 'Validation complete' });

    // Handle name drift for transaction templates
    if (utxoArchitecture.transactionTemplates?.length > 0) {
      const nameMap = new Map<string, string>();
      const archContracts = utxoArchitecture.contracts || [];

      for (let i = 0; i < archContracts.length && i < finalContracts.length; i++) {
        const archName = archContracts[i]?.name;
        const validatedName = finalContracts[i]?.name;
        if (archName && validatedName && archName !== validatedName) {
          console.log(`[Transactions] Name drift: "${archName}" → "${validatedName}"`);
          nameMap.set(archName, validatedName);
        }
      }

      if (nameMap.size > 0) {
        const updatedTemplates = applyNameMappingToTemplates(utxoArchitecture.transactionTemplates, nameMap);
        sse.sendEvent('transactions_ready', { transactions: updatedTemplates });
      }
    }

    logConversionComplete(conversionId, startTime, 'success');
    sse.sendEvent('done', { contracts: finalContracts, deploymentGuide: finalDeploymentGuide });
    sse.endResponse();

  } catch (error) {
    console.error('[Conversion] Error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (conversionId) {
      logConversionComplete(conversionId, startTime, 'error');
    }

    sse.sendEvent('error', {
      message: 'Internal server error',
      details: errorMessage,
    });
    sse.endResponse();
  }
}
