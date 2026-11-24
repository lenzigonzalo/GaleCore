import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { updateOwnPassword } from '../../auth/supabase';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

const ACCENT = 'var(--blue-gc)';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-dark)',
  color: 'var(--text-primary)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
};

/** Los errores de Supabase al cambiar la contraseña, en castellano (BF-0010). */
export function passwordErrorText(error: { code?: string; name?: string; message: string }): string {
  switch (error.code) {
    case 'same_password': return 'La contraseña nueva tiene que ser distinta de la actual.';
    case 'weak_password': return 'La contraseña es muy corta o débil: usá al menos 6 caracteres.';
    case 'reauthentication_needed': return 'Por seguridad hay que volver a entrar: cerrá sesión, entrá de nuevo y cambiala enseguida.';
    case 'session_not_found':
    case 'session_expired': return 'Tu sesión venció: cerrá sesión, entrá de nuevo y volvé a probar.';
    case 'over_request_rate_limit': return 'Demasiados intentos. Esperá unos minutos antes de volver a probar.';
  }
  if (error.name === 'AuthSessionMissingError') return 'Tu sesión venció: cerrá sesión, entrá de nuevo y volvé a probar.';
  return error.message;
}

interface Props {
  /**
   * Le saca el chrome de card (borde, fondo y la fila del título) para montarlo adentro de un
   * modal, que ya pone los suyos. Sin esto se ve una card dentro de otra y el título repetido.
   */
  embedded?: boolean;
}

/**
 * Cambio de la contraseña propia, en el menú Mi Cuenta.
 *
 * ES LA CONTRACARA DEL ALTA. El admin crea al operador con una contraseña INICIAL —es lo que
 * permite dar de alta sin depender de que Supabase tenga un SMTP propio configurado— y acá esa
 * persona la reemplaza por una suya. Sin esta pantalla, la contraseña que el admin eligió sería la
 * definitiva y la sabrían dos personas para siempre.
 *
 * Le pega DIRECTO a Supabase con la sesión vigente, sin pasar por la API: cambiar la propia
 * contraseña no necesita la service_role. Por eso también funciona aunque la API esté caída.
 */
export function MyPasswordCard({ embedded = false }: Props = {}) {
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const username = useCurrentUserStore((s) => s.user?.username ?? null);
  const email = useCurrentUserStore((s) => s.user?.email ?? null);

  // La repetición es la única defensa contra el typo: acá no hay "olvidé mi contraseña" que la
  // rescate — si se guarda una que nadie sabe, hay que pedirle a un admin que la resetee.
  const coinciden = password.length > 0 && password === repetida;
  const canSubmit = coinciden && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    setOk(null);

    try {
      const { error: authError } = await updateOwnPassword(password);

      if (authError) {
        // El motivo de Supabase es accionable pero viene en inglés: se traduce por código y, si es
        // uno que no conocemos, se muestra tal cual antes que un "no se pudo guardar" mudo.
        setError(passwordErrorText(authError));
        return;
      }

      setPassword('');
      setRepetida('');
      setOk('Contraseña cambiada. La sesión abierta sigue valiendo; la próxima vez entrá con la nueva.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo conectar con el servicio de autenticación');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: embedded ? 'transparent' : 'var(--bg-secondary)',
        border: embedded ? 'none' : '1px solid var(--border)',
        borderRadius: embedded ? 0 : 10,
        boxShadow: embedded ? 'none' : 'var(--shadow-sm)',
        padding: embedded ? 0 : '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Lock size={13} style={{ color: ACCENT }} />
          <span style={{
            fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16,
            color: 'var(--text-primary)', letterSpacing: '0.05em',
          }}>
            Mi contraseña
          </span>
        </div>
      )}

      <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        {username || '—'}
        {email && <span style={{ color: 'var(--text-muted)' }}>{' · '}{email}</span>}
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
        Si entraste con una contraseña que te dio un admin, cambiala acá: mientras no lo hagas, la
        saben dos personas.
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label htmlFor="gc-new-password" className="block mb-1" style={labelStyle}>
            Contraseña nueva
          </label>
          <input
            id="gc-new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={inputStyle}
            placeholder="••••••••••••"
          />
        </div>

        <div>
          <label htmlFor="gc-new-password-2" className="block mb-1" style={labelStyle}>
            Repetir
          </label>
          <input
            id="gc-new-password-2"
            type="password"
            autoComplete="new-password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={{
              ...inputStyle,
              borderColor: repetida.length > 0 && !coinciden ? 'var(--red-gc)' : 'var(--border-dark)',
            }}
            placeholder="••••••••••••"
          />
          {repetida.length > 0 && !coinciden && (
            <div style={{ fontSize: 12, color: 'var(--red-gc)', marginTop: 4, fontFamily: 'var(--font-sans)' }}>
              No coinciden.
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs py-2 px-3 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)' }}>
            {error}
          </div>
        )}

        {ok && (
          <div className="text-xs py-2 px-3 rounded" style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: 'var(--green)' }}>
            {ok}
          </div>
        )}

        <button type="submit" className="btn" disabled={!canSubmit} style={{ alignSelf: 'flex-start' }}>
          {saving ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </div>
  );
}
