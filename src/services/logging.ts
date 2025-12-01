import {
  insertConversion,
  updateConversion,
  insertApiAttempt,
  updateApiAttempt,
  generateHash,
  ConversionRecord,
  ApiAttemptRecord,
} from '../database.js';
import type { RequestMetadata } from '../types/logging.js';

// Re-export for consumers
export type { RequestMetadata };

// ============================================================================
// CONVERSION LIFECYCLE
// ============================================================================

/**
 * Log the start of a new conversion
 */
export function logConversionStart(
  metadata: RequestMetadata,
  inputContract: string
): number {
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
  return insertConversion(record);
}

/**
 * Log the completion of a conversion
 */
export function logConversionComplete(
  conversionId: number,
  startTime: number,
  status: 'success' | 'failed' | 'timeout' | 'error'
): void {
  const updates: Partial<ConversionRecord> = {
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    final_status: status === 'success' ? 'success' : 'failed',
  };
  updateConversion(conversionId, updates);
}

// ============================================================================
// API ATTEMPTS
// ============================================================================

/**
 * Log the start of an API attempt
 */
export function logApiCallStart(
  conversionId: number,
  attemptNumber: number,
  userMessage: string
): number {
  updateConversion(conversionId, { total_attempts: attemptNumber });

  const record: Omit<ApiAttemptRecord, 'id'> = {
    conversion_id: conversionId,
    attempt_number: attemptNumber,
    started_at: new Date().toISOString(),
    success: false,
    user_message: userMessage,
  };
  return insertApiAttempt(record);
}

/**
 * Log the completion of an API attempt with full metrics
 */
export function logApiCallComplete(
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
): void {
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
}
