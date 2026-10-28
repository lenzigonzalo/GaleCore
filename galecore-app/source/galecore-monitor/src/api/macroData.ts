import apiClient from './client';
import type { MacroSnapshot } from '../types/macroTypes';

export async function fetchMacro(horizon: string, region: string, signal: AbortSignal, snapshotId?: string): Promise<MacroSnapshot> {
  const { data } = await apiClient.get<MacroSnapshot>(snapshotId ? `/App/Macro/Snapshots/${snapshotId}` : '/App/Macro/Snapshot',
    { params: snapshotId ? undefined : { horizon, region, currency: 'Local' }, signal, timeout: 20000 });
  return data;
}

/** Panel de mercados (WS-0036): franja, tabla por clase de activo, curva y agenda; todo calculado en la API. */
export interface BoardPoint { date: string; value: number }
export interface BoardRow {
  id: string; name: string; symbol: string; unit: string; changeUnit: '%' | 'pb' | 'pts' | string;
  last: number | null; changeDay: number | null; changeWeek: number | null; changeMonth: number | null;
  asOf: string | null; source: string; spark: BoardPoint[];
  /** Sólo en «quién mueve el S&P»: valor de mercado sumado en el mes, USD. */
  valueAddedMonth?: number | null;
}
export interface BoardSection { question: string; detailTab?: string | null; groups: { name: string; rows: BoardRow[] }[] }
export interface BoardTab { id: string; name: string; sections: BoardSection[] }
export interface MacroBoard {
  asOf: string; strip: BoardRow[];
  /** Resumen primero y después el detalle; cada pestaña, una sección por pregunta con sus grupos. */
  tabs: BoardTab[];
  curve: { date: string; points: { tenor: string; value: number }[] } | null;
  events: { date: string; name: string }[]; missing: string[];
}

export async function fetchMacroBoard(signal?: AbortSignal): Promise<MacroBoard> {
  const { data } = await apiClient.get<MacroBoard>('/App/Macro/Board', { signal, timeout: 45_000 });
  return data;
}
