// Request metadata attached by middleware
export interface RequestMetadata {
  session_id: string;
  ip_address: string;
  user_agent: string;
}
