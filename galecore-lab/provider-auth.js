const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');

const PROVIDERS = ['claude', 'codex'];
function nativeCodexFromWrapper(wrapper, exists = fs.existsSync, arch = process.arch) {
  const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : arch === 'x64' ? 'x86_64-pc-windows-msvc' : null;
  if (!triple) return null;
  const root = path.join(path.dirname(wrapper), 'node_modules', '@openai', 'codex');
  const target = path.join('vendor', triple, 'bin', 'codex.exe');
  return [path.join(root, 'node_modules', '@openai', `codex-win32-${arch}`, target),
    path.join(root, '..', `codex-win32-${arch}`, target), path.join(root, target)].find(exists) || null;
}
function providerBinary(provider) {
  if (!PROVIDERS.includes(provider)) return null;
  const override = process.env[provider === 'claude' ? 'GALECORE_CLAUDE_BIN' : 'GALECORE_CODEX_BIN'];
  if (override && fs.existsSync(override)) return override;
  if (provider === 'claude') {
    for (const binary of [path.join(os.homedir(), '.local/bin/claude.exe'), path.join(process.env.APPDATA || '', 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe')]) {
      if (fs.existsSync(binary)) return binary;
    }
  }
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [provider], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const found = output.trim().split(/\r?\n/);
    const executable = found.find(binary => process.platform !== 'win32' || binary.toLowerCase().endsWith('.exe'));
    if (executable) return executable;
    if (provider === 'codex' && process.platform === 'win32') {
      for (const wrapper of found) { const native = nativeCodexFromWrapper(wrapper); if (native) return native; }
    }
    return null;
  } catch { return null; }
}
function authCommand(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error('Proveedor desconocido.');
  return provider === 'claude' ? ['auth', 'login'] : ['login'];
}
function authEnvironment() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const key of Object.keys(env)) {
    if (['CLAUDECODE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(key) || key.startsWith('CLAUDE_CODE_')) delete env[key];
  }
  return env;
}
function parseAuthStatus(provider, error, stdout, stderr) {
  if (provider === 'claude') {
    try { const result = JSON.parse(stdout); if (result.loggedIn === false) return 'signed-out'; if (result.loggedIn === true && !error) return 'authenticated'; } catch { /* Unknown CLI output stays unknown. */ }
  } else if (provider === 'codex') {
    const output = stdout + '\n' + stderr;
    if (/not logged in/i.test(output)) return 'signed-out';
    if (!error && /logged in/i.test(output)) return 'authenticated';
  }
  return 'unknown';
}
async function authStatus(provider, binary, execute = execFile) {
  if (!binary) return { id: provider, status: 'not-installed' };
  const args = provider === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'];
  return new Promise(resolve => execute(binary, args, { env: authEnvironment(), windowsHide: true, timeout: 10000, maxBuffer: 65536 }, (error, stdout = '', stderr = '') => {
    resolve({ id: provider, status: parseAuthStatus(provider, error, stdout, stderr) });
  }));
}

// WS-0106: login de Codex con código de dispositivo, lanzado desde el Lab (un proceso por vez).
const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
function parseDeviceLogin(text) {
  const clean = String(text || '').replace(ANSI, '');
  const urls = clean.match(/https:\/\/[^\s]+(?=\s)/g) || [];
  const url = urls.find(u => /^https:\/\/auth\.openai\.com[\/:?#]/.test(u)) || urls[0];
  const code = (clean.match(/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}(?=\s)/) || [])[0];
  return url && code ? { url, code } : null;
}
// Cierra el login; en no-Windows mata el grupo entero (el wrapper de node deja un binario nativo hijo).
function killTree(proc, { platform = process.platform, killProcess = process.kill.bind(process) } = {}) {
  if (platform !== 'win32' && proc.pid) { try { killProcess(-proc.pid, 'SIGTERM'); return; } catch { /* sin grupo: cae al kill directo */ } }
  try { proc.kill(); } catch { /* ya terminó */ }
}
// Re-resuelve los motores que faltan, sin repetir la búsqueda (bloqueante) más de una vez por ventana.
function createBinaryRefresher({ binaries, resolve, now = Date.now, retryMs = 60000, exists = fs.existsSync, ids = ['codex', 'claude'] }) {
  const failedAt = {};
  return () => {
    for (const id of ids) {
      if (binaries[id] && exists(binaries[id])) continue;
      if (failedAt[id] !== undefined && now() - failedAt[id] < retryMs) continue;
      binaries[id] = resolve(id);
      if (binaries[id]) delete failedAt[id]; else failedAt[id] = now();
    }
  };
}
// Login lanzado desde el Lab (un proceso por vez). Codex: código de dispositivo. Claude: enlace y el código que se pega (stdin).
function createLogin({ name, args, parse, pasteCode = false, binary, spawnProcess = spawn, platform = process.platform, killProcess, environment = authEnvironment, timeoutMs = 15 * 60 * 1000, waitMs = 20000 }) {
  let current = null;
  const stop = () => { if (!current) return; const c = current; current = null; clearTimeout(c.timer); killTree(c.proc, { platform, killProcess }); };
  function start() {
    if (current) return current.ready;
    const exe = binary();
    if (!exe) return Promise.reject(Object.assign(new Error(name + ' no está instalado en el Lab.'), { status: 409 }));
    const proc = spawnProcess(exe, args, { env: environment(), windowsHide: true, detached: platform !== 'win32', stdio: [pasteCode ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const c = current = { proc, text: '', info: null };
    c.ready = new Promise((resolve, reject) => {
      const fail = message => { if (current === c) { current = null; clearTimeout(c.timer); } clearTimeout(waiter); killTree(proc, { platform, killProcess }); reject(Object.assign(new Error(message), { status: 502 })); };
      const waiter = setTimeout(() => fail(name + ' no devolvió el código a tiempo.'), waitMs);
      const feed = chunk => { if (c.info || c.text.length > 65536) return; c.text += chunk; { c.info = parse(c.text); if (c.info) { clearTimeout(waiter); resolve(c.info); } } };
      proc.stdout.on('data', feed); proc.stderr.on('data', feed);
      proc.on('error', () => fail('No se pudo iniciar ' + name + '.'));
      proc.on('close', () => { if (current === c) { current = null; clearTimeout(c.timer); } if (!c.info) { clearTimeout(waiter); reject(Object.assign(new Error(name + ' terminó sin dar el código.'), { status: 502 })); } });
    });
    c.ready.catch(() => {});
    c.timer = setTimeout(stop, timeoutMs);
    return c.ready;
  }
  // Entrega el código pegado por el trader a la entrada del proceso; no se guarda ni se registra.
  function submit(code) {
    const value = String(code || '').trim();
    if (!/^[\w#.~-]{8,1024}$/.test(value)) throw Object.assign(new Error('El código no tiene el formato esperado.'), { status: 400 });
    if (!current || !current.info || !current.proc.stdin) throw Object.assign(new Error('No hay una conexión en curso.'), { status: 409 });
    current.proc.stdin.write(value + '\n');
  }
  return { start, submit, cancel: stop, pending: () => !!current };
}
const createCodexLogin = options => createLogin({ ...options, name: 'Codex', args: ['login', '--device-auth'], parse: parseDeviceLogin });
// `claude auth login` imprime «visit: <url>» y espera «Paste code here». Funciona sin terminal.
function parseClaudeLogin(text) {
  const clean = String(text || '').replace(ANSI, '');
  const url = (clean.match(/https:\/\/(?:claude\.com|claude\.ai|platform\.claude\.com)\/[^\s]+(?=\s)/) || [])[0];
  return url && /Paste code/i.test(clean) ? { url } : null;
}
const createClaudeLogin = options => createLogin({ ...options, name: 'Claude Code', args: authCommand('claude'), parse: parseClaudeLogin, pasteCode: true });
module.exports = { createBinaryRefresher, killTree, parseDeviceLogin, parseClaudeLogin, createCodexLogin, createClaudeLogin, PROVIDERS, providerBinary, nativeCodexFromWrapper, authCommand, authEnvironment, parseAuthStatus, authStatus };
