import { Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import { Copy, Check, X } from 'lucide-solid';
import type { DisplayContract, ContractInfo } from '../types';

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
  highlightedHTML: Accessor<string>;
  mainCopyStatus: Accessor<'idle' | 'copied' | 'error'>;
  onMainCopy: (code: string) => void;
};

export default function ContractCard(props: Props) {
  return (
    <>
      {/* Original Solidity contract */}
      <Show when={props.isOriginal()}>
        <div class="contract-card">
          <div class="code-container">
            <div class="code-block" innerHTML={props.originalHTML()} />
            <button
              class={`code-copy-btn ${props.copyStatus()['original'] === 'copied' ? 'copied' : ''}`}
              onClick={() => props.onCopy(props.originalCode(), 'original')}
              disabled={props.copyStatus()['original'] === 'copied'}
              title={props.copyStatus()['original'] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
            >
              {props.copyStatus()['original'] === 'copied' ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>
        </div>
      </Show>

      {/* Contract content */}
      <Show when={!props.isOriginal() && props.contract}>
        <Show when={!props.contract!.validated}>
          <div class="contract-card">
            <div class="pending-contract-state skeleton">
              <div style="margin-bottom: 1rem;">
                <strong>{props.contract!.name}</strong>
                <p class="phase-info">
                  {props.currentPhase() === 3 ? 'Phase 3: Generating CashScript code...' :
                   props.currentPhase() === 4 ? (
                     props.contractAttempts().get(props.contract!.name) && props.contractAttempts().get(props.contract!.name)! > 1
                       ? `Phase 4: Fixing contract (attempt ${props.contractAttempts().get(props.contract!.name)})`
                       : 'Phase 4: Validating with compiler...'
                   ) : 'Waiting...'}
                </p>
              </div>

              <Show when={props.contract!.isSkeleton && (props.contract!.custodies || props.contract!.validates)}>
                <div class="skeleton-specs">
                  <Show when={props.contract!.custodies}>
                    <div class="spec-item">
                      <span class="spec-label">Custodies:</span>
                      <span class="spec-value">{props.contract!.custodies}</span>
                    </div>
                  </Show>
                  <Show when={props.contract!.validates}>
                    <div class="spec-item">
                      <span class="spec-label">Validates:</span>
                      <span class="spec-value">{props.contract!.validates}</span>
                    </div>
                  </Show>
                </div>
              </Show>

              <div class="skeleton-code">
                <div class="skeleton-line w-40"></div>
                <div class="skeleton-line w-60"></div>
                <div class="skeleton-line w-80"></div>
                <div class="skeleton-line w-50"></div>
                <div class="skeleton-line w-70"></div>
                <div class="skeleton-line w-45"></div>
                <div class="skeleton-line w-90"></div>
                <div class="skeleton-line w-55"></div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={props.contract!.validated}>
          <div class="contract-card">
            <Show when={props.contract!.dependencies && props.contract!.dependencies!.length > 0}>
              <div class="contract-dependencies">
                <strong>Dependencies:</strong> {props.contract!.dependencies!.join(', ')}
              </div>
            </Show>

            <div class="code-container">
              <div class="code-block" innerHTML={props.contractHTML()[props.contract!.id!]} />
              <button
                class={`code-copy-btn ${props.copyStatus()[props.contract!.id!] === 'copied' ? 'copied' : ''}`}
                onClick={() => props.onCopy(props.contract!.code, props.contract!.id!)}
                disabled={props.copyStatus()[props.contract!.id!] === 'copied'}
                title={props.copyStatus()[props.contract!.id!] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
              >
                {props.copyStatus()[props.contract!.id!] === 'copied' ? <Check size={20} /> : <Copy size={20} />}
              </button>
            </div>

            <Show when={props.contract!.bytecodeSize}>
              <div class="bytecode-size">
                Bytecode size: {props.contract!.bytecodeSize} bytes
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      {/* Loading skeleton during early phases */}
      <Show when={!props.isOriginal() && !props.contract && props.loading() && !props.hasIncrementalData}>
        <div class="contract-card">
          <div class="pending-contract-state skeleton">
            <p class="phase-info" style="margin-bottom: 1rem;">
              {props.currentPhase() === 1 ? 'Phase 1: Extracting domain model...' :
               props.currentPhase() === 2 ? 'Phase 2: Designing UTXO architecture...' :
               props.currentPhase() >= 3 ? 'Phase 3: Generating CashScript code...' : 'Starting...'}
            </p>
            <div class="skeleton-code">
              <div class="skeleton-line w-40"></div>
              <div class="skeleton-line w-60"></div>
              <div class="skeleton-line w-80"></div>
              <div class="skeleton-line w-50"></div>
              <div class="skeleton-line w-70"></div>
              <div class="skeleton-line w-45"></div>
              <div class="skeleton-line w-90"></div>
              <div class="skeleton-line w-55"></div>
            </div>
          </div>
        </div>
      </Show>

      {/* Single contract fallback */}
      <Show when={!props.isOriginal() && !props.contract && !(props.loading() && !props.hasIncrementalData)}>
        <div class="contract-card">
          <div class="code-container">
            <div class="code-block" innerHTML={
              props.validatedContracts()[0]
                ? props.contractHTML()[props.validatedContracts()[0].id]
                : props.highlightedHTML()
            } />
            <button
              class={`code-copy-btn ${props.mainCopyStatus() === 'copied' ? 'copied' : props.mainCopyStatus() === 'error' ? 'error' : ''}`}
              onClick={() => props.validatedContracts()[0]?.code && props.onMainCopy(props.validatedContracts()[0].code)}
              disabled={props.mainCopyStatus() === 'copied'}
              title={props.mainCopyStatus() === 'copied' ? 'Copied!' : 'Copy to clipboard'}
            >
              {props.mainCopyStatus() === 'copied' ? <Check size={20} /> : props.mainCopyStatus() === 'error' ? <X size={20} /> : <Copy size={20} />}
            </button>
          </div>
        </div>
      </Show>
    </>
  );
}
