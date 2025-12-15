import { For } from 'solid-js';
import type { NativeSolution } from '../stores/conversion';
import styles from './NativeSolutionView.module.css';

type Props = {
  solution: NativeSolution;
  onReset: () => void;
};

export default function NativeSolutionView(props: Props) {
  return (
    <div class={styles.container}>
      <div class={styles.header}>
        <div class={styles.iconWrapper}>
          <svg class={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h2 class={styles.title}>Native CashTokens Solution</h2>
        <p class={styles.subtitle}>No CashScript contracts needed</p>
      </div>

      <div class={styles.content}>
        <div class={styles.explanation}>
          <p>
            This functionality maps directly to <strong>native CashTokens</strong> on Bitcoin Cash.
            The UTXO model and protocol consensus rules handle everything that would require
            smart contract logic on EVM chains.
          </p>
        </div>

        <div class={styles.section}>
          <h3 class={styles.sectionTitle}>How it works</h3>
          <div class={styles.custodyList}>
            <For each={props.solution.custodyDecisions}>
              {(decision) => (
                <div class={styles.custodyItem}>
                  <div class={styles.custodyHeader}>
                    <span class={styles.entity}>{decision.entity}</span>
                    <span class={styles.arrow}>&rarr;</span>
                    <span class={styles.custody}>{decision.custody.toUpperCase()}</span>
                  </div>
                  <p class={styles.rationale}>{decision.rationale}</p>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class={styles.section}>
          <h3 class={styles.sectionTitle}>Architecture details</h3>
          <div class={styles.rationaleBox}>
            <div class={styles.rationaleHeader}>
              <span class={styles.contractCount}>{props.solution.rationale.total} contracts</span>
              <span class={styles.breakdown}>{props.solution.rationale.breakdown}</span>
            </div>
            <ul class={styles.decisionList}>
              <For each={props.solution.rationale.decisions}>
                {(decision) => <li>{decision}</li>}
              </For>
            </ul>
          </div>
        </div>

        <div class={styles.section}>
          <h3 class={styles.sectionTitle}>Important notes</h3>
          <div class={styles.warningList}>
            <For each={props.solution.guidance}>
              {(warning) => {
                const isCritical = warning.startsWith('CRITICAL:');
                const isImportant = warning.startsWith('IMPORTANT:');
                const isArchitecture = warning.startsWith('ARCHITECTURE:');
                const isRecommendation = warning.startsWith('RECOMMENDATION:');
                return (
                  <div class={
                    isCritical ? styles.warningCritical :
                    isImportant ? styles.warningImportant :
                    isArchitecture ? styles.warningArchitecture :
                    isRecommendation ? styles.warningRecommendation :
                    styles.warning
                  }>
                    {warning}
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        <div class={styles.resources}>
          <h3 class={styles.sectionTitle}>Resources</h3>
          <div class={styles.resourceLinks}>
            <a href="https://cashtokens.org/" target="_blank" rel="noopener noreferrer" class={styles.resourceLink}>
              <svg class={styles.linkIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              CashTokens.org
              <span class={styles.linkDesc}>Official documentation</span>
            </a>
            <a href="https://t.me/cashtoken_devs" target="_blank" rel="noopener noreferrer" class={styles.resourceLink}>
              <svg class={styles.linkIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              CashToken Devs Telegram
              <span class={styles.linkDesc}>Community support</span>
            </a>
          </div>
        </div>
      </div>

      <div class={styles.footer}>
        <button class={styles.startOverBtn} onClick={props.onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}
