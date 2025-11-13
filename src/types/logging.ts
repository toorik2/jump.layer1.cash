export interface ConversionRecord {
  id?: number;
  session_id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
  status: 'in_progress' | 'success' | 'error' | 'validation_failed';
  input_contract: string;
  input_contract_length: number;
  output_contract?: string;
  explanation?: string;
  validation_success?: boolean;
  validation_error?: string;
  bytecode_size?: number;
  retry_attempted: boolean;
  retry_success?: boolean;
}

export interface AnthropicApiCallRecord {
  id?: number;
  conversion_id: number;
  attempt_number: number;
  created_at: string;
  model: string;
  max_tokens: number;
  system_prompt?: string; // Optional - avoid storing large knowledge base
  user_message: string;
  response_text?: string;
  response_time_ms?: number;
  success: boolean;
  error?: string;
}

export interface AlternativeRecord {
  id?: number;
  conversion_id: number;
  name: string;
  contract: string;
  rationale: string;
  validation_success?: boolean;
  validation_error?: string;
}

export interface ConsiderationRecord {
  id?: number;
  conversion_id: number;
  consideration_text: string;
  order: number;
}

export interface ErrorRecord {
  id?: number;
  conversion_id?: number;
  created_at: string;
  error_type: 'validation_error' | 'api_error' | 'parsing_error' | 'database_error' | 'unknown_error';
  error_message: string;
  stack_trace?: string;
  context?: string; // JSON string with additional context
}

// Request metadata attached by middleware
export interface RequestMetadata {
  session_id: string;
  ip_address: string;
  user_agent: string;
}
