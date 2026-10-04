import React from 'react';
import { GexExpiryApi, GexScopeApi } from '../../types/gex';
import { fmtExpiry, fmtGex, fmtPrice } from '../../utils/formatters';

/**
 * Qué está mirando el panel. Es una unión y no dos props opcionales para que no exista el estado
 * imposible "un vencimiento Y el agregado": el scope elegido es uno solo.
 */
export type ExpiryScope =
  | { kind: 'expiry'; expiry: GexExpiryApi | null }
  | { kind: 'global'; global: GexScopeApi; maxDte: number | null };

interface Props {
  scope: ExpiryScope;
  label?: string;
}

// Misma fila que StrikesEnginePanel — el Expiry Engine es ese cuadro sin las filas de estructura
// (estructura, short put, short call, dentro de muros): acá no hay operación que armar.
function ListRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      title={hint}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '2px 0',
        borderBottom: '1px solid var(--border-dark)',
      }}
    >
      <span style={{
        fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)',
        fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em',
      }}>
        {label}
      </span>
      <span className="tabular-nums" style={{
        fontSize: 16,
        color: 'var(--text-secondary)',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 600,
      }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Lectura numérica del scope seleccionado: es lo que dibuja el gráfico de barras, en números.
 *
 * **La banda de gamma NO tiene fila acá, y es deliberado.** El muro y la banda se reparten el
 * trabajo: el muro es el nivel con nombre y valor —contesta "qué número"— y la banda es contexto
 * visual que solo se sombrea en los gráficos —contesta "qué tan ancha es la concentración
 * alrededor"—. Son dos objetos sobre el mismo eje de precio, así que ponerlos los dos como texto
 * duplica la lectura sin agregar nada. Lo declara `expiry_engine._rows_note` del JSON.
 *
 * En `expiry` todos los valores son de ESE vencimiento, no del agregado. En `global` son del
 * agregado de toda la cadena — el mismo número que el cuadro Details.
 */
export function ExpiryEngine({ scope, label = 'Expiry Engine' }: Props) {
  if (scope.kind === 'global') return <GlobalRows scope={scope} label={label} />;
  const { expiry } = scope;

  return (
    <Panel label={label}>
      <ListRow label="Vencimiento" value={expiry ? fmtExpiry(expiry.expiration) : '—'} />
      <ListRow label="DTE" value={expiry ? `${expiry.dte}` : '—'} />
      <ListRow label="Net GEX" value={expiry ? fmtGex(expiry.netGex) : '—'} />
      <ListRow label="ZGL" value={expiry?.gammaZeroLevel != null ? fmtPrice(expiry.gammaZeroLevel, 0) : '—'} />
      <ListRow label="Call Wall" value={expiry?.callWall != null ? fmtPrice(expiry.callWall, 0) : '—'} />
      <ListRow label="Put Wall" value={expiry?.putWall != null ? fmtPrice(expiry.putWall, 0) : '—'} />
      <ListRow
        label="Expected Move"
        value={expiry?.expectedMove != null ? `±${fmtPrice(expiry.expectedMove, 1)} pts` : '—'}
      />
    </Panel>
  );
}

/**
 * Modo global: las mismas filas leídas del agregado. ZGL y muros los calcula el backend sobre los
 * strikes agregados, así que salen tal cual — el argmax de un muro no necesita expected move.
 *
 * Dos diferencias deliberadas, ambas declaradas en `expiry_engine.global_rows` del JSON:
 * - **Expected Move va vacío.** Es `spot × atmIv × √t` y el agregado no tiene un `t`: no es un dato
 *   que falte, es una fórmula que no está definida para este scope. Rellenarlo con el del
 *   vencimiento más cercano pondría un número de otro scope donde se lee como si fuera de éste.
 * - **Vencimiento y DTE se reemplazan** por hechos que sí son del agregado: el alcance del barrido
 *   y cuántos vencimientos entraron — que además deja a la vista si el barrido vino corto.
 *
 * Lo que no se ve acá pero sí cambia: **el gráfico no pinta el sombreado de la banda en global**,
 * por lo mismo que el EM va vacío — su ancho es una fracción del EM. No es una fila vacía, es que
 * no se dibuja nada.
 */
function GlobalRows({
  scope, label,
}: { scope: Extract<ExpiryScope, { kind: 'global' }>; label: string }) {
  const { global: g, maxDte } = scope;
  const partial = g.expirationsRequested > g.expirationsIncluded;

  return (
    <Panel label={label}>
      <ListRow label="Vencimiento" value="Cadena completa" />
      <ListRow label="DTE" value={maxDte != null ? `≤ ${maxDte}` : '—'} />
      <ListRow
        label="Vencimientos"
        value={`${g.expirationsIncluded}${partial ? ` / ${g.expirationsRequested}` : ''}`}
        hint={partial
          ? 'Faltan vencimientos en el agregado: el GEX da más chico que el real'
          : 'Vencimientos incluidos en el agregado'}
      />
      <ListRow label="Net GEX" value={fmtGex(g.netGex)} />
      <ListRow label="ZGL" value={g.gammaZeroLevel != null ? fmtPrice(g.gammaZeroLevel, 0) : '—'} />
      <ListRow label="Call Wall" value={g.callWall != null ? fmtPrice(g.callWall, 0) : '—'} />
      <ListRow label="Put Wall" value={g.putWall != null ? fmtPrice(g.putWall, 0) : '—'} />
      <ListRow
        label="Expected Move"
        value="—"
        hint="No está definido para el agregado: el expected move necesita un vencimiento (spot × IV ATM × √t)"
      />
    </Panel>
  );
}

/** Chrome del panel, compartido por los dos modos. */
function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
          color: '#a78bfa', fontFamily: 'var(--font-sans)',
        }}>
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}
