import React from 'react';
import type { ChatTask } from '../../api/lab';

const STATUS: Record<string, string> = { running: 'Trabajando', completed: 'Terminó', failed: 'Falló', killed: 'Cortado', stopped: 'Cortado', ended: 'Terminó con el turno' };

/** Subagentes y comandos en segundo plano del turno en curso (WS-0067): una línea por tarea, con su estado y su último paso. */
export function LabTasks({ tasks }: { tasks?: ChatTask[] }) {
  if (!tasks?.length) return null;
  return <div className="lab-tasks" role="group" aria-label="En segundo plano">
    {tasks.map(t => <div key={t.id} className={'lab-task ' + t.status}>
      <i aria-hidden="true" />
      <div><b>{t.kind === 'agent' ? 'Subagente' : 'En segundo plano'}</b> {t.label}{t.agentType && <small> · {t.agentType}</small>}</div>
      <span>{STATUS[t.status] || t.status}{t.status === 'running' && t.tools ? ' · ' + t.tools + (t.tools === 1 ? ' paso' : ' pasos') : ''}</span>
      {t.status === 'running' && t.last && <code>{t.last}</code>}
      {t.status !== 'running' && t.summary && <code>{t.summary.split('\n')[0]}</code>}
    </div>)}
  </div>;
}
