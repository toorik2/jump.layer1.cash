import { Show, For } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { DeploymentGuide as DeploymentGuideType } from '../types';

type Props = {
  guide: Accessor<DeploymentGuideType | null>;
};

export default function DeploymentGuide(props: Props) {
  const guide = () => props.guide();

  return (
    <Show when={guide()}>
      <details class="detail-section">
        <summary class="detail-summary">Deployment Guide</summary>
        <div class="deployment-guide">
          <div class="deployment-steps">
            <strong>Deployment Steps:</strong>
            <ol>
              <For each={guide()!.steps}>
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

          <Show when={guide()!.warnings.length > 0}>
            <div class="deployment-warnings">
              <strong>Warnings:</strong>
              <ul>
                <For each={guide()!.warnings}>
                  {(warning) => <li class="warning-item">{warning}</li>}
                </For>
              </ul>
            </div>
          </Show>

          <Show when={guide()!.testingNotes.length > 0}>
            <div class="deployment-testing">
              <strong>Testing Notes:</strong>
              <ul>
                <For each={guide()!.testingNotes}>
                  {(note) => <li>{note}</li>}
                </For>
              </ul>
            </div>
          </Show>
        </div>
      </details>
    </Show>
  );
}
