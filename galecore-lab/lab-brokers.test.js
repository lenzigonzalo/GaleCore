const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { codexConnectors, claudeConnectors, recordClaudeInit, setConnector, listConnectors } = require('./lab-brokers');

function tmp(t) {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-brokers-'));
  t.after(() => { assert.ok(path.resolve(local).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-brokers-')); fs.rmSync(local, { recursive: true, force: true }); });
  return local;
}
const init = {
  mcp_servers: [
    { name: 'claude.ai IoL', status: 'connected' }, { name: 'claude.ai Interactive Brokers (IBKR)', status: 'connected' },
    { name: 'claude.ai Gmail', status: 'connected' }, { name: 'claude.ai LSEG', status: 'needs-auth' },
  ],
  tools: ['Bash', 'mcp__claude_ai_IoL__get_portfolio', 'mcp__claude_ai_IoL__get_access_mode', 'mcp__claude_ai_IoL__validate_order', 'mcp__claude_ai_IoL__get_ddjj',
    'mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions', 'mcp__claude_ai_Interactive_Brokers_IBKR__place_order',
    'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_LSEG__authenticate'],
};

test('Codex: sin nada prendido no hay apps; broker-queries.json es el valor por defecto de IOL e IBKR y connectors.json manda', t => {
  const local = tmp(t);
  assert.equal(codexConnectors(local), null);
  fs.writeFileSync(path.join(local, 'broker-queries.json'), '{"enabled":true}');
  const { args, instructions } = codexConnectors(local);
  const policy = args.find(s => s.startsWith('apps='));
  assert.match(policy, /_default = \{ enabled = false \}/);
  assert.equal((policy.match(/default_tools_enabled = false/g) || []).length, 2);
  const allowed = [...policy.matchAll(/"([^"]+)" = \{ enabled = true \}/g)].map(m => m[1]);
  assert.ok(allowed.includes('interactive_brokers_ibkr.get_account_orders') && allowed.includes('iol_invertironline.get_access_mode'));
  assert.ok(!allowed.some(s => /\.(create_|delete_|edit_|update_|set_|accept_|validate_|place_|cancel_|subscribe_|redeem_|provide_)/.test(s)));
  assert.ok(!allowed.some(s => /get_combo_identifier|get_ddjj|get_caucion_guarantee_assets/.test(s)));
  assert.ok(args.includes('mcp_servers.ibkr.enabled=false') && args.includes('mcp_servers.iol.enabled=false'));
  assert.match(instructions, /debe devolver read_only/);
  setConnector(local, 'codex', 'asdk_app_6a207f00eed0819181227b2ea257ff0b', false);   // IOL apagado a mano
  setConnector(local, 'codex', 'connector_gmail', true);                              // otra app prendida: sin lista de herramientas
  const second = codexConnectors(local);
  const p2 = second.args.find(s => s.startsWith('apps='));
  assert.ok(!p2.includes('iol_invertironline.') && p2.includes('"connector_gmail" = { enabled = true, destructive_enabled = false }'));
  assert.doesNotMatch(second.instructions, /IOL/);
});

test('Claude sin catálogo todavía: se niegan todos los conectores de claude.ai', t => {
  assert.deepEqual(claudeConnectors(tmp(t)), { allow: [], deny: ['mcp__claude_ai_*', 'mcp__plugin_*'], instructions: '' });
});

test('un connectors.json ilegible frena el turno', t => {
  const local = tmp(t);
  fs.writeFileSync(path.join(local, 'connectors.json'), '{');
  assert.throws(() => codexConnectors(local), /configuración local/);
  assert.throws(() => claudeConnectors(local), /configuración local/);
});

test('Claude: el prefijo sale de los nombres reales de tools y todo conector sin entrada queda negado', t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  const seen = JSON.parse(fs.readFileSync(path.join(local, 'connectors-seen.json'), 'utf8')).claude.servers;
  assert.equal(seen.find(s => /IBKR/.test(s.name)).prefix, 'mcp__claude_ai_Interactive_Brokers_IBKR');
  assert.equal(seen.find(s => s.name === 'claude.ai LSEG').prefix, 'mcp__claude_ai_LSEG');
  const { allow, deny, instructions } = claudeConnectors(local);
  assert.deepEqual(allow, []);
  assert.equal(instructions, '');
  assert.deepEqual(deny.sort(), ['mcp__claude_ai_Gmail', 'mcp__claude_ai_Interactive_Brokers_IBKR', 'mcp__claude_ai_IoL', 'mcp__claude_ai_LSEG', 'mcp__plugin_*']);
});

test('Claude: IOL prendido permite sólo consultas y niega validaciones y lo que no está en la lista cerrada; el resto sigue negado', t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  setConnector(local, 'claude', 'claude.ai IoL', true);
  const { allow, deny, instructions } = claudeConnectors(local);
  assert.ok(allow.includes('mcp__claude_ai_IoL__get_portfolio') && allow.includes('mcp__claude_ai_IoL__get_access_mode'));
  assert.ok(allow.every(s => s.startsWith('mcp__claude_ai_IoL__')));
  for (const name of ['validate_order', 'update_access_mode', 'get_ddjj']) assert.ok(deny.includes('mcp__claude_ai_IoL__' + name));
  assert.ok(!deny.includes('mcp__claude_ai_IoL'));
  assert.ok(deny.includes('mcp__claude_ai_Gmail') && deny.includes('mcp__claude_ai_Interactive_Brokers_IBKR'));
  assert.ok(!allow.some(s => deny.includes(s)));
  assert.match(instructions, /IOL/); assert.doesNotMatch(instructions, /IBKR/);
  assert.match(instructions, /debe devolver read_only/);
  setConnector(local, 'claude', 'claude.ai Interactive Brokers (IBKR)', true);
  const both = claudeConnectors(local);
  assert.ok(both.deny.includes('mcp__claude_ai_Interactive_Brokers_IBKR__place_order'));
  assert.ok(!both.deny.includes('mcp__claude_ai_Interactive_Brokers_IBKR'));
  assert.match(both.instructions, /IBKR e IOL/);
});

test('Claude: las escrituras conocidas de IOL e IBKR se niegan por nombre aunque el catálogo visto no las traiga', t => {
  const local = tmp(t);
  recordClaudeInit(local, { mcp_servers: [{ name: 'claude.ai IoL', status: 'needs-auth' }, { name: 'claude.ai Interactive Brokers (IBKR)', status: 'needs-auth' }], tools: [] });
  setConnector(local, 'claude', 'claude.ai IoL', true);
  setConnector(local, 'claude', 'claude.ai Interactive Brokers (IBKR)', true);
  const { allow, deny } = claudeConnectors(local);
  for (const name of ['create_order_instruction', 'delete_order_instruction', 'create_alert', 'edit_watchlist', 'update_saved_screener']) {
    assert.ok(deny.includes('mcp__claude_ai_Interactive_Brokers_IBKR__' + name), name);
  }
  for (const name of ['validate_order', 'update_access_mode']) assert.ok(deny.includes('mcp__claude_ai_IoL__' + name), name);
  assert.ok(!allow.some(s => deny.includes(s)));
});

test('el interruptor viejo de brókers es el valor por defecto de IOL e IBKR en Claude, pero un conector nuevo nace apagado', t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  fs.writeFileSync(path.join(local, 'broker-queries.json'), '{"enabled":true}');
  const { deny } = claudeConnectors(local);
  assert.ok(!deny.includes('mcp__claude_ai_IoL') && !deny.includes('mcp__claude_ai_Interactive_Brokers_IBKR'));
  assert.ok(deny.includes('mcp__claude_ai_Gmail') && deny.includes('mcp__claude_ai_LSEG'));
});

test('Claude: con un catálogo viejo la lista sale enseguida y la sonda refresca en segundo plano', async t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  const file = path.join(local, 'connectors-seen.json');
  const old = JSON.parse(fs.readFileSync(file, 'utf8')); old.claude.at -= 600000; fs.writeFileSync(file, JSON.stringify(old));
  const { EventEmitter } = require('events');
  let probes = 0;
  const spawnProcess = () => { probes++; const p = new EventEmitter(); p.stdout = new EventEmitter(); p.kill = () => p.emit('close'); return p; };
  const start = Date.now();
  const r = await listConnectors({ local, binary: 'claude', spawnProcess, timeout: 2000 });
  assert.ok(Date.now() - start < 1000);
  assert.equal(probes, 1);
  assert.equal(r.claude.length, 4);
});

test('lista por motor con estado e interruptor; sin binarios usa lo visto y IOL e IBKR para Codex', async t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  setConnector(local, 'claude', 'claude.ai Gmail', true);
  const r = await listConnectors({ local });
  assert.deepEqual(r.galecore, { enabled: true });
  assert.deepEqual(r.claude.map(c => [c.name, c.status, c.enabled]), [['IoL', 'connected', false], ['Interactive Brokers (IBKR)', 'connected', false], ['Gmail', 'connected', true], ['LSEG', 'needs-auth', false]]);
  assert.deepEqual(r.codex.map(c => c.name), ['Interactive Brokers (IBKR)', 'IOL invertironline']);
});

// BF-0022: permiso por herramienta, como claude.ai.
test('Claude: lectura = Siempre permitir y escritura = Pedir aprobación (sin regla) por defecto; Nunca niega la herramienta', async t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  const { setToolMode } = require('./lab-brokers');
  setConnector(local, 'claude', 'claude.ai Gmail', true);
  const r = claudeConnectors(local);
  assert.ok(!r.allow.includes('mcp__claude_ai_Gmail__send_message') && !r.deny.includes('mcp__claude_ai_Gmail__send_message'));   // ask: sin regla
  const opts = { local };
  await setToolMode(opts, 'claude', 'claude.ai Gmail', { tool: 'send_message' }, 'allow');
  assert.ok(claudeConnectors(local).allow.includes('mcp__claude_ai_Gmail__send_message'));
  await setToolMode(opts, 'claude', 'claude.ai Gmail', { tool: 'send_message' }, 'deny');
  assert.ok(claudeConnectors(local).deny.includes('mcp__claude_ai_Gmail__send_message'));
  const list = (await listConnectors({ local })).claude.find(c => c.name === 'Gmail').tools;
  assert.deepEqual(list.map(x => [x.name, x.label, x.group, x.value, x.fixed]), [['send_message', 'Send message', 'write', 'deny', false]]);
  // el formato viejo (booleanos) sigue valiendo y no se pierde al guardar un permiso
  assert.equal(JSON.parse(fs.readFileSync(path.join(local, 'connectors.json'), 'utf8')).claude['claude.ai Gmail'], true);
  assert.equal((await listConnectors({ local })).engines.codex.ask, false);
});

test('Claude: las herramientas de IOL e IBKR que operan quedan en Nunca fijo; las de consulta se pueden cambiar', async t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  const { setToolMode } = require('./lab-brokers');
  setConnector(local, 'claude', 'claude.ai Interactive Brokers (IBKR)', true);
  const opts = { local }, ibkr = 'claude.ai Interactive Brokers (IBKR)';
  await assert.rejects(setToolMode(opts, 'claude', ibkr, { tool: 'place_order' }, 'allow'), /siempre en Nunca/);
  await assert.rejects(setToolMode(opts, 'claude', ibkr, { tool: 'create_order_instruction' }, 'ask'), /siempre en Nunca/);
  await setToolMode(opts, 'claude', ibkr, { group: 'write' }, 'allow');   // el grupo no toca las fijas
  assert.ok(claudeConnectors(local).deny.includes('mcp__claude_ai_Interactive_Brokers_IBKR__place_order'));
  assert.ok(!claudeConnectors(local).allow.some(s => /place_order|create_alert/.test(s)));
  await setToolMode(opts, 'claude', ibkr, { tool: 'get_account_positions' }, 'ask');
  const c = claudeConnectors(local);
  assert.ok(!c.allow.includes('mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions') && !c.deny.includes('mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions'));
  const tools = (await listConnectors({ local })).claude.find(x => /IBKR/.test(x.name)).tools;
  assert.deepEqual(tools.find(x => x.name === 'place_order'), { name: 'place_order', label: 'Place order', group: 'write', fixed: true, value: 'deny' });
  await assert.rejects(setToolMode(opts, 'claude', 'claude.ai Gmail', { tool: 'send_message' }, 'quizás'), /Elegí/);
});

test('«Permitir siempre» en el chat guarda allow para esa herramienta; no para las fijas', t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  const { allowAlways, describeMcp } = require('./lab-brokers');
  const d = describeMcp(local, 'mcp__claude_ai_Gmail__send_message');
  assert.deepEqual([d.connector, d.label], ['Gmail', 'Send message']);
  assert.equal(describeMcp(local, 'Bash'), null);
  assert.ok(allowAlways(local, 'mcp__claude_ai_Gmail__send_message'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(local, 'connectors.json'), 'utf8')).tools.claude['claude.ai Gmail'].send_message, 'allow');
  assert.equal(allowAlways(local, 'mcp__claude_ai_Interactive_Brokers_IBKR__place_order'), null);
  assert.equal(allowAlways(local, 'mcp__otro__algo'), null);
});

test('Codex: por herramienta sólo Siempre permitir / Nunca; una escritura permitida habilita destructive para esa app y nada más', async t => {
  const local = tmp(t);
  const gmail = 'connector_gmail';
  fs.writeFileSync(path.join(local, 'connectors-seen.json'), JSON.stringify({ codex: { at: Date.now(), apps: [
    { id: gmail, name: 'Gmail', accessible: true, tools: [{ name: 'list_labels', readOnly: true }, { name: 'archive_emails', readOnly: false }, { name: 'forward_emails', readOnly: false }] },
    { id: 'connector_otra', name: 'Otra', accessible: false, tools: [] }] } }));
  const { setToolMode } = require('./lab-brokers');
  setConnector(local, 'codex', gmail, true);
  const apps = () => codexConnectors(local).args.find(s => s.startsWith('apps='));
  assert.match(apps(), /"connector_gmail" = \{ enabled = true, default_tools_enabled = false, destructive_enabled = false, tools = \{ "gmail\.list_labels" = \{ enabled = true \} \} \}/);
  await assert.rejects(setToolMode({ local }, 'codex', gmail, { tool: 'archive_emails' }, 'ask'), /Codex no puede pedir/);
  await setToolMode({ local }, 'codex', gmail, { tool: 'archive_emails' }, 'allow');
  assert.match(apps(), /destructive_enabled = true, tools = \{ "gmail\.list_labels" = \{ enabled = true \}, "gmail\.archive_emails" = \{ enabled = true \} \}/);
  assert.doesNotMatch(apps(), /forward_emails/);
  const r = await listConnectors({ local });
  assert.ok(!r.codex.some(c => c.name === 'Otra'), 'las apps sin conectar no se listan');
  const g = r.codex.find(c => c.name === 'Gmail');
  assert.deepEqual(g.tools.map(x => [x.name, x.group, x.value]), [['list_labels', 'read', 'allow'], ['archive_emails', 'write', 'allow'], ['forward_emails', 'write', 'deny']]);
  await setToolMode({ local }, 'codex', gmail, { tool: 'list_labels' }, 'deny');
  assert.doesNotMatch(apps(), /list_labels/);
});

test('Codex: listCodexApps pide app/read de las accesibles y de los brokers y devuelve sus herramientas', async () => {
  const { EventEmitter } = require('events');
  const sent = [];
  const spawnProcess = () => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.kill = () => {};
    p.stdin = { write: line => {
      const m = JSON.parse(line); sent.push(m);
      const reply = o => setImmediate(() => p.stdout.emit('data', JSON.stringify(o) + '\n'));
      if (m.method === 'initialize') reply({ id: 1, result: {} });
      if (m.method === 'app/list') reply({ id: 2, result: { data: [{ id: 'connector_gmail', name: 'Gmail', isAccessible: true }, { id: 'asdk_x', name: 'X', isAccessible: false },
        { id: 'asdk_app_69bc11db874881918718abaca20b68ce', name: 'IBKR', isAccessible: false }] } });
      if (m.method === 'app/read') reply({ id: 3, result: { apps: [{ id: 'connector_gmail', name: 'Gmail', toolSummaries: [{ name: 'list_labels', isReadOnly: true }, { name: 'send_email', isReadOnly: false }] }], missingAppIds: [] } });
    } };
    return p;
  };
  const { listCodexApps } = require('./lab-brokers');
  const apps = await listCodexApps({ binary: 'codex', env: {}, spawnProcess, timeout: 3000 });
  assert.deepEqual(sent.find(m => m.method === 'app/read').params, { appIds: ['connector_gmail', 'asdk_app_69bc11db874881918718abaca20b68ce', 'asdk_app_6a207f00eed0819181227b2ea257ff0b'], includeTools: true });
  assert.ok(apps.some(a => a.id === 'asdk_app_6a207f00eed0819181227b2ea257ff0b' && !a.accessible), 'IOL sin listar sale igual, sin autorizar');
  assert.deepEqual(apps.find(a => a.id === 'connector_gmail').tools, [{ name: 'list_labels', title: null, readOnly: true }, { name: 'send_email', title: null, readOnly: false }]);
});

test('un init sin herramientas (conectores todavía pending) muestra el estado del motor pero no pierde las herramientas ya vistas', t => {
  const local = tmp(t);
  recordClaudeInit(local, init);
  recordClaudeInit(local, { mcp_servers: [{ name: 'claude.ai Gmail', status: 'pending' }], tools: ['Bash'] });
  const gmail = JSON.parse(fs.readFileSync(path.join(local, 'connectors-seen.json'), 'utf8')).claude.servers.find(s => s.name === 'claude.ai Gmail');
  assert.deepEqual([gmail.status, gmail.tools], ['pending', ['send_message']]);
});

test('Claude: los MCP de plugins de la cuenta no se listan como conectores y se niegan en el turno', async t => {
  const local = tmp(t);
  recordClaudeInit(local, { mcp_servers: [...init.mcp_servers, { name: 'plugin:finance:gmail', status: 'failed' }],
    tools: [...init.tools, 'mcp__plugin_finance_gmail__send'] });
  assert.ok(claudeConnectors(local).deny.includes('mcp__plugin_*'));
  const { claude } = await listConnectors({ local });
  assert.ok(!claude.some(c => /^plugin:/.test(c.id)));
  assert.ok(claude.some(c => c.id === 'claude.ai Gmail'));
});
