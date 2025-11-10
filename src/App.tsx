import { createSignal, createEffect } from 'solid-js';
import { codeToHtml } from 'shiki';
import { Copy, Check, X } from 'lucide-solid';
import { API_URL } from './config';
import './styles.css';

type ConversionResult = {
  primaryContract: string;
  explanation: string;
  considerations: string[];
  alternatives: Array<{
    name: string;
    contract: string;
    rationale: string;
  }>;
  artifact?: any;
};

export default function App() {
  const [evmContract, setEvmContract] = createSignal('');
  const [result, setResult] = createSignal<ConversionResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const [altCopyStatus, setAltCopyStatus] = createSignal<{[key: number]: 'idle' | 'copied' | 'error'}>({});
  const [highlightedHTML, setHighlightedHTML] = createSignal('');
  const [altHighlightedHTML, setAltHighlightedHTML] = createSignal<{[key: number]: string}>({});
  const [artifactHTML, setArtifactHTML] = createSignal('');

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  const copyAltToClipboard = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setAltCopyStatus(prev => ({ ...prev, [index]: 'copied' }));
    setTimeout(() => setAltCopyStatus(prev => ({ ...prev, [index]: 'idle' })), 2000);
  };

  createEffect(async () => {
    const r = result();
    if (r) {
      const html = await codeToHtml(r.primaryContract, {
        lang: 'javascript',
        theme: 'dark-plus'
      });
      setHighlightedHTML(html);

      const altHtmls: {[key: number]: string} = {};
      for (let i = 0; i < r.alternatives.length; i++) {
        const altHtml = await codeToHtml(r.alternatives[i].contract, {
          lang: 'javascript',
          theme: 'dark-plus'
        });
        altHtmls[i] = altHtml;
      }
      setAltHighlightedHTML(altHtmls);

      if (r.artifact) {
        const artifactJson = JSON.stringify(r.artifact, null, 2);
        const artifactHtml = await codeToHtml(artifactJson, {
          lang: 'json',
          theme: 'dark-plus'
        });
        setArtifactHTML(artifactHtml);
      }
    }
  });

  const handleConvert = async () => {
    console.log('[Jump Arena] Starting conversion...');
    const contract = evmContract().trim();
    if (!contract) {
      console.log('[Jump Arena] No contract provided');
      return;
    }

    console.log(`[Jump Arena] Contract length: ${contract.length} characters`);
    setLoading(true);
    setError('');
    setResult(null);
    setHighlightedHTML('');
    setAltHighlightedHTML({});
    setArtifactHTML('');

    console.log(`[Jump Arena] Sending request to ${API_URL}`);
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract })
    });

    console.log(`[Jump Arena] Response status: ${response.status}`);
    const data = await response.json();
    console.log('[Jump Arena] Response data received:', data);

    if (!response.ok) {
      console.error('[Jump Arena] Conversion failed:', data.error);
      setError(data.error || 'Conversion failed');
      setLoading(false);
      return;
    }

    console.log('[Jump Arena] Conversion successful!');
    setResult(data);
    setLoading(false);
  };

  return (
    <>
      <div class="container">
        <header>
          <h1>Jump to layer 1</h1>
          <p class="intro">Convert your Solidity smart contract to CashScript</p>
        </header>

        <div class="converter">
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

          <div class="output-section">
            <span class="output-label">CashScript Output</span>
            {loading() && <div class="loading">Converting your contract...</div>}
            {error() && <div class="error">{error()}</div>}
            {result() && (
              <>
                <div class="code-container">
                  <div class="code-block" innerHTML={highlightedHTML()} />
                  <button
                    class={`code-copy-btn ${copyStatus() === 'copied' ? 'copied' : copyStatus() === 'error' ? 'error' : ''}`}
                    onClick={() => copyToClipboard(result()!.primaryContract)}
                    disabled={copyStatus() === 'copied'}
                    title={copyStatus() === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                  >
                    {copyStatus() === 'copied' ? <Check size={20} /> : copyStatus() === 'error' ? <X size={20} /> : <Copy size={20} />}
                  </button>
                </div>

                <div class="expandable-sections">
                  <details class="detail-section">
                    <summary class="detail-summary">Explanation</summary>
                    <div class="detail-content">{result()!.explanation}</div>
                  </details>

                  {result()!.considerations.length > 0 && (
                    <details class="detail-section">
                      <summary class="detail-summary">Considerations ({result()!.considerations.length})</summary>
                      <ul class="detail-list">
                        {result()!.considerations.map(item => <li>{item}</li>)}
                      </ul>
                    </details>
                  )}

                  {result()!.alternatives.length > 0 && (
                    <details class="detail-section">
                      <summary class="detail-summary">Alternative Implementations ({result()!.alternatives.length})</summary>
                      <div class="alternatives">
                        {result()!.alternatives.map((alt, idx) => (
                          <div class="alternative">
                            <div class="alternative-header">{alt.name}</div>
                            <div class="alternative-rationale">{alt.rationale}</div>
                            <div class="code-container">
                              <div class="code-block alternative-code-block" innerHTML={altHighlightedHTML()[idx] || ''} />
                              <button
                                class={`code-copy-btn ${altCopyStatus()[idx] === 'copied' ? 'copied' : altCopyStatus()[idx] === 'error' ? 'error' : ''}`}
                                onClick={() => copyAltToClipboard(alt.contract, idx)}
                                disabled={altCopyStatus()[idx] === 'copied'}
                                title={altCopyStatus()[idx] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                              >
                                {altCopyStatus()[idx] === 'copied' ? <Check size={18} /> : altCopyStatus()[idx] === 'error' ? <X size={18} /> : <Copy size={18} />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {result()!.artifact && (
                    <details class="detail-section">
                      <summary class="detail-summary">Compiled Artifact</summary>
                      <div class="code-container">
                        <div class="code-block" innerHTML={artifactHTML()} />
                      </div>
                    </details>
                  )}
                </div>
              </>
            )}
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
