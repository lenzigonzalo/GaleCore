import apiClient from './client';

/**
 * Quién es el portador del token, según la API.
 *
 * `canManagePlatform` es lo único que el tablero necesita para decidir qué muestra habilitado, y
 * NO es lo mismo que `isAdmin`: sin base configurada no hay permisos que consultar y la API se
 * comporta como antes de que la base existiera, así que deja pasar. La regla la resuelve el
 * backend (`CanManagePlatformAsync`), que es el mismo que aplica el 403 — si el front la
 * reimplementara, la UI y la API podrían contradecirse y el operador vería un botón que no anda.
 */
export interface CurrentUser {
  userId: string | null;
  email: string | null;
  /**
   * Con lo que entró al tablero. Sale de la tabla `users`, NO del token: Supabase Auth no conoce
   * el username — solo el mail. Es null sin base configurada.
   */
  username: string | null;
  /** La verdad cruda de la tabla `users`: false sin base, sin fila o si la consulta falla. */
  isAdmin: boolean;
  /** El permiso EFECTIVO para tocar los kill switch de estrategias y servicios. */
  canManagePlatform: boolean;
  databaseConfigured: boolean;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await apiClient.get<CurrentUser>('/App/GaleCore/Me');
  return data;
}
