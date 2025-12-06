import { Copy, Check, X } from 'lucide-solid';
import styles from './CopyButton.module.css';

type Props = {
  status: 'idle' | 'copied' | 'error';
  onClick: () => void;
};

export default function CopyButton(props: Props) {
  const btnClass = () => {
    if (props.status === 'copied') return styles.btnCopied;
    if (props.status === 'error') return styles.btnError;
    return styles.btn;
  };

  return (
    <button
      class={btnClass()}
      onClick={props.onClick}
      disabled={props.status === 'copied'}
      title={props.status === 'copied' ? 'Copied!' : 'Copy to clipboard'}
    >
      {props.status === 'copied' ? (
        <Check size={20} />
      ) : props.status === 'error' ? (
        <X size={20} />
      ) : (
        <Copy size={20} />
      )}
    </button>
  );
}
