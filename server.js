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
 * GET  /folders                                 → dónde se puede abrir: el workspace y cada estrategia
 * WS   /pty?folder=<clave>&prompt=<texto>&cols=&rows=
 *      servidor → panel: la salida tal cual · panel → servidor: {"type":"input","data"} | {"type":"resize","cols","rows"}
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const pty = require('@lydell/node-pty');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.GALECORE_TERMINAL_PORT || 8770);
const ORIGINS = (process.env.GALECORE_TERMINAL_ORIGINS || 'http://localhost:3039,http://127.0.0.1:3039')
  .split(',').map(s => s.trim()).filter(Boolean);
const WORKSPACE = path.resolve(__dirname, '..', '..');
const STRATEGIES = path.join(WORKSPACE, 'knowledge', 'strategies');

function claudeBin() {
  if (process.env.GALECORE_CLAUDE_BIN) return process.env.GALECORE_CLAUDE_BIN;
  const npmExe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return fs.existsSync(npmExe) ? npmExe : (process.platform === 'win32' ? 'claude.exe' : 'claude');
}

/** Clave → carpeta. Sólo estas: el panel nunca manda una ruta. */
function folders() {
  const list = [{ key: 'workspace', label: 'Espacio de trabajo', dir: WORKSPACE }];
  try {
    for (const d of fs.readdirSync(STRATEGIES, { withFileTypes: true })) {
      if (d.isDirectory()) list.push({ key: `strategy:${d.name}`, label: d.name, dir: path.join(STRATEGIES, d.name) });
    }
  } catch { /* sin estrategias: queda el workspace */ }
  return list;
}

function cleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ANTHROPIC_API_KEY') delete env[k];
  }
  return env;
}

const allowed = origin => !!origin && ORIGINS.includes(origin);
const clamp = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; };

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowed(origin)) { res.writeHead(403).end(); return; }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/folders') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(folders().map(({ key, label }) => ({ key, label }))));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/pty' || !allowed(req.headers.origin)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => open(ws, url.searchParams));
});

function open(ws, params) {
  const folder = folders().find(f => f.key === (params.get('folder') || 'workspace'));
  if (!folder) { ws.close(4004, 'carpeta desconocida'); return; }
  const prompt = (params.get('prompt') || '').trim();
  let term;
  try {
    term = pty.spawn(claudeBin(), prompt ? [prompt] : [], {
      name: 'xterm-256color', cwd: folder.dir, env: cleanEnv(),
      cols: clamp(params.get('cols'), 20, 400, 100), rows: clamp(params.get('rows'), 5, 200, 30),
    });
  } catch (e) {
    ws.send(`\r\nNo se pudo abrir claude: ${e.message}\r\n`); ws.close(); return;
  }
  console.log(`[terminal] ${new Date().toISOString()} abre ${folder.key} pid=${term.pid}${prompt ? ' con pedido' : ''}`);
  term.onData(d => { if (ws.readyState === ws.OPEN) ws.send(d); });
  term.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) { ws.send(`\r\n[claude terminó (${exitCode})]\r\n`); ws.close(); }
  });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === 'input' && typeof m.data === 'string') term.write(m.data);
    else if (m.type === 'resize') term.resize(clamp(m.cols, 20, 400, 100), clamp(m.rows, 5, 200, 30));
  });
  ws.on('close', () => { try { term.kill(); } catch { /* ya terminó */ } });
}

server.listen(PORT, '127.0.0.1', () => console.log(`[terminal] http://127.0.0.1:${PORT} · claude=${claudeBin()} · origins=${ORIGINS.join(' ')}`));
