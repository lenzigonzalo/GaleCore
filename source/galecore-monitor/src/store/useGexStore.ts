import { create } from 'zustand';
import { AdHocSearchConfig, GexAnalysisResponse, GexRules, GexTabDisplayConfig } from '../types/gex';
import { fetchGexAnalysis, fetchGexRules } from '../api/gex';

interface GexCacheEntry {
  data: GexAnalysisResponse;
  updatedAt: Date;
}

/** Saca de los mapas por símbolo todo lo que quedó de los que ya no se muestran. */
function dropSymbols<T>(map: Record<string, T>, symbols: string[]): Record<string, T> {
  if (!symbols.length) return map;
  const next = { ...map };
  symbols.forEach((s) => { delete next[s]; });
  return next;
}

let gexSession = 0;

interface GexStore {
  resetSession: () => void;
  selectedSymbol: string | null;
  setSelectedSymbol: (symbol: string | null) => void;
  /** Reglas propias de la estrategia (universo + contrato de render). */
  rules: GexRules | null;
  tickers: string[];
  display: GexTabDisplayConfig | null;
  rulesLoading: boolean;
  rulesError: string | null;

  /** Config del buscador (`universe.ad_hoc_search`). null = el JSON no lo declara → no hay buscador. */
  adHocSearch: AdHocSearchConfig | null;

  /**
   * Símbolos elegidos con el buscador. NO son parte del universo: se muestran al lado, se barren a
   * mano y no sobreviven a la sesión. El tope lo declara `ad_hoc_search.max_pinned`.
   */
  adHocSymbols: string[];

  cache: Record<string, GexCacheEntry>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;

  /**
   * `code` del error, cuando la API mandó uno. Hoy solo `option_chain_not_found`: el símbolo existe
   * pero no se puede barrer, que es una respuesta y no una falla — la pantalla la dice distinto.
   */
  errorCode: Record<string, string | null>;

  /**
   * Scope elegido por símbolo: una fecha de vencimiento, o `GLOBAL_SCOPE` para el agregado de toda
   * la cadena. null = todavía no eligió → manda el más cercano (0DTE), como declara
   * `display_config.gex_tab.default_expiry`.
   */
  selectedExpiry: Record<string, string | null>;

  // El switch de la estrategia NO vive acá: es el mismo hecho que muestra la card de Main, así que
  // su dueño en el front es `useStrategySwitchStore`, indexado por switch_endpoint.

  loadRules: () => Promise<void>;
  fetchGex: (symbol: string, refresh?: boolean) => Promise<void>;
  selectExpiry: (symbol: string, expiration: string) => void;

  /** Pinea un símbolo del buscador. Devuelve el símbolo normalizado, o null si no se pineó. */
  pinAdHoc: (symbol: string) => string | null;
  unpinAdHoc: (symbol: string) => void;
}

export const useGexStore = create<GexStore>((set, get) => ({
  resetSession: () => {
    gexSession++;
    set({ selectedSymbol:null, adHocSymbols:[], cache:{}, loading:{}, error:{}, errorCode:{}, selectedExpiry:{} });
  },
  selectedSymbol: null,
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
  rules: null,
  tickers: [],
  display: null,
  rulesLoading: true,
  rulesError: null,

  adHocSearch: null,
  adHocSymbols: [],

  cache: {},
  loading: {},
  error: {},
  errorCode: {},
  selectedExpiry: {},

  loadRules: async () => {
    set({ rulesLoading: true, rulesError: null });
    try {
      const rules = await fetchGexRules();
      set({
        rules,
        tickers: rules.universe?.tickers ?? [],
        adHocSearch: rules.universe?.ad_hoc_search ?? null,
        display: rules.display_config?.gex_tab ?? null,
        rulesLoading: false,
      });
    } catch (e: any) {
      set({ rulesLoading: false, rulesError: e.message ?? 'Error cargando reglas de GEX' });
    }
  },

  fetchGex: async (symbol, refresh = false) => {
    // Guarda de reentrada: el barrido de la cadena es caro y el auto-refresh no debe apilarse
    // sobre una llamada en vuelo.
    if (get().loading[symbol]) return;
    const session = gexSession;

    set((s) => ({
      loading: { ...s.loading, [symbol]: true },
      error: { ...s.error, [symbol]: null },
      errorCode: { ...s.errorCode, [symbol]: null },
    }));
    try {
      const data = await fetchGexAnalysis(symbol, refresh);
      if (session !== gexSession) return;
      set((s) => ({
        cache: { ...s.cache, [symbol]: { data, updatedAt: new Date() } },
        loading: { ...s.loading, [symbol]: false },
      }));
    } catch (e: any) {
      // La API distingue el símbolo que no se puede barrer (409 + code) de una caída. Sin leer el
      // cuerpo, los dos se verían igual: "Request failed with status code 409", que no le dice a
      // nadie que el problema es el símbolo que eligió.
      if (session !== gexSession) return;
      const payload = e?.response?.data;
      set((s) => ({
        loading: { ...s.loading, [symbol]: false },
        error: { ...s.error, [symbol]: payload?.error ?? e.message ?? 'Error cargando GEX' },
        errorCode: { ...s.errorCode, [symbol]: payload?.code ?? null },
      }));
    }
  },

  selectExpiry: (symbol, expiration) =>
    set((s) => ({ selectedExpiry: { ...s.selectedExpiry, [symbol]: expiration } })),

  pinAdHoc: (symbol) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return null;

    const { tickers, adHocSymbols, adHocSearch } = get();

    // Ya está en el universo: no se pinea, se selecciona. Pinearlo sería una segunda card del
    // mismo símbolo, con su propio barrido de la misma cadena.
    if (tickers.includes(sym)) return sym;
    if (adHocSymbols.includes(sym)) return sym;

    // El tope sale del JSON. Se guarda una LISTA y se recorta acá, así max_pinned es un valor que
    // se honra de verdad: con un solo string guardado, subirlo en el JSON no cambiaría nada.
    const maxPinned = Math.max(1, adHocSearch?.max_pinned ?? 1);
    const next = [...adHocSymbols, sym].slice(-maxPinned);
    const dropped = adHocSymbols.filter((s) => !next.includes(s));

    // Al desplazado se le tira todo su estado. Sin auto-refresh, dejar su barrido cacheado hace que
    // re-pinearlo muestre números viejos como si fueran de recién.
    set((s) => ({
      adHocSymbols: next,
      cache: dropSymbols(s.cache, dropped),
      loading: dropSymbols(s.loading, dropped),
      error: dropSymbols(s.error, dropped),
      errorCode: dropSymbols(s.errorCode, dropped),
      selectedExpiry: dropSymbols(s.selectedExpiry, dropped),
    }));

    return sym;
  },

  unpinAdHoc: (symbol) => set((s) => ({
    adHocSymbols: s.adHocSymbols.filter((x) => x !== symbol),
    cache: dropSymbols(s.cache, [symbol]),
    loading: dropSymbols(s.loading, [symbol]),
    error: dropSymbols(s.error, [symbol]),
    errorCode: dropSymbols(s.errorCode, [symbol]),
    selectedExpiry: dropSymbols(s.selectedExpiry, [symbol]),
  })),
}));
