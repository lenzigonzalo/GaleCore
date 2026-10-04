import React from 'react';
import { tint } from '../../utils/formatters';

interface Props {
  /** Qué pasa, en dos palabras. Va en el color del panel. */
  title: string;
  /** El detalle concreto: qué no está corriendo o qué falta. Genérico no sirve. */
  detail: string;
  /** Qué hacer para salir de este estado. Sin esto el cartel informa pero no resuelve. */
  hint?: string;
  /** El ícono de la izquierda, ya dimensionado por el llamador. */
  icon: React.ReactNode;
  /** El color del borde, el fondo y el título. */
  color: string;
}

/**
 * El cartel que reemplaza a una pantalla que no tiene nada válido para mostrar.
 *
 * ES UN FORMATO, no un mensaje: nació como `StrategyOffPanel` para las estrategias en OFF y se
 * generalizó cuando el Monitor necesitó decir lo mismo por otro motivo (sin cuenta de bróker no hay
 * posiciones que monitorear). Que los dos casos se vean igual es el punto — el operador aprende una
 * sola forma de "acá no hay nada y este es el motivo".
 *
 * La regla que los dos comparten: cuando no hay dato válido, la pantalla se reduce a este cartel en
 * vez de dejar números viejos a la vista. Un panel lleno de números se lee como vigente aunque diga
 * que no lo está.
 */
export function NoticePanel({ title, detail, hint, icon, color }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      margin: '16px 0', padding: '18px 20px', borderRadius: 10,
      backgroundColor: tint(color, 6), border: `1px dashed ${tint(color, 30)}`,
    }}>
      <span style={{ color, flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 4, fontFamily: 'var(--font-sans)' }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
          {detail}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-sans)' }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
