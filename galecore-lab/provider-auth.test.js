const test = require('node:test');
const assert = require('node:assert/strict');
const { authCommand, parseAuthStatus, authStatus, authEnvironment, nativeCodexFromWrapper } = require('./provider-auth');
test('only fixed login commands, no arbitrary provider or shell', () => {
  assert.deepEqual(authCommand('claude'), ['auth', 'login']);
  assert.deepEqual(authCommand('codex'), ['login']);
  assert.throws(() => authCommand('codex; arbitrary'));
});
test('status sanitizes account details and does not infer authentication from failed probes', async () => {
  assert.equal(parseAuthStatus('claude', null, '{"loggedIn":true,"email":"private","apiKey":"secret"}', ''), 'authenticated');
  assert.equal(parseAuthStatus('claude', new Error(), '{"loggedIn":false}', ''), 'signed-out');
  assert.equal(parseAuthStatus('claude', new Error('timeout'), '{"loggedIn":true}', ''), 'unknown');
  assert.equal(parseAuthStatus('codex', null, '', 'Logged in using ChatGPT'), 'authenticated');
  assert.equal(parseAuthStatus('codex', new Error(), '', 'Not logged in'), 'signed-out');
  assert.equal(parseAuthStatus('codex', null, '', 'Not logged in'), 'signed-out');
  assert.equal(parseAuthStatus('codex', new Error('timeout'), '', ''), 'unknown');
  assert.deepEqual(await authStatus('claude', null), { id: 'claude', status: 'not-installed' });
  const result = await authStatus('claude', 'binary', (_bin, args, options, cb) => { assert.deepEqual(args, ['auth', 'status', '--json']); cb(null, '{"loggedIn":true,"email":"private"}', ''); });
  assert.deepEqual(result, { id: 'claude', status: 'authenticated' });
});
test('authentication uses CLI account store, without inherited API keys', () => {
  assert.equal(authEnvironment().OPENAI_API_KEY, undefined);
  assert.equal(authEnvironment().ANTHROPIC_API_KEY, undefined);
  assert.equal(authEnvironment().CLAUDE_CODE_OAUTH_TOKEN, undefined);
});
test('npm Codex wrapper resolves native Windows binary, without running a command shell', () => {
  const path = require('path');
  const wrapper = path.join('test-npm', 'codex.cmd');
  const expected = path.join('test-npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  assert.equal(nativeCodexFromWrapper(wrapper, value => value === expected, 'x64'), expected);
  assert.equal(nativeCodexFromWrapper(wrapper, () => false, 'x64'), null);
});
const { EventEmitter } = require('events');
const { parseDeviceLogin, createCodexLogin } = require('./provider-auth');
const SALIDA = '\nWelcome to Codex [v\u001b[90m0.169.0\u001b[0m]\n1. Open this link\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n   \u001b[94mYP05-MWBNI\u001b[0m\n';
function fakeProc() { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.killed = false; p.kill = () => { p.killed = true; p.emit('close', 1); }; return p; }
test('parseDeviceLogin lee URL y código sin depender de colores', () => {
  assert.deepEqual(parseDeviceLogin(SALIDA), { url: 'https://auth.openai.com/codex/device', code: 'YP05-MWBNI' });
  assert.equal(parseDeviceLogin('Welcome to Codex'), null);
});
test('login de Codex: un proceso por vez, devuelve url/código y se corta', async () => {
  const procs = []; const calls = [];
  const login = createCodexLogin({ binary: () => 'codex', environment: () => ({}), spawnProcess: (bin, args) => { calls.push([bin, args]); const p = fakeProc(); procs.push(p); return p; } });
  const first = login.start();
  procs[0].stdout.emit('data', SALIDA.slice(0, 60));
  procs[0].stdout.emit('data', SALIDA.slice(60));
  assert.deepEqual(await first, { url: 'https://auth.openai.com/codex/device', code: 'YP05-MWBNI' });
  assert.deepEqual(calls, [['codex', ['login', '--device-auth']]]);
  assert.deepEqual(await login.start(), { url: 'https://auth.openai.com/codex/device', code: 'YP05-MWBNI' });
  assert.equal(procs.length, 1); assert.equal(login.pending(), true);
  login.cancel(); assert.equal(procs[0].killed, true); assert.equal(login.pending(), false);
});
test('login de Codex: termina solo al completar, falla sin binario o sin código, y vence por tiempo', async () => {
  const none = createCodexLogin({ binary: () => null });
  await assert.rejects(() => none.start(), /no está instalado/);
  const procs = [];
  const sp = () => { const p = fakeProc(); procs.push(p); return p; };
  const login = createCodexLogin({ binary: () => 'codex', spawnProcess: sp, timeoutMs: 20 });
  const ready = login.start(); procs[0].stdout.emit('data', SALIDA); await ready;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(procs[0].killed, true); assert.equal(login.pending(), false);
  const done = createCodexLogin({ binary: () => 'codex', spawnProcess: sp });
  const r2 = done.start(); procs[1].stdout.emit('data', SALIDA); await r2; procs[1].emit('close', 0);
  assert.equal(done.pending(), false);
  const dead = createCodexLogin({ binary: () => 'codex', spawnProcess: sp });
  const r3 = dead.start(); procs[2].emit('close', 1);
  await assert.rejects(() => r3, /sin dar el código/);
});
const { createBinaryRefresher, killTree } = require('./provider-auth');
test('refresco de binarios: no repite la búsqueda fallida dentro de la ventana y toma el motor instalado después', () => {
  const binaries = { codex: null, claude: '/bin/claude' }; let t = 0; const calls = [];
  const refresh = createBinaryRefresher({ binaries, now: () => t, exists: () => true, resolve: id => { calls.push(id); return null; } });
  refresh(); refresh(); refresh();
  assert.deepEqual(calls, ['codex']);
  t = 61000; refresh(); assert.deepEqual(calls, ['codex', 'codex']);
  const found = createBinaryRefresher({ binaries, now: () => t, exists: () => true, resolve: () => '/bin/codex' });
  t = 200000; found(); assert.equal(binaries.codex, '/bin/codex');
});
test('login de Codex: en Linux corre desacoplado y se corta el grupo; en Windows, kill directo', async () => {
  const opts = []; const killed = [];
  const proc = fakeProc(); proc.pid = 4321;
  const login = createCodexLogin({ binary: () => 'codex', platform: 'linux', spawnProcess: (b, a, o) => { opts.push(o); return proc; }, killProcess: (pid, sig) => killed.push([pid, sig]) });
  const ready = login.start(); proc.stdout.emit('data', SALIDA); await ready;
  assert.equal(opts[0].detached, true);
  login.cancel(); assert.deepEqual(killed, [[-4321, 'SIGTERM']]);
  const direct = fakeProc(); direct.pid = 9;
  killTree(direct, { platform: 'win32', killProcess: () => assert.fail('no debe matar grupo') }); assert.equal(direct.killed, true);
  const fallback = fakeProc(); fallback.pid = 8;
  killTree(fallback, { platform: 'linux', killProcess: () => { throw new Error('ESRCH'); } }); assert.equal(fallback.killed, true);
});
test('parseDeviceLogin prefiere el enlace de auth.openai.com aunque venga otro antes', () => {
  const out = 'Docs: https://developers.openai.com/codex\n1. Open\n  https://auth.openai.com/codex/device\n2. code\n  AB12-CD34EF\n';
  assert.deepEqual(parseDeviceLogin(out), { url: 'https://auth.openai.com/codex/device', code: 'AB12-CD34EF' });
  assert.equal(parseDeviceLogin('https://example.com/x\nAB12-CD34EF\n').url, 'https://example.com/x');
});
test('login de Codex: un segundo pedido concurrente devuelve lo mismo sin lanzar otro proceso', async () => {
  let spawned = 0; const proc = fakeProc();
  const login = createCodexLogin({ binary: () => 'codex', spawnProcess: () => { spawned++; return proc; } });
  const a = login.start(); const b = login.start();
  proc.stdout.emit('data', SALIDA);
  assert.deepEqual(await a, await b); assert.equal(spawned, 1);
  login.cancel();
});
const { parseClaudeLogin, createClaudeLogin } = require('./provider-auth');
const SALIDA_CLAUDE = 'Opening browser to sign in…\nIf the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=abc\nPaste code here if prompted > ';
test('login de Claude: lee el enlace, entrega el código por stdin y se corta', async () => {
  const writes = []; const calls = []; const opts = []; const p = fakeProc(); p.stdin = { write: d => writes.push(d) };
  const login = createClaudeLogin({ binary: () => 'claude', environment: () => ({}), spawnProcess: (b, a, o) => { calls.push([b, a]); opts.push(o); return p; } });
  assert.equal(parseClaudeLogin('visit: https://claude.com/x'), null);
  const ready = login.start(); p.stdout.emit('data', SALIDA_CLAUDE.slice(0, 50)); p.stdout.emit('data', SALIDA_CLAUDE.slice(50));
  assert.deepEqual(await ready, { url: 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=abc' });
  assert.deepEqual(calls, [['claude', ['auth', 'login']]]); assert.equal(opts[0].stdio[0], 'pipe');
  assert.throws(() => login.submit('mal formato!'), /formato/);
  login.submit(' abcDEF123#stateXYZ '); assert.deepEqual(writes, ['abcDEF123#stateXYZ\n']);
  assert.equal(login.pending(), true); login.cancel(); assert.equal(p.killed, true); assert.equal(login.pending(), false);
  assert.throws(() => login.submit('abcDEF123#stateXYZ'), /en curso/);
});
