import React, { useCallback, useEffect, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';

type RefTab = 'definiciones' | 'json';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Título del modal, ej: "RPF · Referencias". */
  title: string;
  /** Color de acento de la estrategia (pestaña activa, badge). */
  accentColor?: string;
  /** Contenido de la pestaña Definiciones (el panel de la estrategia). */
  definitions: React.ReactNode;
  /** Trae el JSON de reglas crudo (galecore_rules_<prefijo>.json, servido tal cual por la API). */
  fetchJson: () => Promise<any>;
}

/**
 * Modal de Referencias de una estrategia. Dos pestañas:
 *  - Definiciones: el panel estructurado de la estrategia (se pasa como `definitions`).
 *  - Json: el archivo `galecore_rules_<prefijo>.json` tal cual lo sirve la API, formateado y de solo
 *    lectura.
 *
 * Es transversal: no conoce ninguna estrategia. RPF y GEX lo montan con su propio contenido y su
 * propio `fetchJson`.
 */
export function ReferencesModal({ open, onClose, title, accentColor = 'var(--blue-gc)', definitions, fetchJson }: Props) {
  const [tab, setTab] = useState<RefTab>('definiciones');
  const [json, setJson] = useState<string | null>(null);
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Cierre con Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // El JSON se pide la primera vez que se abre la pestaña Json, no al montar el modal.
  useEffect(() => {
    if (!open || tab !== 'json' || json != null || jsonLoading) return;
    setJsonLoading(true);
    setJsonErr(null);
    fetchJson()
      .then((data) => {
        const obj = typeof data === 'string' ? JSON.parse(data) : data;
        setJson(JSON.stringify(obj, null, 2));
      })
      .catch((e) => setJsonErr(String(e?.message ?? e)))
      .finally(() => setJsonLoading(false));
  }, [open, tab, json, jsonLoading, fetchJson]);

  const copy = useCallback(() => {
    if (!json) return;
    navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [json]);

  if (!open) return null;

  const tabBtn = (id: RefTab, label: string) => {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        style={{
          padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: active ? 700 : 500, letterSpacing: '0.06em', textTransform: 'uppercase',
          fontFamily: 'var(--font-sans)',
          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
          borderBottom: active ? `2px solid ${accentColor}` : '2px solid transparent',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(940px, 100%)', height: 'min(82vh, 760px)',
          backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)',
          borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', borderBottom: '1px solid var(--border-dark)',
          backgroundColor: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>{title}</span>
          <span style={{ marginLeft: 'auto' }} />
          <button
            onClick={onClose}
            title="Cerrar (Esc)"
            style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-dark)', backgroundColor: 'var(--bg-secondary)', flexShrink: 0, paddingLeft: 8 }}>
          {tabBtn('definiciones', 'Definiciones')}
          {tabBtn('json', 'Json')}
          {tab === 'json' && json && (
            <button
              onClick={copy}
              title="Copiar JSON"
              style={{
                marginLeft: 'auto', marginRight: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                background: 'none', border: '1px solid var(--border-dark)',
                fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
                color: copied ? 'var(--green)' : 'var(--text-muted)', fontFamily: 'var(--font-sans)',
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: tab === 'json' ? 0 : '16px 18px 24px' }}>
          {tab === 'definiciones' && definitions}
          {tab === 'json' && (
            <>
              {jsonLoading && <div style={{ padding: 18, fontSize: 14, color: 'var(--text-muted)' }}>Cargando JSON…</div>}
              {jsonErr && <div style={{ padding: 18, fontSize: 14, color: 'var(--red-gc)', fontFamily: 'JetBrains Mono, monospace' }}>⚠ {jsonErr}</div>}
              {json && (
                <pre style={{
                  margin: 0, padding: '14px 16px', fontSize: 13.5, lineHeight: 1.55,
                  fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)',
                  whiteSpace: 'pre', tabSize: 2,
                }}>
                  {json}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
