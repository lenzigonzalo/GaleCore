import React from 'react';
import { tint } from '../../utils/formatters';

interface Props {
  /** El nombre, en grande. Por convención arranca con "GaleCore". */
  title: string;
  /** Qué es esa pantalla, en el badge. Sin él se renderiza solo el título. */
  badge?: string;
  /** Color del badge. El violeta es el de las pestañas de estrategia. */
  accent?: string;
  /** Controles que van pegados a la derecha (References, switch, semáforo…). */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Encabezado de pantalla: nombre + badge con lo que es.
 *
 * Existe para que las pestañas se vean como una sola aplicación. El formato nació inline en Rpf y
 * Gex y se copió a mano a Main, donde derivó a un subtítulo en texto plano: dos pantallas del mismo
 * tablero con dos jerarquías visuales distintas. Un componente evita que la próxima pantalla vuelva
 * a elegir su propio estilo.
 *
 * `children` va alineado a la derecha, que es donde las estrategias ponen References y su switch.
 */
export function SectionTitle({ title, badge, accent = '#a3d86c', children, style }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, ...style }}>
      <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>

      {badge && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
          color: accent, backgroundColor: tint(accent, 13), border: `1px solid ${tint(accent, 30)}`,
          fontFamily: 'var(--font-sans)',
        }}>
          {badge}
        </span>
      )}

      {children && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {children}
        </span>
      )}
    </div>
  );
}
