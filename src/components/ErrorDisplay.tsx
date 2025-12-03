import { Show } from 'solid-js';
import type { Accessor } from 'solid-js';

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
      <div class="error-display">
        <div class="error-message">{error()}</div>
        <div class="error-actions">
          <Show when={props.canRetry}>
            <button class="error-btn retry" onClick={props.onRetry}>
              Try Again
            </button>
          </Show>
          <button class="error-btn reset" onClick={props.onReset}>
            Start Over
          </button>
        </div>
      </div>
    </Show>
  );
}
