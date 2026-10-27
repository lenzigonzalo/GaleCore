/**
 * Terminal local de Claude Code para el monitor (P1-01c, U-58/U-70).
 *
 * Abre `claude` en una pseudo-terminal y la pasa por WebSocket al panel del monitor (xterm.js). Escucha sólo en
 * 127.0.0.1 y sólo acepta pedidos del monitor local (cabecera Origin): sin eso, cualquier página abierta en el
 * navegador podría abrir una terminal en la PC. Usa el plan de Claude Code de la PC: no pasa ANTHROPIC_API_KEY ni
 * las variables de una sesión de Claude Code (si el servidor se lanzó desde una, `claude` creería estar anidado).
 *
 *   node tools/terminal/server.js          # :8770
 *
 * GET  /folders                                 → dónde se puede abrir: GaleCore (el harness, por defecto), cada
 *                                                 estrategia y el workspace de desarrollo
 * WS   /pty?folder=<clave>&prompt=<texto>&cols=&rows=
 *      servidor → panel: la salida tal cual · panel → servidor: {"type":"input","data"} | {"type":"resize","cols","rows"}
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const pty = require('@lydell/node-pty');
const { WebSocketServer } = require('ws');
const { PROVIDERS, providerBinary, authCommand, authEnvironment, authStatus } = require('./provider-auth');

const PORT = Number(process.env.GALECORE_TERMINAL_PORT || 8770);
const ORIGINS = (process.env.GALECORE_TERMINAL_ORIGINS || 'http://localhost:3039,http://127.0.0.1:3039')
  .split(',').map(s => s.trim()).filter(Boolean);
const WORKSPACE = path.resolve(__dirname, '..', '..');
const STRATEGIES = path.join(WORKSPACE, 'knowledge', 'strategies');
// El trader usa el harness (GaleCore-AI), nunca el workspace de desarrollo con sus hooks y skills (owner 10/10, WS-0023).
const HARNESS = path.join(WORKSPACE, 'GaleCore-AI');
const DEFAULT_FOLDER = 'galecore';
const HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];   // contra DNS rebinding: el nombre tiene que ser local
const MAX_SESSIONS = 4;
const MAX_PROMPT = 2000;
let sessions = 0;
const authSessions = new Set();

function claudeBin() {
  if (process.env.GALECORE_CLAUDE_BIN) return process.env.GALECORE_CLAUDE_BIN;
  const npmExe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return fs.existsSync(npmExe) ? npmExe : (process.platform === 'win32' ? 'claude.exe' : 'claude');
}

/** Clave → carpeta. Sólo estas: el panel nunca manda una ruta. */
function folders() {
  const list = [{ key: DEFAULT_FOLDER, label: 'GaleCore', dir: HARNESS }];
  try {
    for (const d of fs.readdirSync(STRATEGIES, { withFileTypes: true })) {
      if (d.isDirectory()) list.push({ key: `strategy:${d.name}`, label: d.name, dir: path.join(STRATEGIES, d.name) });
    }
  } catch { /* sin estrategias: quedan GaleCore y el workspace */ }
  list.push({ key: 'workspace', label: 'Desarrollo (workspace)', dir: WORKSPACE });
  return list;
}

function cleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of Object.keys(env)) {
    // CLAUDE_CODE_OAUTH_TOKEN es la sesión del plan: se deja.
    if (k === 'CLAUDECODE' || (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN') || k === 'ANTHROPIC_API_KEY') delete env[k];
  }
  return env;
}

const allowed = origin => !!origin && ORIGINS.includes(origin);
const localHost = req => HOSTS.includes(String(req.headers.host || '').toLowerCase());
const clamp = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; };

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!localHost(req) || (origin && !allowed(origin))) { res.writeHead(403).end(); return; }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/auth/status') {
    if (!allowed(origin)) { res.writeHead(403).end(); return; }
    const providers = await Promise.all(PROVIDERS.map(id => authStatus(id, providerBinary(id))));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ providers }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/folders') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(folders().map(({ key, label }) => ({ key, label }))));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/pty' || !localHost(req) || !allowed(req.headers.origin)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => open(ws, url.searchParams));
});

function open(ws, params) {
  const auth = params.get('auth');
  if (auth !== null && !PROVIDERS.includes(auth)) { ws.close(4000, 'proveedor desconocido'); return; }
  if (auth !== null && authSessions.has(auth)) { ws.close(4009, 'autenticación en curso'); return; }
  const folder = folders().find(f => f.key === (params.get('folder') || DEFAULT_FOLDER));
  if (!folder) { ws.close(4004, 'carpeta desconocida'); return; }
  const prompt = (params.get('prompt') || '').trim();
  // Un pedido que empieza con «-» claude lo tomaría como opción (p. ej. saltear permisos): no se acepta.
  if (prompt.startsWith('-') || prompt.length > MAX_PROMPT) { ws.close(4000, 'pedido no válido'); return; }
  if (sessions >= MAX_SESSIONS) { ws.send(`

Ya hay ${MAX_SESSIONS} sesiones abiertas: cerrá una.

`); ws.close(); return; }
  ws.on('error', () => { /* frame inválido o corte: se cierra y se mata la pty en «close» */ });
  let term;
  try {
    const binary = auth !== null ? providerBinary(auth) : claudeBin();
    if (!binary) { ws.close(4004, 'proveedor no instalado'); return; }
    term = pty.spawn(binary, auth !== null ? authCommand(auth) : prompt ? [prompt] : [], {
      name: 'xterm-256color', cwd: auth !== null ? HARNESS : folder.dir, env: auth !== null ? authEnvironment() : cleanEnv(),
      cols: clamp(params.get('cols'), 20, 400, 100), rows: clamp(params.get('rows'), 5, 200, 30),
    });
  } catch (e) {
    ws.send('\r\nNo se pudo abrir la terminal local.\r\n'); ws.close(); return;
  }
  sessions += 1;
  if (auth !== null) authSessions.add(auth);
  console.log(`[terminal] ${new Date().toISOString()} abre ${folder.key} pid=${term.pid}${prompt ? ' con pedido' : ''}`);
  term.onData(d => { if (ws.readyState === ws.OPEN) ws.send(d); });
  term.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) { ws.send(`\r\n[${auth || 'claude'} terminó (${exitCode})]\r\n`); ws.close(); }
  });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    try {
      if (m.type === 'input' && typeof m.data === 'string') term.write(m.data);
      else if (m.type === 'resize') term.resize(clamp(m.cols, 20, 400, 100), clamp(m.rows, 5, 200, 30));
    } catch { /* claude ya terminó */ }
  });
  ws.on('close', () => { sessions -= 1; if (auth !== null) authSessions.delete(auth); try { term.kill(); } catch { /* ya terminó */ } });
}

server.listen(PORT, '127.0.0.1', () => console.log(`[terminal] http://127.0.0.1:${PORT} · claude=${claudeBin()} · origins=${ORIGINS.join(' ')}`));
