/**
 * Proyectos compartidos en el Lab (WS-0064 Fase 2b). La sincronización la hace el CLI del harness
 * (`project share|unshare|shared|sync`, galecore-ai); el Lab sólo lo invoca: al arrancar (`sync --all`), al abrir un
 * proyecto, al terminar cada turno y a pedido del usuario. Un proyecto sin `.sync.json` no se toca nunca.
 */
const fs = require('fs');
const path = require('path');

const SYNC_FILE = '.sync.json';
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// La cache de sesión del CLI (galecore_space.session_file): %LOCALAPPDATA%/GaleCore/session.json.
const defaultSessionFile = () => process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'GaleCore', 'session.json')
  : path.join(require('os').homedir(), '.galecore', 'session.json');

function createSharing({ root, kb, environment, execute, request = fetch, sessionFile = defaultSessionFile }) {
  const running = new Map();   // proyecto -> promesa de su sync en curso (nunca dos a la vez sobre la misma carpeta)
  const notices = new Map();   // proyecto -> { at, conflicts } hasta que el usuario lo cierra
  const lastRun = new Map();   // proyecto -> hora de su última sincronización
  let catalogRun = null;

  const isShared = p => !!p.dir && fs.existsSync(path.join(p.dir, SYNC_FILE));
  const state = p => { try { return JSON.parse(fs.readFileSync(path.join(p.dir, SYNC_FILE), 'utf8')); } catch { return null; } };
  const isRunning = p => running.has(p.id);
  const isFollowing = p => state(p)?.subscribed === true;

  function cli(args) {
    return new Promise((resolve, reject) => execute('python', ['-B', '-m', 'galecore_ai.adapters.cli', ...args],
      { cwd: root, env: { ...environment(), GALECORE_KNOWLEDGE_DIR: kb }, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
      (error, out) => {
        let data = null;
        try { data = JSON.parse(out); } catch { /* sin JSON: falla de arranque del CLI */ }
        if (error || !data || data.error) return reject(fail(data?.error || 'No se pudo consultar a GaleCore para compartir proyectos.', 502));
        resolve(data);
      }));
  }

  // Un sync que salió bien limpia el error anterior (el aviso de conflictos, si lo hay, queda hasta que se cierra).
  function remember(p, summary) {
    const conflicts = summary?.conflicts || [];
    const old = notices.get(p.id);
    if (conflicts.length || summary?.skipped?.length) notices.set(p.id, { at: new Date().toISOString(), conflicts, skipped: summary.skipped || [] });
    else if (old?.conflicts.length) notices.set(p.id, { at: old.at, conflicts: old.conflicts });
    else notices.delete(p.id);
  }

  // El último error de sync de un proyecto, en el mismo aviso de una línea que usa la UI para los conflictos.
  function reason(message) {
    const m = String(message || '');
    if (/no credentials/i.test(m)) return 'faltan las credenciales de GaleCore';
    if (/did not answer|timed out|ENOTFOUND|ECONN/i.test(m)) return 'sin conexión con GaleCore';
    if (/HTTP 429/.test(m)) return 'GaleCore pidió esperar unos minutos';
    if (/HTTP 401|HTTP 403/.test(m)) return 'GaleCore no aceptó la sesión';
    return m || 'GaleCore no respondió';
  }
  function failed(p, message) {
    notices.set(p.id, { at: new Date().toISOString(), conflicts: notices.get(p.id)?.conflicts || [], error: reason(message) });
  }

  // `busy(p)`: hay un turno del motor escribiendo en el proyecto; traer cambios ajenos en ese momento los pisaría.
  // `minInterval`: las sincronizaciones «de cortesía» (al abrir el proyecto) no se repiten antes de ese tiempo: cada una
  // inicia sesión en GaleCore y el login tiene límite (10 cada 5 minutos). La de fin de turno y la manual no lo usan.
  function sync(p, { busy = () => false, minInterval = 0 } = {}) {
    if (!isShared(p)) return Promise.resolve(null);
    if (state(p)?.subscribed !== true) return Promise.resolve({ paused: true });
    if (running.has(p.id)) return running.get(p.id);
    if (minInterval && Date.now() - (lastRun.get(p.id) || 0) < minInterval) return Promise.resolve({ recent: true, pulled: 0, pushed: 0, conflicts: [], skipped: [] });
    lastRun.set(p.id, Date.now());
    if (busy(p)) return Promise.resolve({ busy: true, pulled: 0, pushed: 0, conflicts: [], skipped: [] });
    const job = cli(['project', 'sync', p.id]).then(summary => { remember(p, summary); return summary; },
      err => { failed(p, err.message); throw err; })
      .finally(() => running.delete(p.id));
    running.set(p.id, job);
    return job;
  }

  // Discovery is read-only. It never downloads a newly shared project.
  async function catalog({ busy = () => false } = {}) {
    if (!catalogRun) catalogRun = cli(['project', 'shared']).finally(() => { catalogRun = null; });
    const out = await catalogRun;
    return { ...out, projects: (out.projects || []).map(p => ({ ...p, notice: notices.get(p.local) || null,
      working: !!p.local && busy({id:p.local}), syncing: running.has(p.local) || running.has('remote:' + p.id) })) };
  }

  async function syncAll(projectsOf, { busy = () => false } = {}) {
    let listing;
    try { listing = await catalog({busy}); }
    catch (err) { for (const p of projectsOf()) if (isShared(p)) failed(p, err.message); throw err; }
    const out = { projects: {}, errors: {}, created: [] };
    for (const remote of listing.projects) {
      if (!remote.subscribed) continue;
      const p = projectsOf().find(p => p.id === remote.local);
      if (!p) continue;
      try { out.projects[p.id] = await sync(p, { busy, minInterval: 20000 }); }
      catch (err) { out.errors[p.id] = err.message; }
    }
    return out;
  }

  async function subscribe(id, enabled, projectsOf, { busy = () => false } = {}) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw fail('Proyecto desconocido.');
    const listing = await catalog();
    const remote = listing.projects.find(p => p.id === id);
    if (!remote) throw fail('El proyecto no está disponible para este usuario y entorno.', 404);
    const p = remote.local && projectsOf().find(p => p.id === remote.local);
    if (p && (busy(p) || isRunning(p))) throw fail('El proyecto está trabajando. Esperá a que termine para cambiar el seguimiento.', 409);
    const key = p ? p.id : 'remote:' + id;
    if (running.has(key)) return running.get(key);
    const job = cli(['project', enabled ? 'subscribe' : 'pause', id]).finally(() => running.delete(key));
    running.set(key, job);
    const result = await job;
    const local = projectsOf().find(p => p.id === result.project);
    if (enabled && local) {
      try { result.sync = await sync(local, { busy }); }
      catch (err) { result.error = err.message; }
    }
    return result;
  }

  async function status(p) {
    const own = state(p);
    if (!own) return { shared: false, members: [] };
    const listing = await cli(['project', 'shared']);
    const remote = (listing.projects || []).find(r => r.id === own.sharedProjectId && !r.removed);
    if (!remote) return { shared: true, members: [], owner: null, mine: false, removed: true };
    return { shared: true, members: remote.members, owner: remote.owner, mine: !!remote.mine };
  }

  function username(body) {
    const name = String(body.username || '').trim().toLowerCase();
    if (!USERNAME.test(name)) throw fail('Escribí el usuario de GaleCore de la otra persona.');
    return name;
  }

  async function share(p, body, { busy = () => false } = {}) {
    if (p.id === 'personal') throw fail('El espacio personal no se comparte.');
    const name = username(body);
    if (busy(p) || isRunning(p)) throw fail('El proyecto está trabajando. Esperá a que termine para compartir.', 409);
    const job = cli(['project', 'share', p.id, '--with', name]).finally(() => running.delete(p.id));
    running.set(p.id, job);
    const result = await job;
    remember(p, result.sync);
    return { shared: true, members: result.members, owner: result.members.find(m => m.role === 'owner')?.username || null, mine: true };
  }

  async function unshare(p, body) {
    const result = await cli(['project', 'unshare', p.id, '--with', username(body)]);
    return { shared: true, members: result.members, mine: true };
  }

  // Sugerencias de usuarios para el modal de compartir (usuario y nombre, nunca el mail). Se escriben letra a letra:
  // arrancar el CLI cada vez tarda ~1,5 s, así que se pide directo a la API con el token que el CLI ya dejó en su
  // cache de sesión; sin token vigente (o si la llamada falla) va por el CLI, que lo renueva. Un minuto de memoria.
  const found = new Map();   // texto -> { at, users }
  function cachedToken() {
    const env = environment();
    const base = (env.GALECORE_BASE_URL || process.env.GALECORE_BASE_URL || 'http://localhost:7001').replace(/\/+$/, '');
    const user = env.GALECORE_USERNAME || process.env.GALECORE_USERNAME || 'demo';   // mismo usuario que resuelve el CLI
    try {
      const entry = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'))[user + '@' + base];
      if (entry && entry.token && entry.exp - 60 > Date.now() / 1000) return { base, token: entry.token };
    } catch { /* sin cache: va por el CLI */ }
    return null;
  }
  async function direct(text) {
    const session = cachedToken();
    if (!session) return null;
    try {
      const r = await request(session.base + '/App/GaleCore/Users/Search?q=' + encodeURIComponent(text),
        { headers: { Accept: 'application/json', Authorization: 'Bearer ' + session.token }, signal: AbortSignal.timeout(5000) });
      return r.ok ? (await r.json()).users || [] : null;
    } catch { return null; }
  }
  async function searchUsers(q) {
    const text = String(q || '').trim().slice(0, 64);
    if (text.length < 2) return { users: [] };
    const hit = found.get(text);
    if (hit && Date.now() - hit.at < 60000) return { users: hit.users };
    const raw = (await direct(text)) || (await cli(['users', 'search', text])).users || [];
    const users = raw.map(u => ({ username: u.username, displayName: u.displayName || null })).slice(0, 10);
    found.set(text, { at: Date.now(), users });
    return { users };
  }

  const notice = p => notices.get(p.id) || null;
  const clearNotice = p => { notices.delete(p.id); };

  return { isShared, isRunning, isFollowing, catalog, subscribe, sync, syncAll, status, share, unshare, searchUsers, notice, clearNotice };
}

module.exports = { createSharing, SYNC_FILE };
