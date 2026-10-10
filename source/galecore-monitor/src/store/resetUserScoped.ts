import { useGexStore } from './useGexStore';
import { useAccountStore } from './useAccountStore';
import { useCurrentUserStore } from './useCurrentUserStore';

/**
 * Borra todo lo que pertenece a la persona logueada.
 *
 * LOS STORES SON DE MÓDULO Y SOBREVIVEN AL LOGOUT, que solo desmonta el tablero. Sin esta limpieza,
 * lo del que se va sigue en memoria cuando entra el siguiente, y lo que falle al refrescar deja lo
 * viejo a la vista: un operador vio el número de cuenta y las posiciones del anterior, porque su
 * `Balances` devolvió 500 —todavía no tenía cuenta vinculada— y el error no pisaba los datos.
 *
 * ACÁ VAN LOS STORES DE USUARIO, no todos. Precios, config de la app y switches son de la
 * plataforma: son los mismos para cualquiera que entre y volver a pedirlos no arregla nada.
 *
 * Cuando aparezca otro store con datos de la persona, se agrega acá. Es el único lugar que sabe
 * qué es de quién.
 */
export function resetUserScopedStores() {
  useCurrentUserStore.getState().reset();
  useAccountStore.getState().reset();
  useGexStore.getState().resetSession();
}
