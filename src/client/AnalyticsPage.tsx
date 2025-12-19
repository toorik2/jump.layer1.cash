import { createSignal, createResource, For, Show } from 'solid-js';
import './styles/global.css';
import styles from './AnalyticsPage.module.css';

interface ConversionStats {
  total_conversions: number;
  success_count: number;
  failed_count: number;
  success_rate: number;
  avg_duration_ms: number | null;
  total_contracts: number;
  conversions_today: number;
}

interface VisitorAnalytics {
  unique_ips: number;
  unique_sessions: number;
  top_visitors: { ip: string; count: number }[];
  daily_conversions: { date: string; count: number }[];
}

interface AnalyticsData {
  stats: ConversionStats;
  visitors: VisitorAnalytics;
}

interface ConversionListItem {
  id: number;
  session_id: string;
  created_at: string;
  completed_at: string | null;
  final_status: 'success' | 'failed' | 'timeout' | null;
  duration_ms: number | null;
  contract_count: number;
  is_multi_contract: boolean;
  share_token: string | null;
}

interface ConversionDetail {
  conversion: any;
  contracts: any[];
  semantic_analysis: any;
  utxo_architecture: any;
  api_attempts: any[];
}

interface PhasePromptInfo {
  systemPromptPath: string;
  schemaPath: string | null;
  schema?: any;
  schemaNote?: string;
}

interface PromptsMetadata {
  phase1: PhasePromptInfo;
  phase2: PhasePromptInfo;
  phase3: PhasePromptInfo;
  phase4: PhasePromptInfo;
}

async function fetchAnalytics(): Promise<AnalyticsData> {
  const res = await fetch('/api/analytics');
  if (!res.ok) throw new Error('Failed to fetch analytics');
  return res.json();
}

async function fetchConversions(offset: number): Promise<{ conversions: ConversionListItem[]; total: number }> {
  const res = await fetch(`/api/conversions?limit=25&offset=${offset}`);
  if (!res.ok) throw new Error('Failed to fetch conversions');
  return res.json();
}

async function fetchConversionDetail(id: number): Promise<ConversionDetail> {
  const res = await fetch(`/api/conversions/${id}`);
  if (!res.ok) throw new Error('Failed to fetch conversion');
  return res.json();
}

async function fetchPromptsMetadata(): Promise<PromptsMetadata> {
  const res = await fetch('/api/prompts');
  if (!res.ok) throw new Error('Failed to fetch prompts metadata');
  return res.json();
}

function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Section(props: { title: string; children: any; defaultOpen?: boolean }) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);
  return (
    <div class={styles.section}>
      <button class={styles.sectionHeader} onClick={() => setOpen(!open())}>
        <span class={styles.sectionArrow}>{open() ? '▼' : '▶'}</span>
        {props.title}
      </button>
      <Show when={open()}>
        <div class={styles.sectionContent}>{props.children}</div>
      </Show>
    </div>
  );
}

export default function AnalyticsPage() {
  const [offset, setOffset] = createSignal(0);
  const [expandedId, setExpandedId] = createSignal<number | null>(null);
  const [detail, setDetail] = createSignal<ConversionDetail | null>(null);

  const [analytics] = createResource(fetchAnalytics);
  const [conversions] = createResource(offset, fetchConversions);
  const [prompts] = createResource(fetchPromptsMetadata);

  async function toggleExpand(id: number) {
    if (expandedId() === id) {
      setExpandedId(null);
      setDetail(null);
    } else {
      setExpandedId(id);
      try {
        const data = await fetchConversionDetail(id);
        setDetail(data);
      } catch (e) {
        console.error('Failed to fetch conversion detail:', e);
        setExpandedId(null);
      }
    }
  }

  function nextPage() {
    const data = conversions();
    if (data && offset() + 25 < data.total) {
      setOffset(o => o + 25);
      setExpandedId(null);
      setDetail(null);
    }
  }

  function prevPage() {
    if (offset() > 0) {
      setOffset(o => Math.max(0, o - 25));
      setExpandedId(null);
      setDetail(null);
    }
  }

  return (
    <div class={styles.container}>
      <header class={styles.header}>
        <h1>Analytics</h1>
      </header>

      <Show when={analytics()} fallback={<div class={styles.loading}>Loading analytics...</div>}>
        {data => (
          <>
            <div class={styles.statsGrid}>
              <div class={styles.statCard}>
                <div class={styles.statValue}>{data().stats.total_conversions}</div>
                <div class={styles.statLabel}>Total Conversions</div>
              </div>
              <div class={styles.statCard}>
                <div class={styles.statValue} classList={{ [styles.success]: true }}>
                  {(data().stats.success_rate * 100).toFixed(0)}%
                </div>
                <div class={styles.statLabel}>Success Rate</div>
              </div>
              <div class={styles.statCard}>
                <div class={styles.statValue}>{formatDuration(data().stats.avg_duration_ms)}</div>
                <div class={styles.statLabel}>Avg Duration</div>
              </div>
              <div class={styles.statCard}>
                <div class={styles.statValue}>{data().stats.total_contracts}</div>
                <div class={styles.statLabel}>Total Contracts</div>
              </div>
              <div class={styles.statCard}>
                <div class={styles.statValue}>{data().visitors.unique_ips}</div>
                <div class={styles.statLabel}>Unique IPs</div>
              </div>
              <div class={styles.statCard}>
                <div class={styles.statValue}>{data().visitors.unique_sessions}</div>
                <div class={styles.statLabel}>Unique Sessions</div>
              </div>
              <div class={styles.statCard}>
                <div class={styles.statValue}>{data().stats.conversions_today}</div>
                <div class={styles.statLabel}>Today</div>
              </div>
            </div>

            <Show when={data().visitors.top_visitors.length > 0}>
              <Section title="Top Visitors by IP">
                <div class={styles.topVisitors}>
                  <For each={data().visitors.top_visitors}>
                    {(visitor) => (
                      <div class={styles.visitorRow}>
                        <span class={styles.visitorIp}>{visitor.ip}</span>
                        <span class={styles.visitorCount}>{visitor.count} conversions</span>
                      </div>
                    )}
                  </For>
                </div>
              </Section>
            </Show>

            <Show when={data().visitors.daily_conversions.length > 0}>
              <Section title="Daily Conversions (Last 30 Days)">
                <div class={styles.dailyStats}>
                  <For each={data().visitors.daily_conversions}>
                    {(day) => (
                      <div class={styles.dailyRow}>
                        <span class={styles.dailyDate}>{day.date}</span>
                        <span class={styles.dailyCount}>{day.count}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Section>
            </Show>
          </>
        )}
      </Show>

      <Show when={conversions()} fallback={<div class={styles.loading}>Loading conversions...</div>}>
        {data => (
          <>
            <table class={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Contracts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <For each={data().conversions}>
                  {conv => (
                    <>
                      <tr
                        class={styles.row}
                        classList={{ [styles.expanded]: expandedId() === conv.id }}
                        onClick={() => toggleExpand(conv.id)}
                      >
                        <td>{conv.id}</td>
                        <td>{formatDate(conv.created_at)}</td>
                        <td>
                          <span class={styles.status} classList={{
                            [styles.success]: conv.final_status === 'success',
                            [styles.failed]: conv.final_status === 'failed',
                            [styles.timeout]: conv.final_status === 'timeout',
                            [styles.pending]: !conv.final_status
                          }}>
                            {conv.final_status || 'pending'}
                          </span>
                        </td>
                        <td>{formatDuration(conv.duration_ms)}</td>
                        <td>{conv.contract_count}</td>
                        <td>
                          <Show when={conv.share_token}>
                            <button
                              class={styles.viewBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`/results/${conv.share_token}`, '_blank');
                              }}
                            >
                              View
                            </button>
                          </Show>
                        </td>
                      </tr>
                      <Show when={expandedId() === conv.id && detail()}>
                        <tr class={styles.detailRow}>
                          <td colspan="6">
                            <div class={styles.detailContent}>
                              {/* Phase 1: Domain Extraction */}
                              <Section title="Phase 1: Domain Extraction">
                                <div class={styles.phaseInfo}>
                                  <Show when={detail()?.semantic_analysis}>
                                    <span>{detail()!.semantic_analysis.model_used}</span>
                                    <Show when={detail()!.semantic_analysis.response_time_ms}>
                                      <span>{(detail()!.semantic_analysis.response_time_ms / 1000).toFixed(1)}s</span>
                                    </Show>
                                    <Show when={detail()!.semantic_analysis.input_tokens}>
                                      <span>{detail()!.semantic_analysis.input_tokens} in / {detail()!.semantic_analysis.output_tokens} out</span>
                                    </Show>
                                  </Show>
                                </div>
                                <Show when={detail()?.semantic_analysis?.system_prompt}>
                                  <Section title={`System Prompt (${prompts()?.phase1?.systemPromptPath || 'prompt.ts'})`}>
                                    <pre class={styles.prompt}>{detail()!.semantic_analysis.system_prompt}</pre>
                                  </Section>
                                </Show>
                                <Show when={prompts()?.phase1?.schema}>
                                  <Section title={`Output Schema (${prompts()?.phase1?.schemaPath || 'schema.json'})`}>
                                    <pre class={styles.json}>{JSON.stringify(prompts()!.phase1.schema, null, 2)}</pre>
                                  </Section>
                                </Show>
                                <Section title="User Message">
                                  <pre class={styles.prompt}>{
                                    detail()?.semantic_analysis?.user_prompt ||
                                    (detail()?.conversion?.solidity_code ? `Extract the domain model from this smart contract:\n\n${detail()!.conversion.solidity_code}` : '(no data)')
                                  }</pre>
                                </Section>
                                <Show when={detail()?.semantic_analysis?.analysis_json}>
                                  <Section title="Response">
                                    <pre class={styles.json}>{
                                      JSON.stringify(JSON.parse(detail()!.semantic_analysis.analysis_json), null, 2)
                                    }</pre>
                                  </Section>
                                </Show>
                              </Section>

                              {/* Phase 2: UTXO Architecture */}
                              <Section title="Phase 2: UTXO Architecture">
                                <div class={styles.phaseInfo}>
                                  <Show when={detail()?.utxo_architecture}>
                                    <span>{detail()!.utxo_architecture.model_used}</span>
                                    <Show when={detail()!.utxo_architecture.response_time_ms}>
                                      <span>{(detail()!.utxo_architecture.response_time_ms / 1000).toFixed(1)}s</span>
                                    </Show>
                                    <Show when={detail()!.utxo_architecture.input_tokens}>
                                      <span>{detail()!.utxo_architecture.input_tokens} in / {detail()!.utxo_architecture.output_tokens} out</span>
                                    </Show>
                                  </Show>
                                </div>
                                <Show when={detail()?.utxo_architecture?.system_prompt}>
                                  <Section title={`System Prompt (${prompts()?.phase2?.systemPromptPath || 'prompt.ts'})`}>
                                    <pre class={styles.prompt}>{detail()!.utxo_architecture.system_prompt}</pre>
                                  </Section>
                                </Show>
                                <Show when={prompts()?.phase2?.schema}>
                                  <Section title={`Output Schema (${prompts()?.phase2?.schemaPath || 'schema.json'})`}>
                                    <pre class={styles.json}>{JSON.stringify(prompts()!.phase2.schema, null, 2)}</pre>
                                  </Section>
                                </Show>
                                <Section title="User Message">
                                  <pre class={styles.prompt}>{
                                    detail()?.utxo_architecture?.user_prompt ||
                                    (detail()?.semantic_analysis?.analysis_json ? `Design a UTXO architecture for this domain model.\n\nDOMAIN MODEL:\n${detail()!.semantic_analysis.analysis_json}` : '(no data)')
                                  }</pre>
                                </Section>
                                <Show when={detail()?.utxo_architecture?.architecture_json}>
                                  <Section title="Response">
                                    <pre class={styles.json}>{
                                      JSON.stringify(JSON.parse(detail()!.utxo_architecture.architecture_json), null, 2)
                                    }</pre>
                                  </Section>
                                </Show>
                              </Section>

                              {/* Phase 3: Code Generation */}
                              <Section title="Phase 3: Code Generation">
                                {/* Phase 3 = attempt_number === 1 */}
                                {(() => {
                                  const phase3Attempt = detail()?.api_attempts?.find(a => a.attempt_number === 1);
                                  return (
                                    <Show when={phase3Attempt}>
                                      <div class={styles.phaseInfo}>
                                        <Show when={phase3Attempt!.response_time_ms}>
                                          <span>{(phase3Attempt!.response_time_ms / 1000).toFixed(1)}s</span>
                                        </Show>
                                        <Show when={phase3Attempt!.input_tokens}>
                                          <span>{phase3Attempt!.input_tokens} in / {phase3Attempt!.output_tokens} out</span>
                                        </Show>
                                      </div>
                                      <Show when={phase3Attempt!.system_prompt}>
                                        <Section title={`System Prompt (${prompts()?.phase3?.systemPromptPath || 'prompt.ts'})`}>
                                          <pre class={styles.prompt}>{phase3Attempt!.system_prompt}</pre>
                                        </Section>
                                      </Show>
                                      <Show when={prompts()?.phase3?.schema}>
                                        <Section title={`Output Schema (${prompts()?.phase3?.schemaPath || 'schema.json'})`}>
                                          <pre class={styles.json}>{JSON.stringify(prompts()!.phase3.schema, null, 2)}</pre>
                                        </Section>
                                      </Show>
                                      <Section title="User Message">
                                        <pre class={styles.prompt}>{phase3Attempt!.user_message}</pre>
                                      </Section>
                                      <Show when={phase3Attempt!.response_json}>
                                        <Section title="Response">
                                          <pre class={styles.json}>{JSON.stringify(JSON.parse(phase3Attempt!.response_json), null, 2)}</pre>
                                        </Section>
                                      </Show>
                                    </Show>
                                  );
                                })()}
                              </Section>

                              {/* Phase 4: Validation */}
                              {(() => {
                                const phase4Attempts = detail()?.api_attempts?.filter(a => a.attempt_number >= 2) || [];
                                const validatedCount = detail()?.contracts?.filter(c => c.is_validated).length || 0;
                                const failedCount = (detail()?.contracts?.length || 0) - validatedCount;
                                return (
                                  <Section title={`Phase 4: Validation${phase4Attempts.length > 0 ? ` (${phase4Attempts.length} fix ${phase4Attempts.length === 1 ? 'attempt' : 'attempts'})` : ''}`}>
                                    {/* Validation Summary */}
                                    <Show when={detail()?.contracts?.length}>
                                      <div class={styles.phaseInfo}>
                                        <span>{validatedCount} validated</span>
                                        <Show when={failedCount > 0}>
                                          <span>{failedCount} failed</span>
                                        </Show>
                                      </div>
                                    </Show>

                                    {/* Fix Attempts (attempt_number >= 2) */}
                                    <Show when={phase4Attempts.length > 0}>
                                      <Show when={phase4Attempts[0]?.system_prompt}>
                                        <Section title={`System Prompt (${prompts()?.phase4?.systemPromptPath || 'prompt.ts'})`}>
                                          <pre class={styles.prompt}>{phase4Attempts[0].system_prompt}</pre>
                                        </Section>
                                      </Show>
                                      <Show when={prompts()?.phase4?.schema}>
                                        <Section title={`Output Schema (${prompts()?.phase4?.schemaPath || 'schema.json'})`}>
                                          <pre class={styles.json}>{JSON.stringify(prompts()!.phase4.schema, null, 2)}</pre>
                                        </Section>
                                      </Show>
                                      <For each={phase4Attempts}>
                                        {(attempt) => (
                                          <Section title={`Fix Attempt ${attempt.attempt_number - 1}${!attempt.success ? ' (API error)' : ''}`}>
                                            <div class={styles.phaseInfo}>
                                              <Show when={attempt.response_time_ms}>
                                                <span>{(attempt.response_time_ms / 1000).toFixed(1)}s</span>
                                              </Show>
                                              <Show when={attempt.input_tokens}>
                                                <span>{attempt.input_tokens} in / {attempt.output_tokens} out</span>
                                              </Show>
                                            </div>
                                            <Show when={attempt.error_message}>
                                              <div class={styles.validationError}>{attempt.error_message}</div>
                                            </Show>
                                            <Section title="User Message">
                                              <pre class={styles.prompt}>{attempt.user_message}</pre>
                                            </Section>
                                            <Show when={attempt.response_json}>
                                              <Section title="Response">
                                                <pre class={styles.json}>{JSON.stringify(JSON.parse(attempt.response_json), null, 2)}</pre>
                                              </Section>
                                            </Show>
                                          </Section>
                                        )}
                                      </For>
                                    </Show>

                                    {/* Final Output: Contracts */}
                                    <Show when={detail()?.contracts?.length}>
                                      <Section title={`Output (${detail()!.contracts.length} contracts)`}>
                                        <For each={detail()!.contracts}>
                                          {contract => (
                                            <Section title={`${contract.name} (${contract.role}) - ${contract.is_validated ? 'validated' : 'invalid'}${contract.bytecode_size ? ` - ${contract.bytecode_size} bytes` : ''}`}>
                                              <Show when={contract.validation_error}>
                                                <div class={styles.validationError}>{contract.validation_error}</div>
                                              </Show>
                                              <pre class={styles.code}>{contract.cashscript_code}</pre>
                                            </Section>
                                          )}
                                        </For>
                                      </Section>
                                    </Show>
                                  </Section>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      </Show>
                    </>
                  )}
                </For>
              </tbody>
            </table>

            <div class={styles.pagination}>
              <button onClick={prevPage} disabled={offset() === 0}>Previous</button>
              <span>
                {offset() + 1} - {Math.min(offset() + 25, data().total)} of {data().total}
              </span>
              <button onClick={nextPage} disabled={offset() + 25 >= data().total}>Next</button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
