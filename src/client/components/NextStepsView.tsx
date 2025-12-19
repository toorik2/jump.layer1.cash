import { createSignal } from 'solid-js';
import CollapsibleSection from './CollapsibleSection';
import CopyButton from './CopyButton';
import styles from './NextStepsView.module.css';

type Props = {
  shareableUrl: string;
};

const USAGE_SNIPPET = `npm install cashscript

import { Contract, ElectrumNetworkProvider } from 'cashscript';
import { compileFile } from 'cashc';

const artifact = compileFile('MyContract.cash');
const provider = new ElectrumNetworkProvider('chipnet');
const contract = new Contract(artifact, [], { provider });

// Call a function
const tx = await contract.functions
  .myFunction(arg1, arg2)
  .send();`;

const RESOURCE_LINKS = [
  { label: 'CashScript Documentation', url: 'https://cashscript.org', desc: 'Official docs' },
  { label: 'Get free chipnet BCH', url: 'https://tbch.googol.cash/', desc: 'Testnet faucet' },
];

const COMMUNITY_LINKS = [
  { label: 'CashScript BCH', url: 'https://t.me/CashScriptBCH' },
  { label: 'CashToken Devs', url: 'https://t.me/cashtoken_devs' },
  { label: 'BCH Channel', url: 'https://t.me/bchchannel' },
  { label: 'Layer1 Cash', url: 'https://t.me/layer1_cash' },
];

export default function NextStepsView(props: Props) {
  const [linkCopyStatus, setLinkCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const [codeCopyStatus, setCodeCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');

  const copyShareableLink = async () => {
    try {
      await navigator.clipboard.writeText(props.shareableUrl);
      setLinkCopyStatus('copied');
      setTimeout(() => setLinkCopyStatus('idle'), 2000);
    } catch {
      setLinkCopyStatus('error');
      setTimeout(() => setLinkCopyStatus('idle'), 2000);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(USAGE_SNIPPET);
      setCodeCopyStatus('copied');
      setTimeout(() => setCodeCopyStatus('idle'), 2000);
    } catch {
      setCodeCopyStatus('error');
      setTimeout(() => setCodeCopyStatus('idle'), 2000);
    }
  };

  return (
    <div class={styles.container}>
      <CollapsibleSection title="Using Your Contract" defaultOpen>
        <div class={styles.usageContent}>
          <div class={styles.codeBlockWrapper}>
            <pre class={styles.codeBlock}>{USAGE_SNIPPET}</pre>
            <CopyButton
              status={codeCopyStatus()}
              onClick={copyCode}
            />
          </div>

          <div class={styles.linksSection}>
            <div class={styles.resourceLinks}>
              {RESOURCE_LINKS.map((link) => (
                <a href={link.url} target="_blank" rel="noopener noreferrer" class={styles.resourceLink}>
                  <span class={styles.linkLabel}>{link.label}</span>
                  <span class={styles.linkDesc}>{link.desc}</span>
                </a>
              ))}
            </div>

            <div class={styles.communitySection}>
              <p class={styles.communityLabel}>Have questions? Join the community:</p>
              <div class={styles.communityLinks}>
                {COMMUNITY_LINKS.map((link) => (
                  <a href={link.url} target="_blank" rel="noopener noreferrer" class={styles.communityLink}>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <div class={styles.actions}>
        <button class={styles.actionBtn} onClick={copyShareableLink}>
          <span class={styles.actionIcon}>📤</span>
          {linkCopyStatus() === 'copied' ? 'Copied!' : 'Copy Shareable Link'}
        </button>
      </div>

      <footer class={styles.warning}>
        ⚠️ AI-generated code. Review and test on chipnet before using with real funds.
      </footer>
    </div>
  );
}
