import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the project root directory (one level up from reports/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DB_PATH = join(PROJECT_ROOT, 'data', 'conversions.db');
const db = new Database(DB_PATH, { readonly: true });

// Calculate timestamp for 2 hours ago
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

console.log('='.repeat(80));
console.log('ACTIVITY REPORT - Last 2 Hours');
console.log('='.repeat(80));
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Period: Since ${twoHoursAgo}`);
console.log('='.repeat(80));
console.log();

// ============================================================================
// 1. CONVERSIONS OVERVIEW
// ============================================================================
console.log('📊 CONVERSIONS OVERVIEW');
console.log('-'.repeat(80));

const conversions = db.prepare(`
  SELECT
    id,
    session_id,
    ip_address,
    created_at,
    completed_at,
    duration_ms,
    final_status,
    total_attempts,
    is_multi_contract,
    contract_count
  FROM conversions
  WHERE created_at >= ?
  ORDER BY created_at DESC
`).all(twoHoursAgo);

console.log(`Total conversions: ${conversions.length}`);

if (conversions.length > 0) {
  const successCount = conversions.filter(c => c.final_status === 'success').length;
  const failedCount = conversions.filter(c => c.final_status === 'failed').length;
  const timeoutCount = conversions.filter(c => c.final_status === 'timeout').length;
  const pendingCount = conversions.filter(c => !c.final_status).length;

  console.log(`  ✓ Success: ${successCount}`);
  console.log(`  ✗ Failed: ${failedCount}`);
  console.log(`  ⏱ Timeout: ${timeoutCount}`);
  console.log(`  ⧗ Pending: ${pendingCount}`);

  if (successCount + failedCount + timeoutCount > 0) {
    const successRate = ((successCount / (successCount + failedCount + timeoutCount)) * 100).toFixed(1);
    console.log(`  Success Rate: ${successRate}%`);
  }

  console.log();
  console.log('Recent conversions:');
  conversions.forEach((c, idx) => {
    const statusIcon = c.final_status === 'success' ? '✓' :
                       c.final_status === 'failed' ? '✗' :
                       c.final_status === 'timeout' ? '⏱' : '⧗';
    const multiContract = c.is_multi_contract ? `(${c.contract_count} contracts)` : '(single)';
    const duration = c.duration_ms ? `${(c.duration_ms / 1000).toFixed(1)}s` : 'pending';
    console.log(`  ${idx + 1}. ${statusIcon} [${c.created_at}] IP: ${c.ip_address || 'N/A'} | ${multiContract} | ${c.total_attempts} attempts | ${duration}`);
  });
}
console.log();

// ============================================================================
// 2. USER ACTIVITY (by IP)
// ============================================================================
console.log('👥 USER ACTIVITY (by IP Address)');
console.log('-'.repeat(80));

const userActivity = db.prepare(`
  SELECT
    ip_address,
    COUNT(*) as total_conversions,
    SUM(CASE WHEN final_status = 'success' THEN 1 ELSE 0 END) as successful,
    SUM(CASE WHEN final_status = 'failed' THEN 1 ELSE 0 END) as failed,
    MIN(created_at) as first_activity,
    MAX(created_at) as last_activity
  FROM conversions
  WHERE created_at >= ?
  GROUP BY ip_address
  ORDER BY total_conversions DESC
`).all(twoHoursAgo);

if (userActivity.length > 0) {
  userActivity.forEach((user, idx) => {
    console.log(`  ${idx + 1}. ${user.ip_address || 'Unknown IP'}`);
    console.log(`     Conversions: ${user.total_conversions} (${user.successful} success, ${user.failed} failed)`);
    console.log(`     First: ${user.first_activity}`);
    console.log(`     Last:  ${user.last_activity}`);
  });
} else {
  console.log('  No user activity in this period');
}
console.log();

// ============================================================================
// 3. API USAGE & PERFORMANCE
// ============================================================================
console.log('🔌 API USAGE & PERFORMANCE');
console.log('-'.repeat(80));

const apiStats = db.prepare(`
  SELECT
    COUNT(*) as total_attempts,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
    AVG(response_time_ms) as avg_response_time,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(cache_read_tokens) as total_cache_read,
    SUM(cost_usd) as total_cost
  FROM api_attempts
  WHERE started_at >= ?
`).get(twoHoursAgo);

if (apiStats && apiStats.total_attempts > 0) {
  console.log(`Total API calls: ${apiStats.total_attempts}`);
  console.log(`  Success: ${apiStats.successful}/${apiStats.total_attempts} (${((apiStats.successful / apiStats.total_attempts) * 100).toFixed(1)}%)`);
  console.log(`  Avg response time: ${apiStats.avg_response_time ? (apiStats.avg_response_time / 1000).toFixed(2) + 's' : 'N/A'}`);
  console.log(`  Input tokens: ${apiStats.total_input_tokens?.toLocaleString() || 0}`);
  console.log(`  Output tokens: ${apiStats.total_output_tokens?.toLocaleString() || 0}`);
  console.log(`  Cache read tokens: ${apiStats.total_cache_read?.toLocaleString() || 0}`);
  console.log(`  Total cost: $${apiStats.total_cost?.toFixed(4) || '0.0000'}`);
} else {
  console.log('  No API calls in this period');
}
console.log();

// ============================================================================
// 4. CONTRACTS GENERATED
// ============================================================================
console.log('📝 CONTRACTS GENERATED');
console.log('-'.repeat(80));

const contractStats = db.prepare(`
  SELECT
    COUNT(*) as total_contracts,
    SUM(CASE WHEN is_validated = 1 THEN 1 ELSE 0 END) as validated,
    COUNT(DISTINCT conversion_id) as unique_conversions,
    role,
    COUNT(*) as count_by_role
  FROM contracts c
  WHERE EXISTS (
    SELECT 1 FROM conversions WHERE id = c.conversion_id AND created_at >= ?
  )
  GROUP BY role
`).all(twoHoursAgo);

const totalContracts = contractStats.reduce((sum, s) => sum + s.total_contracts, 0);

if (totalContracts > 0) {
  console.log(`Total contracts generated: ${totalContracts}`);
  console.log('By role:');
  contractStats.forEach(stat => {
    console.log(`  ${stat.role || 'unspecified'}: ${stat.count_by_role} (${stat.validated} validated)`);
  });

  // Recent contracts detail
  const recentContracts = db.prepare(`
    SELECT
      c.name,
      c.role,
      c.is_validated,
      c.line_count,
      conv.created_at,
      conv.ip_address
    FROM contracts c
    JOIN conversions conv ON c.conversion_id = conv.id
    WHERE conv.created_at >= ?
    ORDER BY conv.created_at DESC
    LIMIT 10
  `).all(twoHoursAgo);

  if (recentContracts.length > 0) {
    console.log();
    console.log('Recent contracts:');
    recentContracts.forEach((contract, idx) => {
      const validIcon = contract.is_validated ? '✓' : '✗';
      console.log(`  ${idx + 1}. ${validIcon} ${contract.name} [${contract.role || 'N/A'}] - ${contract.line_count || 0} lines - IP: ${contract.ip_address || 'N/A'}`);
    });
  }
} else {
  console.log('  No contracts generated in this period');
}
console.log();

// ============================================================================
// 5. VALIDATION & ERRORS
// ============================================================================
console.log('🔍 VALIDATION & ERRORS');
console.log('-'.repeat(80));

const validationStats = db.prepare(`
  SELECT
    COUNT(*) as total_validations,
    SUM(CASE WHEN is_valid = 1 THEN 1 ELSE 0 END) as valid,
    error_category,
    COUNT(*) as error_count
  FROM validations v
  WHERE EXISTS (
    SELECT 1 FROM conversions WHERE id = v.conversion_id AND created_at >= ?
  )
  GROUP BY error_category
  ORDER BY error_count DESC
`).all(twoHoursAgo);

const totalValidations = validationStats.reduce((sum, s) => sum + s.total_validations, 0);
const validCount = validationStats.find(s => s.error_category === null)?.total_validations || 0;

if (totalValidations > 0) {
  console.log(`Total validations: ${totalValidations}`);
  console.log(`  Valid: ${validCount}`);
  console.log(`  Invalid: ${totalValidations - validCount}`);

  const errorCategories = validationStats.filter(s => s.error_category !== null);
  if (errorCategories.length > 0) {
    console.log();
    console.log('Error breakdown:');
    errorCategories.forEach(cat => {
      console.log(`  ${cat.error_category}: ${cat.error_count}`);
    });
  }

  // Recent errors
  const recentErrors = db.prepare(`
    SELECT
      v.error_category,
      v.error_message,
      conv.created_at,
      conv.ip_address
    FROM validations v
    JOIN conversions conv ON v.conversion_id = conv.id
    WHERE conv.created_at >= ? AND v.is_valid = 0
    ORDER BY v.validated_at DESC
    LIMIT 5
  `).all(twoHoursAgo);

  if (recentErrors.length > 0) {
    console.log();
    console.log('Recent errors:');
    recentErrors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. [${err.error_category}] ${err.error_message?.substring(0, 80) || 'Unknown error'}`);
      console.log(`     IP: ${err.ip_address || 'N/A'} at ${err.created_at}`);
    });
  }
} else {
  console.log('  No validations in this period');
}
console.log();

// ============================================================================
// 6. RETRY PATTERNS
// ============================================================================
console.log('🔄 RETRY PATTERNS');
console.log('-'.repeat(80));

const retryStats = db.prepare(`
  SELECT
    attempt_number,
    COUNT(*) as attempt_count,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
  FROM api_attempts
  WHERE started_at >= ?
  GROUP BY attempt_number
  ORDER BY attempt_number
`).all(twoHoursAgo);

if (retryStats.length > 0) {
  console.log('Attempts by retry number:');
  retryStats.forEach(stat => {
    const successRate = ((stat.success_count / stat.attempt_count) * 100).toFixed(1);
    console.log(`  Attempt ${stat.attempt_number}: ${stat.attempt_count} calls (${stat.success_count} success, ${successRate}%)`);
  });
} else {
  console.log('  No retry data in this period');
}
console.log();

// ============================================================================
// 7. SUMMARY
// ============================================================================
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));

const summary = {
  users: userActivity.length,
  conversions: conversions.length,
  apiCalls: apiStats?.total_attempts || 0,
  contracts: totalContracts,
  validations: totalValidations,
  cost: apiStats?.total_cost || 0
};

console.log(`Active users (unique IPs): ${summary.users}`);
console.log(`Total conversions: ${summary.conversions}`);
console.log(`Total API calls: ${summary.apiCalls}`);
console.log(`Contracts generated: ${summary.contracts}`);
console.log(`Validations performed: ${summary.validations}`);
console.log(`Total cost: $${summary.cost.toFixed(4)}`);

console.log('='.repeat(80));

db.close();
