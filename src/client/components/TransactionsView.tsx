import { Show, For, createMemo } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { Transaction, PendingContract, ContractInfo } from '../types';
import styles from './TransactionsView.module.css';

type Props = {
  transactions: Accessor<Transaction[]>;
  loading: Accessor<boolean>;
  pendingContracts: Accessor<PendingContract[]>;
  validatedContracts: Accessor<ContractInfo[]>;
  capabilities: Accessor<string[]>;
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

  // Extract contract name from "ContractName.functionName" format
  const getContractName = (slot: string): string => {
    if (!slot || slot === 'P2PKH' || slot === 'burned') return slot;
    return slot.split('.')[0]; // "Ballot.recordVote" -> "Ballot"
  };

  const isContractName = (slot?: string): boolean => {
    if (!slot) return false;
    const contractName = getContractName(slot);
    return contractNameSet().has(contractName);
  };

  const getSlotTypeClass = (utxoType: string, slot?: string) => {
    if (utxoType?.includes('NFT')) {
      const contractName = getContractName(slot || '');
      const cap = getCapability(contractName);
      if (cap === 'minting') return styles.slotTypeNftMinting;
      if (cap === 'mutable') return styles.slotTypeNftMutable;
      return styles.slotTypeNftImmutable;
    }
    if (utxoType?.includes('BCH')) return styles.slotTypeBch;
    if (utxoType?.includes('FT') || utxoType?.includes('fungible')) return styles.slotTypeFungible;
    return styles.slotType;
  };

  const isContractType = (utxoType: string): boolean => {
    return utxoType?.toLowerCase().includes('contract') ||
           utxoType?.toLowerCase().includes('state');
  };

  // Get capability for a contract (e.g., "BallotContract:mutable" -> "mutable")
  const getCapability = (contractName?: string): string | null => {
    if (!contractName) return null;
    const caps = props.capabilities();
    const entry = caps.find(c => c.startsWith(`${contractName}:`));
    if (!entry) return null;
    return entry.split(':')[1]; // "mutable", "minting", or "none"
  };

  // Format capability for display ("none" -> "immutable")
  const formatCapability = (cap: string | null): string => {
    if (cap === 'minting') return 'minting';
    if (cap === 'mutable') return 'mutable';
    return 'immutable'; // "none" in schema means immutable
  };

  // Format utxoType for badge display (e.g., "BallotState NFT" -> "NFT")
  const formatUtxoType = (utxoType: string, slot?: string): string => {
    if (utxoType?.includes('NFT')) {
      const contractName = getContractName(slot || '');
      const cap = getCapability(contractName);
      return `NFT - ${formatCapability(cap)}`;
    }
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
      .replace(/^BCH only$/, '')
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
                  <div class={styles.headerTop}>
                    <h3 class={styles.name}>{tx.name}</h3>
                    {(() => {
                      // Derive participants from inputs/outputs (contracts + P2PKH)
                      const participants = new Set<string>();
                      for (const input of tx.inputs || []) {
                        const contractName = getContractName(input.from);
                        if (isContractName(input.from)) participants.add(contractName);
                        else if (input.from === 'P2PKH') participants.add('P2PKH');
                      }
                      for (const output of tx.outputs || []) {
                        const contractName = getContractName(output.to);
                        if (isContractName(output.to)) participants.add(contractName);
                        else if (output.to === 'P2PKH') participants.add('P2PKH');
                      }
                      const participantList = [...participants];
                      return (
                        <Show when={participantList.length > 0}>
                          <div class={styles.headerRight}>
                            <For each={participantList}>
                              {(participant) => (
                                <span class={participant === 'P2PKH' ? styles.badgeP2pkh : styles.badge}>
                                  {participant}
                                </span>
                              )}
                            </For>
                          </div>
                        </Show>
                      );
                    })()}
                  </div>
                  <p class={styles.description}>{tx.purpose}</p>
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
                              <span class={styles.slotLabelName}>
                                {input.from.includes('.') ? (
                                  <>
                                    <span class={styles.contractNameInSlot}>{getContractName(input.from)}</span>
                                    <span class={styles.functionName}>.{input.from.split('.')[1]}()</span>
                                  </>
                                ) : (
                                  <span class={input.from === 'P2PKH' ? styles.p2pkhNameInSlot : undefined}>{input.from}</span>
                                )}
                              </span>
                              <Show when={input.utxoType}>
                                <span class={getSlotTypeClass(input.utxoType, input.from)}>{formatUtxoType(input.utxoType, input.from)}</span>
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
                              <span class={styles.slotLabelName}>
                                {output.to.includes('.') ? (
                                  <>
                                    <span class={styles.contractNameInSlot}>{getContractName(output.to)}</span>
                                    <span class={styles.functionName}>.{output.to.split('.')[1]}()</span>
                                  </>
                                ) : (
                                  <span class={output.to === 'P2PKH' ? styles.p2pkhNameInSlot : undefined}>{output.to}</span>
                                )}
                              </span>
                              <Show when={output.utxoType}>
                                <span class={getSlotTypeClass(output.utxoType, output.to)}>{formatUtxoType(output.utxoType, output.to)}</span>
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
