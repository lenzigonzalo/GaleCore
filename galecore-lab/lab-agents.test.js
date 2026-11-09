const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createAgents } = require('./lab-agents');

function setup(t, { pending = [{ key: 'resumen-diario' }], exit = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-lab-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'galecore-lab', 'skills', 'agentes-nube'), { recursive: true });
  fs.writeFileSync(path.join(root, 'galecore-lab', 'skills', 'agentes-nube', 'SKILL.md'), 'SKILL agentes-nube');
  const calls = { cli: [], spawn: [] };
  const execute = (cmd, args, opts, cb) => { calls.cli.push(args.join(' ')); cb(null, JSON.stringify({ pending })); };
  const procs = [];
  const spawnProcess = (bin, args, opts) => {
    const proc = Object.assign(new EventEmitter(), { killed: false, kill() { this.killed = true; } });
    calls.spawn.push({ bin, args, opts }); procs.push(proc);
    if (exit !== null) setImmediate(() => proc.emit('close', exit));
    return proc;
  };
  const agents = createAgents({ root, environment: () => ({ X: '1' }), binary: 'claude', execute, spawnProcess, timeoutMs: 50 });
  return { agents, calls, procs };
}

test('sin pendientes no lanza nada', async t => {
  const { agents, calls } = setup(t, { pending: [] });
  assert.equal(await agents.applyOnce(), 'idle');
  assert.equal(calls.spawn.length, 0);
  assert.match(calls.cli[0], /agent pending$/);
});

test('con pendientes lanza Claude sin chat con la skill y sólo RemoteTrigger y el comando agent', async t => {
  const { agents, calls } = setup(t);
  assert.equal(await agents.applyOnce(), 'done');
  const { bin, args } = calls.spawn[0];
  assert.equal(bin, 'claude');
  assert.equal(args[0], '-p');
  assert.match(args[1], /SKILL agentes-nube/);
  assert.match(args[1], /resumen-diario/);
  assert.deepEqual(args.slice(2), ['--model', 'haiku', '--allowedTools', 'RemoteTrigger', 'Bash(python -m galecore_ai.adapters.cli agent:*)']);
});

test('una aplicación a la vez; al terminar se puede otra', async t => {
  const { agents, procs } = setup(t, { exit: null });
  const first = agents.applyOnce();
  for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r));
  assert.equal(agents.isBusy(), true);
  assert.equal(await agents.applyOnce(), 'busy');
  procs[0].emit('close', 0);
  assert.equal(await first, 'done');
  assert.equal(agents.isBusy(), false);
});

test('un proceso que falla o se pasa del tiempo se corta y no deja el Lab ocupado', async t => {
  const failing = setup(t, { exit: 1 });
  assert.equal(await failing.agents.applyOnce(), 'failed');
  const hung = setup(t, { exit: null });
  assert.equal(await hung.agents.applyOnce(), 'failed');
  assert.equal(hung.procs[0].killed, true);
  assert.equal(hung.agents.isBusy(), false);
});

test('sin el motor Claude no hace nada', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-lab-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agents = createAgents({ root, environment: () => ({}), binary: null, execute: () => assert.fail('no corre nada') });
  assert.equal(await agents.applyOnce(), 'busy');
  agents.start();
  agents.stop();
});
