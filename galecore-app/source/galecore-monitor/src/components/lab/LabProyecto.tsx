import { useEffect, useState } from 'react';
import { ArrowUpRight, FileText } from 'lucide-react';
import { labRequest, WorkspaceProject } from '../../api/lab';
import { strategiesOf } from '../../api/labProjects';
import { fetchShadowStatus } from '../../api/shadow';
import type { StrategyView } from '../../pages/LabStrategySheet';
import { strategyName as prettyName } from '../shadow/panelPresentation';
import './LabMapa.css';

// Panel «Proyecto» (WS-0071 AC-3): el índice del proyecto. Estrategias con su etapa (leída del harness) y los informes
// de memory/ y files/. El panel sólo lee; cada clic abre la vista de esa estrategia o ese archivo.
interface Informe { path: string; name: string; updatedAt: string }
type Stage = { label: string; date?: string } | 'loading' | 'error';

// Estrategias de un proyecto (WS-0071): la lista que declara el Lab; sin ella, la única que traían los proyectos viejos.
const day = (iso?: string) => iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const hash = (h?: string) => h?.replace(/^sha256:/, '') || '';

function stageOf(view: StrategyView, running: string[]): { label: string; date?: string } {
  const c = view.current;
  if (!c) return { label: 'Idea' };
  const label = !c.approved ? 'En diseño' : running.includes(hash(c.spec_hash)) ? 'En SHADOW' : 'Aprobada';
  return { label, date: day(c.recorded_at) };
}

export function LabProyecto({ project, running, onDesign, onResults, onOpenFile }: {
  project: WorkspaceProject; running: boolean; onDesign: (strategy: string) => void; onResults?: (strategy: string) => void; onOpenFile: (path: string) => void;
}) {
  const strategies = strategiesOf(project), key = strategies.join('|');
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [informes, setInformes] = useState<Informe[] | null>(null);
  const [informesError, setInformesError] = useState(false);

  useEffect(() => {
    let active = true;
    setInformesError(false);
    labRequest<{ informes: Informe[] }>('/workspaces/' + encodeURIComponent(project.id) + '/informes')
      .then(v => { if (active) setInformes(v.informes); }).catch(() => { if (active) setInformesError(true); });
    return () => { active = false; };
  }, [project.id, running]);

  useEffect(() => {
    let active = true;
    setStages(Object.fromEntries(strategies.map(n => [n, 'loading' as Stage])));
    if (!strategies.length) return;
    // SHADOW es opcional: si el runtime no responde, la etapa llega hasta «Aprobada».
    const shadow = fetchShadowStatus().then(s => s.instances.filter(i => i.lifecycleState === 'RUNNING').map(i => hash(i.versionHash))).catch(() => [] as string[]);
    strategies.forEach(n => {
      Promise.all([labRequest<StrategyView>('/workspaces/' + encodeURIComponent(project.id) + '/strategy?name=' + encodeURIComponent(n), undefined, 65000), shadow])
        .then(([view, hashes]) => { if (active) setStages(s => ({ ...s, [n]: project.externalStrategy ? { label: 'No incluida en esta copia' } : stageOf(view, hashes) })); })
        .catch(() => { if (active) setStages(s => ({ ...s, [n]: 'error' })); });
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, key, running]);

  const empty = !strategies.length && !informes?.length;
  return <aside className="lab-mapa lab-proyecto" aria-label="Proyecto">
    <header><div><h2>Proyecto</h2></div></header>
    <div className="lab-mapa-design">
      {strategies.length > 0 && <section className="lab-mapa-block"><h3>Estrategias</h3>
        <ul className="lab-proyecto-list">{strategies.map(n => {
          const st = stages[n];
          return <li key={n}>
            <button type="button" className="lab-proyecto-item" onClick={() => onDesign(n)} aria-label={'Diseño de ' + prettyName(n)}>
              <strong>{prettyName(n)}</strong>
              <span>{st === 'loading' || !st ? 'Leyendo…' : st === 'error' ? 'No se pudo leer' : [st.label, st.date].filter(Boolean).join(' · ')}</span>
            </button>
            {onResults && <button type="button" className="lab-mapa-results" aria-label={'Resultados de ' + prettyName(n)} onClick={() => onResults(n)}>Resultados<ArrowUpRight size={15}/></button>}
          </li>;
        })}</ul></section>}
      {informes && informes.length > 0 && <section className="lab-mapa-block"><h3>Informes</h3>
        <ul className="lab-proyecto-list">{informes.map(i => <li key={i.path}>
          <button type="button" className="lab-proyecto-item" onClick={() => onOpenFile(i.path)} aria-label={'Informe ' + i.name}>
            <strong><FileText size={14}/> {i.name}</strong><span>{day(i.updatedAt)}</span>
          </button></li>)}</ul></section>}
      {informesError && !informes && <p className="lab-mapa-empty" role="alert">No se pudieron leer los informes.</p>}
      {empty && !informesError && informes && <p className="lab-mapa-empty">Todavía no hay estrategias ni informes: pedile una investigación al chat para empezar.</p>}
    </div>
  </aside>;
}
