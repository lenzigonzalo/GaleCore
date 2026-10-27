import { create } from 'zustand';
import { fetchStrategySwitch, setStrategySwitch } from '../api/strategies';

/**
 * Estado del switch de UNA estrategia, tal como lo ve el front.
 * `enabled` en null es "todavía no lo leí", que no es lo mismo que apagado: el switch queda inerte
 * y las pantallas no se vacían hasta saber.
 */
export interface SwitchEntry {
  enabled: boolean | null;
  /** Qué nivel decidió el `enabled` según el backend: el kill switch de plataforma o el JSON de
   *  reglas de la estrategia. Ver StrategySwitchState. */
  source: 'platform' | 'rules' | null;
  /** Hay una lectura o una escritura en vuelo contra el backend. */
  busy: boolean;
  /** La última llamada falló: lo que se muestra puede no ser lo vigente. */
  error: boolean;
}

/** Entrada de un endpoint que nadie leyó todavía. Es una constante a propósito: los selectores la
 *  devuelven por identidad, y un objeto nuevo en cada render haría rerenderizar sin fin. */
const UNKNOWN: SwitchEntry = { enabled: null, source: null, busy: false, error: false };

interface StrategySwitchStore {
  /** Indexado por `switch_endpoint`, que es la identidad de la estrategia para el switch. */
  byEndpoint: Record<string, SwitchEntry>;

  /** Lee el estado del backend. Reentrante: si ya hay una llamada en vuelo, no apila otra. */
  read: (endpoint: string) => Promise<void>;
  /** Togglea contra el backend. Con el estado desconocido, primero lo lee. */
  toggle: (endpoint: string) => Promise<void>;
  /** Aplica un estado que llegó por fuera del front (el evento ReceiveRpfSwitch del hub). */
  apply: (endpoint: string, enabled: boolean) => void;
}

/**
 * Dueño único del estado de los switches de estrategia en el front.
 *
 * Hasta 2026-08-11 el mismo hecho vivía en tres lugares que no se avisaban entre sí: el `useState`
 * de `StrategyCard`, `useGexStore.switchEnabled` y `useRpfStore.switchEnabled`. Como Main nunca se
 * desmonta (`App.tsx` renderiza todas las pestañas con `display:none`), su card leía el estado al
 * arrancar la app y no volvía a preguntar nunca: prender una estrategia desde su pestaña dejaba la
 * card de Main mostrando OFF hasta recargar la página.
 *
 * El dueño real del dato es el backend (`GET/POST <switch_endpoint>`, persistido en
 * `Files/<Prefijo>/<prefijo>_switch_state.json`). Este store es la única caché del front, así que
 * todos los que muestran o cambian el switch leen y escriben el mismo lugar.
 *
 * El switch es GLOBAL: lo que se lee acá no depende de quién esté logueado. Quién puede ESCRIBIRLO
 * sí — es admin-only, y eso lo resuelve `useCurrentUserStore.canManagePlatform`.
 */
export const useStrategySwitchStore = create<StrategySwitchStore>((set, get) => {
  const patch = (endpoint: string, p: Partial<SwitchEntry>) =>
    set((s) => ({
      byEndpoint: { ...s.byEndpoint, [endpoint]: { ...(s.byEndpoint[endpoint] ?? UNKNOWN), ...p } },
    }));

  const read = async (endpoint: string) => {
    if (get().byEndpoint[endpoint]?.busy) return;
    patch(endpoint, { busy: true });
    try {
      const s = await fetchStrategySwitch(endpoint);
      patch(endpoint, { enabled: s.enabled, source: s.source, error: false, busy: false });
    } catch {
      patch(endpoint, { error: true, busy: false });
    }
  };

  return {
    byEndpoint: {},

    read,

    // Un fallo NO deja el switch muerto: con el estado desconocido el click reintenta leerlo, y con
    // estado conocido togglea. Un POST que falla una vez (p. ej. el broadcast del backend colgado)
    // no puede matar el kill switch hasta recargar la página.
    toggle: async (endpoint) => {
      const entry = get().byEndpoint[endpoint] ?? UNKNOWN;
      if (entry.busy) return;
      if (entry.enabled == null) { await read(endpoint); return; }

      patch(endpoint, { busy: true });
      try {
        const s = await setStrategySwitch(endpoint, !entry.enabled);
        patch(endpoint, { enabled: s.enabled, source: s.source, error: false, busy: false });
      } catch {
        patch(endpoint, { error: true, busy: false });
      }
    },

    apply: (endpoint, enabled) => patch(endpoint, { enabled, error: false }),
  };
});

/** Estado de un endpoint. Devuelve `UNKNOWN` mientras nadie lo haya leído. */
export const useSwitchEntry = (endpoint: string): SwitchEntry =>
  useStrategySwitchStore((s) => s.byEndpoint[endpoint] ?? UNKNOWN);

/** Atajo para las pantallas, que solo miran si la estrategia está prendida. */
export const useSwitchEnabled = (endpoint: string): boolean | null =>
  useStrategySwitchStore((s) => (s.byEndpoint[endpoint] ?? UNKNOWN).enabled);
