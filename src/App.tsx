import { createSignal, createEffect, createMemo, Show, onCleanup } from 'solid-js';
import { codeToHtml } from 'shiki';
import { API_STREAM_URL } from './config.frontend';
import { SIMPLE_EXAMPLE, COMPLEX_EXAMPLE, NATURAL_LANGUAGE_EXAMPLE } from './data/examples';
import type { ContractInfo, Transaction, PendingContract, DisplayContract, DeploymentGuide as DeploymentGuideType } from './types';
import { createConversionStore } from './stores/conversion';
import { streamSSE, type SSEEvent } from './hooks/useSSE';
import PhaseProgress from './components/PhaseProgress';
import TransactionsView from './components/TransactionsView';
import ContractTabs from './components/ContractTabs';
import ContractCard from './components/ContractCard';
import DeploymentGuide from './components/DeploymentGuide';
import ErrorDisplay from './components/ErrorDisplay';
import './styles.css';

export default function App() {
  // Conversion state (single source of truth)
  const store = createConversionStore();

  // Input state
  const [evmContract, setEvmContract] = createSignal('');

  // UI state (separate from conversion state)
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const [contractCopyStatus, setContractCopyStatus] = createSignal<{[key: string]: 'idle' | 'copied' | 'error'}>({});
  const [highlightedHTML, setHighlightedHTML] = createSignal('');
  const [contractHighlightedHTML, setContractHighlightedHTML] = createSignal<{[key: string]: string}>({});
  const [artifactHTML, setArtifactHTML] = createSignal('');
  const [originalContractHTML, setOriginalContractHTML] = createSignal('');
  const [activeContractTab, setActiveContractTab] = createSignal(0);
  const [activeMainTab, setActiveMainTab] = createSignal<'transactions' | 'contracts'>('transactions');

  // Phase progress animation state
  const [phaseStartTimes, setPhaseStartTimes] = createSignal<{[key: number]: number}>({});
  const [connectorProgress, setConnectorProgress] = createSignal<{[key: number]: number}>({});

  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // All contracts (validated + pending) for tab display
  const allContracts = createMemo((): DisplayContract[] => {
    const validated = store.contracts();
    const pending = store.pendingContracts();

    if (validated.length === 0 && pending.length === 0) return [];

    const validatedNames = new Set(validated.map(c => c.name));
    const pendingStubs: DisplayContract[] = pending
      .filter(spec => !validatedNames.has(spec.name))
      .map(spec => ({
        name: spec.name,
        custodies: spec.custodies,
        validates: spec.validates,
        validated: false,
        code: '',
        role: 'unknown',
        deploymentOrder: 999,
        isSkeleton: true
      }));

    const combined: DisplayContract[] = [
      ...validated.map(c => ({ ...c, validated: true })),
      ...pendingStubs
    ];
    const rolePriority: Record<string, number> = { primary: 0, helper: 1, state: 2, unknown: 3 };
    return combined.sort((a, b) => {
      const priorityDiff = (rolePriority[a.role] || 999) - (rolePriority[b.role] || 999);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.deploymentOrder || 999) - (b.deploymentOrder || 999);
    });
  });

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  const copyContractToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setContractCopyStatus(prev => ({ ...prev, [id]: 'copied' }));
    setTimeout(() => setContractCopyStatus(prev => ({ ...prev, [id]: 'idle' })), 2000);
  };

  const handleReset = () => {
    setEvmContract('');
    setHighlightedHTML('');
    setContractHighlightedHTML({});
    setArtifactHTML('');
    setOriginalContractHTML('');
    setActiveContractTab(0);
    setCopyStatus('idle');
    setContractCopyStatus({});
    setActiveMainTab('transactions');
    setPhaseStartTimes({});
    setConnectorProgress({});
    store.reset();
  };

  const PHASE_DURATION_MS = 60000;

  // Record phase start times when phase changes
  createEffect(() => {
    const phase = store.currentPhase();
    if (phase >= 1 && phase <= 4) {
      setPhaseStartTimes(prev => {
        if (!prev[phase]) {
          return { ...prev, [phase]: Date.now() };
        }
        return prev;
      });
    }
  });

  // Progress interval
  let progressInterval: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    const isLoading = store.loading();

    if (isLoading && !progressInterval) {
      progressInterval = setInterval(() => {
        const now = Date.now();
        const times = phaseStartTimes();
        const phase = store.currentPhase();
        const progress: {[key: number]: number} = {};

        for (let p = 1; p <= 3; p++) {
          const startTime = times[p];
          if (startTime && phase === p) {
            const elapsed = now - startTime;
            progress[p] = Math.min(100, (elapsed / PHASE_DURATION_MS) * 100);
          } else if (phase > p) {
            progress[p] = 100;
          } else {
            progress[p] = 0;
          }
        }

        setConnectorProgress(progress);
      }, 500);
    } else if (!isLoading && progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
      setConnectorProgress({ 1: 100, 2: 100, 3: 100 });
    }

    onCleanup(() => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    });
  });

  // Track which contracts are currently being highlighted
  const highlightingInProgress = new Set<string>();

  // Syntax highlighting for incremental contracts
  createEffect(async () => {
    const validated = store.contracts();
    if (validated.length > 0) {
      const currentHighlighted = contractHighlightedHTML();
      const contractsToHighlight = validated.filter(c =>
        !currentHighlighted[c.id] && !highlightingInProgress.has(c.id)
      );

      if (contractsToHighlight.length > 0) {
        contractsToHighlight.forEach(c => highlightingInProgress.add(c.id));

        for (const contract of contractsToHighlight) {
          let html: string;
          try {
            html = await codeToHtml(contract.code, {
              lang: 'javascript',
              theme: 'dark-plus'
            });
          } catch (error) {
            console.error('[Jump] Shiki highlighting failed:', contract.id, error);
            html = `<pre class="shiki" style="background-color:#1e1e1e;color:#d4d4d4"><code>${escapeHtml(contract.code)}</code></pre>`;
          }

          setContractHighlightedHTML(prev => ({ ...prev, [contract.id]: html }));
          highlightingInProgress.delete(contract.id);
        }
      }
    }
  });

  // Auto-switch to first validated contract
  let hasAutoSwitched = false;

  createEffect(() => {
    const validated = store.contracts();
    const all = allContracts();

    if (!hasAutoSwitched && validated.length > 0 && all.length > 0) {
      const currentTab = activeContractTab();
      if (currentTab >= all.length) return;

      const currentContract = all[currentTab];
      if (!currentContract || !currentContract.validated) {
        const firstValidatedIndex = all.findIndex(c => c.validated);
        if (firstValidatedIndex !== -1) {
          setActiveContractTab(firstValidatedIndex);
          hasAutoSwitched = true;
        }
      }
    }
  });

  // Enrich transactions with participating contracts
  const enrichTransactions = (txs: any[]): Transaction[] => {
    return txs
      .filter((tx: any) => (tx.inputs || []).length > 0 || (tx.outputs || []).length > 0)
      .map((tx: any) => {
        if (!tx.participatingContracts || tx.participatingContracts.length === 0) {
          const contracts = new Set<string>();
          const extractContract = (typeStr: string) => {
            if (!typeStr) return null;
            if (typeStr.includes('P2PKH') || typeStr.startsWith('BCH') ||
                typeStr.includes('OP_RETURN') || typeStr.includes('User') ||
                typeStr.includes('change')) return null;
            const genericWords = ['contract', 'address', 'minter', 'user', 'owner', 'sender', 'recipient'];
            const atMatch = typeStr.match(/at\s+(\w+)/);
            if (atMatch && !genericWords.includes(atMatch[1].toLowerCase())) return atMatch[1];
            const parenMatch = typeStr.match(/^(\w+)\s*\(/);
            if (parenMatch && !genericWords.includes(parenMatch[1].toLowerCase())) return parenMatch[1];
            const startMatch = typeStr.match(/^(\w+Contract)/);
            if (startMatch) return startMatch[1];
            return null;
          };
          (tx.inputs || []).forEach((i: any) => {
            if (i.contract) contracts.add(i.contract);
            if (i.from && !i.from.includes('P2PKH') && !i.from.includes('User')) contracts.add(i.from);
            const fromType = extractContract(i.type);
            if (fromType) contracts.add(fromType);
          });
          (tx.outputs || []).forEach((o: any) => {
            if (o.contract) contracts.add(o.contract);
            if (o.to && !o.to.includes('P2PKH') && !o.to.includes('User')) contracts.add(o.to);
            const toType = extractContract(o.type);
            if (toType) contracts.add(toType);
          });
          return { ...tx, participatingContracts: Array.from(contracts) };
        }
        return tx;
      });
  };

  const handleSSEEvent = (event: SSEEvent) => {
    if (!store.loading()) return;

    switch (event.type) {
      case 'phase1_start':
        store.setPhase(1);
        break;
      case 'phase2_start':
        store.setPhase(2);
        break;
      case 'transactions_ready':
        if (event.data.transactions && Array.isArray(event.data.transactions)) {
          const enrichedTxs = enrichTransactions(event.data.transactions);
          const specs = event.data.contractSpecs || [];
          store.addTransactions(enrichedTxs, specs);
        }
        break;
      case 'phase3_start':
        store.setPhase(3);
        break;
      case 'phase4_start':
        store.setPhase(4);
        break;
      case 'validation':
        store.setPhase(4);
        if (event.data.contracts && Array.isArray(event.data.contracts)) {
          store.updateValidation(event.data.contracts);
        }
        break;
      case 'contract_ready':
        store.addValidatedContract(
          event.data.contract,
          event.data.deploymentGuide || null,
          event.data.totalExpected || 1
        );
        break;
      case 'done':
        store.complete();
        break;
      case 'error':
        console.error('[Jump] Error:', event.data);
        store.setError(event.data.message || 'Conversion failed');
        break;
    }
  };

  const handleConvert = async () => {
    const contract = evmContract().trim();
    if (!contract) return;

    hasAutoSwitched = false;
    setPhaseStartTimes({});
    setConnectorProgress({});
    setHighlightedHTML('');
    setContractHighlightedHTML({});
    setArtifactHTML('');
    setActiveContractTab(0);

    // Highlight original contract BEFORE starting conversion
    const html = await codeToHtml(contract, { lang: 'solidity', theme: 'dark-plus' });
    setOriginalContractHTML(html);

    const abortController = store.startConversion();

    try {
      await streamSSE(
        API_STREAM_URL,
        { contract },
        handleSSEEvent,
        abortController.signal
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[Jump] Conversion error:', err);
      store.setError(`Conversion failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Derived state for view logic
  const hasIncrementalData = () => store.contracts().length > 0;
  const hasPendingContracts = () => store.pendingContracts().length > 0;
  const isMulti = () => store.isMultiContract() || (hasPendingContracts() && store.pendingContracts().length > 1);

  const contractsToDisplay = createMemo((): DisplayContract[] => {
    if (hasIncrementalData()) return allContracts();
    if (hasPendingContracts()) {
      return store.pendingContracts().map(c => ({
        ...c,
        validated: false,
        code: '',
        role: 'unknown',
        deploymentOrder: 999,
        isSkeleton: true
      }));
    }
    return [];
  });

  const hasSkeletonTabs = () => store.loading() && contractsToDisplay().length === 0;

  const isOriginalTab = createMemo(() => {
    const multi = isMulti() || hasSkeletonTabs();
    return multi
      ? activeContractTab() >= (hasSkeletonTabs() ? 3 : contractsToDisplay().length)
      : activeContractTab() >= 1;
  });

  const activeContract = createMemo((): DisplayContract | null => {
    const contracts = contractsToDisplay();
    const tab = activeContractTab();
    return contracts[tab] || null;
  });

  return (
    <>
      <div class="container">
        <nav class="header-nav">
          <a href="https://faq.layer1.cash" class="nav-link">FAQ</a>
          <a href="https://arena.layer1.cash" class="nav-link">Arena</a>
          <a href="https://jump.layer1.cash" class="nav-link active">Jump</a>
        </nav>
        <header>
          <h1>Jump to layer 1 (beta)</h1>
          <p class="intro">Convert your Solidity smart contract to CashScript</p>
        </header>

        <div class="converter">
          <Show when={!store.loading() && store.contracts().length === 0 && store.transactions().length === 0}>
            <div class="input-section">
              <div class="textarea-wrapper">
                <textarea
                  class="input-textarea"
                  placeholder="Paste your EVM smart contract code here..."
                  value={evmContract()}
                  onInput={(e) => setEvmContract(e.currentTarget.value)}
                  spellcheck={false}
                />
                <div class="example-buttons-overlay">
                  <Show when={!evmContract()}>
                    <span class="example-label">...Or choose an example:</span>
                  </Show>
                  <button class="example-btn" onClick={() => setEvmContract(SIMPLE_EXAMPLE)} title="Load simple NFT contract example">
                    Simple
                  </button>
                  <button class="example-btn" onClick={() => setEvmContract(COMPLEX_EXAMPLE)} title="Load complex voting contract example">
                    Complex
                  </button>
                  <button class="example-btn" onClick={() => setEvmContract(NATURAL_LANGUAGE_EXAMPLE)} title="Try natural language description (experimental)">
                    Natural language (experimental)
                  </button>
                </div>
              </div>
            </div>

            <button
              class="convert-btn"
              onClick={handleConvert}
              disabled={store.loading() || !evmContract().trim()}
            >
              {store.loading() ? 'Converting...' : 'Convert to CashScript'}
            </button>
          </Show>

          <div class="output-section">
            <ErrorDisplay
              error={store.error}
              onRetry={handleConvert}
              onReset={handleReset}
              canRetry={!!evmContract().trim()}
            />

            <Show when={store.loading() || store.contracts().length > 0 || store.transactions().length > 0}>
              <Show when={store.loading()}>
                <PhaseProgress currentPhase={store.currentPhase} connectorProgress={connectorProgress} />
              </Show>

              <div class="main-tabs">
                <button
                  class={`main-tab ${activeMainTab() === 'transactions' ? 'active' : ''}`}
                  onClick={() => setActiveMainTab('transactions')}
                >
                  Transactions
                  <Show when={store.transactions().length > 0}>
                    <span class="tab-count">{store.transactions().length}</span>
                  </Show>
                </button>

                <button
                  class={`main-tab ${activeMainTab() === 'contracts' ? 'active' : ''}`}
                  onClick={() => setActiveMainTab('contracts')}
                >
                  Contracts
                  <Show when={contractsToDisplay().length > 0}>
                    {(() => {
                      const allValidated = contractsToDisplay().every(c => c.validated);
                      return (
                        <span class={`tab-count ${!allValidated ? 'loading' : ''}`}>
                          {allValidated ? contractsToDisplay().length : <span class="tab-spinner-inline"></span>}
                          {!allValidated && ` ${contractsToDisplay().filter(c => c.validated).length}/${contractsToDisplay().length}`}
                        </span>
                      );
                    })()}
                  </Show>
                </button>

                <button class="main-tab start-over-btn" onClick={handleReset}>
                  Start over
                </button>
              </div>

              <Show when={activeMainTab() === 'transactions'}>
                <TransactionsView transactions={store.transactions} loading={store.loading} />
              </Show>

              <Show when={activeMainTab() === 'contracts'}>
                <ContractTabs
                  contracts={contractsToDisplay}
                  activeTab={activeContractTab}
                  setActiveTab={setActiveContractTab}
                  contractAttempts={store.contractAttempts}
                  loading={store.loading}
                  isOriginalTab={isOriginalTab}
                />

                <ContractCard
                  contract={activeContract()}
                  isOriginal={isOriginalTab}
                  originalCode={evmContract}
                  originalHTML={originalContractHTML}
                  contractHTML={contractHighlightedHTML}
                  copyStatus={contractCopyStatus}
                  onCopy={copyContractToClipboard}
                  currentPhase={store.currentPhase}
                  contractAttempts={store.contractAttempts}
                  loading={store.loading}
                  hasIncrementalData={hasIncrementalData()}
                  validatedContracts={store.contracts}
                  highlightedHTML={highlightedHTML}
                  mainCopyStatus={copyStatus}
                  onMainCopy={copyToClipboard}
                />

                <Show when={!isOriginalTab()}>
                  <div class="expandable-sections">
                    <Show when={isMulti()}>
                      <DeploymentGuide guide={store.deploymentGuide} />
                    </Show>
                    <Show when={!isMulti() && store.contracts()[0]?.artifact}>
                      <details class="detail-section">
                        <summary class="detail-summary">Compiled Artifact</summary>
                        <div class="code-container">
                          <div class="code-block" innerHTML={artifactHTML()} />
                        </div>
                      </details>
                    </Show>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>

      <footer>
        contact:{' '}
        <a href="https://t.me/Toorik_2" target="_blank" rel="noopener noreferrer">
          https://t.me/Toorik_2
        </a>
      </footer>
    </>
  );
}
