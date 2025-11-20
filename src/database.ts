import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const DB_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DB_DIR, 'conversions.db');

let db: Database.Database;

export function initializeDatabase(): Database.Database {
  // Ensure data directory exists
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  createTables();

  console.log(`[Database] Initialized at ${DB_PATH}`);

  return db;
}

function createTables() {
  // 1. CONVERSIONS - Root conversion session
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      final_status TEXT CHECK(final_status IN ('success', 'failed', 'timeout')),
      total_attempts INTEGER NOT NULL DEFAULT 1,
      solidity_code TEXT NOT NULL,
      solidity_hash TEXT NOT NULL,
      is_multi_contract INTEGER NOT NULL DEFAULT 0,
      contract_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  // 2. API_ATTEMPTS - Each of 1-10 retry attempts
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 10),
      started_at TEXT NOT NULL,
      response_time_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      cost_usd REAL,
      success INTEGER NOT NULL DEFAULT 0,
      response_type TEXT CHECK(response_type IN ('single', 'multi')),
      user_message TEXT NOT NULL,
      response_json TEXT,
      error_message TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
    )
  `);

  // 3. CONTRACTS - Individual CashScript contracts produced
  db.exec(`
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      contract_uuid TEXT NOT NULL UNIQUE,
      produced_by_attempt INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT CHECK(role IN ('primary', 'helper', 'state')),
      purpose TEXT,
      cashscript_code TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      deployment_order INTEGER,
      bytecode_size INTEGER,
      line_count INTEGER,
      is_validated INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
    )
  `);

  // 4. CONTRACT_DEPENDENCIES - Multi-contract relationship graph
  db.exec(`
    CREATE TABLE IF NOT EXISTS contract_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      depends_on_contract_id INTEGER NOT NULL,
      dependency_type TEXT CHECK(dependency_type IN ('parameter', 'call', 'state', 'deployment')),
      description TEXT,
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
      UNIQUE(contract_id, depends_on_contract_id, dependency_type)
    )
  `);

  // 5. VALIDATIONS - Compilation results per contract per attempt
  db.exec(`
    CREATE TABLE IF NOT EXISTS validations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,
      contract_id INTEGER,
      validated_at TEXT NOT NULL,
      is_valid INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      error_category TEXT CHECK(error_category IN (
        'unused_variable', 'type_error', 'syntax_error',
        'logic_error', 'compilation_error', 'unknown'
      )),
      compiler_output TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    )
  `);

  // 6. RETRY_PROGRESSION - Track how errors evolve across attempts
  db.exec(`
    CREATE TABLE IF NOT EXISTS retry_progression (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,
      contracts_attempted INTEGER NOT NULL DEFAULT 0,
      contracts_failed INTEGER NOT NULL DEFAULT 0,
      primary_error_category TEXT,
      error_resolved INTEGER NOT NULL DEFAULT 0,
      resolution_method TEXT,
      notes TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE,
      UNIQUE(conversion_id, attempt_number)
    )
  `);

  // 7. ERROR_PATTERNS - Aggregated error tracking for analytics
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_category TEXT NOT NULL,
      error_signature TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      retry_fix_count INTEGER NOT NULL DEFAULT 0,
      retry_fix_rate REAL,
      sample_error_message TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(error_category, error_signature)
    )
  `);

  // 8. SEMANTIC_ANALYSES - Phase 1 semantic extraction results
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      analysis_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model_used TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      response_time_ms INTEGER,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversions_session ON conversions(session_id);
    CREATE INDEX IF NOT EXISTS idx_conversions_created ON conversions(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(final_status);
    CREATE INDEX IF NOT EXISTS idx_conversions_hash ON conversions(solidity_hash);

    CREATE INDEX IF NOT EXISTS idx_attempts_conversion ON api_attempts(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_number ON api_attempts(attempt_number);

    CREATE INDEX IF NOT EXISTS idx_contracts_conversion ON contracts(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_uuid ON contracts(contract_uuid);
    CREATE INDEX IF NOT EXISTS idx_contracts_role ON contracts(role);

    CREATE INDEX IF NOT EXISTS idx_dependencies_contract ON contract_dependencies(contract_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_depends ON contract_dependencies(depends_on_contract_id);

    CREATE INDEX IF NOT EXISTS idx_validations_conversion ON validations(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_validations_contract ON validations(contract_id);
    CREATE INDEX IF NOT EXISTS idx_validations_category ON validations(error_category);

    CREATE INDEX IF NOT EXISTS idx_progression_conversion ON retry_progression(conversion_id);

    CREATE INDEX IF NOT EXISTS idx_patterns_category ON error_patterns(error_category);
    CREATE INDEX IF NOT EXISTS idx_patterns_signature ON error_patterns(error_signature);

    CREATE INDEX IF NOT EXISTS idx_semantic_conversion ON semantic_analyses(conversion_id);
  `);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function generateHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function generateUUID(): string {
  return createHash('sha256')
    .update(Date.now().toString() + Math.random().toString())
    .digest('hex')
    .substring(0, 32);
}

// ============================================================================
// CONVERSIONS TABLE
// ============================================================================

export interface ConversionRecord {
  id?: number;
  session_id: string;
  ip_address?: string;
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
  final_status?: 'success' | 'failed' | 'timeout';
  total_attempts: number;
  solidity_code: string;
  solidity_hash: string;
  is_multi_contract: boolean;
  contract_count: number;
}

export function insertConversion(record: Omit<ConversionRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO conversions (
      session_id, ip_address, created_at, completed_at, duration_ms,
      final_status, total_attempts, solidity_code, solidity_hash,
      is_multi_contract, contract_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.session_id,
    record.ip_address || null,
    record.created_at,
    record.completed_at || null,
    record.duration_ms || null,
    record.final_status || null,
    record.total_attempts,
    record.solidity_code,
    record.solidity_hash,
    record.is_multi_contract ? 1 : 0,
    record.contract_count
  );

  return result.lastInsertRowid as number;
}

export function updateConversion(id: number, updates: Partial<ConversionRecord>): void {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }
  if (updates.duration_ms !== undefined) {
    fields.push('duration_ms = ?');
    values.push(updates.duration_ms);
  }
  if (updates.final_status !== undefined) {
    fields.push('final_status = ?');
    values.push(updates.final_status);
  }
  if (updates.total_attempts !== undefined) {
    fields.push('total_attempts = ?');
    values.push(updates.total_attempts);
  }
  if (updates.is_multi_contract !== undefined) {
    fields.push('is_multi_contract = ?');
    values.push(updates.is_multi_contract ? 1 : 0);
  }
  if (updates.contract_count !== undefined) {
    fields.push('contract_count = ?');
    values.push(updates.contract_count);
  }

  if (fields.length === 0) return;

  values.push(id);
  const stmt = db.prepare(`UPDATE conversions SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

// ============================================================================
// API_ATTEMPTS TABLE
// ============================================================================

export interface ApiAttemptRecord {
  id?: number;
  conversion_id: number;
  attempt_number: number;
  started_at: string;
  response_time_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  success: boolean;
  response_type?: 'single' | 'multi';
  user_message: string;
  response_json?: string;
  error_message?: string;
}

export function insertApiAttempt(record: Omit<ApiAttemptRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO api_attempts (
      conversion_id, attempt_number, started_at, response_time_ms,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cost_usd, success, response_type, user_message, response_json, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.attempt_number,
    record.started_at,
    record.response_time_ms || null,
    record.input_tokens || null,
    record.output_tokens || null,
    record.cache_read_tokens || 0,
    record.cache_write_tokens || 0,
    record.cost_usd || null,
    record.success ? 1 : 0,
    record.response_type || null,
    record.user_message,
    record.response_json || null,
    record.error_message || null
  );

  return result.lastInsertRowid as number;
}

export function updateApiAttempt(id: number, updates: Partial<ApiAttemptRecord>): void {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.response_time_ms !== undefined) {
    fields.push('response_time_ms = ?');
    values.push(updates.response_time_ms);
  }
  if (updates.input_tokens !== undefined) {
    fields.push('input_tokens = ?');
    values.push(updates.input_tokens);
  }
  if (updates.output_tokens !== undefined) {
    fields.push('output_tokens = ?');
    values.push(updates.output_tokens);
  }
  if (updates.cache_read_tokens !== undefined) {
    fields.push('cache_read_tokens = ?');
    values.push(updates.cache_read_tokens);
  }
  if (updates.cache_write_tokens !== undefined) {
    fields.push('cache_write_tokens = ?');
    values.push(updates.cache_write_tokens);
  }
  if (updates.cost_usd !== undefined) {
    fields.push('cost_usd = ?');
    values.push(updates.cost_usd);
  }
  if (updates.success !== undefined) {
    fields.push('success = ?');
    values.push(updates.success ? 1 : 0);
  }
  if (updates.response_type !== undefined) {
    fields.push('response_type = ?');
    values.push(updates.response_type);
  }
  if (updates.response_json !== undefined) {
    fields.push('response_json = ?');
    values.push(updates.response_json);
  }
  if (updates.error_message !== undefined) {
    fields.push('error_message = ?');
    values.push(updates.error_message);
  }

  if (fields.length === 0) return;

  values.push(id);
  const stmt = db.prepare(`UPDATE api_attempts SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

// ============================================================================
// CONTRACTS TABLE
// ============================================================================

export interface ContractRecord {
  id?: number;
  conversion_id: number;
  contract_uuid: string;
  produced_by_attempt: number;
  name: string;
  role?: 'primary' | 'helper' | 'state';
  purpose?: string;
  cashscript_code: string;
  code_hash: string;
  deployment_order?: number;
  bytecode_size?: number;
  line_count?: number;
  is_validated: boolean;
}

export function insertContract(record: Omit<ContractRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO contracts (
      conversion_id, contract_uuid, produced_by_attempt, name, role, purpose,
      cashscript_code, code_hash, deployment_order, bytecode_size, line_count, is_validated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.contract_uuid,
    record.produced_by_attempt,
    record.name,
    record.role || null,
    record.purpose || null,
    record.cashscript_code,
    record.code_hash,
    record.deployment_order || null,
    record.bytecode_size || null,
    record.line_count || null,
    record.is_validated ? 1 : 0
  );

  return result.lastInsertRowid as number;
}

export function updateContract(id: number, updates: Partial<ContractRecord>): void {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.bytecode_size !== undefined) {
    fields.push('bytecode_size = ?');
    values.push(updates.bytecode_size);
  }
  if (updates.is_validated !== undefined) {
    fields.push('is_validated = ?');
    values.push(updates.is_validated ? 1 : 0);
  }

  if (fields.length === 0) return;

  values.push(id);
  const stmt = db.prepare(`UPDATE contracts SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

// ============================================================================
// CONTRACT_DEPENDENCIES TABLE
// ============================================================================

export interface ContractDependencyRecord {
  id?: number;
  contract_id: number;
  depends_on_contract_id: number;
  dependency_type: 'parameter' | 'call' | 'state' | 'deployment';
  description?: string;
}

export function insertContractDependency(record: Omit<ContractDependencyRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO contract_dependencies (
      contract_id, depends_on_contract_id, dependency_type, description
    ) VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.contract_id,
    record.depends_on_contract_id,
    record.dependency_type,
    record.description || null
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// VALIDATIONS TABLE
// ============================================================================

export interface ValidationRecord {
  id?: number;
  conversion_id: number;
  attempt_number: number;
  contract_id?: number;
  validated_at: string;
  is_valid: boolean;
  error_message?: string;
  error_category?: 'unused_variable' | 'type_error' | 'syntax_error' | 'logic_error' | 'compilation_error' | 'unknown';
  compiler_output?: string;
}

export function insertValidation(record: Omit<ValidationRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO validations (
      conversion_id, attempt_number, contract_id, validated_at, is_valid,
      error_message, error_category, compiler_output
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.attempt_number,
    record.contract_id || null,
    record.validated_at,
    record.is_valid ? 1 : 0,
    record.error_message || null,
    record.error_category || null,
    record.compiler_output || null
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// RETRY_PROGRESSION TABLE
// ============================================================================

export interface RetryProgressionRecord {
  id?: number;
  conversion_id: number;
  attempt_number: number;
  contracts_attempted: number;
  contracts_failed: number;
  primary_error_category?: string;
  error_resolved: boolean;
  resolution_method?: string;
  notes?: string;
}

export function insertRetryProgression(record: Omit<RetryProgressionRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO retry_progression (
      conversion_id, attempt_number, contracts_attempted, contracts_failed,
      primary_error_category, error_resolved, resolution_method, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.attempt_number,
    record.contracts_attempted,
    record.contracts_failed,
    record.primary_error_category || null,
    record.error_resolved ? 1 : 0,
    record.resolution_method || null,
    record.notes || null
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// ERROR_PATTERNS TABLE
// ============================================================================

export interface ErrorPatternRecord {
  id?: number;
  error_category: string;
  error_signature: string;
  occurrence_count: number;
  retry_fix_count: number;
  retry_fix_rate?: number;
  sample_error_message: string;
  first_seen: string;
  last_seen: string;
}

export function recordErrorPattern(
  category: string,
  signature: string,
  errorMessage: string,
  wasFixedByRetry: boolean = false
): void {
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO error_patterns (
      error_category, error_signature, occurrence_count, retry_fix_count,
      sample_error_message, first_seen, last_seen
    ) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(error_category, error_signature) DO UPDATE SET
      occurrence_count = occurrence_count + 1,
      retry_fix_count = retry_fix_count + ?,
      retry_fix_rate = CAST(retry_fix_count AS REAL) / occurrence_count,
      last_seen = ?
  `);

  const fixCount = wasFixedByRetry ? 1 : 0;
  stmt.run(category, signature, fixCount, errorMessage, now, now, fixCount, now);
}

// ============================================================================
// ANALYTICS QUERIES
// ============================================================================

export function getConversionSuccessRate(): number {
  const stmt = db.prepare(`
    SELECT
      CAST(SUM(CASE WHEN final_status = 'success' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
    FROM conversions
    WHERE final_status IS NOT NULL
  `);

  const result = stmt.get() as { success_rate: number } | undefined;
  return result?.success_rate || 0;
}

export function getRetryEffectiveness(): any {
  const stmt = db.prepare(`
    SELECT
      attempt_number,
      COUNT(*) as total_attempts,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_attempts,
      CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
    FROM api_attempts
    GROUP BY attempt_number
    ORDER BY attempt_number
  `);

  return stmt.all();
}

export function getErrorPatternStats(): any {
  const stmt = db.prepare(`
    SELECT
      error_category,
      COUNT(*) as pattern_count,
      SUM(occurrence_count) as total_occurrences,
      AVG(retry_fix_rate) as avg_fix_rate
    FROM error_patterns
    GROUP BY error_category
    ORDER BY total_occurrences DESC
  `);

  return stmt.all();
}

export function getCacheSavingsTotal(): number {
  const stmt = db.prepare(`
    SELECT
      SUM(cache_read_tokens * 0.30 / 1000000 * 0.9) as total_savings
    FROM api_attempts
    WHERE cache_read_tokens > 0
  `);

  const result = stmt.get() as { total_savings: number } | undefined;
  return result?.total_savings || 0;
}

// ============================================================================
// SEMANTIC_ANALYSES TABLE
// ============================================================================

export interface SemanticAnalysisRecord {
  id?: number;
  conversion_id: number;
  analysis_json: string;
  created_at: string;
  model_used: string;
  input_tokens?: number;
  output_tokens?: number;
  response_time_ms?: number;
}

export function insertSemanticAnalysis(record: Omit<SemanticAnalysisRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO semantic_analyses (
      conversion_id, analysis_json, created_at, model_used,
      input_tokens, output_tokens, response_time_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.analysis_json,
    record.created_at,
    record.model_used,
    record.input_tokens || null,
    record.output_tokens || null,
    record.response_time_ms || null
  );

  return result.lastInsertRowid as number;
}

export function getSemanticAnalysis(conversionId: number): SemanticAnalysisRecord | undefined {
  const stmt = db.prepare(`
    SELECT * FROM semantic_analyses
    WHERE conversion_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return stmt.get(conversionId) as SemanticAnalysisRecord | undefined;
}

// ============================================================================
// DATABASE MANAGEMENT
// ============================================================================

export function getDatabase(): Database.Database {
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('[Database] Connection closed');
  }
}
