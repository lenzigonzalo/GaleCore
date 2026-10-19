import { useEffect, useState } from 'react';
import { BookOpen, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { labRequest, WorkspaceFile } from '../api/lab';
import { LabMarkdown } from '../components/lab/LabMarkdown';
import { SourceHint } from '../components/lab/LabMapa';
import './Biblioteca.css';

/**
 * Biblioteca (WS-0045, owner 17/10): informes hechos con datos de GaleCore, para consultar con un clic desde la barra
 * lateral. Los escribe el harness en el proyecto «biblioteca» (`informes/<tipo>/<tema>.md`); esta página los agrupa por
 * tipo (la carpeta) y muestra el elegido a todo el ancho: título y conclusión arriba, cada sección en una tarjeta de
 * una grilla, para que no quede una columna larga.
 */
const BASE = '/workspaces/biblioteca/files';
const GROUPS: Record<string, string> = { macro: 'Macro', mercado: 'Mercado', estrategias: 'Estrategias', empresas: 'Empresas', uso: 'Casos de uso' };
// Owner 18/10: títulos, no oraciones. «# GEX: qué mide…» → título «GEX» y el resto como bajada.
const heading = (text: string) => text.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
const title = (text: string, file: string) => heading(text).split(':')[0].trim() || file.replace(/\.md$/, '').replace(/-/g, ' ');
/** Saca las líneas «Fuente: …» del texto: van detrás de un «?» (owner 18/10, ocupaban media pantalla). */
export function splitSources(text: string): { body: string; sources: string[] } {
  const sources: string[] = [];
  const body = text.split(/\r?\n/).filter(l => { const m = l.match(/^\s*\*{0,2}Fuentes?:\*{0,2}\s*(.+)$/); if (m) sources.push(m[1].trim()); return !m; }).join('\n');
  return { body, sources };
}
function Card({ text, className }: { text: string; className: string }) {
  const { body, sources } = splitSources(text);
  return <section className={className + (/^\|/m.test(body) ? ' wide' : '')}>
    {sources.length > 0 && <SourceHint text={sources.join(' · ')} />}
    <LabMarkdown text={body} />
  </section>;
}

interface Report { path: string; group: string; title: string; text: string }

/** El encabezado (título y conclusión) y cada sección `## …` por separado. */
export function splitSections(text: string): { head: string; sections: string[] } {
  const parts = text.split(/^(?=## )/m);
  return { head: parts[0], sections: parts.slice(1) };
}

function files(nodes: WorkspaceFile[], group = ''): { path: string; name: string; group: string }[] {
  return nodes.flatMap(n => n.kind === 'folder' ? (n.path.includes('calculos') ? [] : files(n.children || [], n.name))
    : n.path.endsWith('.md') ? [{ path: n.path, name: n.name, group }] : []);
}

export function Biblioteca() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [listOpen, setListOpen] = useState(() => { try { return localStorage.getItem('galecore:biblioteca:lista') !== '0'; } catch { return true; } });
  const toggleList = () => setListOpen(v => { try { localStorage.setItem('galecore:biblioteca:lista', v ? '0' : '1'); } catch { /* sin storage */ } return !v; });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { tree } = await labRequest<{ tree: WorkspaceFile[] }>(BASE);
        const found = files(tree.find(n => n.path === 'informes')?.children || []);
        const loaded = await Promise.all(found.map(async f => {
          const { text } = await labRequest<{ text: string }>(BASE + '?path=' + encodeURIComponent(f.path));
          return { path: f.path, group: f.group, title: title(text, f.name), text };
        }));
        if (!alive) return;
        const order = (g: string) => { const i = Object.keys(GROUPS).indexOf(g); return i < 0 ? 99 : i; };
        loaded.sort((a, b) => order(a.group) - order(b.group) || a.title.localeCompare(b.title, 'es'));
        setReports(loaded); setSelected(s => s ?? loaded[0]?.path ?? null);
      } catch { if (alive) setError('No se pudo leer la Biblioteca. ¿Está corriendo el Lab?'); }
    })();
    return () => { alive = false; };
  }, []);
  const groups = Object.keys(GROUPS).concat((reports || []).map(r => r.group).filter((g, i, all) => all.indexOf(g) === i && !(g in GROUPS)))
    .map(g => ({ id: g, label: GROUPS[g] || g || 'Otros', items: (reports || []).filter(r => r.group === g) })).filter(g => g.items.length);
  const open = reports?.find(r => r.path === selected);
  const parts = open ? splitSections(open.text) : null;
  const sub = open ? heading(open.text).split(':').slice(1).join(':').trim() : '';
  const head = parts ? parts.head.replace(/^#\s+.+$/m, '') : '';
  return <div className="biblioteca">
    {listOpen && <aside className="biblioteca-list" aria-label="Informes de la Biblioteca">
      <h2><BookOpen size={18}/>Biblioteca<button type="button" className="biblioteca-toggle" aria-label="Ocultar la lista" title="Ocultar la lista" onClick={toggleList}><PanelLeftClose size={17}/></button></h2>
      {error && <p className="biblioteca-error" role="alert">{error}</p>}
      {!reports && !error && <p className="biblioteca-empty">Cargando…</p>}
      {reports?.length === 0 && <p className="biblioteca-empty">Todavía no hay informes.</p>}
      {groups.map(g => <section key={g.id} className="biblioteca-group">
        <h3>{g.label}</h3>
        {g.items.map(r => <button key={r.path} type="button" aria-current={r.path === selected ? 'page' : undefined} onClick={() => setSelected(r.path)}>{r.title}</button>)}
      </section>)}
    </aside>}
    {parts && open && <article className="biblioteca-report">
      <header className="biblioteca-head">
        {!listOpen && <button type="button" className="biblioteca-toggle" aria-label="Mostrar la lista" title="Mostrar la lista" onClick={toggleList}><PanelLeftOpen size={17}/></button>}
        <h1>{open.title}</h1>{sub && <p className="biblioteca-sub">{sub}</p>}
        <Card text={head} className="biblioteca-lead" />
      </header>
      <div className="biblioteca-grid">{parts.sections.map((s, i) => <Card key={i} text={s} className="biblioteca-card" />)}</div>
    </article>}
  </div>;
}
