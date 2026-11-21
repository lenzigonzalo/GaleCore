/**
 * WS-0106: como `setInterval`, pero con la pestaña oculta no consulta nada (cada pedido a la API o al Lab con nadie mirando
 * es egress y base leída de balde). Al volver a estar visible corre `fn` al instante y retoma el intervalo. Devuelve la
 * función que lo cancela. No corre `fn` al arrancar: eso lo sigue haciendo quien llama.
 */
export function setVisibleInterval(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const visible = () => document.visibilityState !== 'hidden';
  const start = () => { if (timer === null) timer = setInterval(fn, ms); };
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  const onChange = () => { if (visible()) { fn(); start(); } else stop(); };
  if (visible()) start();
  document.addEventListener('visibilitychange', onChange);
  return () => { stop(); document.removeEventListener('visibilitychange', onChange); };
}
