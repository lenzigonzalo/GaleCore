import React from 'react';
import { tint } from '../../utils/formatters';

/**
 * Piezas visuales de la sección Inteligencia. Mismo lenguaje que el resto del tablero (variables
 * de color del tema, Inter para texto, JetBrains Mono para números/hashes/timestamps), para que la
 * pestaña se vea como una más y no como una app pegada.
 */

export const INTELIGENCIA_ACCENT = '#a78bfa';
export const OK = 'var(--green)';
export const WARN = 'var(--yellow-gc)';
export const BAD = 'var(--red-gc)';
export const NOTE = INTELIGENCIA_ACCENT;

export const MONO: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace' };
export const SANS: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

export function Badge({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{
      ...SANS, display: 'inline-block', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em',
      textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
      color, backgroundColor: tint(color, 12), border: `1px solid ${tint(color, 35)}`,
    }}>
      {children}
    </span>
  );
}

export function Card({ title, color, children, style }: {
  title?: string; color?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section style={{
      backgroundColor: color ? tint(color, 5) : 'var(--bg-secondary)',
      border: `1px solid ${color ? tint(color, 30) : 'var(--border-dark)'}`,
      borderRadius: 10, padding: '12px 14px', marginBottom: 12, ...style,
    }}>
      {title && (
        <div style={{
          ...SANS, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: color ?? 'var(--text-muted)', marginBottom: 8,
        }}>
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <div style={{ ...SANS, fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', margin: '10px 0 4px' }}>{children}</div>;
}

export function KV({ rows }: { rows: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '3px 14px', margin: 0, fontSize: 11.5, ...SANS }}>
      {rows.map(({ k, v }) => (
        <React.Fragment key={k}>
          <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
          <dd style={{ margin: 0, color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function Mono({ children, muted, wrap }: { children: React.ReactNode; muted?: boolean; wrap?: boolean }) {
  return (
    <span style={{
      ...MONO, fontSize: 11, color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
      whiteSpace: wrap ? 'normal' : 'nowrap', overflowWrap: wrap ? 'anywhere' : undefined,
    }}>
      {children}
    </span>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={{ ...SANS, margin: '2px 0 0', paddingLeft: 18, fontSize: 11.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

const TH: React.CSSProperties = { ...SANS, textAlign: 'left', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 6px', borderBottom: '1px solid var(--border)' };
const TD: React.CSSProperties = { ...SANS, fontSize: 11.5, padding: '4px 6px', borderBottom: '1px solid var(--border-dark)', verticalAlign: 'top', color: 'var(--text-primary)' };

export function Table({ head, rows }: { head: (string | { label: string; num?: boolean })[]; rows: React.ReactNode[][] }) {
  const cols = head.map((h) => (typeof h === 'string' ? { label: h, num: false } : { num: false, ...h }));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{cols.map((c) => <th key={c.label} style={{ ...TH, textAlign: c.num ? 'right' : 'left' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ ...TD, ...(cols[j]?.num ? { ...MONO, textAlign: 'right', whiteSpace: 'nowrap' } : {}) }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function fmtDelta(d: number | null): string {
  if (d === null) return '—';
  return (d > 0 ? '+' : '') + String(d);
}
