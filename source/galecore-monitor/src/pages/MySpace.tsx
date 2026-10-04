import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionTitle } from '../components/common/SectionTitle';
import {
  SPACE_KINDS, SpaceFormat, SpaceItem, SpaceKind, SpaceVisibility,
  deleteSpaceItem, fetchSpace, keyFromTitle, saveSpaceItem,
} from '../api/space';

/**
 * Mi espacio (GC-0007, fase 3c): lo que GaleCore-AI sabe de vos y usa al empezar cada sesión.
 *
 * Es de la persona: vive en el estado de esta pantalla, no en un store de módulo, así que muere con la sesión
 * (el Dashboard se remonta al cambiar de usuario) y no hay nada que agregar a resetUserScopedStores.
 */
const label = (kind: SpaceKind) => SPACE_KINDS.find((k) => k.id === kind)?.label ?? kind;

const box: React.CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 14, padding: 18,
};
const chip = (on: boolean, color = 'var(--accent)'): React.CSSProperties => ({
  fontSize: 13, padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-sans)',
  border: `1px solid ${on ? color : 'var(--border-dark)'}`, color: on ? 'var(--text-primary)' : 'var(--text-muted)',
  backgroundColor: on ? 'var(--bg-elevated)' : 'transparent',
});
const badge = (shared: boolean): React.CSSProperties => ({
  fontSize: 12, padding: '1px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  color: shared ? 'var(--green)' : 'var(--text-secondary)',
  border: `1px solid ${shared ? 'var(--green-border)' : 'var(--border-dark)'}`,
});
const input: React.CSSProperties = {
  width: '100%', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)',
  border: '1px solid var(--border-dark)', borderRadius: 4, padding: '6px 8px', fontSize: 14, fontFamily: 'inherit',
};
const button = (primary = false): React.CSSProperties => ({
  fontSize: 14, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
  border: `1px solid ${primary ? 'var(--accent)' : 'var(--border-dark)'}`,
  backgroundColor: primary ? 'var(--accent)' : 'transparent', color: primary ? 'var(--accent-ink)' : 'var(--text-secondary)',
});

function pretty(item: { content: string; format: SpaceFormat }) {
  if (item.format !== 'json') return item.content;
  try { return JSON.stringify(JSON.parse(item.content), null, 2); } catch { return item.content; }
}

interface Draft { kind: SpaceKind; key: string; title: string; content: string; format: SpaceFormat; visibility: SpaceVisibility; isNew: boolean }

function Editor({ draft, onCancel, onSaved }: { draft: Draft; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSpaceItem(d.kind, d.isNew ? keyFromTitle(d.key || d.title) : d.key,
        { title: d.title, content: d.content, format: d.format, visibility: d.visibility });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
      {d.isNew && (
        <select style={input} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as SpaceKind })}>
          {SPACE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} — {k.hint}</option>)}
        </select>
      )}
      <input style={input} placeholder="Título" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      <textarea style={{ ...input, minHeight: 140, fontFamily: d.format === 'json' ? 'monospace' : 'inherit' }}
        placeholder="Contenido, en tus palabras" value={d.content}
        onChange={(e) => setD({ ...d, content: e.target.value })} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Visibilidad</span>
        <button style={chip(d.visibility === 'private')} onClick={() => setD({ ...d, visibility: 'private' })}>Sólo yo</button>
        <button style={chip(d.visibility === 'shared', 'var(--green)')} onClick={() => setD({ ...d, visibility: 'shared' })}>Compartida con el equipo</button>
        <span style={{ flex: 1 }} />
        <button style={button()} onClick={onCancel}>Cancelar</button>
        <button style={button(true)} disabled={saving || !d.title.trim() || !d.content.trim()} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {error && <div style={{ fontSize: 13, color: 'var(--red-gc)' }}>{error}</div>}
    </div>
  );
}

function ItemCard({ item, onChanged }: { item: SpaceItem; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const shared = item.visibility === 'shared';
  const remove = async () => {
    if (!window.confirm(`¿Borrar "${item.title}" de tu espacio?`)) return;
    await deleteSpaceItem(item.kind, item.key);
    onChanged();
  };
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 86, textTransform: 'uppercase' }}>{label(item.kind)}</span>
        <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.title}</span>
        <span style={badge(shared)}>{item.isOwn ? (shared ? 'compartida' : 'sólo yo') : `de ${item.owner}`}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>v{item.version}</span>
      </div>
      {open && !editing && (
        <>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-secondary)', margin: '10px 0 0',
            fontFamily: item.format === 'json' ? 'monospace' : 'var(--font-sans)' }}>{pretty(item)}</pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              actualizada {new Date(item.updatedAt).toLocaleString()}
            </span>
            <span style={{ flex: 1 }} />
            {item.isOwn && <button style={button()} onClick={remove}>Borrar</button>}
            {item.isOwn && <button style={button(true)} onClick={() => setEditing(true)}>Editar</button>}
          </div>
        </>
      )}
      {editing && (
        <Editor draft={{ ...item, content: pretty(item), isNew: false }} onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }} />
      )}
    </div>
  );
}

export function MySpace() {
  const [items, setItems] = useState<SpaceItem[]>([]);
  const [shared, setShared] = useState<SpaceItem[]>([]);
  const [filter, setFilter] = useState<SpaceKind | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSpace();
      setItems(data.items);
      setShared(data.shared);
      setError(null);
    } catch (e: any) {
      // Un error nunca deja el dato viejo a la vista (regla del monitor).
      setItems([]);
      setShared([]);
      setError(e?.response?.data?.error ?? 'No se pudo leer tu espacio');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => items.filter((i) => filter === 'all' || i.kind === filter), [items, filter]);
  const visibleShared = useMemo(() => shared.filter((i) => filter === 'all' || i.kind === filter), [shared, filter]);
  const count = (k: SpaceKind) => items.filter((i) => i.kind === k).length;

  return (
    <div style={{ padding: '28px 28px 40px', fontFamily: 'var(--font-sans)', maxWidth: 1180 }}>
      <SectionTitle title="Mi espacio" badge="lo que GaleCore-AI sabe de vos" style={{ marginBottom: 8 }} />
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        GaleCore-AI lo carga al empezar cada sesión para responder según tus objetivos y límites. Lo que le pedís
        guardar desde el chat aparece acá; lo que cambiás acá, lo usa la próxima vez.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <button style={chip(filter === 'all')} onClick={() => setFilter('all')}>Todo ({items.length})</button>
        {SPACE_KINDS.map((k) => (
          <button key={k.id} style={chip(filter === k.id)} title={k.hint} onClick={() => setFilter(k.id)}>
            {k.label} ({count(k.id)})
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button style={button(true)} onClick={() => setCreating(true)}>+ Nueva</button>
      </div>

      {creating && (
        <div style={{ ...box, marginBottom: 12 }}>
          <Editor
            draft={{ kind: filter === 'all' ? 'memory' : filter, key: '', title: '', content: '', format: 'markdown',
                     visibility: 'private', isNew: true }}
            onCancel={() => setCreating(false)}
            onSaved={() => { setCreating(false); load(); }} />
        </div>
      )}

      {error && <div style={{ ...box, color: 'var(--red-gc)', fontSize: 14, marginBottom: 12 }}>{error}</div>}
      {loading && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Cargando…</div>}

      {!loading && !error && (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            {visible.map((i) => <ItemCard key={`${i.kind}/${i.key}`} item={i} onChanged={load} />)}
            {visible.length === 0 && (
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                Nada acá todavía. Podés crearlo con «+ Nueva» o pedírselo a GaleCore-AI en el chat.
              </div>
            )}
          </div>
          {visibleShared.length > 0 && (
            <>
              <SectionTitle title="Compartido por el equipo" badge="sólo lectura" accent="#34d399"
                style={{ margin: '22px 0 10px' }} />
              <div style={{ display: 'grid', gap: 10 }}>
                {visibleShared.map((i) => <ItemCard key={`${i.owner}/${i.kind}/${i.key}`} item={i} onChanged={load} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
