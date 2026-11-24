import apiClient from './client';

export type BrokerStatus = 'ok' | 'partial' | 'error' | 'missing' | 'invalid' | 'excluded' | 'soon';
export interface PortfolioBroker { id: string; name: string; status: BrokerStatus; message?: string | null; source?: string | null; asOf?: string | null; reportDate?: string | null; isClose: boolean; totalUsd?: number | null; warnings: string[] }
export interface PortfolioPosition { broker: string; account?: string | null; symbol: string; description?: string | null; type?: string | null; quantity?: number | null; averageCost?: number | null; lastPrice?: number | null; marketValue?: number | null; currency?: string | null; marketValueUsd?: number | null; pnl?: number | null; pnlUsd?: number | null }
export interface PortfolioCash { broker: string; account?: string | null; currency: string; amount?: number | null; amountUsd?: number | null }
export interface PortfolioFx { pair: string; name: string; casa?: string | null; rate: number; asOf?: string | null; source?: string | null }
export interface ConsolidatedPortfolio { asOf: string; baseCurrency: string; fx?: PortfolioFx | null; totalUsd?: number | null; brokers: PortfolioBroker[]; positions: PortfolioPosition[]; cash: PortfolioCash[]; notes: string[] }

/** Consulta a los brokers: tarda unos segundos. */
export async function fetchConsolidatedPortfolio(): Promise<ConsolidatedPortfolio> {
  const { data } = await apiClient.get<ConsolidatedPortfolio>('/Data/Portfolio/Consolidated', { timeout: 60_000 });
  return { ...data, brokers: data.brokers ?? [], positions: data.positions ?? [], cash: data.cash ?? [], notes: data.notes ?? [] };
}
