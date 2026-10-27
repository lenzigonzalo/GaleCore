/**
 * Lab local: CLI de suscripción, proyectos reales y sesiones desacopladas del navegador.
 * Sólo loopback y orígenes locales explícitos. NO es un servicio multiusuario alojado.
 * node lab/lab-server.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { execFile, execFileSync } = require('child_process');
const pty = require('@lydell/node-pty');
const { WebSocketServer } = require('ws');

const { ensureKnowledgeDir } = require('./knowledge-dir');
const ROOT = path.resolve(__dirname, '..');
const KB = ensureKnowledgeDir();
const PORT = Number(process.env.GALECORE_LAB_PORT || 8771);
const LOCAL = path.join(__dirname, '.local');
const STORE = path.join(LOCAL, 'lab-sessions.json');
const ORIGINS = new Set(['http://localhost:3039', 'http://127.0.0.1:3039']);
const TOKEN = crypto.randomBytes(32).toString('hex');
const sessions = new Map();
const UUID = /^[0-9a-f-]{36}$/i;
const { createWorkspaces } = require('./lab-workspaces');
fs.mkdirSync(LOCAL, { recursive: true });
try {
  for (const s of JSON.parse(fs.readFileSync(STORE, 'utf8'))) {
    if (UUID.test(s.id)) sessions.set(s.id, { ...s, state: s.state === 'running' ? 'interrupted' : s.state, term: null, socket: null, buffer: '' });
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('[lab] No se pudo leer el historial local; no se sobrescribe silenciosamente.');
}

const publicSession = s => ({
  id: s.id, project: s.project, provider: s.provider, title: s.title, createdAt: s.createdAt,
  state: s.state, nativeId: s.nativeId || null, exitCode: s.exitCode ?? null, resumeOf: s.resumeOf || null,
});
function persist() {
  const tmp = STORE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...sessions.values()].map(publicSession), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE);
}
function projects() {
  const list = [{ id: 'portfolio', label: 'Cartera e investigación', dir: path.join(KB, 'workspaces', 'portfolio'), relative: 'workspaces/portfolio' }];
  const base = path.join(KB, 'strategies');
  if (!fs.existsSync(base)) return list;
  const realBase = fs.realpathSync(base);
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(d.name)) continue;
    const dir = fs.realpathSync(path.join(base, d.name));
    if (path.dirname(dir).toLowerCase() !== realBase.toLowerCase()) continue;
    list.push({ id: d.name, label: d.name.replace(/_/g, ' '), dir, relative: 'strategies/' + d.name });
  }
  return list;
}
function binary(provider) {
  const override = process.env[provider === 'codex' ? 'GALECORE_CODEX_BIN' : 'GALECORE_CLAUDE_BIN'];
  if (override && fs.existsSync(override)) return override;
  if (provider === 'claude') {
    for (const bin of [
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    ]) if (fs.existsSync(bin)) return bin;
  }
  if (provider === 'codex' && process.platform === 'win32') {
    const bin = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    if (fs.existsSync(bin)) return bin;
  }
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [provider], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    return found.trim().split(/\r?\n/).find(p => process.platform !== 'win32' || p.toLowerCase().endsWith('.exe')) || null;
  } catch { return null; }
}
const binaries = { codex: binary('codex'), claude: binary('claude') };
function instructions(project) {
  return [
    'Esta sesión pertenece a GaleCore Lab: trabajo real del trader, no desarrollo del software ni continuación del ACTIVE_WORK_ITEM.',
    'Proyecto seleccionado: ' + project.id + '. Workspace del producto: ' + ROOT + '.',
    'Al recibir el primer pedido, leé ' + path.join(ROOT, 'ai', 'CLAUDE.md') + ' y consultá antecedentes con las herramientas del harness (ai/).',
    'Usá python -B -m galecore_ai.adapters.cli catalog --match con el pedido y kb search para recuperar contexto. Para estrategias existentes, project show strategy:' + project.id + '; para cartera, project show portfolio. Un borrador nuevo todavía no tiene registro canónico.',
    'PYTHONPATH y GALECORE_KNOWLEDGE_DIR ya están definidos. Las capacidades y su contrato están en ai/docs/HOST-REFERENCE.md.',
    'Guardá investigaciones, decisiones y pendientes mediante research/project/feedback u otras herramientas canónicas; no edites registros con hashes a mano.',
    'Para pasar contenido por stdin, escribí el JSON en un archivo de este proyecto (files/) y corré el comando con `< files/<archivo>.json`; sin cd, heredocs ni pipes.',
    'Después de un hito útil, guardá su evidencia y próximos pasos con las herramientas del harness (ai/). No hagas commit: el guardado alcanza (el commit de ' + KB + ' lo hace el mantenimiento).',
    'No uses git add . ni incluyas cambios ajenos. No pushees. No guardes secretos ni transcripciones completas en Git. No inventes evidencia ni aprobación.',
    'Corto y sin códigos internos. Si guardaste algo, una sola línea al final («Guardado: …»); si no, nada.',
    'Los datos y cálculos financieros provienen de GaleCore. Nunca uses los mocks del front. No hagas órdenes LIVE ni cambios en producción.',
    'El usuario mantiene autoridad sobre reglas, mandato y aprobaciones. Conservá permisos, sandbox y confirmaciones del CLI.',
    'No lances trabajo autónomo al arrancar: esperá el pedido del usuario.',
  ].join('\n');
}
function environment() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor',
    PYTHONPATH: path.join(ROOT, 'ai', 'src'), GALECORE_KNOWLEDGE_DIR: KB };
  for (const k of Object.keys(env)) {
    if (['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'CLAUDECODE'].includes(k)) delete env[k];
    if (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN') delete env[k];
  }
  env.CLAUDE_CODE_SUBAGENT_MODEL = process.env.GALECORE_LAB_SUBAGENT_MODEL || 'haiku';  // WS-0028: subagentes baratos
  return env;
}
const dimension = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback;
function newSession(body) {
  const project = projects().find(p => p.id === body.project);
  if (!project || !['codex', 'claude'].includes(body.provider)) throw Object.assign(new Error('Proyecto o motor desconocido.'), { status: 400 });
  if (!binaries[body.provider]) throw Object.assign(new Error('El CLI no está instalado en esta PC.'), { status: 409 });
  const active = [...sessions.values()].filter(s => s.state === 'running');
  if (active.some(s => s.project === project.id)) {
    throw Object.assign(new Error('Ya hay una sesión abierta sobre este proyecto. Retomala o terminála antes de abrir otra.'), { status: 409 });
  }
  if (active.length >= 4) throw Object.assign(new Error('Hay cuatro sesiones activas. Terminá una antes de continuar.'), { status: 409 });
  const previous = body.resumeOf ? sessions.get(body.resumeOf) : null;
  if (body.resumeOf && (!previous || previous.project !== project.id || previous.provider !== body.provider)) throw Object.assign(new Error('La sesión no pertenece a ese proyecto y motor.'), { status: 400 });
  const id = crypto.randomUUID();
  const s = { id, project: project.id, provider: body.provider, title: project.label,
    createdAt: new Date().toISOString(), state: 'running', term: null, socket: null, buffer: '',
    nativeId: body.provider === 'claude' ? (previous?.nativeId || crypto.randomUUID()) : previous?.nativeId || null,
    resumeOf: previous?.id || null };
  const context = instructions(project);
  let args;
  if (body.provider === 'codex') {
    args = ['--no-daemon', '--no-alt-screen', '-c', 'developer_instructions=' + JSON.stringify(context), '-C', project.dir];
    // Historial nativo del proyecto si todavía no se capturó un ID; nunca --last ambiguo.
    if (previous || body.history) args.push('resume', ...(previous?.nativeId ? [previous.nativeId] : []));
  } else {
    // WS-0028: mismo entorno que el chat (contexto de producto de knowledge/, sin desarrollo ni ~/.claude).
    args = ['--model', process.env.GALECORE_LAB_MODEL || 'sonnet', '--effort', process.env.GALECORE_LAB_EFFORT || 'medium',
      '--append-system-prompt', 'Proyecto: ' + project.id + '.', '--strict-mcp-config',
      '--setting-sources', 'project,local', '--settings', path.join(KB, '.claude', 'settings.json')];
    if (previous || body.history) args.push('--resume', ...(previous?.nativeId ? [previous.nativeId] : []));
    else args.push('--session-id', s.nativeId);
  }
  s.term = pty.spawn(binaries[body.provider], args, {
    cwd: project.dir, env: environment(), name: 'xterm-256color',
    cols: dimension(body.cols, 20, 400, 100), rows: dimension(body.rows, 5, 200, 30),
  });
  sessions.set(id, s);
  s.term.onData(data => {
    s.buffer = (s.buffer + data).slice(-1024 * 1024);
    if (s.provider === 'codex') {
      const match = s.buffer.match(/codex resume ([0-9a-f-]{36})/i);
      if (match && match[1] !== s.nativeId) { s.nativeId = match[1]; persist(); }
    }
    if (s.socket?.readyState === 1) s.socket.send(JSON.stringify({ type: 'output', data }));
  });
  s.term.onExit(({ exitCode }) => {
    s.state = 'ended'; s.exitCode = exitCode; s.term = null; persist();
    if (s.socket?.readyState === 1) s.socket.send(JSON.stringify({ type: 'ended', exitCode }));
  });
  persist();
  return publicSession(s);
}
function git(args) {
  return new Promise((resolve, reject) => execFile('git', ['-C', KB, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 }, (e, out) => e ? reject(new Error('No se pudo leer el repositorio de memoria.')) : resolve(out)));
}
async function projectContext(id) {
  const p = projects().find(p => p.id === id);
  if (!p) throw Object.assign(new Error('Proyecto desconocido.'), { status: 404 });
  const paths = [p.relative, 'projects/' + p.id + '.json'];
  const [log, status] = await Promise.all([
    git(['log', '-6', '--format=%h%x09%aI%x09%s', '--', ...paths]),
    git(['status', '--porcelain', '--', ...paths]),
  ]);
  const files = fs.readdirSync(p.dir, { withFileTypes: true }).filter(f => f.isFile() && /\.(json|md)$/.test(f.name)).map(f => f.name);
  return { project: p.id, folder: p.relative, files,
    commits: log.trim().split('\n').filter(Boolean).map(l => { const [hash, date, ...text] = l.split('\t'); return { hash, date, message: text.join('\t') }; }),
    changes: status.trim() ? status.trim().split('\n').length : 0 };
}
const validHost = req => ['127.0.0.1:' + PORT, 'localhost:' + PORT].includes(String(req.headers.host).toLowerCase());
const validOrigin = req => ORIGINS.has(req.headers.origin);
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function readBody(req) {
  req.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    req.on('data', d => { value += d; if (value.length > 65536) { reject(Object.assign(new Error('Pedido demasiado grande.'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(value || '{}')); } catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const workspaces = createWorkspaces({ root:ROOT, kb:KB, local:LOCAL, binaries, environment, legacyProjects:projects, legacySessions:()=>[...sessions.values()] });
const server = http.createServer(async (req, res) => {
  if (!validHost(req) || !validOrigin(req)) return json(res, 403, { error: 'Sólo se admite el monitor local de esta PC.' });
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.writeHead(204).end(); return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/bootstrap') return json(res, 200, { token: TOKEN, scope: 'local-os-user' });
  if (req.headers.authorization !== 'Bearer ' + TOKEN) return json(res, 401, { error: 'Conexión local no autorizada. Reconectá el Lab.' });
  try {
    if (await workspaces.route(req,res,url,json,readBody)) return;
    if (req.method === 'GET' && url.pathname === '/state') return json(res, 200, {
      projects: projects().map(({ id, label }) => ({ id, label })),
      providers: ['codex', 'claude'].map(id => ({ id, label: id === 'codex' ? 'Codex' : 'Claude Code', installed: !!binaries[id] })),
      sessions: [...sessions.values()].map(publicSession), scope: 'local-os-user',
    });
    if (req.method === 'GET' && url.pathname.startsWith('/projects/')) return json(res, 200, await projectContext(decodeURIComponent(url.pathname.slice(10))));
    if (req.method === 'POST' && url.pathname === '/sessions') return json(res, 201, newSession(await readBody(req)));
    if (req.method === 'POST' && /^\/sessions\/[0-9a-f-]{36}\/stop$/i.test(url.pathname)) {
      const s = sessions.get(url.pathname.split('/')[2]);
      if (!s) return json(res, 404, { error: 'Sesión desconocida.' });
      if (s.term) s.term.kill();
      return json(res, 200, { requested: true });
    }
    json(res, 404, { error: 'Ruta desconocida.' });
  } catch (e) { json(res, e.status || 500, { error: e.status ? e.message : 'No se pudo completar la operación local. Revisá el servicio del Lab.' }); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
// Shell (owner 17/10): una terminal común (PowerShell) en la carpeta del proyecto, al lado de Archivos. Vive mientras
// el panel está abierto; al cerrar el socket se corta. Mismo token y mismas reglas de origen que el resto del Lab.
let shells = 0;
function openShell(ws) {
  let term = null;
  const timer = setTimeout(() => ws.close(4001, 'autenticación requerida'), 5000);
  ws.on('error', () => {});
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { ws.close(4000, 'mensaje inválido'); return; }
    if (!term) {
      const project = m.type === 'open' && m.token === TOKEN && workspaces.listProjects().find(p => p.id === m.project);
      if (!project) { ws.close(4003, 'proyecto no autorizado'); return; }
      if (shells >= 4) { ws.close(4029, 'hay cuatro terminales abiertas'); return; }
      clearTimeout(timer); shells++;
      term = pty.spawn(process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash'), process.platform === 'win32' ? ['-NoLogo'] : [], {
        cwd: project.dir, env: environment(), name: 'xterm-256color',
        cols: dimension(m.cols, 20, 400, 100), rows: dimension(m.rows, 5, 200, 30),
      });
      term.onData(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data })); });
      term.onExit(() => { term = null; shells--; if (ws.readyState === 1) ws.close(1000, 'terminal cerrada'); });
      return;
    }
    try {
      if (m.type === 'input' && typeof m.data === 'string') term.write(m.data);
      if (m.type === 'resize') term.resize(dimension(m.cols, 20, 400, 100), dimension(m.rows, 5, 200, 30));
    } catch { /* la terminal ya terminó */ }
  });
  ws.on('close', () => { clearTimeout(timer); if (term) { try { term.kill(); } catch {} } });
}
server.on('upgrade', (req, socket, head) => {
  if (!validHost(req) || !validOrigin(req) || !['/attach', '/shell'].includes(req.url)) { socket.destroy(); return; }
  if (req.url === '/shell') { wss.handleUpgrade(req, socket, head, openShell); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    let s = null;
    const timer = setTimeout(() => ws.close(4001, 'autenticación requerida'), 5000);
    ws.on('error', () => {});
    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { ws.close(4000, 'mensaje inválido'); return; }
      if (!s) {
        if (m.type !== 'attach' || m.token !== TOKEN || !sessions.has(m.id)) { ws.close(4003, 'sesión no autorizada'); return; }
        clearTimeout(timer); s = sessions.get(m.id);
        if (s.socket && s.socket !== ws) s.socket.close(4009, 'abierta en otra pestaña');
        s.socket = ws;
        ws.send(JSON.stringify({ type: 'replay', data: s.buffer, state: s.state }));
        if (s.term) s.term.resize(dimension(m.cols, 20, 400, 100), dimension(m.rows, 5, 200, 30));
        return;
      }
      if (s.socket !== ws || !s.term) return;
      try {
        if (m.type === 'input' && typeof m.data === 'string') s.term.write(m.data);
        if (m.type === 'resize') s.term.resize(dimension(m.cols, 20, 400, 100), dimension(m.rows, 5, 200, 30));
      } catch { ws.close(4010, 'proceso terminado'); }
    });
    ws.on('close', () => { clearTimeout(timer); if (s?.socket === ws) s.socket = null; });
  });
});
function shutdown() {
  workspaces.shutdown();
  for (const s of sessions.values()) if (s.term) { s.state = 'interrupted'; try { s.term.kill(); } catch {} }
  persist(); server.close(); process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.listen(PORT, '127.0.0.1', () => console.log('[lab] listo en loopback :' + PORT + ' · sesiones de este usuario local'));
