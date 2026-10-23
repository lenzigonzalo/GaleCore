import React from 'react';
import { Switch } from './LanguageSetting';
import { MyPasswordCard } from '../account/MyPasswordCard';

/** Cuenta (WS-0058): usuario, email, rol, idioma, chat nuevo y contraseña. Nada de esto es el perfil del chat. */
export function AccountSettings({ user, language, chatFont, suggestions, onSuggestions }: {
  user?: { username?: string | null; email?: string | null; isAdmin?: boolean } | null;
  language: React.ReactNode;
  chatFont?: React.ReactNode;
  suggestions: boolean;
  onSuggestions: (next: boolean) => void;
}) {
  return (
    <div className="prefs">
      <section className="prefs-group">
        <h2>Cuenta</h2>
        <div className="prefs-row"><span>Usuario</span><strong>{user?.username ?? '—'}</strong></div>
        <div className="prefs-row"><span>Email</span><strong>{user?.email ?? '—'}</strong></div>
        <div className="prefs-row"><span>Rol</span><strong>{user?.isAdmin ? 'Administrador' : 'Operador'}</strong></div>
        {language}
        {chatFont}
        <div className="prefs-row">
          <span>Chat nuevo<small>Sugerir temas del momento al abrir un chat</small></span>
          <Switch on={suggestions} label="Sugerir temas del momento al abrir un chat" onChange={onSuggestions} />
        </div>
      </section>
      <section className="prefs-group">
        <h2>Contraseña</h2>
        <MyPasswordCard embedded />
      </section>
    </div>
  );
}
