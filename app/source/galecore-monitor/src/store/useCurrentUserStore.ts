import { create } from 'zustand';
import { CurrentUser, fetchCurrentUser } from '../api/me';

/**
 * Quién está logueado y qué le deja hacer la plataforma.
 *
 * Existe para que el tablero no muestre habilitado lo que la API va a rechazar: el switch de una
 * estrategia es global y admin-only, así que a un no-admin hay que mostrárselo deshabilitado en vez
 * de dejarlo clickear para cobrar un 403.
 *
 * Se lee al montar el tablero. No hay refresh: el rol de un usuario no cambia mientras usa la app,
 * y si cambia, vuelve a entrar.
 *
 * NO HAY UN `load` IDEMPOTENTE, y es a propósito. Lo hubo: leía una sola vez y se iba si ya estaba
 * cargado. Pero el store es de módulo y sobrevive al logout —que solo desmonta el tablero—, así que
 * cuando alguien salía y entraba con OTRA cuenta sin recargar la página, se iba sin preguntar y
 * dejaba al usuario anterior en memoria: un no-admin entrando después de un admin veía la pestaña
 * Admin y los switches habilitados. Se pide de nuevo en cada montaje del tablero, que es una vez
 * por login, y `reset` limpia al salir.
 */
interface CurrentUserStore {
  user: CurrentUser | null;
  /** null = todavía no se sabe. No es lo mismo que "no puede": mientras carga no se decide nada. */
  loaded: boolean;
  /** Pregunta quién está logueado. La llama el tablero al montar. */
  reload: () => Promise<void>;
  /** Olvida quién estaba. Se llama al cerrar sesión, para que no quede nada del usuario anterior. */
  reset: () => void;
}

export const useCurrentUserStore = create<CurrentUserStore>((set) => {
  const fetch = async () => {
    try {
      set({ user: await fetchCurrentUser(), loaded: true });
    } catch {
      // Sin respuesta no se asume permiso: el botón queda deshabilitado y la API sigue siendo la
      // que decide. Fallar hacia "no puede" es lo correcto para un permiso.
      set({ user: null, loaded: true });
    }
  };

  return {
    user: null,
    loaded: false,

    reload: fetch,

    reset: () => set({ user: null, loaded: false }),
  };
});

/**
 * ¿Puede tocar los kill switch? `null` mientras no se sepa, para que la UI pueda distinguir
 * "cargando" de "no puede" y no parpadee un botón deshabilitado a quien sí es admin.
 */
export const useCanManagePlatform = (): boolean | null =>
  useCurrentUserStore((s) => (s.loaded ? (s.user?.canManagePlatform ?? false) : null));
