import React, { useEffect } from 'react';
import { useStrategySwitchStore, useSwitchEntry } from '../../store/useStrategySwitchStore';
import { useCanManagePlatform } from '../../store/useCurrentUserStore';
import { tint } from '../../utils/formatters';

interface Props {
  /** `switch_endpoint` de la estrategia. Es la identidad: dos switches con el mismo endpoint son
   *  el mismo switch, aunque estén en pantallas distintas. */
  endpoint: string;
  title?: string;
}

/**
 * Switch de una estrategia (regla de CLAUDE.md: todo lo que corra solo se tiene que poder cortar en
 * el acto desde el front). El estado vive en el backend y persiste, así que el botón no es el dueño
 * de la verdad: lo lee al montar y lo reescribe al togglear.
 *
 * ES GLOBAL: apagar la estrategia la apaga para todos, y por eso el POST es admin-only. A quien no
 * puede, se le muestra el estado pero deshabilitado — dejarlo clickear para cobrar un 403 sería
 * mentirle sobre lo que puede hacer. Ojo: esconder el botón NO es la protección; la protección es
 * el 403 del backend.
 *
 * El componente NO guarda estado propio. Hasta 2026-08-11 recibía `enabled`/`onChange` por props, y
 * cada pantalla traía su propia copia: la card de Main y la pestaña de la estrategia mostraban
 * cosas distintas del mismo switch. Ahora todos leen `useStrategySwitchStore` por endpoint, así que
 * apagar desde cualquier lado se ve en todos lados en el acto.
 *
 * Se llamaba WorkersSwitch y decía "WORKERS ON/OFF" hasta 2026-08-10. El nombre describía la
 * implementación —un BackgroundService que en GEX ni siquiera existe— y no lo que el operador hace
 * con él: apagar la estrategia ENTERA (loop, sockets, refresh y tablero). La etiqueta quedó en solo
 * ON/OFF: qué se apaga lo dice el contexto donde vive el switch.
 */
export function StrategySwitch({ endpoint, title }: Props) {
  const { enabled, busy, error } = useSwitchEntry(endpoint);
  const read = useStrategySwitchStore((s) => s.read);
  const toggle = useStrategySwitchStore((s) => s.toggle);
  const canManage = useCanManagePlatform();

  // El store deduplica: que la card de Main y la pestaña monten a la vez no dispara dos GET.
  useEffect(() => { read(endpoint); }, [endpoint, read]);

  const unknown = enabled == null;
  // `canManage` en null es "todavía no sé": no se decide nada hasta saberlo, y mientras tanto el
  // botón no acepta clicks. Dura lo que tarda un GET al montar el tablero.
  const locked = canManage !== true;
  const color = error ? 'var(--yellow-gc)'
    : unknown ? 'var(--text-muted)'
    : enabled ? 'var(--green)' : 'var(--red-gc)';

  return (
    <button
      onClick={() => toggle(endpoint)}
      disabled={busy || locked}
      title={error
        ? 'El backend no respondio. El estado que se muestra puede no ser el vigente — clickeá para reintentar.'
        : canManage === false
          ? 'Prender o apagar una estrategia afecta a toda la plataforma: es solo para admins.'
          : (title ?? 'Prender / apagar')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '3px 9px', borderRadius: 20,
        backgroundColor: tint(color, 10), border: `1px solid ${tint(color, 30)}`,
        color, cursor: busy || locked ? 'default' : 'pointer',
        fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
        fontFamily: 'JetBrains Mono, monospace', opacity: busy || locked ? 0.6 : 1,
      }}
    >
      {/* Riel del switch */}
      <span style={{
        width: 22, height: 12, borderRadius: 20, flexShrink: 0,
        backgroundColor: tint(color, 30), position: 'relative', transition: 'background-color 150ms',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: enabled ? 12 : 2,
          width: 8, height: 8, borderRadius: '50%', backgroundColor: color,
          transition: 'left 150ms',
        }} />
      </span>
      {unknown ? '—' : enabled ? 'ON' : 'OFF'}{error ? ' ⚠' : ''}
    </button>
  );
}
