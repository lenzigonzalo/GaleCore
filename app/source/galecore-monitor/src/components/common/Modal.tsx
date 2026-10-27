import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Título del modal, en el header. */
  title: string;
  /** Ícono opcional al lado del título. */
  icon?: React.ReactNode;
  /** Ancho máximo. El default alcanza para un formulario de una columna. */
  width?: number;
  children: React.ReactNode;
}

/**
 * Modal genérico: overlay + card con header y cierre.
 *
 * Es el hermano chico de `ReferencesModal`, que no sirve para esto: aquél tiene sus dos solapas
 * (Definiciones / Json) cableadas adentro porque es el modal de References de una estrategia. Éste
 * no sabe qué muestra — recibe el contenido y ya.
 *
 * Cierra con Escape y con click en el fondo, como el otro.
 */
export function Modal({ open, onClose, title, icon, width = 520, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

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
          width: `min(${width}px, 100%)`, maxHeight: 'min(86vh, 820px)',
          backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)',
          borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          textAlign: 'left',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '12px 16px', borderBottom: '1px solid var(--border-dark)',
          backgroundColor: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          {icon}
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
            {title}
          </span>
          <button
            onClick={onClose}
            title="Cerrar (Esc)"
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
