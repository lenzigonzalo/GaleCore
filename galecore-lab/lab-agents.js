/**
 * WS-0079: agentes en la nube. Mientras el Lab está abierto, aplica al instante lo que la pestaña Agentes pidió
 * (crear, editar, pausar, ejecutar una rutina de claude.ai): corre `agent pending` y, si hay algo, lanza Claude
 * sin chat con la skill agentes-nube y sólo dos herramientas: RemoteTrigger y el comando `agent` del CLI.
 * El resultado no sale del texto del modelo sino de lo que éste deja con `agent applied`.
 * Todo lo externo (comandos, proceso, reloj) se inyecta para probarlo sin tocar claude.ai.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const CLI = 'python -m galecore_ai.adapters.cli agent';

function createAgents({ root, environment, binary, execute = execFile, spawnProcess = spawn, intervalMs = 60000, timeoutMs = 300000 }) {
  let running = false;      // una aplicación a la vez
  let timer = null;
  const pending = () => new Promise(resolve => execute('python', ['-B', '-m', 'galecore_ai.adapters.cli', 'agent', 'pending'],
    { cwd: root, env: environment(), windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }, (e, out) => {
      try { resolve(e ? [] : JSON.parse(String(out)).pending || []); } catch { resolve([]); }
    }));
  const run = args => new Promise(resolve => execute('python', ['-B', '-m', 'galecore_ai.adapters.cli', 'agent', ...args],
    { cwd: root, env: environment(), windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }, () => resolve()));
  const NOT_APPLIED = 'El Lab no pudo aplicar el pedido; revisá el login de Claude en el Lab y volvé a pedirlo.';
  // Lo que sigue pendiente con el mismo pedido (`at`) después del intento no se relanza cada minuto: queda con error.
  async function giveUp(before) {
    for (const item of await pending()) {
      const was = before.find(b => b.key === item.key);
      if (was && was.at === item.at) await run(['applied', item.key, '--error', NOT_APPLIED]);
    }
  }
  const prompt = items => {
    const skill = fs.readFileSync(path.join(root, 'galecore-lab', 'skills', 'agentes-nube', 'SKILL.md'), 'utf8');
    return skill + '\n\nAplicá ahora la entrada 2 (aplicar pendientes) a estos agentes, uno por uno: ' + items.map(i => i.key).join(', ') + '.';
  };
  // 'idle' (nada para aplicar), 'busy' (ya hay una aplicación o no hay motor Claude), 'done' o 'failed' (el proceso salió con error o se pasó de tiempo).
  async function applyOnce() {
    if (running || !binary) return 'busy';
    running = true;
    try {
      const items = await pending();
      if (!items.length) return 'idle';
      const outcome = await new Promise(resolve => {
        const proc = spawnProcess(binary, ['-p', prompt(items), '--model', 'haiku', '--allowedTools', 'RemoteTrigger', `Bash(${CLI}:*)`, `PowerShell(${CLI}:*)`],
          { cwd: root, env: environment(), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
        const stop = setTimeout(() => { try { proc.kill(); } catch { /* ya terminó */ } resolve('failed'); }, timeoutMs);
        proc.on('error', () => { clearTimeout(stop); resolve('failed'); });
        proc.on('close', code => { clearTimeout(stop); resolve(code === 0 ? 'done' : 'failed'); });
      });
      await giveUp(items);
      return outcome;
    } finally { running = false; }
  }
  const start = () => {
    if (!binary || timer) return;
    applyOnce().catch(() => {});
    timer = setInterval(() => applyOnce().catch(() => {}), intervalMs);
    timer.unref?.();
  };
  const stop = () => { clearInterval(timer); timer = null; };
  return { applyOnce, start, stop, isBusy: () => running };
}

module.exports = { createAgents };
