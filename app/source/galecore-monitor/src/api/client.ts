import axios from 'axios';
import { getAccessToken } from '../auth/supabase';

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  timeout: 15000,
});

/**
 * Autenticación de cada request, con el token de Supabase primero.
 *
 * El backend acepta cualquiera de los dos: un JWT válido identifica a UNA PERSONA, que es más de lo
 * que prueba una clave compartida ("alguien que la tiene"). Por eso el token gana cuando hay sesión.
 *
 * La API key queda como respaldo mientras dure la migración y para lo que no puede loguearse
 * (llamadas de máquina a máquina, pruebas con curl). Cuando el login sea la única puerta, esta rama
 * y REACT_APP_API_KEY se van juntas — hoy esa clave viaja en el bundle, o sea que es pública.
 *
 * El interceptor es async porque getAccessToken() puede tener que renovar el token: axios espera la
 * promesa antes de mandar el request.
 */
apiClient.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
    return config;
  }

  const apiKey = sessionStorage.getItem('galecore:apiKey') || process.env.REACT_APP_API_KEY || '';
  if (apiKey) {
    config.headers['X-API-KEY'] = apiKey;
  }
  return config;
});

export default apiClient;
