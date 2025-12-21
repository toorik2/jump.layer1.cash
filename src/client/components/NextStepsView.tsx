import { createSignal } from 'solid-js';
import styles from './NextStepsView.module.css';

type Props = {
  shareableUrl: string;
};

const COMMUNITY_LINKS = [
  { label: 'Layer1.Cash', url: 'https://t.me/layer1_cash', desc: 'Layer1 community' },
  { label: 'Bitcoin Cash', url: 'https://t.me/bchchannel', desc: 'General BCH discussion' },
  { label: 'CashScript', url: 'https://t.me/CashScriptBCH', desc: 'Language help' },
  { label: 'BCH Builders', url: 'https://t.me/bchbuilders', desc: 'High signal dev chat' },
];

const LEARN_BY_DOING = [
  { label: 'Arena', url: 'https://arena.layer1.cash', desc: 'Break contracts & claim BCH', icon: 'flask' },
  { label: 'FAQ', url: 'https://faq.layer1.cash', desc: 'BCH Technical Q&A', icon: 'question' },
];

const RESOURCES = [
  { label: 'CashScript Docs', url: 'https://cashscript.org', desc: 'Official language reference', icon: 'code' },
  { label: 'CashTokens', url: 'https://cashtokens.org', desc: 'Token standard specs', icon: 'hexagon' },
  { label: 'BCH University', url: 'https://www.youtube.com/@BitcoinCashUniversity', desc: 'Tutorials & courses', icon: 'video' },
];

const TelegramIcon = () => (
  <svg class={styles.telegramIcon} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2-.06-.06-.15-.04-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z"/>
  </svg>
);

const CodeIcon = () => (
  <svg class={styles.resourceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="16 18 22 12 16 6"/>
    <polyline points="8 6 2 12 8 18"/>
  </svg>
);

const HexagonIcon = () => (
  <svg class={styles.resourceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/>
  </svg>
);

const VideoIcon = () => (
  <svg class={styles.resourceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);

const FlaskIcon = () => (
  <svg class={styles.doingIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M9 3h6M10 3v6.5L4 20h16l-6-10.5V3"/>
  </svg>
);

const QuestionIcon = () => (
  <svg class={styles.doingIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <text x="12" y="18" text-anchor="middle" font-size="18" font-weight="bold" fill="currentColor" stroke="none">?</text>
  </svg>
);

const getResourceIcon = (icon: string) => {
  switch (icon) {
    case 'code': return <CodeIcon />;
    case 'hexagon': return <HexagonIcon />;
    case 'video': return <VideoIcon />;
    default: return null;
  }
};

const getDoingIcon = (icon: string) => {
  switch (icon) {
    case 'flask': return <FlaskIcon />;
    case 'question': return <QuestionIcon />;
    default: return null;
  }
};

export default function NextStepsView(props: Props) {
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');

  const copyShareableLink = async () => {
    try {
      await navigator.clipboard.writeText(props.shareableUrl);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  };

  return (
    <div class={styles.container}>
      <div class={styles.columns}>
        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3 class={styles.sectionTitle}>Share</h3>
            <p class={styles.tagline}>Share this conversion and connect with other builders</p>
          </div>

          <button class={styles.shareBtn} onClick={copyShareableLink}>
            <svg class={styles.shareIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {copyStatus() === 'copied' ? 'Link Copied!' : 'Copy Shareable Link'}
          </button>

          <div class={styles.communityBlock}>
            <p class={styles.blockLabel}>Join the community</p>
            <div class={styles.communityLinks}>
              {COMMUNITY_LINKS.map((link) => (
                <a href={link.url} target="_blank" rel="noopener noreferrer" class={styles.communityLink}>
                  <TelegramIcon />
                  <span class={styles.communityText}>
                    <span class={styles.communityName}>{link.label}</span>
                    <span class={styles.communityDesc}>{link.desc}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <div class={styles.divider} />

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3 class={styles.sectionTitleLearn}>Learn</h3>
            <p class={styles.tagline}>Level up your CashScript skills</p>
          </div>

          <div class={styles.doingBlock}>
            <div class={styles.doingLinks}>
              {LEARN_BY_DOING.map((link) => (
                <a href={link.url} target="_blank" rel="noopener noreferrer" class={styles.doingLink}>
                  {getDoingIcon(link.icon)}
                  <span class={styles.doingName}>{link.label}</span>
                  <span class={styles.doingDesc}>{link.desc}</span>
                </a>
              ))}
            </div>
          </div>

          <div class={styles.resourcesBlock}>
            <p class={styles.blockLabel}>Resources</p>
            <div class={styles.resourceLinks}>
              {RESOURCES.map((link) => (
                <a href={link.url} target="_blank" rel="noopener noreferrer" class={styles.resourceLink}>
                  {getResourceIcon(link.icon)}
                  <span class={styles.resourceName}>{link.label}</span>
                  <span class={styles.resourceDesc}>{link.desc}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
