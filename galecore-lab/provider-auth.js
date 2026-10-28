const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

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
module.exports = { PROVIDERS, providerBinary, nativeCodexFromWrapper, authCommand, authEnvironment, parseAuthStatus, authStatus };
