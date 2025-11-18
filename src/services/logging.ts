import {
  insertConversion,
  updateConversion,
  insertApiAttempt,
  updateApiAttempt,
  insertContract,
  updateContract,
  insertContractDependency,
  insertValidation,
  insertRetryProgression,
  recordErrorPattern,
  generateHash,
  generateUUID,
  ConversionRecord,
  ApiAttemptRecord,
  ContractRecord,
  ContractDependencyRecord,
  ValidationRecord,
  RetryProgressionRecord,
} from '../database.js';

// ============================================================================
// CONVERSION LIFECYCLE
// ============================================================================

export interface RequestMetadata {
  session_id: string;
  ip_address?: string;
}

/**
 * Log the start of a new conversion
 */
export async function logConversionStart(
  metadata: RequestMetadata,
  inputContract: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const record: Omit<ConversionRecord, 'id'> = {
          session_id: metadata.session_id,
          ip_address: metadata.ip_address,
          created_at: new Date().toISOString(),
          total_attempts: 0,
          solidity_code: inputContract,
          solidity_hash: generateHash(inputContract),
          is_multi_contract: false,
          contract_count: 0,
        };

        const id = insertConversion(record);
        resolve(id);
      } catch (error) {
        console.error('[Logging] Error logging conversion start:', error);
        reject(error);
      }
    });
  });
}

/**
 * Update conversion record
 */
export async function logConversionUpdate(
  conversionId: number,
  updates: Partial<ConversionRecord>
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        updateConversion(conversionId, updates);
        resolve();
      } catch (error) {
        console.error('[Logging] Error updating conversion:', error);
        reject(error);
      }
    });
  });
}

/**
 * Log the completion of a conversion
 */
export async function logConversionComplete(
  conversionId: number,
  startTime: number,
  status: 'success' | 'failed' | 'timeout',
  outputContract?: string,
  explanation?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const updates: Partial<ConversionRecord> = {
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          final_status: status === 'success' ? 'success' : 'failed',
        };

        updateConversion(conversionId, updates);
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging conversion completion:', error);
        reject(error);
      }
    });
  });
}

// ============================================================================
// API ATTEMPTS (with cache metrics)
// ============================================================================

/**
 * Log the start of an API attempt
 */
export async function logApiCallStart(
  conversionId: number,
  attemptNumber: number,
  model: string,
  maxTokens: number,
  userMessage: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        // Update conversion total_attempts
        updateConversion(conversionId, { total_attempts: attemptNumber });

        const record: Omit<ApiAttemptRecord, 'id'> = {
          conversion_id: conversionId,
          attempt_number: attemptNumber,
          started_at: new Date().toISOString(),
          success: false,
          user_message: userMessage,
        };

        const id = insertApiAttempt(record);
        resolve(id);
      } catch (error) {
        console.error('[Logging] Error logging API call start:', error);
        reject(error);
      }
    });
  });
}

/**
 * Log the completion of an API attempt with full metrics
 */
export async function logApiCallComplete(
  apiCallId: number,
  startTime: number,
  success: boolean,
  responseJson?: string,
  error?: string,
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  },
  responseType?: 'single' | 'multi'
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        // Calculate cost if token usage provided
        let cost_usd: number | undefined;
        if (tokenUsage) {
          // Sonnet 4.5: $3/MTok input, $15/MTok output
          // Cache: write=$6/MTok, read=$0.30/MTok
          const inputCost = (tokenUsage.input_tokens * 3.0) / 1000000;
          const outputCost = (tokenUsage.output_tokens * 15.0) / 1000000;
          const cacheWriteCost = ((tokenUsage.cache_write_tokens || 0) * 6.0) / 1000000;
          const cacheReadCost = ((tokenUsage.cache_read_tokens || 0) * 0.30) / 1000000;
          cost_usd = inputCost + outputCost + cacheWriteCost + cacheReadCost;
        }

        const updates: Partial<ApiAttemptRecord> = {
          response_time_ms: Date.now() - startTime,
          success,
          response_json: responseJson,
          error_message: error,
          input_tokens: tokenUsage?.input_tokens,
          output_tokens: tokenUsage?.output_tokens,
          cache_read_tokens: tokenUsage?.cache_read_tokens || 0,
          cache_write_tokens: tokenUsage?.cache_write_tokens || 0,
          cost_usd,
          response_type: responseType,
        };

        updateApiAttempt(apiCallId, updates);
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging API call completion:', error);
        reject(error);
      }
    });
  });
}

// ============================================================================
// CONTRACTS & DEPENDENCIES
// ============================================================================

/**
 * Log a contract produced by a successful conversion
 */
export async function logContract(
  conversionId: number,
  attemptNumber: number,
  contract: {
    name: string;
    code: string;
    role?: 'primary' | 'helper' | 'state';
    purpose?: string;
    deploymentOrder?: number;
    bytecodeSize?: number;
    isValidated: boolean;
  }
): Promise<number> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const record: Omit<ContractRecord, 'id'> = {
          conversion_id: conversionId,
          contract_uuid: generateUUID(),
          produced_by_attempt: attemptNumber,
          name: contract.name,
          role: contract.role,
          purpose: contract.purpose,
          cashscript_code: contract.code,
          code_hash: generateHash(contract.code),
          deployment_order: contract.deploymentOrder,
          bytecode_size: contract.bytecodeSize,
          line_count: contract.code.split('\n').length,
          is_validated: contract.isValidated,
        };

        const id = insertContract(record);
        resolve(id);
      } catch (error) {
        console.error('[Logging] Error logging contract:', error);
        reject(error);
      }
    });
  });
}

/**
 * Log multiple contracts from a multi-contract response
 */
export async function logContracts(
  conversionId: number,
  attemptNumber: number,
  contracts: Array<{
    name: string;
    code: string;
    role?: 'primary' | 'helper' | 'state';
    purpose?: string;
    deploymentOrder?: number;
    bytecodeSize?: number;
    isValidated: boolean;
  }>
): Promise<number[]> {
  const contractIds: number[] = [];

  for (const contract of contracts) {
    const id = await logContract(conversionId, attemptNumber, contract);
    contractIds.push(id);
  }

  // Update conversion to reflect multi-contract
  await logConversionUpdate(conversionId, {
    is_multi_contract: contracts.length > 1,
    contract_count: contracts.length,
  });

  return contractIds;
}

/**
 * Log a dependency between two contracts
 */
export async function logContractDependency(
  contractId: number,
  dependsOnContractId: number,
  dependencyType: 'parameter' | 'call' | 'state' | 'deployment',
  description?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const record: Omit<ContractDependencyRecord, 'id'> = {
          contract_id: contractId,
          depends_on_contract_id: dependsOnContractId,
          dependency_type: dependencyType,
          description,
        };

        insertContractDependency(record);
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging contract dependency:', error);
        reject(error);
      }
    });
  });
}

// ============================================================================
// VALIDATIONS
// ============================================================================

/**
 * Log validation result (backward compatible with old signature)
 */
export async function logValidationResult(
  conversionId: number,
  isValid: boolean,
  errorMessage?: string,
  bytecodeSize?: number,
  attemptNumber: number = 1,
  contractId?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        // Categorize error if present
        let errorCategory: ValidationRecord['error_category'];
        if (errorMessage && typeof errorMessage === 'string') {
          if (errorMessage.includes('Unused variable')) {
            errorCategory = 'unused_variable';
          } else if (errorMessage.includes('type') || errorMessage.includes('Type')) {
            errorCategory = 'type_error';
          } else if (errorMessage.includes('syntax') || errorMessage.includes('Syntax')) {
            errorCategory = 'syntax_error';
          } else if (errorMessage.includes('compilation')) {
            errorCategory = 'compilation_error';
          } else {
            errorCategory = 'unknown';
          }
        }

        const record: Omit<ValidationRecord, 'id'> = {
          conversion_id: conversionId,
          attempt_number: attemptNumber,
          contract_id: contractId,
          validated_at: new Date().toISOString(),
          is_valid: isValid,
          error_message: errorMessage,
          error_category: errorCategory,
        };

        insertValidation(record);

        // Record error pattern for analytics
        if (!isValid && errorMessage && errorCategory) {
          const signature = generateHash(errorMessage.substring(0, 100));
          recordErrorPattern(errorCategory, signature, errorMessage, false);
        }

        resolve();
      } catch (error) {
        console.error('[Logging] Error logging validation result:', error);
        reject(error);
      }
    });
  });
}

// ============================================================================
// RETRY TRACKING
// ============================================================================

/**
 * Log retry attempt (backward compatible signature)
 */
export async function logRetryAttempt(
  conversionId: number,
  success: boolean
): Promise<void> {
  // Legacy function - simplified logging for backward compatibility
  // No longer tracks detailed retry progression
  return Promise.resolve();
}

/**
 * Log detailed retry progression for tracking error evolution
 */
export async function logRetryProgression(
  conversionId: number,
  attemptNumber: number,
  contractsAttempted: number,
  contractsFailed: number,
  primaryErrorCategory?: string,
  errorResolved?: boolean,
  resolutionMethod?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const record: Omit<RetryProgressionRecord, 'id'> = {
          conversion_id: conversionId,
          attempt_number: attemptNumber,
          contracts_attempted: contractsAttempted,
          contracts_failed: contractsFailed,
          primary_error_category: primaryErrorCategory,
          error_resolved: errorResolved || false,
          resolution_method: resolutionMethod,
        };

        insertRetryProgression(record);
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging retry progression:', error);
        reject(error);
      }
    });
  });
}

/**
 * Mark an error as resolved by retry (for analytics)
 */
export async function logErrorResolved(
  errorCategory: string,
  errorSignature: string,
  errorMessage: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        recordErrorPattern(errorCategory, errorSignature, errorMessage, true);
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging error resolution:', error);
        reject(error);
      }
    });
  });
}

// ============================================================================
// LEGACY COMPATIBILITY (deprecated but maintained for backward compatibility)
// ============================================================================

/**
 * @deprecated Use logContracts instead
 */
export async function logAlternatives(
  conversionId: number,
  alternatives: Array<{ name: string; contract: string; rationale: string }>
): Promise<void> {
  // Legacy function - no longer stores alternatives separately
  // Could be adapted to store as contracts with role='helper' if needed
  return Promise.resolve();
}

/**
 * @deprecated No longer stored in database
 */
export async function logConsiderations(
  conversionId: number,
  considerations: string[]
): Promise<void> {
  // Legacy function - considerations no longer stored
  return Promise.resolve();
}

/**
 * @deprecated Use logValidationResult and recordErrorPattern instead
 */
export async function logError(
  errorType: string,
  errorMessage: string,
  conversionId?: number,
  stackTrace?: string,
  context?: Record<string, any>
): Promise<void> {
  // For backward compatibility, log as validation error
  if (conversionId) {
    return logValidationResult(conversionId, 1, false, errorMessage);
  }
  return Promise.resolve();
}
