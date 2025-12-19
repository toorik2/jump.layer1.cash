import {
  insertConversion,
  updateConversion,
  generateHash,
  generateUUID,
  ConversionRecord,
} from '../database.js';
import type { RequestMetadata } from '../types/logging.js';

export type { RequestMetadata };

/**
 * Log the start of a new conversion
 */
export function logConversionStart(
  metadata: RequestMetadata,
  inputContract: string
): { id: number; shareToken: string } {
  const shareToken = generateUUID();
  const record: Omit<ConversionRecord, 'id'> = {
    session_id: metadata.session_id,
    ip_address: metadata.ip_address,
    user_agent: metadata.user_agent,
    created_at: new Date().toISOString(),
    total_attempts: 0,
    solidity_code: inputContract,
    solidity_hash: generateHash(inputContract),
    is_multi_contract: false,
    contract_count: 0,
    share_token: shareToken,
  };
  return { id: insertConversion(record), shareToken };
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
