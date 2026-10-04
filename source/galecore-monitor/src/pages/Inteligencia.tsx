import React, { useState } from 'react';
import { SectionTitle } from '../components/common/SectionTitle';
import { RegimeTab } from '../components/inteligencia/RegimeTab';
import { INTELIGENCIA_ACCENT } from '../components/inteligencia/ui';

// Sub-pestañas de la sección. Hoy hay una sola; el tipo queda para que las siguientes (propuestas,
// shadow…) se agreguen acá cuando tengan algo real que mostrar — no se dibujan pestañas vacías.
type SubTab = 'regimen';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'regimen', label: 'Régimen' },
];

/**
 * Inteligencia: lo que GaleCore-AI interpretó, qué pasó después y qué opinó el operador. Es la
 * contracara del resto del tablero (que muestra lo que GaleCore calcula): acá no hay datos en
 * vivo, hay registros evaluables. El análisis se pide desde el host; acá se consulta y se revisa.
 */
export function Inteligencia() {
  const [sub, setSub] = useState<SubTab>('regimen');

  return (
    <div className="flex flex-col">
      <div style={{ padding: '14px 18px 0' }}>
        <SectionTitle title="GaleCore Inteligencia" badge="IA · REGISTROS EVALUABLES" accent={INTELIGENCIA_ACCENT} />
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '10px 18px 0', borderBottom: '1px solid var(--border-dark)' }}>
        {SUB_TABS.map((t) => {
          const active = t.id === sub;
          return (
            <button key={t.id} onClick={() => setSub(t.id)} style={{
              fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: active ? 600 : 400, letterSpacing: '0.04em',
              textTransform: 'uppercase', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: active ? `2px solid ${INTELIGENCIA_ACCENT}` : '2px solid transparent',
            }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {sub === 'regimen' && <RegimeTab />}
    </div>
  );
}
