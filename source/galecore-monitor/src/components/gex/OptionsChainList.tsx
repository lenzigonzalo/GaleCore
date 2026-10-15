import React from 'react';
import { GexExpiryApi, GLOBAL_SCOPE } from '../../types/gex';
import { fmtExpiry, fmtGex } from '../../utils/formatters';

interface Props {
  expiries: GexExpiryApi[];
  selected: string | null;
  onSelect: (scope: string) => void;
  label?: string;
  /** Net GEX del agregado de toda la cadena — lo que muestra la fila GLOBAL. */
  globalNetGex?: number;
  /** Tope de DTE del barrido, para rotular el alcance de la fila GLOBAL. */
  maxDte?: number;
  /** Etiqueta de la fila GLOBAL (display_config.gex_tab.options_chain.global_row.label). */
  globalLabel?: string;
}

/**
 * Lista de vencimientos de la cadena (0DTE primero). Elegir uno acota el Expiry Engine y el
 * gráfico a ese vencimiento; el cuadro Details sigue mostrando el GEX global.
 *
 * Arriba de todo, fija fuera del scroll, va la fila GLOBAL: lleva el gráfico y el Expiry Engine al
 * agregado de toda la cadena. Va separada y en el violeta del panel, no como un vencimiento más,
 * porque NO es un vencimiento — no tiene fecha, DTE ni expected move.
 */
export function OptionsChainList({
  expiries, selected, onSelect, label = 'Vencimientos',
  globalNetGex, maxDte, globalLabel = 'Todos',
}: Props) {
  const isGlobal = selected === GLOBAL_SCOPE;
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
          fontSize: 16, fontWeight: 600, 
          color: '#a78bfa', fontFamily: 'var(--font-sans)',
        }}>
          {label}
        </span>

        {globalNetGex != null && (
          <button
            onClick={() => onSelect(GLOBAL_SCOPE)}
            title="Agregado de toda la cadena: el mismo GEX que muestra el cuadro Details"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              padding: '3px 5px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              borderLeft: `2px solid ${isGlobal ? '#a78bfa' : 'transparent'}`,
              backgroundColor: isGlobal ? 'var(--bg-secondary)' : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <span className="tabular-nums" style={{
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: '#a78bfa',
              whiteSpace: 'nowrap',
            }}>
              {globalLabel}
            </span>
            <span className="tabular-nums" style={{
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}>
              {maxDte != null ? `≤${maxDte}d · ` : ''}{fmtGex(globalNetGex)}
            </span>
          </button>
        )}

        {!expiries.length ? (
          <span style={{ fontSize: 14, color: 'var(--text-muted)', padding: '4px 0' }}>Sin vencimientos.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 190, overflowY: 'auto' }}>
            {expiries.map((e) => {
              const isActive = e.expiration === selected;
              // Los mensuales (Regular) concentran el OI y son los que anclan el gamma: van en
              // bold y con check. Los diarios/semanales (Weekly) quedan marcados con W.
              const isRegular = e.expirationType === 'Regular';
              return (
                <button
                  key={e.expiration}
                  onClick={() => onSelect(e.expiration)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '3px 5px',
                    border: 'none',
                    borderBottom: '1px solid var(--border-dark)',
                    borderLeft: `2px solid ${isActive ? 'var(--blue-gc)' : 'transparent'}`,
                    backgroundColor: isActive ? 'var(--bg-secondary)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                    <span className="tabular-nums" style={{
                      fontSize: 14,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: isRegular || isActive ? 700 : 400,
                      color: isRegular || isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}>
                      {fmtExpiry(e.expiration)}
                    </span>
                    <span
                      title={isRegular ? 'Regular (mensual)' : 'Weekly'}
                      style={{
                        fontSize: 14,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        color: isRegular ? 'var(--green)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isRegular ? '✓' : 'W'}
                    </span>
                  </span>
                  <span className="tabular-nums" style={{
                    fontSize: 14,
                    fontFamily: 'var(--font-mono)',
                    color: e.dte === 0 ? 'var(--yellow-gc)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    {e.dte === 0 ? '0DTE' : `${e.dte}d`} · {fmtGex(e.netGex)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
