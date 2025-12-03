import { Show, For } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { Transaction } from '../types';

type Props = {
  transactions: Accessor<Transaction[]>;
  loading: Accessor<boolean>;
};

export default function TransactionsView(props: Props) {
  return (
    <div class="transactions-view">
      <Show when={props.transactions().length === 0 && props.loading()}>
        <div class="transactions-skeleton">
          <div class="skeleton-transactions">
            <For each={[1, 2, 3]}>
              {() => (
                <div class="skeleton-tx-card">
                  <div class="skeleton-tx-header">
                    <div class="skeleton-line w-40"></div>
                    <div class="skeleton-line w-70"></div>
                  </div>
                  <div class="skeleton-tx-flow">
                    <div class="skeleton-tx-side">
                      <div class="skeleton-line w-20"></div>
                      <div class="skeleton-slot"></div>
                      <div class="skeleton-slot"></div>
                    </div>
                    <div class="skeleton-arrow"></div>
                    <div class="skeleton-tx-side">
                      <div class="skeleton-line w-20"></div>
                      <div class="skeleton-slot"></div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.transactions().length > 0}>
        <div class="transactions-list">
          <For each={props.transactions()}>
            {(tx) => (
              <div class="transaction-card">
                <div class="tx-header">
                  <div class="tx-header-left">
                    <h3 class="tx-name">{tx.name}</h3>
                    <p class="tx-description">{tx.description}</p>
                  </div>
                  <Show when={(tx.participatingContracts || []).length > 0}>
                    <div class="tx-header-right">
                      <span class="tx-badge">{(tx.participatingContracts || []).join(' · ')}</span>
                    </div>
                  </Show>
                </div>

                <div class="tx-flow">
                  <div class="tx-inputs">
                    <h4>Inputs</h4>
                    <For each={tx.inputs || []}>
                      {(input) => (
                        <div class={`tx-slot input-slot ${input.contract ? 'contract' : 'user'}`}>
                          <div class="slot-index">[{input.index}]</div>
                          <div class="slot-content">
                            <div class="slot-label">
                              {input.contract || input.from}
                              <Show when={input.type}>
                                <span class={`slot-type ${input.type}`}>{input.type}</span>
                              </Show>
                            </div>
                            <div class="slot-description">{input.description}</div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>

                  <div class="tx-arrow">→</div>

                  <div class="tx-outputs">
                    <h4>Outputs</h4>
                    <For each={tx.outputs || []}>
                      {(output) => (
                        <div class={`tx-slot output-slot ${output.contract ? 'contract' : 'user'}`}>
                          <div class="slot-index">[{output.index}]</div>
                          <div class="slot-content">
                            <div class="slot-label">
                              {output.contract || output.to}
                              <Show when={output.type}>
                                <span class={`slot-type ${output.type}`}>{output.type}</span>
                              </Show>
                            </div>
                            <div class="slot-description">{output.description}</div>
                            <Show when={output.changes && output.changes.length > 0}>
                              <div class="slot-changes">
                                <For each={output.changes}>
                                  {(change) => (
                                    <span class={`change-badge ${change.changeType}`}>
                                      {change.field}: {change.changeType}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <Show when={tx.flowDescription}>
                  <details class="tx-flow-description">
                    <summary>Flow Description</summary>
                    <p>{tx.flowDescription}</p>
                  </details>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
