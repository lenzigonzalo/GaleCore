const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { EventEmitter } = require('events');
const { createWorkspaces } = require('./lab-workspaces');

// El CLI del harness se reemplaza por un doble que anota los argumentos y contesta lo que cada caso necesita.
function world(t, { answers = {}, autoSync = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-lab-test-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const kb = path.join(base, 'knowledge'), local = path.join(base, 'local'); fs.mkdirSync(kb); fs.mkdirSync(local);
  fs.mkdirSync(path.join(base, 'galecore-ai')); fs.writeFileSync(path.join(base, 'galecore-ai', 'PRODUCT.md'), 'núcleo');
  const calls = [], procs = [];
  const execute = (cmd, args, opts, cb) => {
    const sub = args.slice(3); calls.push(sub);
    const key = sub.slice(0, 2).join(' '); const answer = typeof answers[key] === 'function' ? answers[key](sub) : answers[key];
    setImmediate(() => answer === undefined ? cb(new Error('x'), JSON.stringify({ error: 'sin respuesta' })) : cb(null, JSON.stringify(answer)));
  };
  const spawnProcess = () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = { write() {}, end() {} }; p.kill = () => {}; procs.push(p); return p; };
  const service = createWorkspaces({ root: base, kb, local, binaries: { claude: 'claude' }, environment: () => ({}), legacyProjects: () => [], legacySessions: () => [], execute, spawnProcess, autoSync });
  return { base, kb, service, calls, procs };
}
async function route(service, method, url, body) { let answer; await service.route({ method }, {}, new URL(url, 'http://localhost'), (res, status, value) => { answer = { status, value }; }, async () => body); return answer; }
const share = (kb, id, extra = {}) => fs.writeFileSync(path.join(kb, 'workspaces', id, '.sync.json'), JSON.stringify({ sharedProjectId: 'p1', lastSeq: 0, files: {}, ...extra }));
const members = [{ username: 'demo', role: 'owner' }, { username: 'gonza', role: 'member' }];
const create = async (service, label) => (await route(service, 'POST', '/workspaces', { label, type: 'analysis' })).value;

test('compartir llama al CLI con el proyecto y el usuario, y devuelve los miembros', async t => {
  const { service, calls } = world(t, { answers: { 'project share': { status: 'SHARED', members, sync: { pulled: 0, pushed: 3, conflicts: [], skipped: [] } } } });
  const p = await create(service, 'Idea SPY');
  const out = await route(service, 'POST', '/workspaces/' + p.id + '/share', { username: ' Gonza ' });
  assert.equal(out.status, 200); assert.deepEqual(calls.at(-1), ['project', 'share', p.id, '--with', 'gonza']);
  assert.deepEqual(out.value.members, members); assert.equal(out.value.owner, 'demo');
});

test('un usuario inválido se rechaza antes de llamar al CLI y Personal no se comparte', async t => {
  const { service, calls } = world(t);
  const p = await create(service, 'Idea');
  for (const bad of ['', 'ab', '-x --all', 'a b c', 'x'.repeat(40)]) await assert.rejects(route(service, 'POST', '/workspaces/' + p.id + '/share', { username: bad }), /usuario de GaleCore/);
  await assert.rejects(route(service, 'POST', '/workspaces/personal/share', { username: 'gonza' }), /personal no se comparte/);
  assert.equal(calls.length, 0);
});

test('un error del CLI llega al usuario con su mensaje', async t => {
  const { service } = world(t, { answers: { 'project share': { error: "no existe el usuario 'nadie'" } } });
  const p = await create(service, 'Idea');
  await assert.rejects(route(service, 'POST', '/workspaces/' + p.id + '/share', { username: 'nadie' }), /no existe el usuario/);
});

test('el estado de compartir sale del CLI, sólo del proyecto compartido de esta carpeta', async t => {
  const { kb, service, calls } = world(t, { answers: { 'project shared': { projects: [{ id: 'otro', members: [], mine: true }, { id: 'p1', members, owner: 'demo', mine: true }] } } });
  const p = await create(service, 'Idea');
  assert.deepEqual((await route(service, 'GET', '/workspaces/' + p.id + '/sharing')).value, { shared: false, members: [], notice: null }); assert.equal(calls.length, 0);
  share(kb, p.id);
  const on = (await route(service, 'GET', '/workspaces/' + p.id + '/sharing')).value;
  assert.deepEqual([on.shared, on.owner, on.mine, on.members.length], [true, 'demo', true, 2]);
});

test('la lista marca los compartidos; sincronizar avisa los conflictos hasta que se cierran', async t => {
  const conflicts = [{ path: 'README.md', with: 'gonza', copy: 'README (conflicto gonza 2026-10-28).md', kind: 'editado-en-ambos' }];
  const { kb, service, calls } = world(t, { answers: { 'project sync': { status: 'SYNCED', pulled: 1, pushed: 0, conflicts, skipped: [] } } });
  const p = await create(service, 'Idea');
  await assert.rejects(route(service, 'POST', '/workspaces/' + p.id + '/sync'), /no está compartido/); assert.equal(calls.length, 0);
  share(kb, p.id);
  const out = await route(service, 'POST', '/workspaces/' + p.id + '/sync');
  assert.deepEqual(calls.at(-1), ['project', 'sync', p.id]); assert.equal(out.value.notice.conflicts[0].with, 'gonza');
  const listed = (await route(service, 'GET', '/workspaces')).value.projects;
  assert.equal(listed.find(x => x.id === p.id).shared, true); assert.equal(listed.find(x => x.id === p.id).syncNotice.conflicts.length, 1);
  assert.equal(listed.find(x => x.id === 'personal').shared, undefined);
  await route(service, 'POST', '/workspaces/' + p.id + '/notice');
  assert.equal((await route(service, 'GET', '/workspaces')).value.projects.find(x => x.id === p.id).syncNotice, null);
});

test('dos sincronizaciones del mismo proyecto comparten una sola corrida del CLI', async t => {
  const { kb, service, calls } = world(t, { answers: { 'project sync': { pulled: 0, pushed: 0, conflicts: [], skipped: [] } } });
  const p = await create(service, 'Idea'); share(kb, p.id);
  await Promise.all([route(service, 'POST', '/workspaces/' + p.id + '/sync'), route(service, 'POST', '/workspaces/' + p.id + '/sync')]);
  assert.equal(calls.filter(c => c[1] === 'sync').length, 1);
});

test('al terminar un turno se sincroniza sólo si el proyecto está compartido', async t => {
  const { kb, service, calls, procs } = world(t, { answers: { 'project sync': { pulled: 0, pushed: 1, conflicts: [], skipped: [] } } });
  const mine = await create(service, 'Solo mío');
  const shared = await create(service, 'Con Gonza'); share(kb, shared.id);
  for (const p of [mine, shared]) {
    const chat = (await route(service, 'POST', '/chats', { project: p.id, provider: 'claude' })).value;
    await route(service, 'POST', '/chats/' + chat.id + '/messages', { text: 'hola' });
    while (!procs.length) await new Promise(r => setImmediate(r));
    procs.pop().emit('close', 0);
    await new Promise(r => setTimeout(r, 30));
  }
  assert.deepEqual(calls.map(c => c.join(' ')), ['project sync ' + shared.id]);
});

test('al arrancar trae lo compartido conmigo; sin autoSync no llama al CLI', async t => {
  const on = world(t, { autoSync: true, answers: { 'project sync': { status: 'SYNCED', projects: {}, created: [], skipped: [], errors: {} } } });
  await new Promise(r => setTimeout(r, 30)); assert.deepEqual(on.calls, [['project', 'sync', '--all']]);
  const off = world(t); await new Promise(r => setTimeout(r, 30)); assert.deepEqual(off.calls, []);
});

test('el archivo de estado no aparece en Archivos', async t => {
  const { kb, service } = world(t);
  const p = await create(service, 'Idea'); share(kb, p.id);
  fs.mkdirSync(path.join(kb, 'workspaces', p.id, '.scratch'));
  const names = (await route(service, 'GET', '/workspaces/' + p.id + '/files')).value.tree.map(n => n.name);
  assert.ok(names.includes('README.md') && !names.some(n => n.startsWith('.')));
});

test('abrir el proyecto no repite la sincronización de hace menos de 20 segundos; la manual sí', async t => {
  const { kb, service, calls } = world(t, { answers: { 'project sync': { pulled: 0, pushed: 0, conflicts: [], skipped: [] } } });
  const p = await create(service, 'Idea'); share(kb, p.id);
  const sync = body => route(service, 'POST', '/workspaces/' + p.id + '/sync', body);
  await sync({ auto: true }); const again = await sync({ auto: true });
  assert.equal(again.value.recent, true); assert.equal(calls.length, 1);
  await sync({}); assert.equal(calls.length, 2);
});

test('un sync que falla deja un aviso de una línea con el motivo y el siguiente que sale bien lo limpia', async t => {
  let fail = 'GaleCore did not answer at http://x: ConnectError';
  const { kb, service } = world(t, { answers: { 'project sync': () => fail ? { error: fail } : { pulled: 0, pushed: 0, conflicts: [], skipped: [] } } });
  const p = await create(service, 'Idea'); share(kb, p.id);
  const noticeOf = async () => (await route(service, 'GET', '/workspaces')).value.projects.find(x => x.id === p.id).syncNotice;
  await assert.rejects(route(service, 'POST', '/workspaces/' + p.id + '/sync'), /did not answer/);
  assert.equal((await noticeOf()).error, 'sin conexión con GaleCore');
  fail = 'no credentials: set GALECORE_USERNAME and GALECORE_PASSWORD';
  await assert.rejects(route(service, 'POST', '/workspaces/' + p.id + '/sync'));
  assert.equal((await noticeOf()).error, 'faltan las credenciales de GaleCore');
  fail = null;
  await route(service, 'POST', '/workspaces/' + p.id + '/sync');
  assert.equal(await noticeOf(), null);
});

test('si falla el sync de arranque, cada proyecto compartido muestra el motivo; los errores por proyecto también', async t => {
  const { createSharing } = require('./lab-sharing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-lab-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.sync.json'), '{}');
  const projects = [{ id: 'a', dir }, { id: 'b', dir: path.join(dir, 'nada') }];
  let answer = { error: 'no credentials: set GALECORE_USERNAME' };
  const execute = (c, a, o, cb) => setImmediate(() => cb(null, JSON.stringify(answer)));
  const sharing = createSharing({ root: dir, kb: dir, environment: () => ({}), execute });
  await assert.rejects(sharing.syncAll(() => projects));
  assert.equal(sharing.notice(projects[0]).error, 'faltan las credenciales de GaleCore'); assert.equal(sharing.notice(projects[1]), null);
  answer = { projects: {}, errors: { a: 'GaleCore did not answer at x: ConnectError' } };
  await sharing.syncAll(() => projects);
  assert.equal(sharing.notice(projects[0]).error, 'sin conexión con GaleCore');
  answer = { projects: { a: { pulled: 0, pushed: 0, conflicts: [] } }, errors: {} };
  await sharing.syncAll(() => projects);
  assert.equal(sharing.notice(projects[0]), null);
});

test('el motor predeterminado sale de GALECORE_LAB_PROVIDER (claude) y sin la variable sigue siendo codex', async t => {
  const original = process.env.GALECORE_LAB_PROVIDER; t.after(() => { if (original === undefined) delete process.env.GALECORE_LAB_PROVIDER; else process.env.GALECORE_LAB_PROVIDER = original; });
  const { service } = world(t);
  delete process.env.GALECORE_LAB_PROVIDER; assert.equal((await route(service, 'GET', '/workspaces')).value.defaultProvider, 'codex');
  process.env.GALECORE_LAB_PROVIDER = 'claude'; assert.equal((await route(service, 'GET', '/workspaces')).value.defaultProvider, 'claude');
  process.env.GALECORE_LAB_PROVIDER = 'otro'; assert.equal((await route(service, 'GET', '/workspaces')).value.defaultProvider, 'codex');
});
