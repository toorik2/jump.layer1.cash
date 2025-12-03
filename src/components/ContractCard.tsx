import { Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import { Copy, Check, X } from 'lucide-solid';
import type { DisplayContract, ContractInfo } from '../types';

type Props = {
  contract: DisplayContract | null;
  isOriginal: boolean;
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
  // Show original Solidity contract
  if (props.isOriginal) {
    return (
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
    );
  }

  // Show contract content
  if (props.contract) {
    // Show loading state for pending contracts
    if (!props.contract.validated) {
      const attemptNum = props.contractAttempts().get(props.contract.name);
      const phase = props.currentPhase();
      const isSkeleton = props.contract.isSkeleton;

      let phaseMessage = 'Waiting...';
      if (phase === 3) {
        phaseMessage = 'Phase 3: Generating CashScript code...';
      } else if (phase === 4) {
        phaseMessage = attemptNum && attemptNum > 1
          ? `Phase 4: Fixing contract (attempt ${attemptNum})`
          : 'Phase 4: Validating with compiler...';
      }

      return (
        <div class="contract-card">
          <div class="pending-contract-state skeleton">
            <div style="margin-bottom: 1rem;">
              <strong>{props.contract.name}</strong>
              <p class="phase-info">{phaseMessage}</p>
            </div>

            <Show when={isSkeleton && (props.contract.custodies || props.contract.validates)}>
              <div class="skeleton-specs">
                <Show when={props.contract.custodies}>
                  <div class="spec-item">
                    <span class="spec-label">Custodies:</span>
                    <span class="spec-value">{props.contract.custodies}</span>
                  </div>
                </Show>
                <Show when={props.contract.validates}>
                  <div class="spec-item">
                    <span class="spec-label">Validates:</span>
                    <span class="spec-value">{props.contract.validates}</span>
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
      );
    }

    // Validated contract
    const highlightedHtml = props.contractHTML()[props.contract.id!];

    return (
      <div class="contract-card">
        {props.contract.dependencies && props.contract.dependencies.length > 0 && (
          <div class="contract-dependencies">
            <strong>Dependencies:</strong> {props.contract.dependencies.join(', ')}
          </div>
        )}

        <div class="code-container">
          <div class="code-block" innerHTML={highlightedHtml} />
          <button
            class={`code-copy-btn ${props.copyStatus()[props.contract.id!] === 'copied' ? 'copied' : ''}`}
            onClick={() => props.onCopy(props.contract!.code, props.contract!.id!)}
            disabled={props.copyStatus()[props.contract.id!] === 'copied'}
            title={props.copyStatus()[props.contract.id!] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
          >
            {props.copyStatus()[props.contract.id!] === 'copied' ? <Check size={20} /> : <Copy size={20} />}
          </button>
        </div>

        {props.contract.bytecodeSize && (
          <div class="bytecode-size">
            Bytecode size: {props.contract.bytecodeSize} bytes
          </div>
        )}
      </div>
    );
  }

  // Loading skeleton during early phases
  if (props.loading() && !props.hasIncrementalData) {
    const phase = props.currentPhase();
    let phaseMessage = 'Starting...';
    if (phase === 1) {
      phaseMessage = 'Phase 1: Extracting domain model...';
    } else if (phase === 2) {
      phaseMessage = 'Phase 2: Designing UTXO architecture...';
    } else if (phase >= 3) {
      phaseMessage = 'Phase 3: Generating CashScript code...';
    }

    return (
      <div class="contract-card">
        <div class="pending-contract-state skeleton">
          <p class="phase-info" style="margin-bottom: 1rem;">{phaseMessage}</p>
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
    );
  }

  // Single contract fallback
  const firstContract = props.validatedContracts()[0];
  const html = firstContract
    ? props.contractHTML()[firstContract.id]
    : props.highlightedHTML();
  const code = firstContract?.code;

  return (
    <div class="contract-card">
      <div class="code-container">
        <div class="code-block" innerHTML={html} />
        <button
          class={`code-copy-btn ${props.mainCopyStatus() === 'copied' ? 'copied' : props.mainCopyStatus() === 'error' ? 'error' : ''}`}
          onClick={() => code && props.onMainCopy(code)}
          disabled={props.mainCopyStatus() === 'copied'}
          title={props.mainCopyStatus() === 'copied' ? 'Copied!' : 'Copy to clipboard'}
        >
          {props.mainCopyStatus() === 'copied' ? <Check size={20} /> : props.mainCopyStatus() === 'error' ? <X size={20} /> : <Copy size={20} />}
        </button>
      </div>
    </div>
  );
}
