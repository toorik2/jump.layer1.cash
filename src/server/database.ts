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
      user_agent TEXT,
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
      name TEXT NOT NULL,
      role TEXT CHECK(role IN ('primary', 'helper', 'state')),
      purpose TEXT,
      cashscript_code TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      bytecode_size INTEGER,
      line_count INTEGER,
      is_validated INTEGER NOT NULL DEFAULT 0,
      validation_error TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
    )
  `);

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

  // VALIDATION_ATTEMPTS - Track every validation attempt per contract (for error analysis)
  db.exec(`
    CREATE TABLE IF NOT EXISTS validation_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      contract_name TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0,
      validation_error TEXT,
      code_hash TEXT,
      created_at TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_validation_attempts_conversion ON validation_attempts(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_validation_attempts_error ON validation_attempts(validation_error) WHERE validation_error IS NOT NULL;
  `);

  // Migrations - add columns if missing, fail loud on unexpected errors
  const migrations = [
    { table: 'contracts', column: 'validation_error', type: 'TEXT' },
    { table: 'semantic_analyses', column: 'user_prompt', type: 'TEXT' },
    { table: 'utxo_architectures', column: 'user_prompt', type: 'TEXT' },
    { table: 'semantic_analyses', column: 'system_prompt', type: 'TEXT' },
    { table: 'utxo_architectures', column: 'system_prompt', type: 'TEXT' },
    { table: 'api_attempts', column: 'system_prompt', type: 'TEXT' },
    { table: 'conversions', column: 'user_agent', type: 'TEXT' },
    { table: 'conversions', column: 'share_token', type: 'TEXT' },
  ];

  for (const { table, column, type } of migrations) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (e: any) {
      if (!e.message?.includes('duplicate column')) throw e;
    }
  }

  // Post-migration indexes (for columns added via migration)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversions_share_token ON conversions(share_token) WHERE share_token IS NOT NULL;
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
    .substring(0, 6);
}

// ============================================================================
// CONVERSIONS TABLE
// ============================================================================

export interface ConversionRecord {
  id?: number;
  session_id: string;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
  final_status?: 'success' | 'failed' | 'timeout';
  total_attempts: number;
  solidity_code: string;
  solidity_hash: string;
  is_multi_contract: boolean;
  contract_count: number;
  share_token?: string;
}

export function insertConversion(record: Omit<ConversionRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO conversions (
      session_id, ip_address, user_agent, created_at, completed_at, duration_ms,
      final_status, total_attempts, solidity_code, solidity_hash,
      is_multi_contract, contract_count, share_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.session_id,
    record.ip_address || null,
    record.user_agent || null,
    record.created_at,
    record.completed_at || null,
    record.duration_ms || null,
    record.final_status || null,
    record.total_attempts,
    record.solidity_code,
    record.solidity_hash,
    record.is_multi_contract ? 1 : 0,
    record.contract_count,
    record.share_token || null
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
  name: string;
  role?: 'primary' | 'helper' | 'state';
  purpose?: string;
  cashscript_code: string;
  code_hash: string;
  bytecode_size?: number;
  line_count?: number;
  is_validated: boolean;
  validation_error?: string;
}

export function insertContract(record: Omit<ContractRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO contracts (
      conversion_id, contract_uuid, name, role, purpose,
      cashscript_code, code_hash, bytecode_size, line_count, is_validated, validation_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.contract_uuid,
    record.name,
    record.role || null,
    record.purpose || null,
    record.cashscript_code,
    record.code_hash,
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
  user_prompt?: string;
  system_prompt?: string;
}

export function insertSemanticAnalysis(record: Omit<SemanticAnalysisRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO semantic_analyses (
      conversion_id, analysis_json, created_at, model_used,
      input_tokens, output_tokens, response_time_ms, user_prompt, system_prompt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.analysis_json,
    record.created_at,
    record.model_used,
    record.input_tokens || null,
    record.output_tokens || null,
    record.response_time_ms || null,
    record.user_prompt || null,
    record.system_prompt || null
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
  user_prompt?: string;
  system_prompt?: string;
}

export function insertUtxoArchitecture(record: Omit<UtxoArchitectureRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO utxo_architectures (
      conversion_id, architecture_json, created_at, model_used,
      input_tokens, output_tokens, response_time_ms, user_prompt, system_prompt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.architecture_json,
    record.created_at,
    record.model_used,
    record.input_tokens || null,
    record.output_tokens || null,
    record.response_time_ms || null,
    record.user_prompt || null,
    record.system_prompt || null
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// API_ATTEMPTS TABLE (Phase 3/4 Code Generation)
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
  system_prompt?: string;
}

export function insertApiAttempt(record: Omit<ApiAttemptRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO api_attempts (
      conversion_id, attempt_number, started_at, response_time_ms,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cost_usd, success, response_type, user_message, response_json, error_message, system_prompt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.attempt_number,
    record.started_at,
    record.response_time_ms || null,
    record.input_tokens || null,
    record.output_tokens || null,
    record.cache_read_tokens || null,
    record.cache_write_tokens || null,
    record.cost_usd || null,
    record.success ? 1 : 0,
    record.response_type || null,
    record.user_message,
    record.response_json || null,
    record.error_message || null,
    record.system_prompt || null
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// VALIDATION_ATTEMPTS TABLE
// ============================================================================

export interface ValidationAttemptRecord {
  id?: number;
  conversion_id: number;
  contract_name: string;
  attempt_number: number;
  passed: boolean;
  validation_error?: string;
  code_hash?: string;
  created_at: string;
}

export function insertValidationAttempt(record: Omit<ValidationAttemptRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO validation_attempts (
      conversion_id, contract_name, attempt_number, passed, validation_error, code_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.contract_name,
    record.attempt_number,
    record.passed ? 1 : 0,
    record.validation_error || null,
    record.code_hash || null,
    record.created_at
  );

  return result.lastInsertRowid as number;
}

// ============================================================================
// QUERY FUNCTIONS (Read-only)
// ============================================================================

export interface ConversionListItem {
  id: number;
  session_id: string;
  created_at: string;
  completed_at: string | null;
  final_status: 'success' | 'failed' | 'timeout' | null;
  duration_ms: number | null;
  contract_count: number;
  is_multi_contract: boolean;
}

export function getConversions(limit = 50, offset = 0): { conversions: ConversionListItem[]; total: number } {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM conversions');
  const total = (countStmt.get() as { count: number }).count;

  const stmt = db.prepare(`
    SELECT id, session_id, created_at, completed_at, final_status, duration_ms, contract_count, is_multi_contract
    FROM conversions
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);

  const rows = stmt.all(limit, offset) as any[];
  const conversions = rows.map(row => ({
    ...row,
    is_multi_contract: Boolean(row.is_multi_contract)
  }));

  return { conversions, total };
}

export function getConversionById(id: number) {
  const conversionStmt = db.prepare('SELECT * FROM conversions WHERE id = ?');
  const conversion = conversionStmt.get(id) as any;
  if (!conversion) return null;

  const contractsStmt = db.prepare('SELECT * FROM contracts WHERE conversion_id = ? ORDER BY id');
  const contracts = contractsStmt.all(id);

  const analysisStmt = db.prepare('SELECT * FROM semantic_analyses WHERE conversion_id = ? LIMIT 1');
  const semantic_analysis = analysisStmt.get(id);

  const archStmt = db.prepare('SELECT * FROM utxo_architectures WHERE conversion_id = ? LIMIT 1');
  const utxo_architecture = archStmt.get(id);

  const attemptsStmt = db.prepare('SELECT * FROM api_attempts WHERE conversion_id = ? ORDER BY attempt_number');
  const api_attempts = attemptsStmt.all(id);

  return {
    conversion: { ...conversion, is_multi_contract: Boolean(conversion.is_multi_contract) },
    contracts,
    semantic_analysis,
    utxo_architecture,
    api_attempts
  };
}

export function getConversionByToken(token: string) {
  const conversionStmt = db.prepare('SELECT * FROM conversions WHERE share_token = ?');
  const conversion = conversionStmt.get(token) as any;
  if (!conversion) return null;

  const contractsStmt = db.prepare('SELECT * FROM contracts WHERE conversion_id = ? ORDER BY id');
  const contracts = contractsStmt.all(conversion.id);

  const archStmt = db.prepare('SELECT * FROM utxo_architectures WHERE conversion_id = ? LIMIT 1');
  const utxo_architecture = archStmt.get(conversion.id) as any;

  return {
    token: conversion.share_token,
    createdAt: conversion.created_at,
    solidityCode: conversion.solidity_code,
    contracts: contracts.map((c: any) => ({
      name: c.name,
      role: c.role,
      purpose: c.purpose,
      code: c.cashscript_code,
      validated: Boolean(c.is_validated)
    })),
    transactions: utxo_architecture?.architecture_json
      ? JSON.parse(utxo_architecture.architecture_json).transactionTemplates || []
      : []
  };
}

export interface ConversionStats {
  total_conversions: number;
  success_count: number;
  failed_count: number;
  success_rate: number;
  avg_duration_ms: number | null;
  total_contracts: number;
  conversions_today: number;
}

export function getConversionStats(): ConversionStats {
  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) as total_conversions,
      SUM(CASE WHEN final_status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN final_status = 'failed' THEN 1 ELSE 0 END) as failed_count,
      AVG(CASE WHEN final_status = 'success' THEN duration_ms END) as avg_duration_ms
    FROM conversions
  `);
  const stats = statsStmt.get() as any;

  const contractCountStmt = db.prepare('SELECT COUNT(*) as count FROM contracts');
  const contractCount = (contractCountStmt.get() as { count: number }).count;

  const todayStmt = db.prepare(`
    SELECT COUNT(*) as count FROM conversions
    WHERE date(created_at) = date('now')
  `);
  const todayCount = (todayStmt.get() as { count: number }).count;

  return {
    total_conversions: stats.total_conversions || 0,
    success_count: stats.success_count || 0,
    failed_count: stats.failed_count || 0,
    success_rate: stats.total_conversions > 0
      ? (stats.success_count || 0) / stats.total_conversions
      : 0,
    avg_duration_ms: stats.avg_duration_ms || null,
    total_contracts: contractCount,
    conversions_today: todayCount
  };
}

export interface VisitorAnalytics {
  unique_ips: number;
  unique_sessions: number;
  top_visitors: { ip: string; count: number }[];
  daily_conversions: { date: string; count: number }[];
}

export function getVisitorAnalytics(): VisitorAnalytics {
  const uniqueIpsStmt = db.prepare(`
    SELECT COUNT(DISTINCT ip_address) as count FROM conversions WHERE ip_address IS NOT NULL
  `);
  const uniqueIps = (uniqueIpsStmt.get() as { count: number }).count;

  const uniqueSessionsStmt = db.prepare(`
    SELECT COUNT(DISTINCT session_id) as count FROM conversions
  `);
  const uniqueSessions = (uniqueSessionsStmt.get() as { count: number }).count;

  const topVisitorsStmt = db.prepare(`
    SELECT ip_address as ip, COUNT(*) as count
    FROM conversions
    WHERE ip_address IS NOT NULL
    GROUP BY ip_address
    ORDER BY count DESC
    LIMIT 10
  `);
  const topVisitors = topVisitorsStmt.all() as { ip: string; count: number }[];

  const dailyStmt = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM conversions
    WHERE created_at >= date('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY date DESC
  `);
  const dailyConversions = dailyStmt.all() as { date: string; count: number }[];

  return {
    unique_ips: uniqueIps,
    unique_sessions: uniqueSessions,
    top_visitors: topVisitors,
    daily_conversions: dailyConversions
  };
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
