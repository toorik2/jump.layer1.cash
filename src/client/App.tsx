import { createSignal, createEffect, createMemo, Show, onCleanup } from 'solid-js';
import { codeToHtml } from 'shiki';
import { API_STREAM_URL } from './config.frontend';
import { SIMPLE_EXAMPLE, COMPLEX_EXAMPLE, VERY_COMPLEX_EXAMPLE } from './data/examples';
import type { DisplayContract } from './types';
import { enrichTransactions } from './utils/transactions';
import { createConversionStore } from './stores/conversion';
import { streamSSE, type SSEEvent } from './hooks/useSSE';
import { useNavigationHistory } from './hooks/useNavigationHistory';
import PhaseProgress from './components/PhaseProgress';
import TransactionsView from './components/TransactionsView';
import ContractTabs from './components/ContractTabs';
import ContractCard from './components/ContractCard';
import ErrorDisplay from './components/ErrorDisplay';
import NativeSolutionView from './components/NativeSolutionView';
import './styles/global.css';
import styles from './App.module.css';

export default function App() {
  // Conversion state (single source of truth)
  const store = createConversionStore();

  // Input state
  const [evmContract, setEvmContract] = createSignal('');

  // UI state (separate from conversion state)
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const [contractCopyStatus, setContractCopyStatus] = createSignal<{[key: string]: 'idle' | 'copied' | 'error'}>({});
  const [contractHighlightedHTML, setContractHighlightedHTML] = createSignal<{[key: string]: string}>({});
  const [originalContractHTML, setOriginalContractHTML] = createSignal('');
  const [activeContractTab, setActiveContractTab] = createSignal(0);
  const [activeMainTab, setActiveMainTab] = createSignal<'transactions' | 'contracts'>('transactions');

  // Phase progress animation state
  const [phaseStartTimes, setPhaseStartTimes] = createSignal<{[key: number]: number}>({});
  const [connectorProgress, setConnectorProgress] = createSignal<{[key: number]: number}>({});

  // Navigation history (browser back/forward support)
  const navigationHistory = useNavigationHistory({
    activeMainTab,
    setActiveMainTab,
    activeContractTab,
    setActiveContractTab
  });

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
        isSkeleton: true
      }));

    const combined: DisplayContract[] = [
      ...validated.map(c => ({ ...c, validated: c.validated ?? false })),
      ...pendingStubs
    ];
    const rolePriority: Record<string, number> = { primary: 0, helper: 1, state: 2, unknown: 3 };
    return combined.sort((a, b) => (rolePriority[a.role] || 999) - (rolePriority[b.role] || 999));
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
    navigationHistory.resetHistory();
    setEvmContract('');
    setContractHighlightedHTML({});
    setOriginalContractHTML('');
    setActiveContractTab(0);
    setCopyStatus('idle');
    setContractCopyStatus({});
    setActiveMainTab('transactions');
    setPhaseStartTimes({});
    setConnectorProgress({});
    store.reset();
  };

  // Navigation handlers that push history (for user-initiated navigation)
  const navigateToMainTab = (tab: 'transactions' | 'contracts') => {
    if (activeMainTab() === tab) return;
    navigationHistory.pushNavigation();
    setActiveMainTab(tab);
  };

  const navigateToContractTab = (index: number) => {
    if (activeContractTab() === index) return;
    navigationHistory.pushNavigation();
    setActiveContractTab(index);
  };

  // Linear duration model from DB regression analysis
  const getPhaseDuration = (phase: number, chars: number): number => {
    switch (phase) {
      case 1: return 24000 + chars * 4.4;
      case 2: return 41000 + chars * 7.6;
      case 3: return 15000 + chars * 8;
      case 4: return 30000 + chars * 17;
      default: return 60000;
    }
  };

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
    const contractLength = evmContract().length;

    if (isLoading && !progressInterval) {
      progressInterval = setInterval(() => {
        const now = Date.now();
        const times = phaseStartTimes();
        const phase = store.currentPhase();
        const progress: {[key: number]: number} = {};

        for (let p = 1; p <= 4; p++) {
          const startTime = times[p];
          const duration = getPhaseDuration(p, contractLength);
          if (startTime && phase === p) {
            const elapsed = now - startTime;
            progress[p] = Math.min(100, (elapsed / duration) * 100);
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
      setConnectorProgress({ 1: 100, 2: 100, 3: 100, 4: 100 });
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
          const html = await codeToHtml(contract.code, {
            lang: 'javascript',
            theme: 'dark-plus'
          });
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
          const caps = event.data.capabilities || [];
          store.addTransactions(enrichedTxs, specs, caps);
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
        break;
      case 'contract_ready':
        store.addValidatedContract(event.data.contract);
        break;
      case 'retrying':
        store.setRetryAttempt(event.data.attempt);
        break;
      case 'native_solution':
        store.setNativeSolution(event.data);
        break;
      case 'done':
        store.complete();
        break;
      case 'error':
        console.error('[Jump] Error:', event.data);
        store.setError(event.data.details || event.data.message || 'Conversion failed');
        break;
    }
  };

  const handleConvert = async () => {
    const contract = evmContract().trim();
    if (!contract) return;

    hasAutoSwitched = false;
    setPhaseStartTimes({});
    setConnectorProgress({});
    setContractHighlightedHTML({});
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

  // Navigation from transaction slots to contracts
  const logFunctionNotFound = async (contractName: string, functionName: string, reason: string) => {
    try {
      await fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'function_not_found',
          contractName,
          functionName,
          reason,
        }),
      });
    } catch (e) {
      console.error('Failed to log error:', e);
    }
  };

  const scrollToFunction = async (functionName: string, contractName: string) => {
    // Get the contract's raw code to find line number
    const contract = allContracts().find(c => c.name === contractName);
    if (!contract?.code) {
      await logFunctionNotFound(contractName, functionName, 'Contract code not found');
      throw new Error(`Contract code not found for ${contractName}`);
    }

    // Find line number of function definition
    const lines = contract.code.split('\n');
    const pattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
    const lineIndex = lines.findIndex(line => pattern.test(line));

    if (lineIndex === -1) {
      await logFunctionNotFound(contractName, functionName, 'Function not in contract code');
      throw new Error(`Function ${functionName} not found in contract ${contractName}`);
    }

    // Shiki renders each line as a span.line inside <pre><code>
    // Find the target line element and scroll window to it
    const codeBlock = document.querySelector('[class*="codeBlock"]');
    if (!codeBlock) {
      await logFunctionNotFound(contractName, functionName, 'Code block not found');
      throw new Error(`Code block not found for contract ${contractName}`);
    }

    const lineSpans = codeBlock.querySelectorAll('.line');
    const targetLine = lineSpans[lineIndex] as HTMLElement | undefined;

    if (!targetLine) {
      await logFunctionNotFound(contractName, functionName, `Line ${lineIndex} not found in DOM`);
      throw new Error(`Line ${lineIndex} not found in contract ${contractName}`);
    }

    // Scroll window so target line is at top
    targetLine.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleNavigateToContract = (contractName: string, functionName?: string) => {
    const contracts = allContracts();
    const index = contracts.findIndex(c => c.name === contractName);

    if (index !== -1) {
      // Push current state BEFORE changing tabs (so back returns here)
      navigationHistory.pushNavigation();

      setActiveMainTab('contracts');
      setActiveContractTab(index);

      if (functionName) {
        setTimeout(() => {
          scrollToFunction(functionName, contractName);
        }, 100);
      }
    }
  };

  // Derived state for view logic
  const hasIncrementalData = () => store.contracts().length > 0;
  const hasPendingContracts = () => store.pendingContracts().length > 0;
  const contractsToDisplay = createMemo((): DisplayContract[] => {
    if (hasIncrementalData()) return allContracts();
    if (hasPendingContracts()) {
      return store.pendingContracts().map(c => ({
        ...c,
        validated: false,
        code: '',
        role: 'unknown',
        isSkeleton: true
      }));
    }
    return [];
  });

  const hasSkeletonTabs = () => store.loading() && contractsToDisplay().length === 0;

  const isOriginalTab = createMemo(() => {
    const contractCount = hasSkeletonTabs() ? 3 : contractsToDisplay().length;
    return activeContractTab() >= contractCount;
  });

  const activeContract = createMemo((): DisplayContract | null => {
    const contracts = contractsToDisplay();
    const tab = activeContractTab();
    return contracts[tab] || null;
  });

  return (
    <>
      <div class={styles.container}>
        <nav class={styles.headerNav}>
          <a href="https://faq.layer1.cash" class={styles.navLink}>FAQ</a>
          <a href="https://arena.layer1.cash" class={styles.navLink}>Arena</a>
          <a href="https://jump.layer1.cash" class={styles.navLinkActive}>Jump</a>
        </nav>
        <header class={styles.header}>
          <h1 class={styles.title}>Jump to layer 1 (beta)</h1>
          <p class={styles.intro}>Convert your Solidity smart contract to CashScript</p>
        </header>

        <div class={styles.converter}>
          <Show when={!store.loading() && store.contracts().length === 0 && store.transactions().length === 0}>
            <div class={styles.inputSection}>
              <div class={styles.textareaWrapper}>
                <textarea
                  class={styles.inputTextarea}
                  placeholder="Paste your EVM smart contract code here..."
                  value={evmContract()}
                  onInput={(e) => setEvmContract(e.currentTarget.value)}
                  spellcheck={false}
                />
                <div class={styles.exampleButtonsOverlay}>
                  <Show when={!evmContract()}>
                    <span class={styles.exampleLabel}>...Or choose an example:</span>
                  </Show>
                  <button class={styles.exampleBtn} onClick={() => setEvmContract(SIMPLE_EXAMPLE)} title="Load simple NFT contract example">
                    Simple
                  </button>
                  <button class={styles.exampleBtn} onClick={() => setEvmContract(COMPLEX_EXAMPLE)} title="Load complex voting contract example">
                    Complex
                  </button>
                  <button class={styles.exampleBtn} onClick={() => setEvmContract(VERY_COMPLEX_EXAMPLE)} title="Try Compound CToken (very complex)">
                    Very complex
                  </button>
                </div>
              </div>
            </div>

            <button
              class={styles.convertBtn}
              onClick={handleConvert}
              disabled={store.loading() || !evmContract().trim()}
            >
              {store.loading() ? 'Converting...' : 'Convert to CashScript'}
            </button>
          </Show>

          <div class={styles.outputSection}>
            <ErrorDisplay
              error={store.error}
              onRetry={handleConvert}
              onReset={handleReset}
              canRetry={!!evmContract().trim()}
            />

            <Show when={store.loading() || store.contracts().length > 0 || store.transactions().length > 0 || store.nativeSolution()}>
              <Show when={store.loading()}>
                <PhaseProgress currentPhase={store.currentPhase} connectorProgress={connectorProgress} />
              </Show>

              <Show when={store.nativeSolution()}>
                <NativeSolutionView solution={store.nativeSolution()!} onReset={handleReset} />
              </Show>

              <Show when={!store.nativeSolution()}>
              <div class={styles.mainTabs}>
                <button
                  class={activeMainTab() === 'transactions' ? styles.mainTabActive : styles.mainTab}
                  onClick={() => navigateToMainTab('transactions')}
                >
                  Transactions
                  <Show when={store.transactions().length > 0}>
                    <span class={styles.tabCount}>{store.transactions().length}</span>
                  </Show>
                </button>

                <button
                  class={activeMainTab() === 'contracts' ? styles.mainTabContractActive : styles.mainTabContract}
                  onClick={() => navigateToMainTab('contracts')}
                >
                  Contracts
                  <Show when={contractsToDisplay().length > 0}>
                    {(() => {
                      const allValidated = contractsToDisplay().every(c => c.validated);
                      return (
                        <span class={allValidated ? styles.tabCountContract : styles.tabCountContractLoading}>
                          {allValidated ? contractsToDisplay().length : <span class={styles.tabSpinnerInline}></span>}
                          {!allValidated && ` ${contractsToDisplay().filter(c => c.validated).length}/${contractsToDisplay().length}`}
                        </span>
                      );
                    })()}
                  </Show>
                </button>

                <button class={styles.startOverBtn} onClick={handleReset}>
                  Start over
                </button>
              </div>

              <Show when={activeMainTab() === 'transactions'}>
                <TransactionsView transactions={store.transactions} loading={store.loading} pendingContracts={store.pendingContracts} validatedContracts={store.contracts} capabilities={store.capabilities} onNavigateToContract={handleNavigateToContract} />
              </Show>

              <Show when={activeMainTab() === 'contracts'}>
                <ContractTabs
                  contracts={contractsToDisplay}
                  activeTab={activeContractTab}
                  setActiveTab={navigateToContractTab}
                  retryAttempt={store.retryAttempt}
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
                  retryAttempt={store.retryAttempt}
                  loading={store.loading}
                  hasIncrementalData={hasIncrementalData()}
                />
              </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>

      <footer class={styles.footer}>
        <a href="https://t.me/CashScript_Arena" target="_blank" rel="noopener noreferrer">community</a>
        {' · '}
        <a href="https://forms.gle/tQVieRgHnmx3XGs89" target="_blank" rel="noopener noreferrer">feedback</a>
        {' · '}
        <a href="https://t.me/Toorik_2" target="_blank" rel="noopener noreferrer">contact</a>
        <div class={styles.donate}>
          donate:{' '}
          <span
            class={styles.footerLink}
            onClick={(e) => {
              navigator.clipboard.writeText('bitcoincash:qp2qwd3y6ldweg27yj9dyyh93wyrf7l2wygvdvys6v');
              const el = e.currentTarget;
              el.textContent = 'copied! thank you!';
              setTimeout(() => el.textContent = 'bitcoincash:qp2qwd3y6ldweg27yj9dyyh93wyrf7l2wygvdvys6v', 1500);
            }}
          >bitcoincash:qp2qwd3y6ldweg27yj9dyyh93wyrf7l2wygvdvys6v</span>
        </div>
      </footer>
    </>
  );
}
