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
