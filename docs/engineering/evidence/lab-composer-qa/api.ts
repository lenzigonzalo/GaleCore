export async function labRequest(url: string, body?: object) {
  if (body) throw new Error('QA aislada: no se permiten escrituras ni inferencias.');
  const fixture = (window as any).__LAB_FIXTURE__;
  if (url === '/workspaces') return fixture.state;
  if (url.startsWith('/chats/')) return structuredClone(fixture.chat);
  if (url.endsWith('/strategy')) return fixture.strategyPending ? new Promise(() => {}) : structuredClone(fixture.strategy);
  if (url.includes('/files')) return { tree: [] };
  throw new Error('Ruta no contemplada en QA: ' + url);
}
