import { createSignal, type JSX } from 'solid-js';
import styles from './CollapsibleSection.module.css';

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: JSX.Element;
};

export default function CollapsibleSection(props: Props) {
  const [isOpen, setIsOpen] = createSignal(props.defaultOpen ?? false);

  return (
    <div class={styles.section}>
      <button
        class={styles.header}
        onClick={() => setIsOpen(!isOpen())}
        aria-expanded={isOpen()}
      >
        <span class={styles.chevron}>{isOpen() ? '▼' : '►'}</span>
        <span class={styles.title}>{props.title}</span>
      </button>
      <div class={`${styles.content} ${isOpen() ? styles.open : ''}`}>
        <div class={styles.inner}>
          {props.children}
        </div>
      </div>
    </div>
  );
}
