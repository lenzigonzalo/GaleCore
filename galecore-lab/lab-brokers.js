const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Catálogos reales de app/read y codex_apps, comprobados el 03/11/2026.
// Lista cerrada: una herramienta nueva no se habilita automáticamente.
const BROKERS = [
  { id: 'asdk_app_69bc11db874881918718abaca20b68ce', prefix: 'interactive_brokers_ibkr', tools: [
    'get_account_balances', 'get_account_positions', 'get_account_orders', 'get_account_summary', 'get_account_trades',
    'get_order_instructions', 'get_pa_allocation', 'get_pa_performance_all_periods',
    'get_alert', 'get_alerts', 'get_watchlist', 'get_watchlists', 'get_saved_screener', 'list_saved_screeners', 'run_saved_screener',
    'search_contracts', 'search_futures', 'search_investment_topics', 'get_company_connections', 'get_company_themes',
    'get_theme_details', 'get_option_data', 'get_option_parameters', 'get_price_history', 'get_price_snapshot', 'whats_new',
  ] },
  { id: 'asdk_app_6a207f00eed0819181227b2ea257ff0b', prefix: 'iol_invertironline', tools: [
    'get_access_mode', 'get_balance', 'get_portfolio', 'get_activities', 'get_order_status', 'get_stop_loss_and_take_profit',
    'get_aum_evolution', 'get_return_evolution', 'show_portfolio_treemap', 'get_asset_quote', 'get_asset_info',
    'get_price_history', 'get_intraday_prices', 'get_fixed_income_analytics', 'simulate_fixed_income_by_amount',
    'simulate_fixed_income_by_nominals', 'get_options_chain', 'get_caucion_rates', 'get_caucion_rate',
    'get_fci_funds', 'get_next_corporate_events',
  ] },
];

// Conectores por motor (WS-0091). <local>/connectors.json = { claude: {<servidor>: bool}, codex: {<id>: bool} }.
// Sin entrada: apagado, salvo IOL e IBKR, que heredan el interruptor viejo (broker-queries.json).
// <local>/connectors-seen.json guarda lo último que vio Claude (nombre, estado, herramientas) para listar y para negar.
const IOL_DENIED = ['update_access_mode', 'validate_order', 'validate_caucion', 'validate_fci_subscription',
  'validate_fci_redemption', 'get_ddjj', 'get_caucion_guarantee_assets'];
const CLAUDE_BROKERS = [
  { test: /\bIoL\b/i, prefix: 'iol_invertironline', label: 'IOL', denied: IOL_DENIED },
  { test: /Interactive Brokers|IBKR/i, prefix: 'interactive_brokers_ibkr', label: 'IBKR', denied: [] },
];
const norm = s => String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function readJson(local, name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(local, name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error('No se pudo leer la configuración local de conectores.'); }
}
function writeJson(local, name, value) {
  fs.mkdirSync(local, { recursive: true });
  const file = path.join(local, name), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
// Interruptor viejo de brókers: sólo el valor por defecto de IOL e IBKR. Un archivo ilegible cuenta como apagado.
function brokerSetting(local) {
  try { return JSON.parse(fs.readFileSync(path.join(local, 'broker-queries.json'), 'utf8')).enabled === true; } catch { return false; }
}
function isBroker(engine, key) {
  return engine === 'codex' ? BROKERS.some(b => b.id === key) : CLAUDE_BROKERS.some(b => b.test.test(key));
}
function isOn(local, engine, key, cfg = readJson(local, 'connectors.json', {})) {
  const v = (cfg[engine] || {})[key];
  return typeof v === 'boolean' ? v : isBroker(engine, key) && brokerSetting(local);
}
function setConnector(local, engine, key, enabled) {
  const cfg = readJson(local, 'connectors.json', {});
  cfg[engine] = { ...(cfg[engine] || {}), [key]: enabled === true };
  writeJson(local, 'connectors.json', cfg);
}

// Claude: el evento init del CLI trae mcp_servers y tools. El prefijo (mcp__claude_ai_IoL) sale de los nombres reales de tools.
function recordClaudeInit(local, event) {
  const tools = (event.tools || []).filter(t => t.startsWith('mcp__'));
  const servers = (event.mcp_servers || []).filter(s => s && s.name).map(s => {
    const seg = tools.map(t => t.split('__')[1]).find(x => norm(x) === norm(s.name));
    const prefix = 'mcp__' + (seg || norm(s.name));
    return { name: s.name, status: s.status, prefix, tools: tools.filter(t => t.startsWith(prefix + '__')).map(t => t.slice(prefix.length + 2)) };
  });
  if (!servers.length) return;
  writeJson(local, 'connectors-seen.json', { claude: { at: Date.now(), servers } });
}
function claudeSeen(local) { return readJson(local, 'connectors-seen.json', {}).claude || null; }

// Sonda corta: abre el CLI, espera el init y lo corta (no llega a llamar al modelo).
function probeClaude({ local, binary, env, spawnProcess = spawn, timeout = 20000 }) {
  return new Promise(done => {
    let buf = '', ok = false;
    const proc = spawnProcess(binary, ['-p', 'ok', '--output-format', 'stream-json', '--verbose', '--model', 'haiku',
      '--setting-sources', 'project,local'], { cwd: local, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const end = () => { clearTimeout(timer); try { proc.kill(); } catch { /* ya terminó */ } done(ok); };
    const timer = setTimeout(end, timeout);
    proc.on('error', end); proc.on('close', end);
    proc.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const e = JSON.parse(line); if (e.type === 'system' && e.subtype === 'init') { recordClaudeInit(local, e); ok = true; end(); return; } } catch { /* línea que no es evento */ }
      }
    });
  });
}
// Catálogo de Claude: lo último visto en un init; se refresca con la sonda si falta o tiene más de 5 minutos (una a la vez).
let claudeProbe = null;
async function claudeCatalog(opts) {
  let seen = claudeSeen(opts.local);
  if (opts.binary && (!seen || Date.now() - seen.at > 300000)) {
    claudeProbe = claudeProbe || probeClaude(opts).finally(() => { claudeProbe = null; });
    await claudeProbe;
    seen = claudeSeen(opts.local);
  }
  return seen ? seen.servers : [];
}

// Codex: las apps de ChatGPT se listan con `app/list` del app-server (JSON-RPC por stdio). Si no responde, quedan IOL e IBKR.
function listCodexApps({ binary, env, spawnProcess = spawn, timeout = 15000 }) {
  return new Promise(done => {
    let buf = '', apps = null;
    const proc = spawnProcess(binary, ['app-server'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const end = () => { clearTimeout(timer); try { proc.kill(); } catch { /* ya terminó */ } done(apps); };
    const timer = setTimeout(end, timeout);
    const send = o => { try { proc.stdin.write(JSON.stringify(o) + '\n'); } catch { /* sin stdin */ } };
    proc.on('error', end); proc.on('close', end);
    proc.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const e = JSON.parse(line);
          if (e.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'app/list', params: {} }); }
          const data = e.id === 2 ? e.result?.data : e.method === 'app/list/updated' ? e.params?.data : null;
          if (Array.isArray(data)) { apps = data.map(a => ({ id: a.id, name: a.name, accessible: a.isAccessible !== false })); if (e.id === 2 || data.length) end(); }
        } catch { /* línea que no es mensaje */ }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'galecore-lab', version: '1' } } });
  });
}
const CODEX_FALLBACK = [{ id: BROKERS[0].id, name: 'Interactive Brokers (IBKR)', accessible: true }, { id: BROKERS[1].id, name: 'IOL invertironline', accessible: true }];
let codexCache = null;
async function codexCatalog({ codexBinary, ...opts }) {
  if (!codexCache || Date.now() - codexCache.at > 300000) {
    const apps = codexBinary ? await listCodexApps({ ...opts, binary: codexBinary }) : null;
    codexCache = { at: Date.now(), apps: apps && apps.length ? apps : codexCache?.apps || CODEX_FALLBACK };
  }
  return codexCache.apps;
}

// Lista por motor para Configuración → Mis conectores.
async function listConnectors(opts) {
  const cfg = readJson(opts.local, 'connectors.json', {});
  const [servers, apps] = await Promise.all([claudeCatalog(opts), codexCatalog(opts)]);
  const claude = servers.map(s => ({ id: s.name, name: s.name.replace(/^claude\.ai /, ''), status: s.status, enabled: isOn(opts.local, 'claude', s.name, cfg) }));
  const codex = apps.map(a => ({ id: a.id, name: a.name, status: a.accessible ? 'connected' : 'needs-auth', enabled: isOn(opts.local, 'codex', a.id, cfg) }));
  return { galecore: { enabled: true }, claude, codex };
}
async function knownConnector(opts, engine, id) {
  return engine === 'claude' ? (await claudeCatalog(opts)).some(s => s.name === id) : (await codexCatalog(opts)).some(a => a.id === id);
}

function brokerInstructions(labels, suffix) {
  return '\nBrokers externos habilitados sólo para consultas: ' + labels.join(' e ') + ', mediante las conexiones del usuario' + suffix + '. ' +
    'GaleCore sigue siendo la primera fuente. Para datos propios de esos brokers usá sus consultas y presentá fuente y fecha por separado. ' +
    'No envíes, prepares, valides, modifiques ni canceles operaciones, ni cambies alertas, listas, permisos o fondos. ' +
    (labels.includes('IOL') ? 'En IOL comprobá get_access_mode antes de consultar la cuenta; debe devolver read_only. ' : '') +
    'Si un broker pide autorización o no responde, decilo y seguí con GaleCore. ' +
    'No uses shell, HTTP ni otro canal para evitar estas restricciones. Si falta una consulta, declará el faltante.\n';
}

// Claude: reglas del turno según lo prendido. Apagado o sin entrada = se niega el servidor entero; en IOL e IBKR prendidos
// sólo se permite la lista cerrada de consultas y se niega todo lo demás que el servidor exponga.
function claudeConnectors(local) {
  const cfg = readJson(local, 'connectors.json', {});
  const allow = [], deny = [], labels = [], seen = claudeSeen(local);
  // Sin catálogo todavía (primer turno, nadie abrió Configuración): se niegan todos los conectores de claude.ai; el init de este turno arma el catálogo.
  if (!seen) deny.push('mcp__claude_ai_*');
  for (const s of seen?.servers || []) {
    if (!isOn(local, 'claude', s.name, cfg)) { deny.push(s.prefix); continue; }
    const broker = CLAUDE_BROKERS.find(b => b.test.test(s.name));
    if (!broker) continue;
    const reads = BROKERS.find(b => b.prefix === broker.prefix).tools;
    allow.push(...reads.map(t => s.prefix + '__' + t));
    deny.push(...Array.from(new Set([...broker.denied, ...s.tools.filter(t => !reads.includes(t))]), t => s.prefix + '__' + t));
    labels.push(broker.label);
  }
  return { allow, deny, instructions: labels.length ? brokerInstructions(labels.sort(), '') : '' };
}

// Codex: la config `apps=` del turno con lo prendido. IOL e IBKR, con su lista cerrada; otra app prendida, sin herramientas destructivas.
function codexConnectors(local) {
  const cfg = readJson(local, 'connectors.json', {});
  const ids = [...new Set([...BROKERS.map(b => b.id), ...Object.keys(cfg.codex || {})])].filter(id => isOn(local, 'codex', id, cfg));
  if (!ids.length) return null;
  const apps = '{ _default = { enabled = false }, ' + ids.map(id => {
    const b = BROKERS.find(x => x.id === id);
    return b ? JSON.stringify(id) + ' = { enabled = true, default_tools_enabled = false, destructive_enabled = false, tools = { ' +
      b.tools.map(t => JSON.stringify(b.prefix + '.' + t) + ' = { enabled = true }').join(', ') + ' } }'
      : JSON.stringify(id) + ' = { enabled = true, destructive_enabled = false }';
  }).join(', ') + ' }';
  const labels = BROKERS.filter(b => ids.includes(b.id)).map(b => b.prefix === 'iol_invertironline' ? 'IOL' : 'IBKR').sort();
  return {
    args: ['--enable', 'apps', '-c', 'apps=' + apps, '-c', 'mcp_servers.ibkr.enabled=false', '-c', 'mcp_servers.iol.enabled=false'],
    instructions: labels.length ? brokerInstructions(labels, ' de ChatGPT') : '',
  };
}

module.exports = { codexConnectors, claudeConnectors, recordClaudeInit, listConnectors, knownConnector, setConnector, brokerSetting };
