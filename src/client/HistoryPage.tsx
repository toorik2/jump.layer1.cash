import { createSignal, createResource, For, Show } from 'solid-js';
import './styles/global.css';
import styles from './HistoryPage.module.css';

interface ConversionStats {
  total_conversions: number;
  success_count: number;
  failed_count: number;
  success_rate: number;
  avg_duration_ms: number | null;
  total_contracts: number;
  conversions_today: number;
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
}

interface ConversionDetail {
  conversion: any;
  contracts: any[];
  semantic_analysis: any;
  utxo_architecture: any;
  api_attempts: any[];
}

async function fetchStats(): Promise<ConversionStats> {
  const res = await fetch('/api/stats');
  if (!res.ok) throw new Error('Failed to fetch stats');
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

export default function HistoryPage() {
  const [offset, setOffset] = createSignal(0);
  const [expandedId, setExpandedId] = createSignal<number | null>(null);
  const [detail, setDetail] = createSignal<ConversionDetail | null>(null);

  const [stats] = createResource(fetchStats);
  const [conversions] = createResource(offset, fetchConversions);

  async function toggleExpand(id: number) {
    if (expandedId() === id) {
      setExpandedId(null);
      setDetail(null);
    } else {
      setExpandedId(id);
      const data = await fetchConversionDetail(id);
      setDetail(data);
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
        <h1>Conversion History</h1>
      </header>

      <Show when={stats()} fallback={<div class={styles.loading}>Loading stats...</div>}>
        {s => (
          <div class={styles.statsGrid}>
            <div class={styles.statCard}>
              <div class={styles.statValue}>{s().total_conversions}</div>
              <div class={styles.statLabel}>Total Conversions</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statValue} classList={{ [styles.success]: true }}>
                {(s().success_rate * 100).toFixed(0)}%
              </div>
              <div class={styles.statLabel}>Success Rate</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statValue}>{formatDuration(s().avg_duration_ms)}</div>
              <div class={styles.statLabel}>Avg Duration</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statValue}>{s().total_contracts}</div>
              <div class={styles.statLabel}>Total Contracts</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statValue}>{s().conversions_today}</div>
              <div class={styles.statLabel}>Today</div>
            </div>
          </div>
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
                      </tr>
                      <Show when={expandedId() === conv.id && detail()}>
                        <tr class={styles.detailRow}>
                          <td colspan="5">
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
                                  <div class={styles.promptSection}>
                                    <div class={styles.promptLabel}>System Prompt</div>
                                    <pre class={styles.prompt}>{detail()!.semantic_analysis.system_prompt}</pre>
                                  </div>
                                </Show>
                                <div class={styles.promptSection}>
                                  <div class={styles.promptLabel}>User Message</div>
                                  <pre class={styles.prompt}>{
                                    detail()?.semantic_analysis?.user_prompt ||
                                    (detail()?.conversion?.solidity_code ? `Extract the domain model from this smart contract:\n\n${detail()!.conversion.solidity_code}` : '(no data)')
                                  }</pre>
                                </div>
                                <Show when={detail()?.semantic_analysis?.analysis_json}>
                                  <div class={styles.promptSection}>
                                    <div class={styles.promptLabel}>Response</div>
                                    <pre class={styles.json}>{
                                      JSON.stringify(JSON.parse(detail()!.semantic_analysis.analysis_json), null, 2)
                                    }</pre>
                                  </div>
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
                                  <div class={styles.promptSection}>
                                    <div class={styles.promptLabel}>System Prompt</div>
                                    <pre class={styles.prompt}>{detail()!.utxo_architecture.system_prompt}</pre>
                                  </div>
                                </Show>
                                <div class={styles.promptSection}>
                                  <div class={styles.promptLabel}>User Message</div>
                                  <pre class={styles.prompt}>{
                                    detail()?.utxo_architecture?.user_prompt ||
                                    (detail()?.semantic_analysis?.analysis_json ? `Design a UTXO architecture for this domain model.\n\nDOMAIN MODEL:\n${detail()!.semantic_analysis.analysis_json}` : '(no data)')
                                  }</pre>
                                </div>
                                <Show when={detail()?.utxo_architecture?.architecture_json}>
                                  <div class={styles.promptSection}>
                                    <div class={styles.promptLabel}>Response</div>
                                    <pre class={styles.json}>{
                                      JSON.stringify(JSON.parse(detail()!.utxo_architecture.architecture_json), null, 2)
                                    }</pre>
                                  </div>
                                </Show>
                              </Section>

                              {/* Phase 3/4: Code Generation */}
                              <Section title={`Phase 3/4: Code Generation (${detail()?.api_attempts?.length || 0} attempts)`}>
                                {/* Show system prompt once at top (same for all attempts) */}
                                <Show when={detail()?.api_attempts?.[0]?.system_prompt}>
                                  <div class={styles.promptSection}>
                                    <div class={styles.promptLabel}>System Prompt (same for all attempts)</div>
                                    <pre class={styles.prompt}>{detail()!.api_attempts[0].system_prompt}</pre>
                                  </div>
                                </Show>
                                <Show when={detail()?.api_attempts?.length} fallback={
                                  <div class={styles.promptSection}>
                                    <div class={styles.promptLabel}>User Message</div>
                                    <pre class={styles.prompt}>{
                                      detail()?.semantic_analysis?.analysis_json && detail()?.utxo_architecture?.architecture_json
                                        ? `DOMAIN MODEL:\n${detail()!.semantic_analysis.analysis_json}\n\nUTXO ARCHITECTURE:\n${detail()!.utxo_architecture.architecture_json}`
                                        : '(no data)'
                                    }</pre>
                                  </div>
                                }>
                                  <For each={detail()!.api_attempts}>
                                    {(attempt) => (
                                      <div class={styles.attempt}>
                                        <div class={styles.attemptHeader}>
                                          <span class={styles.attemptNumber}>Attempt {attempt.attempt_number}</span>
                                          <span classList={{
                                            [styles.attemptSuccess]: attempt.success,
                                            [styles.attemptFailed]: !attempt.success
                                          }}>
                                            {attempt.success ? 'success' : 'failed'}
                                          </span>
                                          <Show when={attempt.response_time_ms}>
                                            <span class={styles.attemptTime}>{(attempt.response_time_ms / 1000).toFixed(1)}s</span>
                                          </Show>
                                          <Show when={attempt.input_tokens}>
                                            <span class={styles.attemptTokens}>
                                              {attempt.input_tokens} in / {attempt.output_tokens} out
                                            </span>
                                          </Show>
                                        </div>
                                        <Show when={attempt.error_message}>
                                          <div class={styles.validationError}>{attempt.error_message}</div>
                                        </Show>
                                        <div class={styles.promptSection}>
                                          <div class={styles.promptLabel}>User Message</div>
                                          <pre class={styles.prompt}>{attempt.user_message}</pre>
                                        </div>
                                        <Show when={attempt.response_json}>
                                          <div class={styles.promptSection}>
                                            <div class={styles.promptLabel}>Response</div>
                                            <pre class={styles.json}>{
                                              (() => {
                                                try {
                                                  return JSON.stringify(JSON.parse(attempt.response_json), null, 2);
                                                } catch {
                                                  return attempt.response_json;
                                                }
                                              })()
                                            }</pre>
                                          </div>
                                        </Show>
                                      </div>
                                    )}
                                  </For>
                                </Show>

                                {/* Final Output: Contracts */}
                                <Show when={detail()?.contracts?.length}>
                                  <div class={styles.outputSection}>
                                    <div class={styles.promptLabel}>Output ({detail()!.contracts.length} contracts)</div>
                                    <For each={detail()!.contracts}>
                                      {contract => (
                                        <div class={styles.contract}>
                                          <div class={styles.contractHeader}>
                                            <span class={styles.contractName}>{contract.name}</span>
                                            <span class={styles.contractRole}>{contract.role}</span>
                                            <span classList={{
                                              [styles.validated]: contract.is_validated,
                                              [styles.invalid]: !contract.is_validated
                                            }}>
                                              {contract.is_validated ? 'validated' : 'invalid'}
                                            </span>
                                            <Show when={contract.bytecode_size}>
                                              <span class={styles.bytecodeSize}>{contract.bytecode_size} bytes</span>
                                            </Show>
                                          </div>
                                          <Show when={contract.validation_error}>
                                            <div class={styles.validationError}>{contract.validation_error}</div>
                                          </Show>
                                          <pre class={styles.code}>{contract.cashscript_code}</pre>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </Section>
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
