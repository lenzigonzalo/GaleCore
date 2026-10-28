import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { StrategySwitch } from '../common/StrategySwitch';
import { ReferencesModal } from '../common/ReferencesModal';
import { getStrategyReference } from '../strategy/strategyReferences';
import { StrategyEntry } from '../../types/api';
import { tint } from '../../utils/formatters';

interface Props {
  strategy: StrategyEntry;
  onOpen: () => void;
}

const KIND_COLOR: Record<string, string> = {
  operativa: '#a78bfa',
  informativa: 'var(--blue-gc)',
};

/**
 * Card de una estrategia implementada en Main. Muestra qué es y si está corriendo.
 *
 * La card entera es clickeable y lleva a la pestaña de la estrategia (`onOpen`). Los controles de
 * adentro (switch de la estrategia, botón References) cortan la propagación para no navegar al usarlos.
 *
 * El estado que reporta es el del switch de la estrategia, que es lo único que la plataforma sabe de
 * una estrategia sin conocer su lógica interna: si sus procesos están prendidos o apagados.
 * El switch escribe en el backend de la propia estrategia (`switch_endpoint` del config), así
 * que apagar desde acá corta lo mismo que apagar desde su pestaña — y como el estado es compartido
 * (`useStrategySwitchStore`, indexado por ese mismo endpoint), apagar desde la pestaña se ve acá
 * en el acto. Antes esta card tenía su propio `useState`, leído una sola vez al montar; como Main
 * nunca se desmonta, mostraba el estado del arranque hasta recargar la página.
 */
export function StrategyCard({ strategy, onOpen }: Props) {
  const [refOpen, setRefOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const accent = KIND_COLOR[strategy.kind ?? ''] ?? 'var(--text-muted)';
  const ref = getStrategyReference(strategy.id);

  // Evita que un click en un control interno navegue a la pestaña.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`Abrir ${strategy.label}`}
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: `1px solid ${hover ? tint(accent, 45) : 'var(--border)'}`,
        borderRadius: 10,
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 260,
        cursor: 'pointer',
        transition: 'border-color 120ms, box-shadow 120ms',
      }}
    >
      {/* Identidad */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16,
          color: 'var(--text-primary)', letterSpacing: '0.05em',
        }}>
          {strategy.label}
        </span>
        {strategy.kind && (
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 4,
            color: accent, backgroundColor: tint(accent, 13), border: `1px solid ${tint(accent, 30)}`,
            fontFamily: 'var(--font-mono)',
          }}>
            {strategy.kind}
          </span>
        )}
      </div>

      {strategy.name && (
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', marginTop: -6 }}>
          {strategy.name}
        </div>
      )}

      {strategy.description && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
          {strategy.description}
        </div>
      )}

      {/* References (izquierda) + estado (derecha) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 4 }}>
        {ref && (
          <button
            onClick={(e) => { stop(e); setRefOpen(true); }}
            className="btn"
            title={`Definiciones de ${strategy.label} + JSON de reglas`}
          >
            <BookOpen size={11} />
            References
          </button>
        )}
        <span onClick={stop} style={{ display: 'inline-flex', marginLeft: 'auto' }}>
          <StrategySwitch
            endpoint={strategy.switch_endpoint}
            title={`Prender / apagar la estrategia ${strategy.label}. Afecta a todos los operadores y solo lo pueden tocar los admin.`}
          />
        </span>
      </div>

      {ref && (
        <span onClick={stop}>
          <ReferencesModal
            open={refOpen}
            onClose={() => setRefOpen(false)}
            title={`${strategy.label} · Referencias`}
            accentColor={ref.accentColor}
            definitions={ref.definitions}
            fetchJson={ref.fetchJson}
          />
        </span>
      )}
    </div>
  );
}
