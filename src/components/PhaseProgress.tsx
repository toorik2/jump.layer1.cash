import type { Accessor } from 'solid-js';

type Props = {
  currentPhase: Accessor<number>;
  connectorProgress: Accessor<{ [key: number]: number }>;
};

export default function PhaseProgress(props: Props) {
  const phase = () => props.currentPhase();
  const progress = () => props.connectorProgress();

  const connectorStyle = (phaseNum: number) => ({
    width: `${progress()[phaseNum] || 0}%`,
    background: (progress()[phaseNum] || 0) >= 100
      ? 'rgba(57, 255, 20, 0.5)'
      : 'linear-gradient(90deg, rgba(255, 165, 0, 0.6), rgba(255, 165, 0, 0.3))'
  });

  return (
    <div class="phase-progress">
      <div class={`phase-step ${phase() >= 1 ? 'active' : ''} ${phase() > 1 ? 'completed' : ''}`}>
        <div class="phase-indicator">
          {phase() > 1 ? '✓' : phase() === 1 ? <span class="phase-spinner"></span> : '1'}
        </div>
        <span>Extracting Intent</span>
      </div>
      <div class="phase-connector">
        <div class="connector-fill" style={connectorStyle(1)}></div>
      </div>
      <div class={`phase-step ${phase() >= 2 ? 'active' : ''} ${phase() > 2 ? 'completed' : ''}`}>
        <div class="phase-indicator">
          {phase() > 2 ? '✓' : phase() === 2 ? <span class="phase-spinner"></span> : '2'}
        </div>
        <span>Designing Architecture</span>
      </div>
      <div class="phase-connector">
        <div class="connector-fill" style={connectorStyle(2)}></div>
      </div>
      <div class={`phase-step ${phase() >= 3 ? 'active' : ''} ${phase() > 3 ? 'completed' : ''}`}>
        <div class="phase-indicator">
          {phase() > 3 ? '✓' : phase() === 3 ? <span class="phase-spinner"></span> : '3'}
        </div>
        <span>Building Contracts</span>
      </div>
      <div class="phase-connector">
        <div class="connector-fill" style={connectorStyle(3)}></div>
      </div>
      <div class={`phase-step ${phase() >= 4 ? 'active' : ''}`}>
        <div class="phase-indicator">
          {phase() === 4 ? <span class="phase-spinner"></span> : '4'}
        </div>
        <span>Fixing Errors</span>
      </div>
    </div>
  );
}
