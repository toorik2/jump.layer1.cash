import { Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { DisplayContract, ContractInfo } from '../types';
import CopyButton from './CopyButton';
import styles from './ContractCard.module.css';

type Props = {
  contract: DisplayContract | null;
  isOriginal: Accessor<boolean>;
  originalCode: Accessor<string>;
  originalHTML: Accessor<string>;
  contractHTML: Accessor<{ [key: string]: string }>;
  copyStatus: Accessor<{ [key: string]: 'idle' | 'copied' | 'error' }>;
  onCopy: (code: string, id: string) => void;
  currentPhase: Accessor<number>;
  contractAttempts: Accessor<Map<string, number>>;
  loading: Accessor<boolean>;
  hasIncrementalData: boolean;
  validatedContracts: Accessor<ContractInfo[]>;
  mainCopyStatus: Accessor<'idle' | 'copied' | 'error'>;
  onMainCopy: (code: string) => void;
};

export default function ContractCard(props: Props) {
  return (
    <>
      {/* Original Solidity contract */}
      <Show when={props.isOriginal()}>
        <div class={styles.card}>
          <div class={styles.codeContainer}>
            <div class={styles.codeBlock} innerHTML={props.originalHTML()} />
            <CopyButton
              status={props.copyStatus()['original'] || 'idle'}
              onClick={() => props.onCopy(props.originalCode(), 'original')}
            />
          </div>
        </div>
      </Show>

      {/* Contract content */}
      <Show when={!props.isOriginal() && props.contract}>
        <Show when={!props.contract!.validated}>
          <div class={styles.card}>
            <div class={styles.pendingState}>
              <div style="margin-bottom: 1rem;">
                <strong>{props.contract!.name}</strong>
                <p class={styles.phaseInfo}>
                  {props.currentPhase() === 3 ? 'Phase 3: Generating CashScript code...' :
                   props.currentPhase() === 4 ? (
                     props.contractAttempts().get(props.contract!.name) && props.contractAttempts().get(props.contract!.name)! > 1
                       ? `Phase 4: Fixing contract (attempt ${props.contractAttempts().get(props.contract!.name)})`
                       : 'Phase 4: Validating with compiler...'
                   ) : 'Waiting...'}
                </p>
              </div>

              <Show when={props.contract!.isSkeleton && (props.contract!.custodies || props.contract!.validates)}>
                <div class={styles.skeletonSpecs}>
                  <Show when={props.contract!.custodies}>
                    <div class={styles.specItem}>
                      <span class={styles.specLabel}>Custodies:</span>
                      <span class={styles.specValue}>{props.contract!.custodies}</span>
                    </div>
                  </Show>
                  <Show when={props.contract!.validates}>
                    <div class={styles.specItem}>
                      <span class={styles.specLabel}>Validates:</span>
                      <span class={styles.specValue}>{props.contract!.validates}</span>
                    </div>
                  </Show>
                </div>
              </Show>

              <div class={styles.skeletonCode}>
                <div class={`${styles.skeletonLine} ${styles.w40}`}></div>
                <div class={`${styles.skeletonLine} ${styles.w60}`}></div>
                <div class={`${styles.skeletonLine} ${styles.w80}`}></div>
                <div class={`${styles.skeletonLine} ${styles.w50}`}></div>
                <div class={`${styles.skeletonLine} ${styles.w70}`}></div>
                <div class={`${styles.skeletonLine} ${styles.w45}`}></div>
                <div class={`${styles.skeletonLine} ${styles.w90}`}></div>
                <div class={`${styles.skeletonLine} ${styles.w55}`}></div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={props.contract!.validated}>
          <div class={styles.card}>
            <Show when={props.contract!.dependencies && props.contract!.dependencies!.length > 0}>
              <div class={styles.dependencies}>
                <strong>Dependencies:</strong> {props.contract!.dependencies!.join(', ')}
              </div>
            </Show>

            <div class={styles.codeContainer}>
              <div class={styles.codeBlock} innerHTML={props.contractHTML()[props.contract!.id!]} />
              <CopyButton
                status={props.copyStatus()[props.contract!.id!] || 'idle'}
                onClick={() => props.onCopy(props.contract!.code, props.contract!.id!)}
              />
            </div>

            <Show when={props.contract!.bytecodeSize}>
              <div class={styles.bytecodeSize}>
                Bytecode size: {props.contract!.bytecodeSize} bytes
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      {/* Loading skeleton during early phases */}
      <Show when={!props.isOriginal() && !props.contract && props.loading() && !props.hasIncrementalData}>
        <div class={styles.card}>
          <div class={styles.pendingState}>
            <p class={styles.phaseInfo} style="margin-bottom: 1rem;">
              {props.currentPhase() === 1 ? 'Phase 1: Extracting domain model...' :
               props.currentPhase() === 2 ? 'Phase 2: Designing UTXO architecture...' :
               props.currentPhase() >= 3 ? 'Phase 3: Generating CashScript code...' : 'Starting...'}
            </p>
            <div class={styles.skeletonCode}>
              <div class={`${styles.skeletonLine} ${styles.w40}`}></div>
              <div class={`${styles.skeletonLine} ${styles.w60}`}></div>
              <div class={`${styles.skeletonLine} ${styles.w80}`}></div>
              <div class={`${styles.skeletonLine} ${styles.w50}`}></div>
              <div class={`${styles.skeletonLine} ${styles.w70}`}></div>
              <div class={`${styles.skeletonLine} ${styles.w45}`}></div>
              <div class={`${styles.skeletonLine} ${styles.w90}`}></div>
              <div class={`${styles.skeletonLine} ${styles.w55}`}></div>
            </div>
          </div>
        </div>
      </Show>

      {/* Single contract fallback */}
      <Show when={!props.isOriginal() && !props.contract && !(props.loading() && !props.hasIncrementalData) && props.validatedContracts()[0]}>
        <div class={styles.card}>
          <div class={styles.codeContainer}>
            <div class={styles.codeBlock} innerHTML={props.contractHTML()[props.validatedContracts()[0].id]} />
            <CopyButton
              status={props.mainCopyStatus()}
              onClick={() => props.onMainCopy(props.validatedContracts()[0].code)}
            />
          </div>
        </div>
      </Show>
    </>
  );
}
