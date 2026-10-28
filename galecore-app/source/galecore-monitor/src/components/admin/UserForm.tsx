import React, { useState } from 'react';
import { AdminUser, createAdminUser, updateAdminUser } from '../../api/admin';

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

/** El mismo charset que `Usernames.Pattern` en el backend y que el check de Postgres. */
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

interface Props {
  /** null = alta. Con un usuario = edición de ese usuario. */
  user: AdminUser | null;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Alta y edición de un operador. Un solo formulario para las dos cosas, porque los campos son los
 * mismos: lo único que cambia es que en el alta la contraseña es obligatoria y en la edición es
 * opcional ("vacío = no se toca").
 *
 * VALIDA EL USERNAME EN EL CLIENTE, pero no es ahí donde se decide: la regla la aplican el
 * endpoint y el check de Postgres. Acá está para que el charset se explique ANTES de mandar, en vez
 * de que el operador descubra tipeando que no puede poner mayúsculas.
 *
 * LA CONTRASEÑA ES INICIAL: la persona la cambia después desde su propia pantalla. El admin la
 * elige una vez y no la vuelve a ver — no se muestra en ningún lado ni vuelve en el GET.
 */
export function UserForm({ user, onSaved, onCancel }: Props) {
  const esAlta = user === null;

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(user?.isAdmin ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameNormalizado = username.trim().toLowerCase();
  const usernameValido = USERNAME_RE.test(usernameNormalizado);
  const emailValido = email.trim().length > 3 && email.includes('@');
  const passwordOk = esAlta ? password.length > 0 : true;

  const canSubmit = usernameValido && emailValido && passwordOk && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    try {
      if (esAlta) {
        await createAdminUser({
          username: usernameNormalizado,
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
          isAdmin,
        });
      } else {
        // Solo se manda lo que cambió. El backend trata el campo ausente como "no tocar", así que
        // mandar todo pisaría con lo que esta pantalla leyó hace rato lo que otro pudo editar.
        await updateAdminUser(user!.id, {
          username: usernameNormalizado !== user!.username ? usernameNormalizado : undefined,
          email: email.trim() !== user!.email ? email.trim() : undefined,
          displayName: (displayName.trim() || '') !== (user!.displayName ?? '') ? displayName.trim() : undefined,
          password: password.length > 0 ? password : undefined,
        });
      }

      await onSaved();
    } catch (err: any) {
      // El motivo real viene del backend o de Supabase ("email already exists", "password should be
      // at least 6 characters", "el usuario 'x' ya está tomado") y es accionable: se muestra tal cual.
      setError(err?.response?.data?.error || err?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 16,
        maxWidth: 900,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{
        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15,
        color: 'var(--text-primary)', letterSpacing: '0.05em',
      }}>
        {esAlta ? 'Nuevo operador' : `Editar ${user!.username}`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div>
          <label htmlFor="gc-user-username" className="block mb-1" style={labelStyle}>Usuario</label>
          <input
            id="gc-user-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={{
              ...inputStyle,
              borderColor: username.length > 0 && !usernameValido ? 'var(--red-gc)' : 'var(--border-dark)',
            }}
            placeholder="eric"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <div style={{
            fontSize: 12, marginTop: 4, fontFamily: 'var(--font-sans)',
            color: username.length > 0 && !usernameValido ? 'var(--red-gc)' : 'var(--text-muted)',
          }}>
            Minúscula, 3 a 32, letras, números, punto, guion y guion bajo. Con esto entra al tablero.
          </div>
        </div>

        <div>
          <label htmlFor="gc-user-email" className="block mb-1" style={labelStyle}>Email</label>
          <input
            id="gc-user-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={inputStyle}
            placeholder="operador@ejemplo.com"
            autoComplete="off"
            spellCheck={false}
          />
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
            Real y único: es la identidad en Supabase, la que recibe el reset de contraseña.
          </div>
        </div>

        <div>
          <label htmlFor="gc-user-display" className="block mb-1" style={labelStyle}>Nombre (opcional)</label>
          <input
            id="gc-user-display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={inputStyle}
            placeholder="Eric Lenzi"
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="gc-user-password" className="block mb-1" style={labelStyle}>
            {esAlta ? 'Contraseña inicial' : 'Contraseña nueva (opcional)'}
          </label>
          <input
            id="gc-user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={inputStyle}
            placeholder="••••••••••••"
            autoComplete="new-password"
          />
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
            {esAlta
              ? 'Se la pasás una vez; la cambia desde su pantalla en cuanto entre.'
              : 'Vacío = no se toca. Solo para rescatar a alguien que perdió el acceso.'}
          </div>
        </div>
      </div>

      {esAlta && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', cursor: 'pointer',
        }}>
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Admin — puede administrar usuarios y prender o apagar estrategias para todos.
        </label>
      )}

      {error && (
        <div className="text-xs py-2 px-3 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn" disabled={!canSubmit}>
          {saving ? 'Guardando…' : esAlta ? 'Crear operador' : 'Guardar cambios'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
