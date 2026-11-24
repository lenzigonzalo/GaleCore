import React, { useEffect, useState } from 'react';
import { Switch } from './Switch';
import { MyPasswordCard } from '../account/MyPasswordCard';

/** Cuenta (WS-0058): usuario, email, rol, tamaño del texto, chat nuevo y contraseña. Nada de esto es el perfil del chat. */
export function AccountSettings({ user, textSize, suggestions, onSuggestions }: {
  user?: { username?: string | null; email?: string | null; isAdmin?: boolean } | null;
  textSize?: React.ReactNode;
  suggestions: boolean;
  onSuggestions: (next: boolean) => Promise<void>;
}) {
  // El interruptor se mueve al tocarlo y vuelve atrás si el guardado falla (BF-0011): esperar a la API lo dejaba quieto
  // un par de segundos, parecía roto, y un segundo toque pisaba al primero.
  const [on, setOn] = useState(suggestions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setOn(suggestions); }, [suggestions]);
  const toggle = (next: boolean) => {
    if (saving) return;
    setOn(next); setSaving(true); setError('');
    onSuggestions(next)
      .catch(() => { setOn(!next); setError('No se pudo guardar. Probá de nuevo.'); })
      .finally(() => setSaving(false));
  };
  return (
    <div className="prefs">
      <section className="prefs-group">
        <h2>Cuenta</h2>
        <div className="prefs-row"><span>Usuario</span><strong>{user?.username ?? '—'}</strong></div>
        <div className="prefs-row"><span>Email</span><strong>{user?.email ?? '—'}</strong></div>
        <div className="prefs-row"><span>Rol</span><strong>{user?.isAdmin ? 'Administrador' : 'Operador'}</strong></div>
        {textSize}
        <div className="prefs-row">
          <span>Chat nuevo<small role={error ? 'alert' : undefined}>{error || 'Sugerir temas del momento al abrir un chat'}</small></span>
          <Switch on={on} label="Sugerir temas del momento al abrir un chat" onChange={toggle} />
        </div>
      </section>
      <section className="prefs-group">
        <h2>Contraseña</h2>
        <MyPasswordCard embedded />
      </section>
    </div>
  );
}
