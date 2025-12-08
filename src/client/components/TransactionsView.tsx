import { Show, For, createMemo } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { Transaction, PendingContract, ContractInfo } from '../types';
import styles from './TransactionsView.module.css';

type Props = {
  transactions: Accessor<Transaction[]>;
  loading: Accessor<boolean>;
  pendingContracts: Accessor<PendingContract[]>;
  validatedContracts: Accessor<ContractInfo[]>;
};

export default function TransactionsView(props: Props) {
  // Build set of known contract names from both pending and validated
  const contractNameSet = createMemo(() => {
    const names = new Set<string>();
    for (const c of props.pendingContracts()) {
      names.add(c.name);
    }
    for (const c of props.validatedContracts()) {
      names.add(c.name);
    }
    return names;
  });

  const isContractName = (name?: string): boolean => {
    if (!name) return false;
    return contractNameSet().has(name);
  };

  const getSlotTypeClass = (type: string) => {
    if (type?.includes('NFT') && type?.includes('contract')) return styles.slotTypeContractNft;
    if (type?.includes('NFT')) return styles.slotTypeUserNft;
    if (type?.includes('BCH')) return styles.slotTypeBch;
    if (type?.includes('fungible')) return styles.slotTypeFungible;
    return styles.slotType;
  };

  return (
    <div class={styles.view}>
      <Show when={props.transactions().length === 0 && props.loading()}>
        <div class={styles.skeleton}>
          <div class={styles.skeletonList}>
            <For each={[1, 2, 3]}>
              {() => (
                <div class={styles.skeletonCard}>
                  <div class={styles.skeletonHeader}>
                    <div class={`${styles.skeletonLine} ${styles.w40}`}></div>
                    <div class={`${styles.skeletonLine} ${styles.w70}`}></div>
                  </div>
                  <div class={styles.skeletonFlow}>
                    <div class={styles.skeletonSide}>
                      <div class={`${styles.skeletonLine} ${styles.w20}`}></div>
                      <div class={styles.skeletonSlot}></div>
                      <div class={styles.skeletonSlot}></div>
                    </div>
                    <div class={styles.skeletonArrow}></div>
                    <div class={styles.skeletonSide}>
                      <div class={`${styles.skeletonLine} ${styles.w20}`}></div>
                      <div class={styles.skeletonSlot}></div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.transactions().length > 0}>
        <div class={styles.list}>
          <For each={props.transactions()}>
            {(tx) => (
              <div class={styles.card}>
                <div class={styles.header}>
                  <div class={styles.headerLeft}>
                    <h3 class={styles.name}>{tx.name}</h3>
                    <p class={styles.description}>{tx.description}</p>
                  </div>
                  {(() => {
                    // Derive contracts from inputs/outputs instead of relying on AI-provided participatingContracts
                    const contracts = new Set<string>();
                    for (const input of tx.inputs || []) {
                      if (isContractName(input.from)) contracts.add(input.from!);
                    }
                    for (const output of tx.outputs || []) {
                      if (isContractName(output.to)) contracts.add(output.to!);
                    }
                    const contractList = [...contracts];
                    return (
                      <Show when={contractList.length > 0}>
                        <div class={styles.headerRight}>
                          <span class={styles.badge}>{contractList.join(' · ')}</span>
                        </div>
                      </Show>
                    );
                  })()}
                </div>

                <div class={styles.flow}>
                  <div class={styles.inputs}>
                    <h4>Inputs</h4>
                    <For each={tx.inputs || []}>
                      {(input) => (
                        <div class={isContractName(input.from) ? styles.slotContract : styles.slotUser}>
                          <div class={styles.slotIndex}>[{input.index}]</div>
                          <div class={styles.slotContent}>
                            <div class={styles.slotLabel}>
                              {input.from}
                              <Show when={input.type}>
                                <span class={getSlotTypeClass(input.type)}>{input.type}</span>
                              </Show>
                            </div>
                            <div class={styles.slotDescription}>{input.description}</div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>

                  <div class={styles.arrow}>→</div>

                  <div class={styles.outputs}>
                    <h4>Outputs</h4>
                    <For each={tx.outputs || []}>
                      {(output) => (
                        <div class={isContractName(output.to) ? styles.slotContract : styles.slotUser}>
                          <div class={styles.slotIndex}>[{output.index}]</div>
                          <div class={styles.slotContent}>
                            <div class={styles.slotLabel}>
                              {output.to}
                              <Show when={output.type}>
                                <span class={getSlotTypeClass(output.type)}>{output.type}</span>
                              </Show>
                            </div>
                            <div class={styles.slotDescription}>{output.description}</div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <Show when={tx.flowDescription}>
                  <details class={styles.flowDescription}>
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
