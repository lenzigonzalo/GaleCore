import React, { useState } from 'react';
import { loginWithUsername, supabaseConfigured } from '../auth/supabase';

interface Props {
  onAuthenticated: () => void;
}

/**
 * Entrada al tablero, con USUARIO y contraseña.
 *
 * Reemplaza a la pantalla de Access Key, que tenía dos problemas de fondo: la clave era COMPARTIDA
 * (no identificaba a nadie, así que la API no podía saber de quién era la cuenta de bróker que
 * estaba sirviendo) y no servía para autenticar el hub, porque en el upgrade a WebSocket el
 * navegador no deja mandar headers propios.
 *
 * EL CAMPO ES EL USERNAME, NO EL MAIL (desde 2026-08-13). El mail sigue existiendo —es la identidad
 * en Supabase, la que recibe el reset de contraseña— pero el front no lo conoce ni lo necesita: la
 * API resuelve username → mail contra su tabla. Ver `loginWithUsername`.
 *
 * La sesión la administra supabase-js: la guarda y renueva el access token sola antes de que venza.
 */
export function LoginScreen({ onAuthenticated }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && password.length > 0 && supabaseConfigured;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      // El mensaje ya viene resuelto: el backend contesta lo mismo para usuario inexistente y para
      // contraseña equivocada, y `loginWithUsername` distingue aparte el rate limit y la red.
      await loginWithUsername(username.trim().toLowerCase(), password);
      onAuthenticated();
    } catch (err: any) {
      setError(err?.message || 'No se pudo conectar con el servicio de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div
        className="w-80 rounded-lg p-8"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-dark)',
        }}
      >
        <div className="text-center mb-8">
          <div
            className="text-2xl font-bold tracking-widest mb-1"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}
          >
            GALECORE
          </div>
          <div className="text-xs tracking-widest uppercase" style={{ color: 'var(--blue-gc)' }}>
            OPTIONS TRADING MONITOR
          </div>
        </div>

        {!supabaseConfigured && (
          <div
            className="text-xs py-2 px-3 rounded mb-4"
            style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)' }}
          >
            Falta configurar REACT_APP_SUPABASE_URL y REACT_APP_SUPABASE_ANON_KEY.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-xs tracking-wider mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              spellCheck={false}
              className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-dark)',
                color: 'var(--text-primary)',
              }}
              placeholder="usuario"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs tracking-wider mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-dark)',
                color: 'var(--text-primary)',
              }}
              placeholder="••••••••••••"
            />
          </div>

          {error && (
            <div
              className="text-xs py-2 px-3 rounded"
              style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)' }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full py-2 rounded text-sm font-medium transition-opacity"
            style={{
              backgroundColor: loading || !canSubmit ? 'var(--bg-tertiary)' : 'var(--blue-gc)',
              color: loading || !canSubmit ? 'var(--text-muted)' : '#fff',
              cursor: loading || !canSubmit ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" style={{ width: 14, height: 14 }} />
                Entrando…
              </span>
            ) : (
              'Entrar'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
