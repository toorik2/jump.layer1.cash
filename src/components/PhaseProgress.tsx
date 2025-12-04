import type { Accessor } from 'solid-js';
import styles from './PhaseProgress.module.css';

type Props = {
  currentPhase: Accessor<number>;
  connectorProgress: Accessor<{ [key: number]: number }>;
};

export default function PhaseProgress(props: Props) {
  const phase = () => props.currentPhase();
  const progress = () => props.connectorProgress();

  const stepClass = (phaseNum: number) => {
    if (phase() > phaseNum) return styles.stepCompleted;
    if (phase() >= phaseNum) return styles.stepActive;
    return styles.step;
  };

  const connectorStyle = (phaseNum: number) => ({
    width: `${progress()[phaseNum] || 0}%`,
    background: (progress()[phaseNum] || 0) >= 100
      ? 'rgba(57, 255, 20, 0.5)'
      : 'linear-gradient(90deg, rgba(255, 165, 0, 0.6), rgba(255, 165, 0, 0.3))'
  });

  return (
    <div class={styles.progress}>
      <div class={stepClass(1)}>
        <div class={styles.indicator}>
          {phase() > 1 ? '✓' : phase() === 1 ? <span class={styles.spinner}></span> : '1'}
        </div>
        <span class={styles.label}>Extracting Intent</span>
      </div>
      <div class={styles.connector}>
        <div class={styles.connectorFill} style={connectorStyle(1)}></div>
      </div>
      <div class={stepClass(2)}>
        <div class={styles.indicator}>
          {phase() > 2 ? '✓' : phase() === 2 ? <span class={styles.spinner}></span> : '2'}
        </div>
        <span class={styles.label}>Designing New Architecture</span>
      </div>
      <div class={styles.connector}>
        <div class={styles.connectorFill} style={connectorStyle(2)}></div>
      </div>
      <div class={stepClass(3)}>
        <div class={styles.indicator}>
          {phase() > 3 ? '✓' : phase() === 3 ? <span class={styles.spinner}></span> : '3'}
        </div>
        <span class={styles.label}>Building Contracts</span>
      </div>
      <div class={styles.connector}>
        <div class={styles.connectorFill} style={connectorStyle(3)}></div>
      </div>
      <div class={stepClass(4)}>
        <div class={styles.indicator}>
          {phase() > 4 ? '✓' : phase() === 4 ? <span class={styles.spinner}></span> : '4'}
        </div>
        <span class={styles.label}>Fixing Errors</span>
      </div>
      <div class={styles.connector}>
        <div class={styles.connectorFill} style={connectorStyle(4)}></div>
      </div>
      <div class={stepClass(5)}>
        <div class={styles.indicator}>
          {phase() >= 5 ? '✓' : '5'}
        </div>
        <span class={styles.label}>Done</span>
      </div>
    </div>
  );
}
