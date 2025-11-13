import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  ConversionRecord,
  AnthropicApiCallRecord,
  AlternativeRecord,
  ConsiderationRecord,
  ErrorRecord,
} from './types/logging.js';

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
  // Conversions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      status TEXT NOT NULL CHECK(status IN ('in_progress', 'success', 'error', 'validation_failed')),
      input_contract TEXT NOT NULL,
      input_contract_length INTEGER NOT NULL,
      output_contract TEXT,
      explanation TEXT,
      validation_success INTEGER,
      validation_error TEXT,
      bytecode_size INTEGER,
      retry_attempted INTEGER NOT NULL DEFAULT 0,
      retry_success INTEGER
    )
  `);

  // Anthropic API calls table
  db.exec(`
    CREATE TABLE IF NOT EXISTS anthropic_api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      model TEXT NOT NULL,
      max_tokens INTEGER NOT NULL,
      system_prompt TEXT NOT NULL,
      user_message TEXT NOT NULL,
      response_text TEXT,
      response_time_ms INTEGER,
      success INTEGER NOT NULL,
      error TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id)
    )
  `);

  // Alternatives table
  db.exec(`
    CREATE TABLE IF NOT EXISTS alternatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      contract TEXT NOT NULL,
      rationale TEXT NOT NULL,
      validation_success INTEGER,
      validation_error TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id)
    )
  `);

  // Considerations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS considerations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      consideration_text TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id)
    )
  `);

  // Errors table
  db.exec(`
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER,
      created_at TEXT NOT NULL,
      error_type TEXT NOT NULL CHECK(error_type IN ('validation_error', 'api_error', 'parsing_error', 'database_error', 'unknown_error')),
      error_message TEXT NOT NULL,
      stack_trace TEXT,
      context TEXT,
      FOREIGN KEY (conversion_id) REFERENCES conversions(id)
    )
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversions_session ON conversions(session_id);
    CREATE INDEX IF NOT EXISTS idx_conversions_created ON conversions(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(status);
    CREATE INDEX IF NOT EXISTS idx_api_calls_conversion ON anthropic_api_calls(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_alternatives_conversion ON alternatives(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_considerations_conversion ON considerations(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_errors_conversion ON errors(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_errors_type ON errors(error_type);
  `);
}

// Insert a new conversion record
export function insertConversion(record: Omit<ConversionRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO conversions (
      session_id, ip_address, user_agent, created_at, completed_at, duration_ms,
      status, input_contract, input_contract_length, output_contract, explanation,
      validation_success, validation_error, bytecode_size, retry_attempted, retry_success
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.session_id,
    record.ip_address,
    record.user_agent,
    record.created_at,
    record.completed_at || null,
    record.duration_ms || null,
    record.status,
    record.input_contract,
    record.input_contract_length,
    record.output_contract || null,
    record.explanation || null,
    record.validation_success !== undefined ? (record.validation_success ? 1 : 0) : null,
    record.validation_error || null,
    record.bytecode_size || null,
    record.retry_attempted ? 1 : 0,
    record.retry_success !== undefined ? (record.retry_success ? 1 : 0) : null
  );

  return result.lastInsertRowid as number;
}

// Update conversion record
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
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.output_contract !== undefined) {
    fields.push('output_contract = ?');
    values.push(updates.output_contract);
  }
  if (updates.explanation !== undefined) {
    fields.push('explanation = ?');
    values.push(updates.explanation);
  }
  if (updates.validation_success !== undefined) {
    fields.push('validation_success = ?');
    values.push(updates.validation_success ? 1 : 0);
  }
  if (updates.validation_error !== undefined) {
    fields.push('validation_error = ?');
    values.push(updates.validation_error);
  }
  if (updates.bytecode_size !== undefined) {
    fields.push('bytecode_size = ?');
    values.push(updates.bytecode_size);
  }
  if (updates.retry_attempted !== undefined) {
    fields.push('retry_attempted = ?');
    values.push(updates.retry_attempted ? 1 : 0);
  }
  if (updates.retry_success !== undefined) {
    fields.push('retry_success = ?');
    values.push(updates.retry_success ? 1 : 0);
  }

  if (fields.length === 0) return;

  values.push(id);
  const stmt = db.prepare(`UPDATE conversions SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

// Insert Anthropic API call record
export function insertAnthropicApiCall(record: Omit<AnthropicApiCallRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO anthropic_api_calls (
      conversion_id, attempt_number, created_at, model, max_tokens,
      system_prompt, user_message, response_text, response_time_ms, success, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.attempt_number,
    record.created_at,
    record.model,
    record.max_tokens,
    record.system_prompt,
    record.user_message,
    record.response_text || null,
    record.response_time_ms || null,
    record.success ? 1 : 0,
    record.error || null
  );

  return result.lastInsertRowid as number;
}

// Update Anthropic API call record
export function updateAnthropicApiCall(id: number, updates: Partial<AnthropicApiCallRecord>): void {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.response_text !== undefined) {
    fields.push('response_text = ?');
    values.push(updates.response_text);
  }
  if (updates.response_time_ms !== undefined) {
    fields.push('response_time_ms = ?');
    values.push(updates.response_time_ms);
  }
  if (updates.success !== undefined) {
    fields.push('success = ?');
    values.push(updates.success ? 1 : 0);
  }
  if (updates.error !== undefined) {
    fields.push('error = ?');
    values.push(updates.error);
  }

  if (fields.length === 0) return;

  values.push(id);
  const stmt = db.prepare(`UPDATE anthropic_api_calls SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

// Insert alternative implementation
export function insertAlternative(record: Omit<AlternativeRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO alternatives (
      conversion_id, name, contract, rationale, validation_success, validation_error
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.name,
    record.contract,
    record.rationale,
    record.validation_success !== undefined ? (record.validation_success ? 1 : 0) : null,
    record.validation_error || null
  );

  return result.lastInsertRowid as number;
}

// Insert consideration
export function insertConsideration(record: Omit<ConsiderationRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO considerations (conversion_id, consideration_text, "order")
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id,
    record.consideration_text,
    record.order
  );

  return result.lastInsertRowid as number;
}

// Insert error record
export function insertError(record: Omit<ErrorRecord, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO errors (
      conversion_id, created_at, error_type, error_message, stack_trace, context
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    record.conversion_id || null,
    record.created_at,
    record.error_type,
    record.error_message,
    record.stack_trace || null,
    record.context || null
  );

  return result.lastInsertRowid as number;
}

// Get database instance (for direct queries if needed)
export function getDatabase(): Database.Database {
  return db;
}

// Close database connection
export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('[Database] Connection closed');
  }
}
