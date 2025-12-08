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
import * as phase1 from '../phases/phase1/index.js';
import * as phase2 from '../phases/phase2/index.js';
import * as phase3 from '../phases/phase3/index.js';
import * as phase4 from '../phases/phase4/index.js';
import { applyNameMappingToTemplates, type ContractInfo } from '../phases/phase4/index.js';

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

function persistContracts(conversionId: number, contracts: ContractInfo[], failed: boolean = false): void {
  updateConversion(conversionId, {
    is_multi_contract: contracts.length > 1,
    contract_count: contracts.length,
  });

  for (const contract of contracts) {
    insertContract({
      conversion_id: conversionId,
      contract_uuid: generateUUID(),
      name: contract.name,
      role: contract.role as 'primary' | 'helper' | 'state' | undefined,
      purpose: contract.purpose,
      cashscript_code: contract.code,
      code_hash: generateHash(contract.code),
      bytecode_size: contract.bytecodeSize,
      line_count: contract.code.split('\n').length,
      is_validated: contract.validated || false,
      validation_error: contract.validationError,
    });
  }

  if (failed) {
    console.log(`[Conversion] Persisted ${contracts.length} contracts with failures for debugging`);
  }
}

export async function handleConversion(
  req: RequestWithMetadata,
  res: Response,
  anthropic: Anthropic,
  knowledgeBase: string
): Promise<void> {
  const startTime = Date.now();
  let conversionId: number | undefined;
  const allContracts: Map<string, ContractInfo> = new Map();

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

    const phase1Result = await phase1.execute(anthropic, conversionId, contract);
    const domainModel = phase1Result.domainModel;

    sse.sendEvent('phase1_complete', {
      message: 'Domain extraction complete',
      domain: domainModel.domain,
      entities: domainModel.entities.length,
      transitions: domainModel.transitions.length,
    });

    // PHASE 2: UTXO Architecture Design
    sse.sendEvent('phase2_start', { message: 'Designing UTXO architecture...' });

    if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

    const phase2Result = await phase2.execute(anthropic, conversionId, domainModel);
    const utxoArchitecture = phase2Result.architecture;

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

    // PHASE 3: Code Generation
    sse.sendEvent('phase3_start', { message: 'Generating CashScript...' });

    if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

    const phase3Result = await phase3.execute(
      anthropic,
      conversionId,
      domainModel,
      utxoArchitecture,
      knowledgeBase
    );
    const contracts = phase3Result.contracts;

    sse.sendEvent('phase3_complete', { message: 'Code generation complete' });

    // PHASE 4: Validation + Fix Loop
    sse.sendEvent('phase4_start', {
      message: "Validating contracts... You'll be redirected to results as soon as we have something to show.",
    });

    if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

    let finalContracts: ContractInfo[] = [];

    for await (const event of phase4.execute(anthropic, contracts, knowledgeBase, conversionId)) {
      if (sse.isDisconnected()) throw new Error('AbortError: Client disconnected');

      switch (event.type) {
        case 'validation_start':
          // Already sent phase4_start above
          break;

        case 'validation_progress':
          sse.sendEvent('validation', {
            passed: event.failedCount === 0,
            validCount: event.validCount,
            failedCount: event.failedCount,
            attempt: event.attempt,
            maxAttempts: ANTHROPIC_CONFIG.phase4.maxRetries,
          });
          break;

        case 'contract_validated':
          allContracts.set(event.contract.name, event.contract);
          sse.sendEvent('contract_ready', {
            contract: event.contract,
            totalExpected: event.totalExpected,
            readySoFar: event.readySoFar,
          });
          break;

        case 'retrying':
          console.log(`[Conversion] Retry attempt ${event.attempt} for: ${event.failedNames.join(', ')}`);
          sse.sendEvent('retrying', { attempt: event.attempt });
          break;

        case 'complete':
          finalContracts = event.contracts;
          break;

        case 'max_retries_exceeded':
          if (conversionId && allContracts.size > 0) {
            persistContracts(conversionId, Array.from(allContracts.values()), true);
            logConversionComplete(conversionId, startTime, 'failed');
          }
          sse.sendEvent('error', {
            phase: 4,
            message: `Contract validation failed after ${ANTHROPIC_CONFIG.phase4.maxRetries} attempts. This is not a deterministic system, so just try again - it's likely to work!`,
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
        const updatedSpecs = contractSpecs.map(spec => ({
          ...spec,
          name: nameMap.get(spec.name) || spec.name
        }));
        sse.sendEvent('transactions_ready', { transactions: updatedTemplates, contractSpecs: updatedSpecs });
      }
    }

    logConversionComplete(conversionId, startTime, 'success');
    sse.sendEvent('done', { contracts: finalContracts });
    sse.endResponse();

  } catch (error) {
    console.error('[Conversion] Error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (conversionId) {
      if (allContracts.size > 0) {
        persistContracts(conversionId, Array.from(allContracts.values()), true);
      }
      logConversionComplete(conversionId, startTime, 'error');
    }

    sse.sendEvent('error', {
      message: 'Internal server error',
      details: errorMessage,
    });
    sse.endResponse();
  }
}
