import apiClient from './client';

/**
 * Un usuario de la plataforma, como lo ve un admin.
 *
 * NO trae la cuenta de bróker ajena, y es a propósito: un admin administra usuarios, no sus
 * credenciales. Lo único que se expone es el metadato administrativo — si tiene cuenta vinculada y
 * si es la de sistema —, nunca el número de cuenta ni el refresh token.
 */
export interface AdminUser {
  id: string;
  email: string;
  /** Con lo que entra al tablero. Único, en minúscula, y editable desde acá. */
  username: string;
  displayName?: string | null;
  isAdmin: boolean;
  createdAt: string;
  hasBrokerAccount: boolean;
  hasSystemAccount: boolean;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  /** Para que la pantalla pueda marcar "sos vos" sin volver a pedir /Me. */
  currentUserId: string | null;
}

export async function fetchAdminUsers(): Promise<AdminUsersResponse> {
  const { data } = await apiClient.get<AdminUsersResponse>('/App/GaleCore/Admin/Users');
  return data;
}

export interface CreateUserInput {
  username: string;
  email: string;
  /** Inicial: el operador la cambia después desde su propia pantalla. */
  password: string;
  displayName?: string;
  isAdmin?: boolean;
}

/**
 * Da de alta un operador.
 *
 * El backend escribe en DOS sistemas —la identidad en Supabase Auth y la fila en `users`— y
 * compensa si la segunda falla. Cuando algo sale mal, el motivo real viene en `error`: puede ser de
 * Supabase ("email already exists", "password should be at least 6 characters") o nuestro (un
 * username tomado). La pantalla lo muestra tal cual en vez de traducirlo, porque es accionable.
 */
export async function createAdminUser(input: CreateUserInput): Promise<AdminUser> {
  const { data } = await apiClient.post('/App/GaleCore/Admin/Users', input);
  return data;
}

/**
 * Lo que se le puede cambiar a un usuario. Todo opcional: lo que no se manda no se toca.
 *
 * Es lo que permite que el toggle de admin mande solo `{ isAdmin }` sin reenviar el usuario entero
 * —y sin pisar con datos viejos lo que otro haya editado mientras tanto.
 */
export interface UpdateUserInput {
  isAdmin?: boolean;
  username?: string;
  email?: string;
  displayName?: string;
  /** Contraseña nueva. No mandar el campo = no se toca. */
  password?: string;
}

export async function updateAdminUser(id: string, input: UpdateUserInput): Promise<AdminUser> {
  const { data } = await apiClient.patch(`/App/GaleCore/Admin/Users/${id}`, input);
  return data;
}

/**
 * Prende o apaga el permiso de admin de un usuario.
 *
 * El backend RECHAZA dejar la plataforma sin ningún admin: sin admins, el kill switch de las
 * estrategias no se puede tocar desde ningún tablero y hay que arreglarlo con SQL. Si pasa, la
 * respuesta trae el motivo en `error` y la pantalla lo muestra tal cual.
 */
export async function setAdminUserRole(id: string, isAdmin: boolean): Promise<AdminUser> {
  return updateAdminUser(id, { isAdmin });
}

/**
 * Elimina un operador: se va de Supabase Auth y de la tabla, con sus cuentas de bróker por la FK en
 * cascada. Irreversible.
 *
 * `wasSystem` avisa que la cuenta que se llevó puesta era la de SISTEMA, o sea que los procesos de
 * fondo se quedaron sin credencial para pedir datos de mercado.
 */
export async function deleteAdminUser(id: string): Promise<{ id: string; deleted: boolean; wasSystem: boolean }> {
  const { data } = await apiClient.delete(`/App/GaleCore/Admin/Users/${id}`);
  return data;
}
