import React from 'react';
import { ShadowInstance } from '../../types/shadow';
import { stateLabel } from './panelPresentation';

export function latestInstance(instances: ShadowInstance[], spec: string): ShadowInstance | null {
  return instances.filter(item => item.specName === spec).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}
export function InstanceState({ instance }: { instance: ShadowInstance | null }) {
  const state = instance?.lifecycleState;
  const label = state ? stateLabel(state) : 'sin ejecución';
  const display = !state || ['RUNNING', 'PAUSED', 'STOPPED'].includes(state) ? label.charAt(0).toUpperCase() + label.slice(1) : label;
  return <span className={`instance-state ${state === 'RUNNING' ? 'running' : state === 'PAUSED' ? 'paused' : 'stopped'}`}><i aria-hidden="true" />{display}</span>;
}
