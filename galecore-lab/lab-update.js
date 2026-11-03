/**
 * WS-0082: el Lab de la PC del usuario se actualiza solo cuando se despliega main.
 * El disparo es la web: el front compilado en el deploy conoce su commit; si el Lab está en otro, le pide actualizarse.
 * Sólo actúa en un checkout de `main` limpio (nunca en development ni con cambios locales).
 * Todo lo externo (git, ocupado, reinicio, espera) se inyecta para poder probarlo sin tocar nada real.
 */
const { execFile, spawn } = require('child_process');
const path = require('path');

const DEPS = /^(galecore-lab\/package(-lock)?\.json|galecore-ai\/(pyproject\.toml|requirements[^/]*\.txt))$/;
const SHA = /^[0-9a-f]{7,40}$/i;
const DIVERGED = 'El Lab no se pudo actualizar solo: esta copia tiene cambios propios que main no tiene.';

function createUpdater({ git, busy, restart, sleep = ms => new Promise(r => setTimeout(r, ms)), onNotice = () => {} }) {
  let notice = null;
  let commit = null;          // HEAD al arrancar
  let updatable = false;      // main y árbol limpio al arrancar
  let working = false;        // hay una actualización en curso
  const tried = new Set();    // commits ya intentados: no se reintenta en loop
  const setNotice = text => { if (text !== notice) { notice = text; onNotice(text); } };
  const reason = e => String((e && e.message) || e).split(/\r?\n/).filter(Boolean).pop().slice(0, 160);
  const ok = async args => { try { await git(args); return true; } catch { return false; } };
  // Un aviso de «cambios propios» deja de valer cuando la web alcanza al Lab; los demás avisos se quedan.
  const clearDiverged = () => { if (notice === DIVERGED) setNotice(null); };

  // AC-5: otra rama o cambios locales (lo ignorado por .gitignore no cuenta) -> no es actualizable.
  async function eligible() {
    try {
      if ((await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim() !== 'main') return null;
      if ((await git(['status', '--porcelain'])).trim()) return null;
      return (await git(['rev-parse', 'HEAD'])).trim();
    } catch { return null; }
  }

  async function init() {
    const head = await eligible();
    try { commit = head || (await git(['rev-parse', 'HEAD'])).trim(); } catch { commit = null; }
    updatable = !!head;
  }

  async function apply(wanted) {
    try {
      while (busy()) await sleep(5000);   // AC-2: no corta chats ni sincronizaciones
      const head = await eligible();
      if (!head) return;
      await git(['pull', '--ff-only', 'origin', 'main']);
      const now = (await git(['rev-parse', 'HEAD'])).trim();
      if (now === head) return;
      const changed = (await git(['diff', '--name-only', head, now])).split(/\r?\n/).filter(Boolean);
      if (changed.some(f => DEPS.test(f))) {
        setNotice('El Lab se actualizó pero cambiaron dependencias: corré el instalador (install\instalar.ps1).');
        return;
      }
      setNotice(null);
      restart();
    } catch (e) {
      setNotice('El Lab no se pudo actualizar solo: ' + reason(e));
    } finally { working = false; }
  }

  /** El front pide actualizarse a `wanted`. Devuelve rápido; la espera y el pull siguen en segundo plano. */
  async function request(wanted) {
    if (typeof wanted !== 'string' || !SHA.test(wanted)) return 'invalid';
    if (working) return 'working';
    if (tried.has(wanted)) return 'tried';
    const head = await eligible();
    if (!head) return 'skip';
    if (head.startsWith(wanted.toLowerCase()) || wanted.toLowerCase().startsWith(head)) { clearDiverged(); return 'current'; }
    // El commit tiene que ser el de origin/main o un ancestro suyo, y HEAD tiene que estar detrás.
    try { await git(['fetch', 'origin', 'main']); } catch (e) { setNotice('El Lab no se pudo actualizar solo: ' + reason(e)); return 'failed'; }
    let full;
    try { full = (await git(['rev-parse', '--verify', '--quiet', wanted + '^{commit}'])).trim(); } catch { return 'unknown'; }
    if (!(await ok(['merge-base', '--is-ancestor', full, 'origin/main']))) return 'unknown';
    // El Lab ya está más adelante que la web (p. ej. git pull antes de que Vercel termine el deploy): no es divergir.
    if (await ok(['merge-base', '--is-ancestor', full, head])) { clearDiverged(); return 'ahead'; }
    tried.add(wanted);
    if (!(await ok(['merge-base', '--is-ancestor', head, full]))) {
      setNotice(DIVERGED);
      return 'diverged';
    }
    working = true;
    apply(full);
    return 'updating';
  }

  return { init, request, notice: () => notice, info: () => ({ commit, updatable, notice }) };
}

/** git sobre el repo del Lab; sin ventanas, sin pedir credenciales por consola. */
const gitIn = root => args => new Promise((resolve, reject) => execFile('git', ['-C', root, ...args],
  { encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  (e, out, err) => e ? reject(new Error((err || e.message).trim())) : resolve(out)));

/** Proceso aparte: espera a que este termine (libera el puerto) y corre start-lab.ps1 -Background. */
function relaunch(labDir, pid = process.pid) {
  const script = path.join(labDir, 'start-lab.ps1');
  const cmd = `$ErrorActionPreference='Stop'; try { Wait-Process -Id ${pid} -Timeout 60 } catch {}; & '${script.replace(/'/g, "''")}' -Background`;
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', cmd],
    { stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = { createUpdater, gitIn, relaunch, DEPS };
