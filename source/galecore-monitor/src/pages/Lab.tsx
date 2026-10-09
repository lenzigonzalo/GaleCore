import React, { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { useTerminalStore } from '../store/useTerminalStore';

interface LoadedSpec {
  id: string; name: string; displayName: string; version: string; contentHash: string;
  eligibleModes: string[]; symbols: string[]; structure: string;
}

/** Construcción por el host actual; esta lista no prueba aprobación ni ejecución. */
export function Lab({ onMonitor }: { onMonitor: () => void }) {
  const [specs, setSpecs] = useState<LoadedSpec[] | null>(null);
  const [error, setError] = useState(false);
  const setOpen = useTerminalStore(s => s.setOpen);
  useEffect(() => {
    let alive = true;
    apiClient.get<LoadedSpec[]>('/App/Runtime/Specs')
      .then(({ data }) => { if (!Array.isArray(data)) throw new Error('Invalid specs'); if (alive) setSpecs(data); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);
  return <div className="lab-workspace">
    <div className="lab-actions"><h2>Construir una estrategia</h2><button className="btn" onClick={() => setOpen(true)}>Abrir conversación</button></div>
    <p>Diseñá y revisá las reglas en Claude Code. La aprobación y el despliegue siguen por ese mismo camino.</p>
    <div className="main-section-heading"><h2>Versiones cargadas</h2><button className="main-link" onClick={onMonitor}>Ver seguimiento</button></div>
    <p className="main-source">Cargada no significa aprobada ni en ejecución.</p>
    {error ? <p role="alert">No se pudieron leer las versiones.</p> : !specs ? <p>Leyendo versiones…</p>
      : specs.length === 0 ? <p>No hay versiones cargadas.</p> : <div className="main-results-table"><table>
        <thead><tr><th>Estrategia</th><th>Versión</th><th>Símbolos</th><th>Estructura</th><th>Modos admitidos</th></tr></thead>
        <tbody>{specs.map(s => <tr key={s.contentHash}><td>{s.displayName || s.name}<details><summary>Identidad de versión</summary><code>{s.contentHash}</code></details></td>
          <td>{s.version}</td><td>{s.symbols.join(', ')}</td><td>{s.structure}</td><td>{s.eligibleModes.join(', ')}</td></tr>)}</tbody>
      </table></div>}
    <details className="main-history-pending"><summary>Construcción gráfica y escenarios</summary>
      <p>El builder por patas, los gráficos de posición y la actualización visual desde la conversación todavía no están integrados. Las reglas se versionan; un cambio requiere nueva aprobación y despliegue, sin reescribir el historial de la versión anterior.</p>
    </details>
  </div>;
}
