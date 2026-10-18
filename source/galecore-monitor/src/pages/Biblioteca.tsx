import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { labRequest, WorkspaceFile } from '../api/lab';
import { LabMarkdown } from '../components/lab/LabMarkdown';
import './Biblioteca.css';

/**
 * Biblioteca (WS-0045, owner 17/10): informes hechos con datos de GaleCore, para consultar con un clic desde la barra
 * lateral. Los escribe el harness en el proyecto «biblioteca» (`informes/<tipo>/<tema>.md`); esta página los agrupa por
 * tipo (la carpeta) y muestra el elegido a todo el ancho: título y conclusión arriba, cada sección en una tarjeta de
 * una grilla, para que no quede una columna larga.
 */
const BASE = '/workspaces/biblioteca/files';
const GROUPS: Record<string, string> = { macro: 'Macro', mercado: 'Mercado', estrategias: 'Estrategias', empresas: 'Empresas', uso: 'Uso del harness' };
const title = (text: string, file: string) => text.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.replace(/\.md$/, '').replace(/-/g, ' ');

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
  return <div className="biblioteca">
    <aside className="biblioteca-list" aria-label="Informes de la Biblioteca">
      <h2><BookOpen size={18}/>Biblioteca</h2>
      {error && <p className="biblioteca-error" role="alert">{error}</p>}
      {!reports && !error && <p className="biblioteca-empty">Cargando…</p>}
      {reports?.length === 0 && <p className="biblioteca-empty">Todavía no hay informes.</p>}
      {groups.map(g => <section key={g.id} className="biblioteca-group">
        <h3>{g.label}</h3>
        {g.items.map(r => <button key={r.path} type="button" aria-current={r.path === selected ? 'page' : undefined} onClick={() => setSelected(r.path)}>{r.title}</button>)}
      </section>)}
    </aside>
    {parts && <article className="biblioteca-report">
      <header className="biblioteca-head"><LabMarkdown text={parts.head} /></header>
      <div className="biblioteca-grid">{parts.sections.map((s, i) => <section key={i} className="biblioteca-card"><LabMarkdown text={s} /></section>)}</div>
    </article>}
  </div>;
}
