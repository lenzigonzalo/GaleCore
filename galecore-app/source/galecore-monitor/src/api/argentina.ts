import apiClient from './client';

/** Tablero Argentina (WS-0095): `GET /App/Macro/Argentina`. Cada bloque trae su fuente y la fecha de su último dato. */
export interface ArgentinaPoint { fecha: string; valor: number }
export interface ArgentinaSeriesItem {
  id: string; name: string; unit: string; ok: boolean; error: string | null; source: string | null;
  last: number | null; date: string | null; changeAbs: number | null; changePct: number | null; series: ArgentinaPoint[];
}
export interface ArgentinaDolar {
  casa: string; nombre: string; compra: number | null; venta: number | null; brechaPct: number | null;
  fechaActualizacion: string; varDiariaPct: number | null; varDiariaContra: string | null; serie: ArgentinaPoint[];
}
export interface ArgentinaLetra {
  ticker: string; precio: number | null; tnaPct: number | null; teaPct: number | null; temPct: number | null;
  vencimiento: string | null; dias: number | null; variacionPct: number | null;
}
export interface ArgentinaFuturo {
  ticker: string; ultimo: number | null; ajuste: number | null; variacionPct: number | null; interesAbierto: number | null;
  vencimiento: string | null; dias: number | null; devaluacionPct: number | null; tnaPct: number | null; teaPct: number | null;
}
export interface ArgentinaBlock<T = unknown> {
  id: string; ok: boolean; error: string | null; source: string | null; asOf: string | null; notes: string[]; data: T | null;
}
export interface ArgentinaBoard {
  asOf: string;
  blocks: {
    dolares?: ArgentinaBlock<ArgentinaDolar[]>;
    riesgoPais?: ArgentinaBlock<ArgentinaSeriesItem>;
    inflacion?: ArgentinaBlock<{ mensual: ArgentinaSeriesItem; interanual: ArgentinaSeriesItem; rem: ArgentinaSeriesItem }>;
    curvaPesos?: ArgentinaBlock<ArgentinaLetra[]>;
    reservas?: ArgentinaBlock<ArgentinaSeriesItem>;
    baseMonetaria?: ArgentinaBlock<ArgentinaSeriesItem>;
    tasas?: ArgentinaBlock<ArgentinaSeriesItem[]>;
    balanza?: ArgentinaBlock<ArgentinaSeriesItem[]>;
    futurosDolar?: ArgentinaBlock<{ referencia: { a3500: number | null; a3500Fecha: string | null; mtr: number | null; mtrFecha: string | null }; contratos: ArgentinaFuturo[] }>;
    agro?: ArgentinaBlock<{ referencia: unknown; contratos: ArgentinaFuturo[] }>;
  };
}

export async function fetchArgentinaBoard(signal?: AbortSignal): Promise<ArgentinaBoard> {
  const { data } = await apiClient.get<ArgentinaBoard>('/App/Macro/Argentina', { signal, timeout: 90_000 });
  return data;
}
