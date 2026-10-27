import apiClient from './client';

/**
 * Cuenta de bróker vinculada al usuario logueado.
 *
 * Ni el refresh token ni el client secret vuelven por acá: entran cifrados a la base y no salen más
 * por HTTP. Lo único que se puede leer es qué cuenta hay vinculada, desde cuándo, y si trae su
 * propia aplicación OAuth — el hecho, no el valor.
 */
export interface BrokerAccountState {
  linked: boolean;
  broker?: string;
  accountNumber?: string;
  /** Marca la cuenta que usan los procesos de fondo para pedir datos de MERCADO. Hay una sola. */
  isSystem?: boolean;
  /**
   * La cuenta entra por la aplicación OAuth propia del operador (true) o por la de la plataforma
   * (false). Es lo primero que hay que mirar cuando Tastytrade rechaza la credencial: las dos
   * mitades —refresh token y client secret— tienen que ser de la misma aplicación.
   */
  hasOwnClientSecret?: boolean;
  updatedAt?: string;
}

export async function fetchBrokerAccount(): Promise<BrokerAccountState> {
  const { data } = await apiClient.get<BrokerAccountState>('/App/GaleCore/Account');
  return data;
}

/**
 * Vincula o actualiza la cuenta. El uuid del usuario sale del token, no del body: por eso desde acá
 * no se puede vincular una cuenta al usuario de otro.
 *
 * Es el único camino correcto para cambiar el refresh token — es quien lo cifra con la clave del
 * servidor antes de guardarlo. Un UPDATE a mano contra Postgres dejaría la fila ilegible.
 *
 * REEMPLAZA la credencial entera, no parchea campos: `clientSecret` vacío significa "esta cuenta
 * entra por la aplicación OAuth de la plataforma", no "dejá el que estaba". Si conservara el
 * anterior, actualizar solo el refresh token dejaría las dos mitades de aplicaciones distintas, que
 * es exactamente lo que Tastytrade rechaza.
 */
export async function linkBrokerAccount(
  accountNumber: string,
  refreshToken: string,
  clientSecret?: string,
): Promise<{ linked: boolean; accountNumber: string; hasOwnClientSecret: boolean }> {
  const { data } = await apiClient.post('/App/GaleCore/Account', {
    accountNumber,
    refreshToken,
    clientSecret: clientSecret?.trim() || null,
  });
  return data;
}

/**
 * Desvincula la cuenta propia. Borra la fila, o sea también el refresh token cifrado — no hay
 * "desvincular pero guardar por las dudas": una credencial que nadie sabe que sigue ahí es
 * justamente lo que no se quiere.
 *
 * `wasSystem` avisa que la que se borró era la cuenta de sistema, con la que los procesos de fondo
 * piden datos de mercado. No se bloquea (a veces desvincular una credencial comprometida es
 * exactamente lo que hay que hacer), pero la pantalla tiene que decirlo fuerte.
 */
export async function unlinkBrokerAccount(): Promise<{ linked: false; wasSystem?: boolean }> {
  const { data } = await apiClient.delete('/App/GaleCore/Account');
  return data;
}
