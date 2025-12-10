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

  const getSlotTypeClass = (utxoType: string) => {
    if (utxoType?.includes('NFT') && isContractType(utxoType)) return styles.slotTypeContractNft;
    if (utxoType?.includes('NFT')) return styles.slotTypeUserNft;
    if (utxoType?.includes('BCH')) return styles.slotTypeBch;
    if (utxoType?.includes('FT') || utxoType?.includes('fungible')) return styles.slotTypeFungible;
    return styles.slotType;
  };

  const isContractType = (utxoType: string): boolean => {
    return utxoType?.toLowerCase().includes('contract') ||
           utxoType?.toLowerCase().includes('state');
  };

  // Format utxoType for badge display (e.g., "BallotState NFT" -> "NFT")
  const formatUtxoType = (utxoType: string): string => {
    if (utxoType?.includes('NFT')) return 'NFT';
    if (utxoType?.includes('BCH')) return 'BCH';
    if (utxoType?.includes('FT') || utxoType?.includes('fungible')) return 'FT';
    return '';  // Hide badge for unrecognized types
  };

  // Strip type suffix from description (badge shows type, no need to repeat)
  const formatDescription = (utxoType: string): string => {
    if (!utxoType) return '';
    return utxoType
      .replace(/ NFT$/, '')
      .replace(/ FT$/, '')
      .replace(/ BCH$/, '')
      .replace(/^BCH only$/, 'BCH')
      .replace(/ fungible tokens?$/i, '')
      .trim();
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
                    <p class={styles.description}>{tx.purpose}</p>
                  </div>
                  {(() => {
                    // Derive participants from inputs/outputs (contracts + P2PKH)
                    const participants = new Set<string>();
                    for (const input of tx.inputs || []) {
                      if (isContractName(input.from)) participants.add(input.from!);
                      else if (input.from === 'P2PKH') participants.add('P2PKH');
                    }
                    for (const output of tx.outputs || []) {
                      if (isContractName(output.to)) participants.add(output.to!);
                      else if (output.to === 'P2PKH') participants.add('P2PKH');
                    }
                    const participantList = [...participants];
                    return (
                      <Show when={participantList.length > 0}>
                        <div class={styles.headerRight}>
                          <For each={participantList}>
                            {(participant, i) => (
                              <>
                                <span class={participant === 'P2PKH' ? styles.badgeP2pkh : styles.badge}>
                                  {participant}
                                </span>
                                <Show when={i() < participantList.length - 1}>
                                  <span class={styles.badgeSeparator}>·</span>
                                </Show>
                              </>
                            )}
                          </For>
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
                              <Show when={input.utxoType}>
                                <span class={getSlotTypeClass(input.utxoType)}>{formatUtxoType(input.utxoType)}</span>
                              </Show>
                            </div>
                            <div class={styles.slotDescription}>
                              {formatDescription(input.utxoType)}
                              <Show when={input.stateRequired}>
                                <span> ({input.stateRequired})</span>
                              </Show>
                            </div>
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
                              <Show when={output.utxoType}>
                                <span class={getSlotTypeClass(output.utxoType)}>{formatUtxoType(output.utxoType)}</span>
                              </Show>
                            </div>
                            <div class={styles.slotDescription}>
                              {formatDescription(output.utxoType)}
                              <Show when={output.stateProduced}>
                                <span> ({output.stateProduced})</span>
                              </Show>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
