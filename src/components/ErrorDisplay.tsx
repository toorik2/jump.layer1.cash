import { Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import styles from './ErrorDisplay.module.css';

type Props = {
  error: Accessor<string | null>;
  onRetry: () => void;
  onReset: () => void;
  canRetry: boolean;
};

export default function ErrorDisplay(props: Props) {
  const error = () => props.error();

  return (
    <Show when={error()}>
      <div class={styles.error}>
        <div class={styles.message}>{error()}</div>
        <div class={styles.actions}>
          <Show when={props.canRetry}>
            <button class={styles.btnRetry} onClick={props.onRetry}>
              Try Again
            </button>
          </Show>
          <button class={styles.btnReset} onClick={props.onReset}>
            Start Over
          </button>
        </div>
      </div>
    </Show>
  );
}
