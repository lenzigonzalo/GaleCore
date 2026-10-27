import { create } from 'zustand';
import { AppConfig, ServiceEntry, StrategyEntry } from '../types/api';

/**
 * Configuración de la aplicación, leída de /App/GaleCore/Rules/Core.
 * De acá salen: el universo que se streamea por SignalR, las cards de estrategias de Main y los
 * umbrales de gestión que muestra Monitor. No contiene reglas de trading — eso vive en el JSON
 * de cada estrategia.
 */
interface AppConfigStore {
  config: AppConfig | null;
  /** Universo de la plataforma. Alimenta el Subscribe del hub. */
  tickers: string[];
  strategies: StrategyEntry[];
  /** Procesos de plataforma con switch propio. Vacío hasta que llega el config. */
  services: ServiceEntry[];
  loading: boolean;
  error: string | null;
  setConfig: (c: AppConfig) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useAppConfigStore = create<AppConfigStore>((set) => ({
  config: null,
  tickers: [],
  strategies: [],
  services: [],
  loading: true,
  error: null,

  setConfig: (c) => set({
    config: c,
    tickers: c.universe?.tickers ?? [],
    strategies: c.strategies ?? [],
    services: c.services ?? [],
    error: null,
  }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}));

/**
 * `switch_endpoint` que declara una estrategia en el config. La pantalla de la estrategia lo
 * resuelve por acá y no con una constante propia: si la hardcodeara, la card de Main (que sí lee
 * el config) y su pestaña podrían terminar apuntando a endpoints distintos — o sea, dos switches
 * en vez de uno, que es justo lo que este store compartido vino a arreglar.
 * `fallback` cubre el arranque, cuando el config todavía no llegó.
 */
export const useSwitchEndpoint = (id: string, fallback: string): string =>
  useAppConfigStore((s) => s.strategies.find((x) => x.id === id)?.switch_endpoint ?? fallback);
