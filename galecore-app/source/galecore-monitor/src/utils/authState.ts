/**
 * Marca de "entré sin que la clave se pudiera validar".
 *
 * La pone LoginScreen cuando la API no responde (caída, timeout, CORS) — un caso distinto de que la
 * API responda 401, que es un rechazo y no deja entrar. Se entra igual porque dejar al operador
 * afuera cuando el backend no contesta le impide hasta abrir el tablero para ver que no contesta.
 *
 * Pero entrar sin verificación no puede verse igual que entrar verificado: la StatusBar lo muestra.
 * Vive acá y no en LoginScreen para que la barra no tenga que importar de la pantalla de login.
 */
export const AUTH_UNVERIFIED = 'galecore:authUnverified';

export function isAuthUnverified(): boolean {
  return sessionStorage.getItem(AUTH_UNVERIFIED) === '1';
}
