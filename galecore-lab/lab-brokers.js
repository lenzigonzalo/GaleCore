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

// Conectores por motor (WS-0091). <local>/connectors.json = { claude: {<servidor>: bool}, codex: {<id>: bool},
// tools: { claude: {<servidor>: {<herramienta>: 'allow'|'ask'|'deny'}}, codex: {...} } } (BF-0022: permiso por herramienta,
// como claude.ai). Sin valor de herramienta: lectura = allow, escritura = ask (Claude) o deny (Codex, que en `exec` no puede pedir).
// Sin entrada: apagado, salvo IOL e IBKR, que heredan el interruptor viejo (broker-queries.json).
// <local>/connectors-seen.json guarda lo último que vio Claude (nombre, estado, herramientas) para listar y para negar.
const IOL_DENIED = ['update_access_mode', 'validate_order', 'validate_caucion', 'validate_fci_subscription',
  'validate_fci_redemption', 'get_ddjj', 'get_caucion_guarantee_assets'];
// Escrituras conocidas de IBKR: se niegan por nombre aunque el catálogo visto no las traiga (p. ej. visto sin autorizar).
const IBKR_DENIED = ['create_order_instruction', 'delete_order_instruction', 'create_alert', 'update_alert', 'delete_alert',
  'set_alert_status', 'create_watchlist', 'edit_watchlist', 'delete_watchlist', 'create_saved_screener',
  'update_saved_screener', 'delete_saved_screener', 'provide_customer_feedback'];
const CLAUDE_BROKERS = [
  { test: /\bIoL\b/i, prefix: 'iol_invertironline', label: 'IOL', denied: IOL_DENIED },
  { test: /Interactive Brokers|IBKR/i, prefix: 'interactive_brokers_ibkr', label: 'IBKR', denied: IBKR_DENIED },
];
const norm = s => String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const MODES = ['allow', 'ask', 'deny'];
// Lectura vs escritura de un conector que no es broker: el init de Claude sólo trae nombres, así que va por prefijo.
const READ_NAME = /^(get|list|search|read|show|fetch|find|query|describe|preview|suggest)_|^(run_saved_screener|whats_new)$/;
const toolLabel = name => { const t = String(name).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

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
  const before = claudeSeen(local)?.servers || [];
  const servers = (event.mcp_servers || []).filter(s => s && s.name).map(s => {
    const seg = tools.map(t => t.split('__')[1]).find(x => norm(x) === norm(s.name));
    const prefix = 'mcp__' + (seg || norm(s.name));
    const names = tools.filter(t => t.startsWith(prefix + '__')).map(t => t.slice(prefix.length + 2));
    // El init sale antes de que conecten los conectores de claude.ai (status pending, sin herramientas): el estado se guarda tal cual
    // lo dijo el motor, pero las herramientas ya vistas no se pierden.
    return { name: s.name, status: s.status, prefix, tools: names.length ? names : before.find(b => b.name === s.name)?.tools || [] };
  });
  if (!servers.length) return;
  writeJson(local, 'connectors-seen.json', { ...readJson(local, 'connectors-seen.json', {}), claude: { at: Date.now(), servers } });
}
function claudeSeen(local) { return readJson(local, 'connectors-seen.json', {}).claude || null; }
function codexSeen(local) { return readJson(local, 'connectors-seen.json', {}).codex || null; }

// Herramientas de un servidor de Claude con su grupo. IOL e IBKR: la lista cerrada BROKERS es lectura; todo lo demás
// (las escrituras conocidas y lo que el servidor exponga de más) opera y queda en Nunca fijo.
function claudeToolList(s) {
  const broker = CLAUDE_BROKERS.find(b => b.test.test(s.name));
  if (!broker) return s.tools.map(name => ({ name, group: READ_NAME.test(name) ? 'read' : 'write', fixed: false }));
  const reads = BROKERS.find(b => b.prefix === broker.prefix).tools;
  return [...new Set([...reads, ...s.tools, ...broker.denied])].map(name => reads.includes(name)
    ? { name, group: 'read', fixed: false } : { name, group: 'write', fixed: true });
}
// Lo mismo para una app de Codex (app/read trae isReadOnly por herramienta; sin dato, por prefijo).
function codexToolList(app) {
  const broker = BROKERS.find(b => b.id === app.id);
  const seen = app.tools || [];
  if (broker) return [...new Set([...broker.tools, ...seen.map(t => t.name)])].map(name => ({ name, title: seen.find(t => t.name === name)?.title || null,
    group: broker.tools.includes(name) ? 'read' : 'write', fixed: !broker.tools.includes(name) }));
  return seen.map(t => ({ name: t.name, title: t.title || null, group: (t.readOnly === undefined ? READ_NAME.test(t.name) : t.readOnly) ? 'read' : 'write', fixed: false }));
}
const codexSlug = app => (BROKERS.find(b => b.id === app.id)?.prefix) || norm(app.name || app.id).toLowerCase();
const storedMode = (cfg, engine, key, name) => { const v = ((cfg.tools || {})[engine] || {})[key]?.[name]; return MODES.includes(v) ? v : null; };
// Valor efectivo de una herramienta. Codex no puede pedir aprobación en `exec`: ahí «ask» nunca se cumple y cuenta como Nunca.
function toolMode(cfg, engine, key, t) {
  if (t.fixed) return 'deny';
  const v = storedMode(cfg, engine, key, t.name) || (t.group === 'read' ? 'allow' : engine === 'codex' ? 'deny' : 'ask');
  return engine === 'codex' && v === 'ask' ? 'deny' : v;
}
const withModes = (cfg, engine, key, list) => list.map(t => ({ name: t.name, label: t.title || toolLabel(t.name), group: t.group, fixed: t.fixed, value: toolMode(cfg, engine, key, t) }));

// Sonda corta: abre el CLI, espera el init y lo corta (no llega a llamar al modelo). El init tarda ~20 s: espera a que
// conecten los conectores de claude.ai.
function probeClaude({ local, binary, env, spawnProcess = spawn, timeout = 60000 }) {
  return new Promise(done => {
    let buf = '', ok = false;
    const proc = spawnProcess(binary, ['-p', 'ok', '--output-format', 'stream-json', '--verbose', '--model', 'haiku',
      '--setting-sources', 'user,project,local'], { cwd: local, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
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
// Catálogo de Claude: lo último visto en un init. Si tiene más de 5 minutos se refresca con la sonda en segundo plano
// y se devuelve el que hay; sólo se espera la sonda cuando no hay ninguno (una a la vez).
let claudeProbe = null;
async function claudeCatalog(opts) {
  let seen = claudeSeen(opts.local);
  if (opts.binary && (!seen || Date.now() - seen.at > 300000)) {
    claudeProbe = claudeProbe || probeClaude(opts).finally(() => { claudeProbe = null; });
    if (!seen) { await claudeProbe; seen = claudeSeen(opts.local); }
  }
  return seen ? seen.servers : [];
}

// Codex: las apps de ChatGPT se listan con `app/list` del app-server (JSON-RPC por stdio) y, de las accesibles, de IOL/IBKR y de
// las configuradas, sus herramientas con `app/read` (se pide con la primera lista, sin esperar el cierre de app/list) (includeTools: nombre, título e isReadOnly). Si no responde, quedan IOL e IBKR.
function listCodexApps({ binary, env, keepIds = [], spawnProcess = spawn, timeout = 30000 }) {
  return new Promise(done => {
    let buf = '', apps = null, listed = false;
    const proc = spawnProcess(binary, ['app-server'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const end = () => { clearTimeout(timer); try { proc.kill(); } catch { /* ya terminó */ } done(apps); };
    const timer = setTimeout(end, timeout);
    const send = o => { try { proc.stdin.write(JSON.stringify(o) + '\n'); } catch { /* sin stdin */ } };
    const take = data => data.map(a => ({ id: a.id, name: a.name, accessible: a.isAccessible !== false }));
    proc.on('error', end); proc.on('close', end);
    proc.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const e = JSON.parse(line);
          if (e.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'app/list', params: {} }); }
          if (e.id === 2 || e.method === 'app/list/updated') {
            const data = e.id === 2 ? e.result?.data : e.params?.data;
            if (Array.isArray(data)) apps = take(data);
            // La primera lista ya trae quién es accesible (app/list tarda ~45 s en cerrar): no se espera al resultado final.
            if (Array.isArray(data) && !listed) {
              listed = true;
              const want = [...new Set([...(apps || []).filter(a => a.accessible).map(a => a.id), ...BROKERS.map(b => b.id), ...keepIds])].slice(0, 100);
              if (!apps || !want.length) end(); else send({ id: 3, method: 'app/read', params: { appIds: want, includeTools: true } });
            }
          }
          if (e.id === 3) {
            const byId = new Map((e.result?.apps || []).map(a => [a.id, a.toolSummaries || []]));
            // IOL e IBKR salen siempre, aunque el motor no los liste (sin autorizar en ChatGPT): ahí quedan en «Falta autorizar».
            for (const b of BROKERS) if (!apps.some(a => a.id === b.id)) apps.push({ id: b.id, name: b.prefix === 'iol_invertironline' ? 'IOL invertironline' : 'Interactive Brokers (IBKR)', accessible: false });
            apps = apps.map(a => byId.has(a.id) ? { ...a, tools: byId.get(a.id).map(t => ({ name: t.name, title: t.title || null, readOnly: t.isReadOnly === true })) } : a);
            end();
          }
        } catch { /* línea que no es mensaje */ }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'galecore-lab', version: '1' } } });
  });
}
const CODEX_FALLBACK = [{ id: BROKERS[0].id, name: 'Interactive Brokers (IBKR)', accessible: true }, { id: BROKERS[1].id, name: 'IOL invertironline', accessible: true }];
let codexCache = null;
async function codexCatalog({ codexBinary, local, ...opts }) {
  const kept = codexSeen(local);   // lo último guardado en disco manda si es más nuevo que la memoria (otro arranque del Lab)
  if (kept?.apps?.length && (!codexCache || kept.at > codexCache.at)) codexCache = { at: kept.at, apps: kept.apps };
  if (!codexCache || Date.now() - codexCache.at > 300000) {
    const keepIds = Object.keys(readJson(local, 'connectors.json', {}).codex || {});
    const apps = codexBinary ? await listCodexApps({ ...opts, binary: codexBinary, keepIds }) : null;
    if (apps && apps.length) {
      try { writeJson(local, 'connectors-seen.json', { ...readJson(local, 'connectors-seen.json', {}), codex: { at: Date.now(), apps } }); } catch { /* sólo cache */ }
    }
    codexCache = { at: Date.now(), apps: apps && apps.length ? apps : codexSeen(local)?.apps || codexCache?.apps || CODEX_FALLBACK };
  }
  return codexCache.apps;
}

// Lista por motor para Configuración → Mis conectores. Codex: sólo lo que el trader tiene conectado en ChatGPT (más IOL/IBKR y
// lo que ya configuró): el catálogo entero son miles de apps.
async function listConnectors(opts) {
  const cfg = readJson(opts.local, 'connectors.json', {});
  const [servers, apps] = await Promise.all([claudeCatalog(opts), codexCatalog(opts)]);
  const claude = servers.map(s => ({ id: s.name, name: s.name.replace(/^claude\.ai /, ''), status: s.status, enabled: isOn(opts.local, 'claude', s.name, cfg),
    tools: withModes(cfg, 'claude', s.name, claudeToolList(s)) }));
  const codex = apps.filter(a => a.accessible || BROKERS.some(b => b.id === a.id) || a.id in (cfg.codex || {}))
    .map(a => ({ id: a.id, name: a.name, status: a.accessible ? 'connected' : 'needs-auth', enabled: isOn(opts.local, 'codex', a.id, cfg),
      tools: withModes(cfg, 'codex', a.id, codexToolList(a)) }));
  return { galecore: { enabled: true }, engines: { claude: { ask: true }, codex: { ask: false } }, claude, codex };
}
async function knownConnector(opts, engine, id) {
  return engine === 'claude' ? (await claudeCatalog(opts)).some(s => s.name === id) : (await codexCatalog(opts)).some(a => a.id === id);
}
// Herramientas de un conector (grupo y si son fijas), para validar y para cambiar un grupo entero.
async function connectorTools(opts, engine, id) {
  if (engine === 'claude') { const s = (await claudeCatalog(opts)).find(x => x.name === id); return s ? claudeToolList(s) : null; }
  const a = (await codexCatalog(opts)).find(x => x.id === id);
  return a ? codexToolList(a) : null;
}
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
// Guarda el permiso de una herramienta o de todas las de un grupo (las fijas no se tocan). `which`: {tool} o {group: 'read'|'write'}.
async function setToolMode(opts, engine, id, which, value) {
  if (!MODES.includes(value)) throw bad('Elegí Siempre permitir, Pedir aprobación o Nunca.');
  if (engine === 'codex' && value === 'ask') throw bad('Codex no puede pedir aprobación por herramienta: elegí Siempre permitir o Nunca.');
  const list = await connectorTools(opts, engine, id);
  if (!list) throw bad('Ese conector no está en la lista del motor.', 404);
  let targets;
  if (which.tool !== undefined) {
    targets = list.filter(t => t.name === which.tool);
    if (!targets.length) throw bad('Esa herramienta no es de este conector.', 404);
    if (targets[0].fixed) throw bad('Esa herramienta opera en la cuenta: queda siempre en Nunca.');
  } else {
    if (!['read', 'write'].includes(which.group)) throw bad('Indicá la herramienta o el grupo.');
    targets = list.filter(t => t.group === which.group && !t.fixed);
  }
  const cfg = readJson(opts.local, 'connectors.json', {});
  const mine = { ...(((cfg.tools || {})[engine] || {})[id] || {}) };
  for (const t of targets) mine[t.name] = value;
  cfg.tools = { ...(cfg.tools || {}), [engine]: { ...((cfg.tools || {})[engine] || {}), [id]: mine } };
  writeJson(opts.local, 'connectors.json', cfg);
  return targets.map(t => t.name);
}
// Una herramienta mcp__<servidor>__<herramienta> del chat: nombre legible del conector y de la herramienta (p. ej. «Gmail › Send message»).
function describeMcp(local, toolName) {
  const m = /^(mcp__.+?)__(.+)$/.exec(String(toolName));
  if (!m) return null;
  const server = (claudeSeen(local)?.servers || []).find(x => x.prefix === m[1]) || null;
  const base = m[1].slice(5).replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return { server, connector: server ? server.name.replace(/^claude\.ai /, '') : base, tool: m[2], label: toolLabel(m[2]) };
}
// «Permitir siempre» en el chat: la herramienta queda 'allow', igual que en Conectores. Las fijas (brokers que operan) no.
function allowAlways(local, toolName) {
  const d = describeMcp(local, toolName);
  if (!d || !d.server) return null;
  const t = claudeToolList(d.server).find(x => x.name === d.tool);
  if (!t || t.fixed) return null;
  const cfg = readJson(local, 'connectors.json', {});
  const mine = { ...(((cfg.tools || {}).claude || {})[d.server.name] || {}), [d.tool]: 'allow' };
  cfg.tools = { ...(cfg.tools || {}), claude: { ...((cfg.tools || {}).claude || {}), [d.server.name]: mine } };
  writeJson(local, 'connectors.json', cfg);
  return d;
}

function brokerInstructions(labels, suffix) {
  return '\nBrokers externos habilitados sólo para consultas: ' + labels.join(' e ') + ', mediante las conexiones del usuario' + suffix + '. ' +
    'GaleCore sigue siendo la primera fuente. Para datos propios de esos brokers usá sus consultas y presentá fuente y fecha por separado. ' +
    'No envíes, prepares, valides, modifiques ni canceles operaciones, ni cambies alertas, listas, permisos o fondos. ' +
    (labels.includes('IOL') ? 'En IOL comprobá get_access_mode antes de consultar la cuenta; debe devolver read_only. ' : '') +
    'Si un broker pide autorización o no responde, decilo y seguí con GaleCore. ' +
    'No uses shell, HTTP ni otro canal para evitar estas restricciones. Si falta una consulta, declará el faltante.\n';
}

// Claude: reglas del turno según lo prendido. Apagado o sin entrada = se niega el servidor entero. Prendido, cada herramienta
// según su permiso: allow = regla de permitir, deny = regla de negar, ask = sin regla (el CLI pide y el Lab lo muestra en el chat).
// En IOL e IBKR sólo la lista cerrada de consultas se puede permitir; todo lo demás que el servidor exponga se niega.
function claudeConnectors(local) {
  const cfg = readJson(local, 'connectors.json', {});
  const allow = [], deny = [], labels = [], seen = claudeSeen(local);
  // Sin catálogo todavía (primer turno, nadie abrió Configuración): se niegan todos los conectores de claude.ai; el init de este turno arma el catálogo.
  if (!seen) deny.push('mcp__claude_ai_*');
  for (const s of seen?.servers || []) {
    if (!isOn(local, 'claude', s.name, cfg)) { deny.push(s.prefix); continue; }
    for (const t of claudeToolList(s)) {
      const mode = toolMode(cfg, 'claude', s.name, t);
      if (mode === 'allow') allow.push(s.prefix + '__' + t.name); else if (mode === 'deny') deny.push(s.prefix + '__' + t.name);
    }
    const broker = CLAUDE_BROKERS.find(b => b.test.test(s.name));
    if (broker) labels.push(broker.label);
  }
  return { allow, deny: [...new Set(deny)], instructions: labels.length ? brokerInstructions(labels.sort(), '') : '' };
}

// Codex: la config `apps=` del turno con lo prendido. IOL e IBKR, con su lista cerrada (menos lo que el trader apagó); otra app
// prendida, sólo con las herramientas en Siempre permitir (destructive_enabled si alguna escribe). Sin catálogo de la app, sin
// herramientas destructivas. `exec` no puede pedir aprobación (probado: «requires approval, but approval policy is never»).
function codexConnectors(local) {
  const cfg = readJson(local, 'connectors.json', {});
  const ids = [...new Set([...BROKERS.map(b => b.id), ...Object.keys(cfg.codex || {})])].filter(id => isOn(local, 'codex', id, cfg));
  if (!ids.length) return null;
  const known = codexSeen(local)?.apps || [];
  const apps = '{ _default = { enabled = false }, ' + ids.map(id => {
    const b = BROKERS.find(x => x.id === id), app = known.find(a => a.id === id);
    if (!b && !(app?.tools || []).length) return JSON.stringify(id) + ' = { enabled = true, destructive_enabled = false }';
    const list = codexToolList(app || { id, name: id, tools: [] }).filter(t => toolMode(cfg, 'codex', id, t) === 'allow');
    const slug = b ? b.prefix : codexSlug(app);
    return JSON.stringify(id) + ' = { enabled = true, default_tools_enabled = false, destructive_enabled = ' + (!b && list.some(t => t.group === 'write')) +
      ', tools = { ' + list.map(t => JSON.stringify(slug + '.' + t.name) + ' = { enabled = true }').join(', ') + ' } }';
  }).join(', ') + ' }';
  const labels = BROKERS.filter(b => ids.includes(b.id)).map(b => b.prefix === 'iol_invertironline' ? 'IOL' : 'IBKR').sort();
  return {
    args: ['--enable', 'apps', '-c', 'apps=' + apps, '-c', 'mcp_servers.ibkr.enabled=false', '-c', 'mcp_servers.iol.enabled=false'],
    instructions: labels.length ? brokerInstructions(labels, ' de ChatGPT') : '',
  };
}

module.exports = { listCodexApps, codexConnectors, claudeConnectors, recordClaudeInit, listConnectors, knownConnector, setConnector, setToolMode, allowAlways, describeMcp, brokerSetting };
