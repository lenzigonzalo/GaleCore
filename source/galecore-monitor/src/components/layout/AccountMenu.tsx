import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, Lock, LogOut, User } from 'lucide-react';
import { Modal } from '../common/Modal';
import { MyPasswordCard } from '../account/MyPasswordCard';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

interface Props {
  /** Abre la pestaña de la cuenta de bróker. */
  onOpenBrokerAccount: () => void;
  /** Cierra la sesión. Si no viene, el menú no ofrece "Salir". */
  onLogout?: () => void;
  /** La pestaña de la cuenta está activa: el botón del menú se marca como las demás pestañas. */
  active?: boolean;
}

const itemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%',
  padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 11.5, fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)',
  textAlign: 'left', whiteSpace: 'nowrap',
};

/**
 * Menú "Mi Cuenta" — lo de cada operador, sin importar si es admin.
 *
 * Reemplaza al botón LOGOUT suelto. Lo que hay adentro es de la persona, no de la plataforma: su
 * cuenta de bróker (de la que salen SUS balances y posiciones), su contraseña y la salida. Por eso
 * NO se gatea por permiso — es lo contrario de Admin, que administra a otros.
 *
 * Los dos primeros ítems vivían en la pestaña Admin, que ahora quedó solo con la tabla de usuarios
 * y por lo tanto solo la ven los admin.
 *
 * La cuenta de bróker abre una pestaña y la contraseña un modal a propósito: la primera es una
 * pantalla con estado (lee la cuenta vinculada, se vuelve a ella) y la segunda es un formulario de
 * dos campos que se completa y se cierra.
 */
export function AccountMenu({ onOpenBrokerAccount, onLogout, active = false }: Props) {
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const username = useCurrentUserStore((s) => s.user?.username ?? null);

  // Un menú que no se cierra al clickear afuera queda tapando la pantalla: se escucha en captura
  // para cerrarlo aunque el click lo consuma otro componente.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hoverOn = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
    e.currentTarget.style.color = 'var(--text-primary)';
  };
  const hoverOff = (color: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent';
    e.currentTarget.style.color = color;
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', height: '100%' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={username ? `Sesión de ${username}` : 'Mi cuenta'}
        className="flex items-center gap-1.5 px-3 h-full text-xs uppercase tracking-wider"
        style={{
          background: 'none',
          border: 'none',
          color: open || active ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontWeight: active ? 600 : 400,
          borderBottom: active ? '2px solid var(--blue-gc)' : '2px solid transparent',
          whiteSpace: 'nowrap',
        }}
      >
        <User size={12} />
        MI CUENTA
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, zIndex: 900, marginTop: 1,
            minWidth: 190, padding: '5px 0',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          }}
        >
          {username && (
            <div style={{
              padding: '4px 12px 8px', fontSize: 10, letterSpacing: '0.05em',
              color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace',
              borderBottom: '1px solid var(--border-dark)', marginBottom: 5,
            }}>
              {username}
            </div>
          )}

          <button
            role="menuitem"
            onClick={() => { setOpen(false); onOpenBrokerAccount(); }}
            style={itemStyle}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff('var(--text-secondary)')}
          >
            <KeyRound size={12} style={{ flexShrink: 0 }} />
            Cuenta de bróker
          </button>

          <button
            role="menuitem"
            onClick={() => { setOpen(false); setPasswordOpen(true); }}
            style={itemStyle}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff('var(--text-secondary)')}
          >
            <Lock size={12} style={{ flexShrink: 0 }} />
            Mi contraseña
          </button>

          {onLogout && (
            <>
              <div style={{ height: 1, backgroundColor: 'var(--border-dark)', margin: '5px 0' }} />
              <button
                role="menuitem"
                onClick={() => { setOpen(false); onLogout(); }}
                style={{ ...itemStyle, color: 'var(--text-muted)' }}
                onMouseEnter={hoverOn}
                onMouseLeave={hoverOff('var(--text-muted)')}
              >
                <LogOut size={12} style={{ flexShrink: 0 }} />
                Salir
              </button>
            </>
          )}
        </div>
      )}

      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Mi contraseña"
        icon={<Lock size={13} style={{ color: 'var(--blue-gc)' }} />}
        width={460}
      >
        <MyPasswordCard embedded />
      </Modal>
    </div>
  );
}
