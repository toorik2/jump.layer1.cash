import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const DB_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DB_DIR, 'conversions.db');

let db: Database.Database;

export function initializeDatabase(): Database.Database {
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  createTables();
  console.log(`[Database] Initialized at ${DB_PATH}`);
  return db;
}

function createTables() {
  // CONVERSIONS - Root conversion session
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

  // API_ATTEMPTS - Each retry attempt
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

  // CONTRACTS - Individual CashScript contracts produced
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
      validation_error TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
    )
  `);

  // Add validation_error column if missing (migration)
  try {
    db.exec(`ALTER TABLE contracts ADD COLUMN validation_error TEXT`);
  } catch { /* column already exists */ }

  // SEMANTIC_ANALYSES - Phase 1 semantic extraction results
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

  // UTXO_ARCHITECTURES - Phase 2 architecture design results
  db.exec(`
    CREATE TABLE IF NOT EXISTS utxo_architectures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      architecture_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model_used TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      response_time_ms INTEGER,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
    )
  `);

  // Indexes
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
    CREATE INDEX IF NOT EXISTS idx_semantic_conversion ON semantic_analyses(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_architecture_conversion ON utxo_architectures(conversion_id);
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
// CONTRACTS TABLE
// ============================================================================

interface ContractRecord {
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
  validation_error?: string;
}

export function insertContract(record: Omit<ContractRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO contracts (
      conversion_id, contract_uuid, produced_by_attempt, name, role, purpose,
      cashscript_code, code_hash, deployment_order, bytecode_size, line_count, is_validated, validation_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    record.is_validated ? 1 : 0,
    record.validation_error || null
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// SEMANTIC_ANALYSES TABLE
// ============================================================================

interface SemanticAnalysisRecord {
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

// ============================================================================
// UTXO_ARCHITECTURES TABLE (Phase 2)
// ============================================================================

interface UtxoArchitectureRecord {
  id?: number;
  conversion_id: number;
  architecture_json: string;
  created_at: string;
  model_used: string;
  input_tokens?: number;
  output_tokens?: number;
  response_time_ms?: number;
}

export function insertUtxoArchitecture(record: Omit<UtxoArchitectureRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO utxo_architectures (
      conversion_id, architecture_json, created_at, model_used,
      input_tokens, output_tokens, response_time_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.architecture_json,
    record.created_at,
    record.model_used,
    record.input_tokens || null,
    record.output_tokens || null,
    record.response_time_ms || null
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// DATABASE MANAGEMENT
// ============================================================================

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('[Database] Connection closed');
  }
}
