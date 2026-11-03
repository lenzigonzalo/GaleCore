const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdater } = require('./lab-update');

const H = 'a'.repeat(40), N = 'b'.repeat(40);   // commit del Lab y el nuevo (el de la web)

// git simulado. `known`: commits que existen; `onMain`: los alcanzables desde origin/main; HEAD está detrás de N.
function fake({ branch = 'main', status = '', head = H, headAfter = N, known = [H, N], onMain = [H, N], fetch = null, pull = null, changed = '', busyFor = 0, ahead = false } = {}) {
  const calls = [];
  let pulled = false, busyLeft = busyFor, restarts = 0;
  const notices = [];
  const git = async args => {
    calls.push(args.join(' '));
    const [k, a1, a2, a3] = args;
    if (k === 'rev-parse' && a1 === '--abbrev-ref') return branch + '\n';
    if (k === 'status') return status;
    if (k === 'rev-parse' && a1 === '--verify') { const sha = a3.replace('^{commit}', ''); if (!known.includes(sha)) throw new Error('no existe'); return sha + '\n'; }
    if (k === 'rev-parse') return (pulled ? headAfter : head) + '\n';
    if (k === 'fetch') { if (fetch) throw fetch; return ''; }
    if (k === 'merge-base') {
      if (a3 === 'origin/main') { if (!onMain.includes(a2)) throw new Error('no'); return ''; }
      if (a2 === H && a3 === N) return '';   // HEAD detrás de N
      if (ahead && a2 === N && a3 === head) return '';   // la web (N) detrás de HEAD
      throw new Error('no');
    }
    if (k === 'pull') { if (pull) throw pull; pulled = true; return ''; }
    if (k === 'diff') return changed;
    throw new Error('inesperado ' + args);
  };
  const u = createUpdater({ git, busy: () => busyLeft-- > 0, restart: () => { restarts++; }, sleep: async () => {}, onNotice: t => notices.push(t) });
  return { u, calls, notices, restarts: () => restarts };
}
const settle = () => new Promise(r => setTimeout(r, 20));

test('commit de la web igual al del Lab: no hace nada', async () => {
  const f = fake();
  assert.equal(await f.u.request(H), 'current');
  assert.ok(!f.calls.some(c => c.startsWith('fetch') || c.startsWith('pull')));
});

test('commit distinto y en main: hace pull ff-only y reinicia', async () => {
  const f = fake({ changed: 'galecore-lab/lab-server.js\n' });
  assert.equal(await f.u.request(N), 'updating');
  await settle();
  assert.ok(f.calls.includes('fetch origin main'));
  assert.ok(f.calls.includes('pull --ff-only origin main'));
  assert.equal(f.restarts(), 1);
  assert.equal(f.u.notice(), null);
});

test('ocupado: espera a que termine y recién ahí hace pull', async () => {
  const f = fake({ busyFor: 3 });
  assert.equal(await f.u.request(N), 'updating');
  await settle();
  assert.equal(f.restarts(), 1);
  assert.ok(f.calls.indexOf('pull --ff-only origin main') > -1);
});

test('pull que falla: no reinicia, deja el aviso y no reintenta en loop', async () => {
  const f = fake({ pull: new Error('From origin\nfatal: Not possible to fast-forward, aborting.') });
  assert.equal(await f.u.request(N), 'updating');
  await settle();
  assert.equal(f.restarts(), 0);
  assert.match(f.u.notice(), /^El Lab no se pudo actualizar solo: fatal: Not possible/);
  assert.equal(await f.u.request(N), 'tried');
  assert.equal(f.calls.filter(c => c.startsWith('pull')).length, 1);
});

test('segundo pedido mientras actualiza: no duplica', async () => {
  const f = fake({ busyFor: 2 });
  assert.equal(await f.u.request(N), 'updating');
  assert.equal(await f.u.request(N), 'working');
  await settle();
  assert.equal(f.calls.filter(c => c.startsWith('pull')).length, 1);
});

test('rama que no es main: no hace nada', async () => {
  const f = fake({ branch: 'development' });
  assert.equal(await f.u.request(N), 'skip');
  assert.ok(!f.calls.some(c => c.startsWith('fetch') || c.startsWith('pull')));
  assert.equal(f.restarts(), 0);
});

test('cambios locales: no hace nada', async () => {
  const f = fake({ status: ' M galecore-lab/lab-server.js\n' });
  assert.equal(await f.u.request(N), 'skip');
  assert.ok(!f.calls.some(c => c.startsWith('pull')));
});

test('copia local divergida de main: avisa y no actualiza', async () => {
  const f = fake({ head: 'c'.repeat(40) });
  assert.equal(await f.u.request(N), 'diverged');
  assert.match(f.u.notice(), /cambios propios/);
  assert.ok(!f.calls.some(c => c.startsWith('pull')));
});

test('Lab más adelante que la web (pull antes de que termine el deploy): no avisa ni actualiza', async () => {
  const f = fake({ head: 'c'.repeat(40), ahead: true });
  assert.equal(await f.u.request(N), 'ahead');
  assert.equal(f.u.notice(), null);
  assert.ok(!f.calls.some(c => c.startsWith('pull')));
});

test('el aviso de «cambios propios» se borra cuando la web alcanza al Lab', async () => {
  const C = 'c'.repeat(40);
  const f = fake({ head: C, known: [H, N, C], onMain: [H, N, C] });
  assert.equal(await f.u.request(N), 'diverged');
  assert.match(f.u.notice(), /cambios propios/);
  assert.equal(await f.u.request(C), 'current');
  assert.equal(f.u.notice(), null);
});

test('commit desconocido o que no está en main: no hace nada', async () => {
  const unknown = fake({ known: [H] });
  assert.equal(await unknown.u.request(N), 'unknown');
  const offMain = fake({ onMain: [H] });
  assert.equal(await offMain.u.request(N), 'unknown');
  for (const f of [unknown, offMain]) assert.ok(!f.calls.some(c => c.startsWith('pull')));
});

test('commit mal formado: se rechaza', async () => {
  const f = fake();
  for (const bad of [undefined, '', 'HEAD', '--upload-pack=x', 'zzzzzzz', 42]) assert.equal(await f.u.request(bad), 'invalid');
  assert.equal(f.calls.length, 0);
});

test('sin red al traer origin: avisa y no actualiza', async () => {
  const f = fake({ fetch: new Error('fatal: unable to access') });
  assert.equal(await f.u.request(N), 'failed');
  assert.match(f.u.notice(), /no se pudo actualizar solo/);
  assert.equal(f.restarts(), 0);
});

test('cambiaron dependencias: no reinicia y avisa del instalador', async () => {
  const f = fake({ changed: 'galecore-lab/package-lock.json\n' });
  assert.equal(await f.u.request(N), 'updating');
  await settle();
  assert.equal(f.restarts(), 0);
  assert.match(f.u.notice(), /corré el instalador/);
});

test('info: commit al arrancar y si es actualizable', async () => {
  const f = fake();
  await f.u.init();
  assert.deepEqual({ commit: f.u.info().commit, updatable: f.u.info().updatable }, { commit: H, updatable: true });
  const dev = fake({ branch: 'development' });
  await dev.u.init();
  assert.equal(dev.u.info().updatable, false);
  assert.equal(dev.u.info().commit, H);
});
