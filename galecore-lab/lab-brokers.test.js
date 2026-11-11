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
  assert.deepEqual(claudeConnectors(tmp(t)), { allow: [], deny: ['mcp__claude_ai_*'], instructions: '' });
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
  assert.deepEqual(deny.sort(), ['mcp__claude_ai_Gmail', 'mcp__claude_ai_Interactive_Brokers_IBKR', 'mcp__claude_ai_IoL', 'mcp__claude_ai_LSEG']);
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
