import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Code, Eye, Plus, Search } from 'lucide-react';
import { SpaceItem, deleteSpaceItem, keyFromTitle, saveSpaceItem } from '../../api/space';
import { Markdown } from './Markdown';
import './SkillsView.css';

const SKILL_TEMPLATE = `Qué pedido atiende y cuándo no usarla.

## Cuándo se usa
Pedidos típicos, con tus palabras.

## Qué necesita
Qué datos de GaleCore usa y qué hacer si falta alguno.

## Pasos
1. Primer paso, con el dato que trae.
2. Segundo paso.

## Qué entrega
La forma de la respuesta y un ejemplo corto.

## Errores a evitar
- Lo que no tiene que hacer.

## Cómo responder
El dato principal primero; después la forma (conclusión, tabla).
`;

function description(content: string): string {
  return content.replace(/\r\n/g, '\n').split(/\n\s*\n/).find(p => p.trim() && !p.trim().startsWith('#'))?.trim() ?? 'Sin descripción.';
}

export function SkillsView({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('summary');
  const [source, setSource] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && !creating && !editing) {
      heading.current?.focus({ preventScroll: true });
      view.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [selected, creating, editing]);
  const skill = items.find(i => i.key === selected);
  const own = (i: SpaceItem) => i.isOwn && i.visibility === 'private';
  const editable = !!skill && own(skill);
  const visible = items.filter(i => (filter === 'all' || (filter === 'mine' ? own(i) : !own(i))) &&
    (i.title + ' ' + i.content).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const open = (i: SpaceItem) => {
    setSelected(i.key); setTab('summary'); setSource(false); setError(''); setConfirmDelete(false);
  };
  const back = () => { setSelected(null); setCreating(false); setEditing(false); setError(''); setConfirmDelete(false); };
  const persist = async () => {
    const key = creating ? keyFromTitle(title) : skill?.key;
    if (!key || (!creating && !editable)) return;
    if (creating && items.some(i => i.key === key)) { setError('Ya hay una skill con ese nombre.'); return; }
    setBusy(true); setError('');
    try {
      await saveSpaceItem('skill', key, { title: creating ? title.trim() : skill!.title, content: draft, format: 'markdown', visibility: 'private' });
      setCreating(false); setEditing(false); setSelected(key); setTab('content'); setSource(false); onChanged();
    } catch { setError('No se pudo guardar la skill. Tus cambios siguen acá para reintentar.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!skill || !editable) return;
    setBusy(true); setError('');
    try { await deleteSpaceItem('skill', skill.key); back(); onChanged(); }
    catch { setError('No se pudo borrar la skill. Intentá de nuevo.'); }
    finally { setBusy(false); }
  };
  let fence = '';
  const sections: string[] = [];
  for (const line of skill?.content.split('\n') ?? []) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      continue;
    }
    if (!fence && /^#{1,3}\s/.test(line)) sections.push(line.replace(/^#+\s+/, ''));
  }
  const date = skill && new Date(skill.updatedAt);
  const updated = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('es-AR') : null;

  return <div className="skills-view" ref={view}>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {creating || editing ? <>
      <h2>{creating ? 'Nueva skill' : skill?.title}</h2>
      <p className="skills-muted">Definí qué pedido atiende, qué necesita y cómo responde.</p>
      {creating && <label className="skills-label">Nombre<input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Nombre de la skill" disabled={busy}/></label>}
      <label className="skills-label">Instrucciones en Markdown<textarea autoFocus={!creating} value={draft} onChange={e => setDraft(e.target.value)} disabled={busy}/></label>
      <div className="skills-actions"><button className="settings-action" disabled={busy} onClick={() => { setCreating(false); setEditing(false); setError(''); }}>Cancelar</button>
        <button className="settings-action is-primary" disabled={busy || !draft.trim() || (creating ? !title.trim() : draft === skill?.content)} onClick={persist}>{busy ? 'Guardando…' : creating ? 'Crear' : 'Guardar cambios'}</button></div>
    </> : skill ? <>
      <button className="skills-back" onClick={back}><ArrowLeft size={18}/> Todas las skills</button>
      <header className="skills-detail-header"><span className="skills-icon"><BookOpen size={26}/></span><div><h2 ref={heading} tabIndex={-1}>{skill.title.replace(/_/g, ' ')}</h2>
        <p className="skills-muted">{own(skill) ? 'Tu skill' : 'De la plataforma'} · Versión {skill.version}{updated && ` · Actualizada el ${updated}`}</p></div>
        {editable && <button className="settings-action" onClick={() => { setDraft(skill.content); setEditing(true); }}>Editar skill</button>}</header>
      <div className="skills-tabs" role="tablist" aria-label="Detalle de la skill" onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 'summary' : e.key === 'End' ? 'content' : tab === 'summary' ? 'content' : 'summary';
        setTab(next);
        e.currentTarget.querySelector<HTMLButtonElement>(`#skill-${next}-tab`)?.focus();
      }}>
        <button role="tab" id="skill-summary-tab" tabIndex={tab === 'summary' ? 0 : -1} aria-selected={tab === 'summary'} aria-controls="skill-panel" onClick={() => setTab('summary')}>Resumen</button>
        <button role="tab" id="skill-content-tab" tabIndex={tab === 'content' ? 0 : -1} aria-selected={tab === 'content'} aria-controls="skill-panel" onClick={() => setTab('content')}>Contenido</button>
      </div>
      <div role="tabpanel" id="skill-panel" aria-labelledby={tab === 'summary' ? 'skill-summary-tab' : 'skill-content-tab'}>
        {tab === 'summary' ? <div className="skills-summary"><section><h3>Descripción</h3><Markdown text={description(skill.content)} fontSize={18}/>
          {sections.length > 0 && <><h3>Qué incluye</h3><ul>{sections.map((s, n) => <li key={n}>{s}</li>)}</ul></>}
          <button className="settings-action" onClick={() => setTab('content')}>Ver contenido completo <ChevronRight size={18}/></button></section>
          <aside><h3>Origen</h3><p>{own(skill) ? 'Creada por vos' : `Publicada por ${skill.owner}`}</p><p className="skills-muted">{editable ? 'Podés editar sus instrucciones.' : 'Disponible para consultar. Sus instrucciones son de solo lectura.'}</p></aside>
        </div> : <div className="skills-content"><div className="skills-filebar"><span>Instrucciones</span><div className="prefs-segmented">
          <button aria-label="Vista previa" aria-pressed={!source} onClick={() => setSource(false)}><Eye size={18}/><span>Vista previa</span></button>
          <button aria-label="Código Markdown" aria-pressed={source} onClick={() => setSource(true)}><Code size={18}/><span>Markdown</span></button></div></div>
          <article className="skills-document">{source ? <pre>{skill.content}</pre> : <Markdown text={skill.content} fontSize={18}/>}</article></div>}
      </div>
      {editable && <footer className="skills-delete">{confirmDelete ? <><span>¿Borrar esta skill?</span><button className="settings-action" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</button><button className="settings-action is-danger" disabled={busy} onClick={remove}>{busy ? 'Borrando…' : 'Confirmar borrado'}</button></> : <button className="skills-back" onClick={() => setConfirmDelete(true)}>Borrar skill</button>}</footer>}
    </> : <>
      <div className="skills-toolbar"><div className="prefs-segmented" aria-label="Filtrar skills">{[['all', 'Todas'], ['mine', 'Tuyas'], ['platform', 'De la plataforma']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
        <button className="settings-action is-primary" onClick={() => { setCreating(true); setTitle(''); setDraft(SKILL_TEMPLATE); setError(''); }}><Plus size={19}/> Nueva skill</button></div>
      <label className="skills-search"><Search size={20}/><input aria-label="Buscar skills" placeholder="Buscar por nombre o contenido" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <p className="skills-muted" role="status">{visible.length} {visible.length === 1 ? 'skill' : 'skills'}</p>
      <ul className="skills-list">{visible.map(i => <li key={i.key}><button onClick={() => open(i)}><span className="skills-icon"><BookOpen size={23}/></span><span className="skills-row-body"><strong>{i.title.replace(/_/g, ' ')}</strong><span>{own(i) ? 'Tu skill' : 'De la plataforma'} · {description(i.content).replace(/[*#`]/g, '')}</span></span><span className="skills-version">v{i.version}</span><ChevronRight size={20}/></button></li>)}</ul>
      {!visible.length && <div className="skills-empty"><BookOpen size={32}/><h3>{items.length ? 'No hay skills que coincidan' : 'Todavía no hay skills'}</h3><p>{items.length ? 'Probá otro nombre o cambiá el filtro.' : 'Creá la primera con «Nueva skill».'}</p></div>}
    </>}
  </div>;
}
