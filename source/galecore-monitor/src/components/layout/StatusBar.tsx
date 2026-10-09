import React, { useEffect, useState } from 'react';
import { fmtTime } from '../../utils/formatters';
import { isAuthUnverified } from '../../utils/authState';
import { ConnectionStatus } from '../../socket/useMarketSocket';

interface Props {
  connectionStatus: ConnectionStatus;
  lastUpdate: Date | null;
}

export function StatusBar({ connectionStatus, lastUpdate }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const isOnline     = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  const systemColor = isOnline ? 'var(--green)' : isConnecting ? 'var(--yellow-gc)' : 'var(--red-gc)';
  const systemLabel = isOnline ? 'Conexión: abierta' : isConnecting ? 'Conexión: abriendo' : 'Conexión: cerrada';

  const lastUpdateStr = lastUpdate ? fmtTime(lastUpdate) : null;

  // Se entró sin poder validar la clave (la API no respondió al login). No es lo mismo que entrar
  // verificado y el tablero no puede mostrarlo igual: si la clave estuviera mal, los endpoints REST
  // van a devolver 401 y las cards se van a ver vacías sin explicación. Esto le da el porqué.
  const authUnverified = isAuthUnverified();

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      height: 40,
      flexShrink: 0,
      backgroundColor: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-dark)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      letterSpacing: '0.04em',
      userSelect: 'none',
    }}>
      {/* Left: empty for balance */}
      <div />

      {/* Right: status + last update + clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {authUnverified && (
          <span
            title="La API no respondió al iniciar sesión, así que la Access Key no se pudo validar. Si es incorrecta, los datos van a venir vacíos con 401."
            style={{
              color: 'var(--yellow-gc)',
              fontWeight: 700,
              border: '1px solid var(--yellow-gc)',
              borderRadius: 3,
              padding: '1px 6px',
            }}
          >
            SIN VALIDAR
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span

            style={{
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: systemColor,
              display: 'inline-block',

            }}
          />
          <span title="Conexión con GaleCore; no confirma recepción ni frescura de precios" style={{ color: systemColor, fontWeight: 600 }}>{systemLabel}</span>
        </div>
        {lastUpdateStr && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
            Cuenta leída <span style={{ color: 'var(--text-secondary)' }}>{lastUpdateStr}</span>
          </span>
        )}
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmtTime(now)} ET</span>
      </div>
    </header>
  );
}
