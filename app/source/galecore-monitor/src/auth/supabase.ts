import { createClient, Session } from '@supabase/supabase-js';

/**
 * Cliente de Supabase Auth: la identidad del operador.
 *
 * La anon key es PUBLICA por diseño — va embebida en el bundle y su seguridad no depende de
 * ocultarla, sino de las políticas del lado de Supabase y de que la API valide el JWT. Por eso vive
 * en .env y no en un secreto.
 *
 * La librería guarda la sesión en localStorage y RENUEVA el access token sola antes de que venza
 * (duran una hora). Esa es la razón de usarla en vez de pegarle a /auth/v1/token con fetch: sin
 * renovación automática, el tablero se quedaría sin datos a la hora de haber entrado.
 */
const url = process.env.REACT_APP_SUPABASE_URL || '';
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://localhost', anonKey || 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/**
 * Access token vigente, o null si no hay sesión.
 *
 * Pasa por getSession() en cada llamada a propósito: ahí es donde la librería decide si el token
 * está por vencer y lo renueva. Cachearlo por fuera sería quedarse con uno vencido.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getSession(): Promise<Session | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Entrada con USUARIO y contraseña.
 *
 * Le pega a NUESTRA API y no a Supabase directo, porque el front no conoce el mail: solo el
 * username. La API lo resuelve contra la tabla `users` y autentica ese mail contra Supabase. Un
 * endpoint público que tradujera username → mail para que el navegador siguiera solo sería una
 * ruta sin autenticar que devuelve direcciones de correo a quien adivine un usuario.
 *
 * DESPUÉS DEL LOGIN NADA CAMBIA: `setSession` deja los dos tokens en manos de supabase-js, que los
 * guarda y los renueva sola antes de que venzan. Por eso `getAccessToken`, el interceptor de axios,
 * el `accessTokenFactory` del hub y el `onAuthStateChange` de App.tsx siguen funcionando sin
 * enterarse de que la puerta de entrada cambió.
 *
 * Se usa fetch y no el cliente de axios a propósito: ese interceptor adjunta el token de la sesión,
 * y acá justamente todavía no hay ninguna.
 */
export async function loginWithUsername(username: string, password: string) {
  const base = process.env.REACT_APP_API_BASE_URL || '';

  const res = await fetch(`${base}/App/GaleCore/Auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    // El backend contesta lo MISMO para usuario inexistente y contraseña equivocada: si fueran
    // mensajes distintos, probar nombres en el formulario diría cuáles existen. El 429 sí se
    // distingue, porque decirle "usuario o contraseña incorrectos" a quien en realidad chocó con el
    // rate limit lo manda a dudar de una contraseña que estaba bien.
    if (res.status === 429) {
      throw new Error('Demasiados intentos. Esperá unos minutos antes de volver a probar.');
    }

    const data = await res.json().catch(() => null);
    throw new Error(data?.error || 'Usuario o contraseña incorrectos.');
  }

  const { accessToken, refreshToken } = await res.json();

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) throw new Error(error.message);
}

export async function signOut() {
  await supabase.auth.signOut();
}

/**
 * Cambia la contraseña del usuario logueado.
 *
 * Va DIRECTO a Supabase con la sesión que ya tiene, sin pasar por la API: cambiar la propia
 * contraseña no necesita la service_role —esa hace falta para tocar la de OTRO— y mandarla a
 * nuestro backend sería hacerla viajar por un servidor de más sin ninguna ganancia.
 *
 * Es la contracara del alta: el admin crea al operador con una contraseña inicial y desde acá esa
 * persona la reemplaza por una suya, sin que el admin vuelva a tocarla.
 */
export async function updateOwnPassword(password: string) {
  return supabase.auth.updateUser({ password });
}
