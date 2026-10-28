import apiClient from './client';

/**
 * Exposición de SHADOW calculada por la API (`/App/Runtime/Exposure`): riesgo abierto, % del capital de referencia,
 * lo que queda para riesgo nuevo y las apuestas (mismo subyacente, dirección y semana de vencimiento). El front no
 * suma ni compara: sólo muestra lo que viene. Los límites salen del perfil del trader (espacio `profile/perfil`).
 */

export interface Bet {
  key: string; symbol: string | null; direction: string | null; positions: number; maxRisk: number;
  pctOfCapital: number; expirations: string[]; positionIds: string[];
}
export interface Exposure {
  asOf: string;
  limits: { capital: number; maxOpenRiskUsd: number; maxBetUsd: number; reserveUsd: number; maxRiskPerTradeUsd: number };
  positionsOpen: number; openMaxRisk: number; openRiskPctOfCapital: number; unrealizedPnl: number;
  availableForNewRiskUsd: number; openNotValued: number;
  bets: Bet[]; byStrategy: Bet[];
}
export interface ProfileLimits {
  capital: number; maxRiskPerTradePct: number; maxOpenRiskPct: number; reservePct: number; maxBetPct: number;
}

/** Misma lectura que hace GaleCore-AI: el capital de referencia y, en cada línea de límites, el primer porcentaje. */
export function limitsFromProfile(content: string): ProfileLimits | null {
  let doc: { reference_capital?: { amount?: number }; risk_limits?: string[] };
  try { doc = JSON.parse(content); } catch { return null; }
  const capital = doc.reference_capital?.amount;
  const lines = doc.risk_limits ?? [];
  const pct = (keyword: string) => {
    const line = lines.find((l) => l.toLowerCase().includes(keyword));
    const m = line?.match(/(\d+(?:[.,]\d+)?)\s*%/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  };
  const maxRiskPerTradePct = pct('por operaci');
  const maxOpenRiskPct = pct('sumado');
  const reservePct = pct('reserva');
  const maxBetPct = pct('apuesta');
  if (!capital || maxRiskPerTradePct == null || maxOpenRiskPct == null || reservePct == null || maxBetPct == null) return null;
  return { capital, maxRiskPerTradePct, maxOpenRiskPct, reservePct, maxBetPct };
}

export async function fetchExposure(l: ProfileLimits): Promise<Exposure> {
  const { data } = await apiClient.get<Exposure>('/App/Runtime/Exposure', {
    params: { capital: l.capital, maxRiskPerTradePct: l.maxRiskPerTradePct, maxOpenRiskPct: l.maxOpenRiskPct,
      reservePct: l.reservePct, maxBetPct: l.maxBetPct },
    timeout: 45_000,
  });
  return data;
}
