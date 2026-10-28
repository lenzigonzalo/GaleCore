import React from 'react';
import { StrategyReference } from './StrategyReference';
import { GexReference } from '../gex/GexReference';
import { fetchRpfRulesRaw } from '../../api/rules';
import { fetchGexRules } from '../../api/gex';

/**
 * Registro de References por estrategia — fuente única de verdad de "qué panel de Definiciones y qué
 * JSON abre el modal de cada estrategia". Lo consumen tanto las cards de Main (StrategyCard) como la
 * cabecera de cada pantalla (Rpf, Gex): así el mapeo estrategia → panel vive en un solo lugar y no
 * driftea entre pantallas.
 *
 * La clave es el `id` de la estrategia (el mismo `id` de strategies[] del config). Una estrategia sin
 * entrada acá no ofrece botón References (getStrategyReference devuelve null).
 */
export interface StrategyReferenceConfig {
  accentColor: string;
  /** Panel de la solapa Definiciones. */
  definitions: React.ReactNode;
  /** Trae el JSON de reglas crudo para la solapa Json. */
  fetchJson: () => Promise<any>;
}

const REGISTRY: Record<string, StrategyReferenceConfig> = {
  rpf: { accentColor: '#a78bfa', definitions: <StrategyReference embedded />, fetchJson: fetchRpfRulesRaw },
  gex: { accentColor: '#a78bfa', definitions: <GexReference />, fetchJson: fetchGexRules },
};

export function getStrategyReference(id: string): StrategyReferenceConfig | null {
  return REGISTRY[id] ?? null;
}
