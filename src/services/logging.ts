import {
  insertConversion,
  updateConversion,
  insertAnthropicApiCall,
  updateAnthropicApiCall,
  insertAlternative,
  insertConsideration,
  insertError,
} from '../database.js';
import {
  ConversionRecord,
  AnthropicApiCallRecord,
  AlternativeRecord,
  ConsiderationRecord,
  ErrorRecord,
  RequestMetadata,
} from '../types/logging.js';

// Async wrapper for inserting conversion record
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
          user_agent: metadata.user_agent,
          created_at: new Date().toISOString(),
          status: 'in_progress',
          input_contract: inputContract,
          input_contract_length: inputContract.length,
          retry_attempted: false,
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

// Async wrapper for updating conversion record
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

// Async wrapper for logging conversion completion
export async function logConversionComplete(
  conversionId: number,
  startTime: number,
  status: 'success' | 'error' | 'validation_failed',
  outputContract?: string,
  explanation?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const updates: Partial<ConversionRecord> = {
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          status,
          output_contract: outputContract,
          explanation: explanation,
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

// Async wrapper for logging Anthropic API call start
export async function logApiCallStart(
  conversionId: number,
  attemptNumber: number,
  model: string,
  maxTokens: number,
  systemPrompt: string,
  userMessage: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const record: Omit<AnthropicApiCallRecord, 'id'> = {
          conversion_id: conversionId,
          attempt_number: attemptNumber,
          created_at: new Date().toISOString(),
          model,
          max_tokens: maxTokens,
          system_prompt: systemPrompt,
          user_message: userMessage,
          success: false,
        };

        const id = insertAnthropicApiCall(record);
        resolve(id);
      } catch (error) {
        console.error('[Logging] Error logging API call start:', error);
        reject(error);
      }
    });
  });
}

// Async wrapper for logging Anthropic API call completion
export async function logApiCallComplete(
  apiCallId: number,
  startTime: number,
  success: boolean,
  responseText?: string,
  error?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const updates: Partial<AnthropicApiCallRecord> = {
          response_time_ms: Date.now() - startTime,
          success,
          response_text: responseText,
          error,
        };

        updateAnthropicApiCall(apiCallId, updates);
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging API call completion:', error);
        reject(error);
      }
    });
  });
}

// Async wrapper for logging alternatives
export async function logAlternatives(
  conversionId: number,
  alternatives: Array<{
    name: string;
    contract: string;
    rationale: string;
  }>
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        for (const alt of alternatives) {
          const record: Omit<AlternativeRecord, 'id'> = {
            conversion_id: conversionId,
            name: alt.name,
            contract: alt.contract,
            rationale: alt.rationale,
          };

          insertAlternative(record);
        }
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging alternatives:', error);
        reject(error);
      }
    });
  });
}

// Async wrapper for logging considerations
export async function logConsiderations(
  conversionId: number,
  considerations: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        considerations.forEach((text, index) => {
          const record: Omit<ConsiderationRecord, 'id'> = {
            conversion_id: conversionId,
            consideration_text: text,
            order: index,
          };

          insertConsideration(record);
        });
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging considerations:', error);
        reject(error);
      }
    });
  });
}

// Async wrapper for logging errors
export async function logError(
  errorType: ErrorRecord['error_type'],
  errorMessage: string,
  conversionId?: number,
  stackTrace?: string,
  context?: Record<string, any>
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const record: Omit<ErrorRecord, 'id'> = {
          conversion_id: conversionId,
          created_at: new Date().toISOString(),
          error_type: errorType,
          error_message: errorMessage,
          stack_trace: stackTrace,
          context: context ? JSON.stringify(context) : undefined,
        };

        insertError(record);
        resolve();
      } catch (error) {
        console.error('[Logging] Error logging error:', error);
        reject(error);
      }
    });
  });
}

// Helper to log validation results
export async function logValidationResult(
  conversionId: number,
  success: boolean,
  error?: string,
  bytecodeSize?: number
): Promise<void> {
  return logConversionUpdate(conversionId, {
    validation_success: success,
    validation_error: error,
    bytecode_size: bytecodeSize,
  });
}

// Helper to log retry attempt
export async function logRetryAttempt(
  conversionId: number,
  success: boolean
): Promise<void> {
  return logConversionUpdate(conversionId, {
    retry_attempted: true,
    retry_success: success,
  });
}
