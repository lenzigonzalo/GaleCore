import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { labRequest, WorkspaceFile } from '../api/lab';
import { LabMarkdown } from '../components/lab/LabMarkdown';
import './Biblioteca.css';

/**
 * Biblioteca (WS-0045, owner 17/10): informes de 1–2 páginas hechos con datos de GaleCore, para consultar con un clic
 * desde la barra lateral, no perdidos entre conversaciones. Los escribe el harness en el proyecto «biblioteca»
 * (`informes/*.md`); esta página sólo los lista y los muestra con el mismo renderer del chat (tablas y gráficos).
 */
const BASE = '/workspaces/biblioteca/files';
const title = (text: string, file: string) => text.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
const summary = (text: string) => (text.split('\n').find(l => l.startsWith('**')) || '').replace(/\*\*/g, '').slice(0, 140);

interface Report { path: string; title: string; summary: string; text: string }

export function Biblioteca() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { tree } = await labRequest<{ tree: WorkspaceFile[] }>(BASE);
        const files = (tree.find(n => n.path === 'informes')?.children || []).filter(n => n.kind === 'file' && n.path.endsWith('.md'))
          .sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }));
        const loaded = await Promise.all(files.map(async f => {
          const { text } = await labRequest<{ text: string }>(BASE + '?path=' + encodeURIComponent(f.path));
          return { path: f.path, title: title(text, f.name), summary: summary(text), text };
        }));
        if (!alive) return;
        setReports(loaded); setSelected(s => s ?? loaded[0]?.path ?? null);
      } catch { if (alive) setError('No se pudo leer la Biblioteca. ¿Está corriendo el Lab?'); }
    })();
    return () => { alive = false; };
  }, []);
  const open = reports?.find(r => r.path === selected);
  return <div className="biblioteca">
    <aside className="biblioteca-list" aria-label="Informes de la Biblioteca">
      <h2><BookOpen size={18}/>Biblioteca</h2>
      {error && <p className="biblioteca-error" role="alert">{error}</p>}
      {!reports && !error && <p className="biblioteca-empty">Cargando…</p>}
      {reports?.length === 0 && <p className="biblioteca-empty">Todavía no hay informes.</p>}
      {reports?.map(r => <button key={r.path} type="button" aria-current={r.path === selected ? 'page' : undefined} onClick={() => setSelected(r.path)}>
        <strong>{r.title}</strong>{r.summary && <span>{r.summary}</span>}
      </button>)}
    </aside>
    <article className="biblioteca-report lab-files-read">{open ? <LabMarkdown text={open.text} /> : null}</article>
  </div>;
}
