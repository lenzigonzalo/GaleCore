import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * Primitivas visuales compartidas por los paneles de Referencias de cada estrategia
 * (StrategyReference para RPF, GexReference para GEX). Antes vivían privadas dentro de
 * StrategyReference; se extrajeron para que los dos paneles se vean iguales sin duplicarlas.
 */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: 'var(--text-muted)', fontFamily: 'var(--font-sans)',
      padding: '2px 0 8px', borderBottom: '1px solid var(--border-dark)', marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)',
      borderRadius: 8, padding: '14px 16px', marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

export function CollapsibleCard({ title, titleColor = 'var(--text-muted)', defaultOpen = false, children }:
  { title: React.ReactNode; titleColor?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', color: titleColor, marginBottom: open ? 8 : 0 }}>
        <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>{title}</span>
      </button>
      {open && <div>{children}</div>}
    </Card>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px',
      backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, minWidth: 0,
    }}>
      <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{label}</span>
      <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.1 }}>{value}</span>
      {hint && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{hint}</span>}
    </div>
  );
}

export function TH({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      padding: '5px 8px', textAlign: 'left', fontSize: 9, fontWeight: 600,
      letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)',
      borderBottom: '1px solid var(--border-dark)', fontFamily: 'var(--font-sans)',
    }}>
      {children}
    </th>
  );
}

export function TD({ children, mono, color }: { children: React.ReactNode; mono?: boolean; color?: string }) {
  return (
    <td style={{
      padding: '5px 8px', fontSize: 11, color: color ?? 'var(--text-primary)',
      fontFamily: mono ? 'JetBrains Mono, monospace' : 'var(--font-sans)',
      borderBottom: '1px solid var(--border-dark)',
    }}>
      {children}
    </td>
  );
}
