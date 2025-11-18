import { createSignal, createEffect, createMemo, For, Show } from 'solid-js';
import { codeToHtml } from 'shiki';
import { Copy, Check, X } from 'lucide-solid';
import { API_URL } from './config';
import './styles.css';

// Single contract response type
type SingleContractResult = {
  primaryContract: string;
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
};

// Multi-contract response types
type ContractParam = {
  name: string;
  type: string;
  description: string;
  source: string;
  sourceContractId: string | null;
};

type ContractInfo = {
  id: string;
  name: string;
  purpose: string;
  code: string;
  role: string;
  deploymentOrder: number;
  dependencies: string[];
  constructorParams: ContractParam[];
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
  validationError?: string;
};

type DeploymentStep = {
  order: number;
  contractId: string;
  description: string;
  prerequisites: string[];
  outputs: string[];
};

type DeploymentGuide = {
  steps: DeploymentStep[];
  warnings: string[];
  testingNotes: string[];
};

type MultiContractResult = {
  contracts: ContractInfo[];
  deploymentGuide: DeploymentGuide;
};

type ConversionResult = SingleContractResult | MultiContractResult;

function isMultiContractResult(result: ConversionResult): result is MultiContractResult {
  return 'contracts' in result && Array.isArray(result.contracts);
}

export default function App() {
  const [evmContract, setEvmContract] = createSignal('');
  const [result, setResult] = createSignal<ConversionResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const [contractCopyStatus, setContractCopyStatus] = createSignal<{[key: string]: 'idle' | 'copied' | 'error'}>({});
  const [highlightedHTML, setHighlightedHTML] = createSignal('');
  const [contractHighlightedHTML, setContractHighlightedHTML] = createSignal<{[key: string]: string}>({});
  const [artifactHTML, setArtifactHTML] = createSignal('');
  const [originalContractHTML, setOriginalContractHTML] = createSignal('');
  const [activeContractTab, setActiveContractTab] = createSignal(0);

  // Sorted contracts: primary first, then helper, then state
  const sortedContracts = createMemo(() => {
    const r = result();
    if (!r || !isMultiContractResult(r)) return [];

    const rolePriority = { primary: 0, helper: 1, state: 2 };
    return [...r.contracts].sort((a, b) => {
      const priorityDiff = (rolePriority[a.role as keyof typeof rolePriority] || 999) -
                          (rolePriority[b.role as keyof typeof rolePriority] || 999);
      if (priorityDiff !== 0) return priorityDiff;
      return a.deploymentOrder - b.deploymentOrder; // Same role: sort by deployment order
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
    setResult(null);
    setError('');
    setHighlightedHTML('');
    setContractHighlightedHTML({});
    setArtifactHTML('');
    setOriginalContractHTML('');
    setActiveContractTab(0);
    setCopyStatus('idle');
    setContractCopyStatus({});
  };

  createEffect(async () => {
    const r = result();
    if (r) {
      if (isMultiContractResult(r)) {
        // Multi-contract response
        const contractHtmls: {[key: string]: string} = {};
        for (const contract of r.contracts) {
          const html = await codeToHtml(contract.code, {
            lang: 'javascript',
            theme: 'dark-plus'
          });
          contractHtmls[contract.id] = html;
        }
        setContractHighlightedHTML(contractHtmls);
      } else {
        // Single contract response
        const html = await codeToHtml(r.primaryContract, {
          lang: 'javascript',
          theme: 'dark-plus'
        });
        setHighlightedHTML(html);

        if (r.artifact) {
          const artifactJson = JSON.stringify(r.artifact, null, 2);
          const artifactHtml = await codeToHtml(artifactJson, {
            lang: 'json',
            theme: 'dark-plus'
          });
          setArtifactHTML(artifactHtml);
        }
      }
    }
  });

  // Highlight original Solidity contract when result is shown
  createEffect(async () => {
    const contract = evmContract();
    const r = result();
    if (r && contract) {
      const html = await codeToHtml(contract, {
        lang: 'solidity',
        theme: 'dark-plus'
      });
      setOriginalContractHTML(html);
    }
  });

  const handleConvert = async () => {
    console.log('[Jump] Starting conversion...');
    const contract = evmContract().trim();
    if (!contract) {
      console.log('[Jump] No contract provided');
      return;
    }

    console.log(`[Jump] Contract length: ${contract.length} characters`);
    setLoading(true);
    setError('');
    setResult(null);
    setHighlightedHTML('');
    setContractHighlightedHTML({});
    setArtifactHTML('');
    setActiveContractTab(0);

    console.log(`[Jump] Sending request to ${API_URL}`);
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract })
    });

    console.log(`[Jump] Response status: ${response.status}`);
    const data = await response.json();
    console.log('[Jump] Response data received:', data);

    if (!response.ok) {
      console.error('[Jump] Conversion failed:', data.error);
      setError(data.error || 'Conversion failed');
      setLoading(false);
      return;
    }

    console.log('[Jump] Conversion successful!');
    setResult(data);
    setLoading(false);
  };

  return (
    <>
      <div class="container">
        <nav class="header-nav">
          <a href="https://faq.layer1.cash" class="nav-link">FAQ</a>
          <a href="https://arena.layer1.cash" class="nav-link">Arena</a>
          <a href="https://jump.layer1.cash" class="nav-link active">Jump</a>
        </nav>
        <header>
          <h1>Jump to layer 1</h1>
          <p class="intro">Convert your Solidity smart contract to CashScript</p>
        </header>

        <div class="converter">
          <Show when={!result()}>
            <div class="input-section">
              <textarea
                class="input-textarea"
                placeholder="Paste your EVM smart contract code here..."
                value={evmContract()}
                onInput={(e) => setEvmContract(e.currentTarget.value)}
                spellcheck={false}
              />
            </div>

            <button
              class="convert-btn"
              onClick={handleConvert}
              disabled={loading() || !evmContract().trim()}
            >
              {loading() ? 'Converting...' : 'Convert to CashScript'}
            </button>
          </Show>

          <div class="output-section">
            <span class="output-label">CashScript Output</span>
            {loading() && <div class="loading">Converting your contract...</div>}
            {error() && <div class="error">{error()}</div>}

            {result() && (() => {
              const r = result()!;
              const isMulti = isMultiContractResult(r);
              const totalTabs = isMulti ? sortedContracts().length + 1 : 2; // +1 for "Original" tab
              const isOriginalTab = activeContractTab() === totalTabs - 1;

              return (
                <>
                  {/* Unified tabs for all results */}
                  <div class="contract-tabs">
                    {isMulti ? (
                      // Multi-contract tabs
                      <For each={sortedContracts()}>
                        {(contract, idx) => (
                          <button
                            class={`contract-tab ${activeContractTab() === idx() ? 'active' : ''}`}
                            onClick={() => setActiveContractTab(idx())}
                          >
                            <span class="tab-name">{contract.name}</span>
                            <span class={`tab-status ${contract.validated ? 'valid' : 'invalid'}`}>
                              {contract.validated ? '✓' : '✗'}
                            </span>
                          </button>
                        )}
                      </For>
                    ) : (
                      // Single contract tab
                      <button
                        class={`contract-tab ${activeContractTab() === 0 ? 'active' : ''}`}
                        onClick={() => setActiveContractTab(0)}
                      >
                        <span class="tab-name">CashScript</span>
                        <span class="tab-status valid">✓</span>
                      </button>
                    )}

                    {/* Original and Start over buttons on the right */}
                    <button
                      class={`original-btn ${isOriginalTab ? 'active' : ''}`}
                      onClick={() => setActiveContractTab(totalTabs - 1)}
                    >
                      Original
                    </button>

                    <button class="start-over-btn" onClick={handleReset}>
                      Start over
                    </button>
                  </div>

                  {/* Contract card (active tab content) */}
                  <div class="contract-card">
                    {isOriginalTab ? (
                      // Show original Solidity contract
                      <div class="code-container">
                        <div class="code-block" innerHTML={originalContractHTML()} />
                        <button
                          class={`code-copy-btn ${contractCopyStatus()['original'] === 'copied' ? 'copied' : ''}`}
                          onClick={() => copyContractToClipboard(evmContract(), 'original')}
                          disabled={contractCopyStatus()['original'] === 'copied'}
                          title={contractCopyStatus()['original'] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                        >
                          {contractCopyStatus()['original'] === 'copied'
                            ? <Check size={20} />
                            : <Copy size={20} />}
                        </button>
                      </div>
                    ) : isMulti ? (
                      // Show multi-contract content
                      (() => {
                        const contract = sortedContracts()[activeContractTab()];
                        return (
                          <>
                            {contract.dependencies.length > 0 && (
                              <div class="contract-dependencies">
                                <strong>Dependencies:</strong> {contract.dependencies.join(', ')}
                              </div>
                            )}

                            <div class="code-container">
                              <div class="code-block" innerHTML={contractHighlightedHTML()[contract.id] || ''} />
                              <button
                                class={`code-copy-btn ${contractCopyStatus()[contract.id] === 'copied' ? 'copied' : ''}`}
                                onClick={() => copyContractToClipboard(contract.code, contract.id)}
                                disabled={contractCopyStatus()[contract.id] === 'copied'}
                                title={contractCopyStatus()[contract.id] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                              >
                                {contractCopyStatus()[contract.id] === 'copied'
                                  ? <Check size={20} />
                                  : <Copy size={20} />}
                              </button>
                            </div>

                            {contract.bytecodeSize && (
                              <div class="bytecode-size">
                                Bytecode size: {contract.bytecodeSize} bytes
                              </div>
                            )}
                          </>
                        );
                      })()
                    ) : (
                      // Show single contract content
                      <div class="code-container">
                        <div class="code-block" innerHTML={highlightedHTML()} />
                        <button
                          class={`code-copy-btn ${copyStatus() === 'copied' ? 'copied' : copyStatus() === 'error' ? 'error' : ''}`}
                          onClick={() => copyToClipboard((r as SingleContractResult).primaryContract)}
                          disabled={copyStatus() === 'copied'}
                          title={copyStatus() === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                        >
                          {copyStatus() === 'copied' ? <Check size={20} /> : copyStatus() === 'error' ? <X size={20} /> : <Copy size={20} />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Expandable sections */}
                  {!isOriginalTab && (
                    <div class="expandable-sections">
                      {isMulti ? (
                        // Deployment guide for multi-contract
                        <details class="detail-section" open>
                          <summary class="detail-summary">Deployment Guide</summary>
                          <div class="deployment-guide">
                            <div class="deployment-steps">
                              <strong>Deployment Steps:</strong>
                              <ol>
                                <For each={(r as MultiContractResult).deploymentGuide.steps}>
                                  {(step) => (
                                    <li>
                                      <div class="step-description">{step.description}</div>
                                      {step.prerequisites.length > 0 && (
                                        <div class="step-prereqs">
                                          Prerequisites: {step.prerequisites.join(', ')}
                                        </div>
                                      )}
                                      {step.outputs.length > 0 && (
                                        <div class="step-outputs">
                                          Outputs: {step.outputs.join(', ')}
                                        </div>
                                      )}
                                    </li>
                                  )}
                                </For>
                              </ol>
                            </div>

                            {(r as MultiContractResult).deploymentGuide.warnings.length > 0 && (
                              <div class="deployment-warnings">
                                <strong>Warnings:</strong>
                                <ul>
                                  <For each={(r as MultiContractResult).deploymentGuide.warnings}>
                                    {(warning) => <li class="warning-item">{warning}</li>}
                                  </For>
                                </ul>
                              </div>
                            )}

                            {(r as MultiContractResult).deploymentGuide.testingNotes.length > 0 && (
                              <div class="deployment-testing">
                                <strong>Testing Notes:</strong>
                                <ul>
                                  <For each={(r as MultiContractResult).deploymentGuide.testingNotes}>
                                    {(note) => <li>{note}</li>}
                                  </For>
                                </ul>
                              </div>
                            )}
                          </div>
                        </details>
                      ) : (
                        // Artifact for single contract
                        (r as SingleContractResult).artifact && (
                          <details class="detail-section">
                            <summary class="detail-summary">Compiled Artifact</summary>
                            <div class="code-container">
                              <div class="code-block" innerHTML={artifactHTML()} />
                            </div>
                          </details>
                        )
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <footer>
        contact:{' '}
        <a
          href="https://t.me/Toorik_2"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://t.me/Toorik_2
        </a>
      </footer>
    </>
  );
}
