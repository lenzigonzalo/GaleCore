import React from 'react';
import { StrategySwitch } from '../common/StrategySwitch';
import { ServiceEntry } from '../../types/api';

interface Props {
  service: ServiceEntry;
}

/**
 * Card de un servicio de plataforma en Main: un proceso que corre solo y no es de ninguna
 * estrategia (hoy SkewSnapshotService).
 *
 * Se parece a StrategyCard pero NO es la misma card, y las diferencias son de fondo:
 *   - no navega a ninguna parte: un servicio no tiene pestaña, solo se prende y se apaga;
 *   - no tiene References: no hay reglas que mostrar, su declaración es su entrada en services[];
 *   - el switch que monta es de plataforma (dos niveles) y solo lo pueden tocar los admin. Al
 *     resto el backend le devuelve 403 y el switch muestra el error sin cambiar de estado.
 *
 * El `name` se muestra a propósito: es el nombre de la clase en el backend, y es lo que hace que
 * un servicio apagado se pueda encontrar en el código y en los logs sin adivinar.
 */
export function ServiceCard({ service }: Props) {
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
        gap: 10,
        minWidth: 260,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13,
          color: 'var(--text-primary)', letterSpacing: '0.04em',
        }}>
          {service.label}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 4,
          color: 'var(--text-muted)', border: '1px solid var(--border)',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          servicio
        </span>
      </div>

      {service.name && (
        <div style={{
          fontSize: 10.5, color: 'var(--text-secondary)',
          fontFamily: 'JetBrains Mono, monospace', marginTop: -4,
        }}>
          {service.name}
        </div>
      )}

      {service.description && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
          {service.description}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 'auto', paddingTop: 4 }}>
        <span style={{ display: 'inline-flex', marginLeft: 'auto' }}>
          <StrategySwitch
            endpoint={service.switch_endpoint}
            title={`Prender / apagar ${service.label}. Es un switch de plataforma: afecta a todos los operadores y solo lo pueden tocar los admin.`}
          />
        </span>
      </div>
    </div>
  );
}
