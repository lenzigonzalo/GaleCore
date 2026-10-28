import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Unlink } from 'lucide-react';
import { BrokerAccountState, fetchBrokerAccount, linkBrokerAccount, unlinkBrokerAccount } from '../../api/brokerAccount';
import { describeAccountError, fetchAccountOverview } from '../../api/account';
import { tint } from '../../utils/formatters';

const ACCENT = 'var(--blue-gc)';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-dark)',
  color: 'var(--text-primary)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
};

/**
 * Vinculación de la cuenta de bróker del operador, en Configuración.
 *
 * Existe porque el refresh token se ROTA: cada vez que se emite uno nuevo en Tastytrade hay que
 * dejarlo acá, y hasta que se hace, los procesos de fondo siguen intentando con el token viejo y el
 * feed se queda sin datos. Antes de esta pantalla el endpoint estaba implementado pero no lo llamaba
 * nadie, así que la única forma era armar un POST a mano con el JWT copiado del navegador.
 *
 * El token se manda y se olvida: no se guarda en estado global, ni en localStorage, ni vuelve en el
 * GET. El input se limpia solo al guardar.
 */
export function BrokerAccountCard({ onLinked }: { onLinked?: () => void }) {
  const [state, setState] = useState<BrokerAccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountNumber, setAccountNumber] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  // La otra mitad de la credencial, opcional: solo la llena quien registro su propia aplicacion
  // OAuth en Tastytrade. Vacio = la aplicacion de la plataforma.
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Desvincular borra el refresh token cifrado y no se puede deshacer sin volver a pegarlo, así que
  // pide una confirmación explícita en vez de borrar de un click.
  const [confirmandoUnlink, setConfirmandoUnlink] = useState(false);
  // Vinculada no es lo mismo que conectada: se comprueba leyendo la cuenta en Tastytrade.
  const [conexion, setConexion] = useState<'checking' | 'ok' | 'rejected' | 'unknown' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setState(null);
    setError(null);
    setConexion(null);
    try {
      const data = await fetchBrokerAccount();
      setState(data);
      // Solo propone el número que ya está vinculado: el que se rota es el token, no la cuenta.
      if (data.accountNumber) setAccountNumber((prev) => prev || data.accountNumber!);
      if (data.linked) {
        setConexion('checking');
        fetchAccountOverview()
          .then(() => setConexion('ok'))
          .catch((err) => setConexion(describeAccountError(err).brokerAccountIssue === 'credential_invalid' ? 'rejected' : 'unknown'));
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'No se pudo leer la cuenta vinculada');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canSubmit = accountNumber.trim().length > 0 && refreshToken.trim().length > 0 && !saving && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    setOk(null);

    try {
      await linkBrokerAccount(accountNumber.trim(), refreshToken.trim(), clientSecret.trim());
      setRefreshToken('');
      setClientSecret('');
      setOk('Cuenta vinculada. El cambio tarda hasta un minuto en tomar efecto (la credencial se cachea 60s).');
      await load();
      onLinked?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'No se pudo vincular la cuenta');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await unlinkBrokerAccount();
      setState(null);
      setConfirmandoUnlink(false);
      setRefreshToken('');
      setClientSecret('');
      setOk(res.wasSystem
        ? 'Cuenta desvinculada. ERA LA CUENTA DE SISTEMA: hasta que se vincule otra y se la marque, los procesos de fondo se quedan sin credencial para pedir datos de mercado.'
        : 'Cuenta desvinculada. El refresh token cifrado se borró de la base.');
      setAccountNumber('');
      await load();
      onLinked?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'No se pudo desvincular la cuenta');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-sm)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Identidad + estado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <KeyRound size={13} style={{ color: ACCENT }} />
        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18,
          color: 'var(--text-primary)', letterSpacing: '0.05em',
        }}>
          Cuenta de bróker
        </span>

        {state?.linked && state.broker && (
          <span style={{
            fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 4, fontFamily: 'var(--font-mono)',
            color: ACCENT, backgroundColor: tint(ACCENT, 13), border: `1px solid ${tint(ACCENT, 30)}`,
          }}>
            {state.broker}
          </span>
        )}

        {state?.isSystem && (
          <span
            title="Es la cuenta con la que los procesos de fondo piden datos de mercado."
            style={{
              fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: 4, fontFamily: 'var(--font-mono)',
              color: '#a78bfa', backgroundColor: tint('#a78bfa', 13), border: `1px solid ${tint('#a78bfa', 30)}`,
            }}
          >
            sistema
          </span>
        )}

        <button
          onClick={load}
          className="btn"
          title="Releer el estado"
          style={{ marginLeft: 'auto' }}
          disabled={loading || saving}
        >
          <RefreshCw size={11} />
          Releer
        </button>
      </div>

      {/* Estado de la conexión, como en Conexiones (Claude Code / Codex) */}
      {!loading && state && (
        <span className={'settings-status' + (conexion === 'ok' ? ' is-good' : '')} role="status">
          <i />
          {!state.linked ? 'Sin cuenta vinculada'
            : conexion === 'ok' ? 'Cuenta conectada'
            : conexion === 'rejected' ? 'Tastytrade rechaza la credencial'
            : conexion === 'unknown' ? 'Vinculada, sin poder comprobar la conexión'
            : 'Comprobando…'}
        </span>
      )}

      {/* Estado actual */}
      <div style={{ fontSize: 15, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        {loading && 'Leyendo…'}
        {!loading && state?.linked && (
          <>
            {state.accountNumber}
            <span style={{ color: 'var(--text-muted)' }}>
              {' · app OAuth: '}
              {state.hasOwnClientSecret ? 'propia' : 'de GaleCore'}
            </span>
            {state.updatedAt && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' · actualizada '}
                {new Date(state.updatedAt).toLocaleString()}
              </span>
            )}
          </>
        )}
      </div>

      <div style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
        El refresh token se guarda cifrado y no vuelve a salir por HTTP. Cargalo cada vez que lo
        rotes en Tastytrade: hasta que lo hagas, la plataforma sigue intentando con el anterior.
        <span style={{ display: 'block', marginTop: 4 }}>
          Si registraste <strong>tu propia aplicación OAuth</strong> en Tastytrade, cargá también su
          client secret: el token y el secret tienen que ser de la MISMA aplicación o Tastytrade
          rechaza la credencial. Dejalo vacío para entrar por la aplicación de GaleCore.
        </span>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label htmlFor="gc-account-number" className="block mb-1" style={labelStyle}>
            Número de cuenta
          </label>
          <input
            id="gc-account-number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={inputStyle}
            disabled={saving || loading}
            // Descriptivo y no un número real: el ejemplo de antes era la cuenta de una persona, y
            // en gris adentro del campo se leía como un valor ya cargado que venía por default.
            placeholder="tu número de cuenta en Tastytrade"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label htmlFor="gc-refresh-token" className="block mb-1" style={labelStyle}>
            Refresh token
          </label>
          <input
            id="gc-refresh-token"
            type="password"
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={inputStyle}
            disabled={saving || loading}
            placeholder="pegar el token nuevo"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label htmlFor="gc-client-secret" className="block mb-1" style={labelStyle}>
            Client secret <span style={{ textTransform: 'none', letterSpacing: 0 }}>(opcional)</span>
          </label>
          <input
            id="gc-client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-mono outline-none"
            style={inputStyle}
            disabled={saving || loading}
            placeholder="solo si usás tu propia aplicación OAuth"
            autoComplete="off"
            spellCheck={false}
          />
          {state?.hasOwnClientSecret && !clientSecret && (
            // Dejarlo vacío BORRA el que está guardado — el POST reemplaza la credencial entera —
            // así que hay que decirlo donde se decide, no en la doc del endpoint.
            <div style={{ fontSize: 14, color: 'var(--yellow-gc)', marginTop: 4, fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>
              Esta cuenta hoy usa tu propia aplicación OAuth. Si guardás con este campo vacío, pasa a
              usar la de GaleCore.
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="text-sm py-2 px-3 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)' }}>
            {error}
          </div>
        )}

        {ok && (
          <div role="status" className="text-sm py-2 px-3 rounded" style={{ backgroundColor: 'var(--green-muted)', color: 'var(--green)' }}>
            {ok}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="py-2 rounded text-sm font-medium"
          style={{
            backgroundColor: canSubmit ? ACCENT : 'var(--bg-tertiary)',
            color: canSubmit ? '#fff' : 'var(--text-muted)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            border: 'none',
          }}
        >
          {saving ? 'Guardando…' : state?.linked ? 'Actualizar token' : 'Vincular cuenta'}
        </button>
      </form>

      {/* Desvincular: solo tiene sentido si hay algo vinculado. Va fuera del <form> para que un
          Enter en los inputs no lo dispare nunca. */}
      {state?.linked && (
        <div style={{ borderTop: '1px solid var(--border-dark)', paddingTop: 10 }}>
          {!confirmandoUnlink ? (
            <button
              onClick={() => setConfirmandoUnlink(true)}
              className="btn"
              title="Borrar la cuenta vinculada y su refresh token cifrado"
              disabled={saving || loading}
            >
              <Unlink size={11} />
              Desvincular
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
                Se borra la cuenta <strong>{state.accountNumber}</strong> y su refresh token cifrado.
                Para volver atrás hay que pegar un token nuevo de Tastytrade.
                {state.isSystem && (
                  <span style={{ color: 'var(--yellow-gc)', display: 'block', marginTop: 4 }}>
                    ⚠ Es la cuenta de sistema: los procesos de fondo se quedan sin credencial para
                    pedir datos de mercado.
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleUnlink}
                  disabled={saving || loading}
                  className="py-1.5 px-3 rounded text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--red-gc)', color: '#fff', border: 'none',
                    cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Desvinculando…' : 'Sí, desvincular'}
                </button>
                <button onClick={() => setConfirmandoUnlink(false)} className="btn" disabled={saving || loading}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
