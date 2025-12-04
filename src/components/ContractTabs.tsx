import { Show, For } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import type { DisplayContract } from '../types';
import styles from './ContractTabs.module.css';

type Props = {
  contracts: Accessor<DisplayContract[]>;
  activeTab: Accessor<number>;
  setActiveTab: Setter<number>;
  contractAttempts: Accessor<Map<string, number>>;
  loading: Accessor<boolean>;
  isOriginalTab: Accessor<boolean>;
};

export default function ContractTabs(props: Props) {
  return (
    <div class={styles.tabs}>
      <Show when={props.contracts().length > 0}>
        <For each={props.contracts()}>
          {(contract, idx) => {
            const attemptNum = props.contractAttempts().get(contract.name);
            const tabClass = () => {
              if (props.activeTab() === idx()) {
                return contract.validated ? styles.tabActive : `${styles.tabPending} ${styles.tabActive}`;
              }
              return contract.validated ? styles.tab : styles.tabPending;
            };
            return (
              <button class={tabClass()} onClick={() => props.setActiveTab(idx())}>
                <span class={styles.tabName}>{contract.name}</span>
                {contract.validated ? (
                  <span class={styles.tabStatusValid}>✓</span>
                ) : (
                  <span class={styles.tabStatusPending}>
                    <span class={styles.tabSpinner}></span>
                    {attemptNum && attemptNum > 1 && (
                      <span class={styles.attemptBadge}>attempt {attemptNum}</span>
                    )}
                  </span>
                )}
              </button>
            );
          }}
        </For>
      </Show>

      {/* Skeleton tabs during early phases */}
      <Show when={props.loading() && props.contracts().length === 0}>
        <button
          class={`${styles.skeletonTab} ${props.activeTab() === 0 ? styles.tabActive : ''}`}
          onClick={() => props.setActiveTab(0)}
        >
          <span class={styles.tabNameSkeleton}></span>
          <span class={styles.tabStatusPending}><span class={styles.tabSpinner}></span></span>
        </button>
        <button
          class={`${styles.skeletonTab} ${props.activeTab() === 1 ? styles.tabActive : ''}`}
          onClick={() => props.setActiveTab(1)}
        >
          <span class={styles.tabNameSkeleton}></span>
          <span class={styles.tabStatusPending}><span class={styles.tabSpinner}></span></span>
        </button>
        <button
          class={`${styles.skeletonTab} ${props.activeTab() === 2 ? styles.tabActive : ''}`}
          onClick={() => props.setActiveTab(2)}
        >
          <span class={styles.tabNameSkeleton}></span>
          <span class={styles.tabStatusPending}><span class={styles.tabSpinner}></span></span>
        </button>
      </Show>

      {/* Original button - always on right side */}
      <button
        class={props.isOriginalTab() ? styles.originalTabActive : styles.originalTab}
        onClick={() => props.setActiveTab(9999)}
      >
        <span class={styles.tabName}>Original</span>
      </button>
    </div>
  );
}
