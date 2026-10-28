import { create } from 'zustand';
import { RpfStateUpdate, TradeSuggestion } from '../types/rpf';

interface RpfStore {
  /** Último estado del loop por símbolo (ReceiveRpfState). */
  states: Record<string, RpfStateUpdate>;
  /** Sugerencia vigente por símbolo (ReceiveTradeSuggestion); null si no hay/expiró. */
  suggestions: Record<string, TradeSuggestion | null>;

  // El switch de la estrategia NO vive acá: es el mismo hecho que muestra la card de Main, así que
  // su dueño en el front es `useStrategySwitchStore`, indexado por switch_endpoint.

  applyState: (symbol: string, update: RpfStateUpdate) => void;
  applySuggestion: (symbol: string, suggestion: TradeSuggestion) => void;
  clearSuggestion: (symbol: string) => void;
  /** Vacía el tablero. Lo llama la pantalla cuando la estrategia pasa a OFF. */
  clear: () => void;
}

const EMPTY = { states: {}, suggestions: {} };

export const useRpfStore = create<RpfStore>((set) => ({
  ...EMPTY,

  applyState: (symbol, update) =>
    set((s) => {
      // Un cambio de estado que no sea TRIGGERED invalida la sugerencia vigente.
      const dropSuggestion = update.state !== 'TRIGGERED';
      return {
        states: { ...s.states, [symbol]: update },
        suggestions: dropSuggestion ? { ...s.suggestions, [symbol]: null } : s.suggestions,
      };
    }),

  applySuggestion: (symbol, suggestion) =>
    set((s) => ({ suggestions: { ...s.suggestions, [symbol]: suggestion } })),

  clearSuggestion: (symbol) =>
    set((s) => ({ suggestions: { ...s.suggestions, [symbol]: null } })),

  // Apagar la estrategia deja el tablero como recién abierto: con el loop inerte nadie actualiza el
  // estado, y dejarlo en pantalla haría pasar datos congelados por vigentes.
  clear: () => set({ ...EMPTY }),
}));
