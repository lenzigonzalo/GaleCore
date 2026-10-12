import { create } from 'zustand';
import { BalancesResponse, PositionResponse } from '../types/api';
import type { AccountFailure, BrokerAccountIssue } from '../api/account';

/**
 * Balances y posiciones de la cuenta de bróker del operador.
 *
 * ES DE LA PERSONA LOGUEADA, no de la plataforma: por eso lo limpia `resetUserScopedStores()` al
 * cerrar sesión, y por eso un error PISA los datos en vez de dejarlos al lado del cartel rojo.
 * Números viejos abajo de un error se leen como vigentes: un operador recién dado de alta, cuyo
 * `Balances` devuelve 500 porque todavía no vinculó su cuenta, veía el número de cuenta y las
 * posiciones del que había usado el tablero antes que él.
 */
interface AccountStore {
  balances: BalancesResponse | null;
  positions: PositionResponse[];
  loadingBalances: boolean;
  loadingPositions: boolean;
  errorPositions: boolean;
  positionsReadAt: Date | null;
  errorBalances: string | null;
  /**
   * El operador no puede leer su cuenta de bróker por algo que él arregla: no la vinculó, o la que
   * vinculó tiene un refresh token que Tastytrade rechaza. Es distinto de un error cualquiera —no
   * hay nada roto del lado de la plataforma— y el Monitor lo usa para mostrar el cartel que
   * corresponde en vez de una pantalla vacía. null = ninguno de los dos.
   */
  brokerAccountIssue: BrokerAccountIssue | null;
  lastUpdate: Date | null;
  setBalances: (b: BalancesResponse) => void;
  setPositions: (p: PositionResponse[]) => void;
  setLoadingBalances: (v: boolean) => void;
  setLoadingPositions: (v: boolean) => void;
  /** El error deja la cuenta en blanco: sin dato es mejor que con el dato de otro. */
  setErrorBalances: (f: AccountFailure | null) => void;
  /** Las posiciones no se pudieron leer: se vacían por el mismo motivo. */
  failPositions: () => void;
  /** Vuelve al estado inicial. La llama `resetUserScopedStores()`. */
  reset: () => void;
}

const EMPTY = {
  balances: null,
  positions: [] as PositionResponse[],
  loadingBalances: false,
  loadingPositions: false,
  errorPositions: false,
  positionsReadAt: null,
  errorBalances: null,
  brokerAccountIssue: null,
  lastUpdate: null,
};

export const useAccountStore = create<AccountStore>((set) => ({
  ...EMPTY,

  // Que los balances lleguen prueba que la cuenta está vinculada Y que su credencial sirve: se
  // limpia la marca, sea cuál sea de las dos que estaba puesta.
  setBalances: (b) => set({ balances: b, lastUpdate: new Date(), errorBalances: null, brokerAccountIssue: null }),
  setPositions: (p) => set({ positions: p, errorPositions: false, positionsReadAt: new Date() }),
  setLoadingBalances: (v) => set({ loadingBalances: v }),
  setLoadingPositions: (v) => set({ loadingPositions: v }),
  setErrorBalances: (f) => set(f
    ? { errorBalances: f.message, brokerAccountIssue: f.brokerAccountIssue, balances: null, lastUpdate: null }
    : { errorBalances: null, brokerAccountIssue: null }),
  failPositions: () => set({ positions: [], errorPositions: true, positionsReadAt: null }),

  reset: () => set({ ...EMPTY }),
}));
