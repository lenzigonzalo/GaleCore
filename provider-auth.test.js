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
