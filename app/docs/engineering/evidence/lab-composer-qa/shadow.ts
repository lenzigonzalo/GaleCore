export async function fetchShadowMetrics() {
  const runtime = (window as any).__LAB_FIXTURE__.runtime;
  if (runtime.mode === 'timeout') throw new Error('timeout of 15000ms exceeded');
  if (runtime.mode === 'pending') return new Promise(() => {});
  return structuredClone(runtime.metrics);
}
export async function fetchShadowStatus() {
  return structuredClone((window as any).__LAB_FIXTURE__.runtime.status);
}
