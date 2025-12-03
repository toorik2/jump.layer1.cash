import { Show, For } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import type { DisplayContract } from '../types';

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
    <div class="contract-tabs">
      <Show when={props.contracts().length > 0}>
        <For each={props.contracts()}>
          {(contract, idx) => {
            const attemptNum = props.contractAttempts().get(contract.name);
            return (
              <button
                class={`contract-tab ${props.activeTab() === idx() ? 'active' : ''} ${!contract.validated ? 'pending' : ''}`}
                onClick={() => props.setActiveTab(idx())}
              >
                <span class="tab-name">{contract.name}</span>
                {contract.validated ? (
                  <span class="tab-status valid">✓</span>
                ) : (
                  <span class="tab-status pending">
                    <span class="tab-spinner"></span>
                    {attemptNum && attemptNum > 1 && (
                      <span class="attempt-badge">attempt {attemptNum}</span>
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
          class={`contract-tab pending skeleton-tab ${props.activeTab() === 0 ? 'active' : ''}`}
          onClick={() => props.setActiveTab(0)}
        >
          <span class="tab-name-skeleton"></span>
          <span class="tab-status pending"><span class="tab-spinner"></span></span>
        </button>
        <button
          class={`contract-tab pending skeleton-tab ${props.activeTab() === 1 ? 'active' : ''}`}
          onClick={() => props.setActiveTab(1)}
        >
          <span class="tab-name-skeleton"></span>
          <span class="tab-status pending"><span class="tab-spinner"></span></span>
        </button>
        <button
          class={`contract-tab pending skeleton-tab ${props.activeTab() === 2 ? 'active' : ''}`}
          onClick={() => props.setActiveTab(2)}
        >
          <span class="tab-name-skeleton"></span>
          <span class="tab-status pending"><span class="tab-spinner"></span></span>
        </button>
      </Show>

      {/* Original button - always on right side */}
      <button
        class={`contract-tab original-tab ${props.isOriginalTab() ? 'active' : ''}`}
        onClick={() => props.setActiveTab(9999)}
      >
        <span class="tab-name">Original</span>
      </button>
    </div>
  );
}
