const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { brokerQueries } = require('./lab-brokers');

test('brokers requieren opt-in local y una configuración ilegible frena el turno', t => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-brokers-'));
  t.after(() => { assert.ok(path.resolve(local).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-brokers-')); fs.rmSync(local, { recursive: true, force: true }); });
  const file = path.join(local, 'broker-queries.json');
  assert.equal(brokerQueries(local), null);
  fs.writeFileSync(file, '{"enabled":false}');
  assert.equal(brokerQueries(local), null);
  fs.writeFileSync(file, '{');
  assert.throws(() => brokerQueries(local), /configuración local/);
});

test('consulta permite ambos brokers y excluye operaciones, validaciones y conexiones duplicadas', t => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-brokers-'));
  t.after(() => { assert.ok(path.resolve(local).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-brokers-')); fs.rmSync(local, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(local, 'broker-queries.json'), '{"enabled":true}');
  const { args, instructions } = brokerQueries(local);
  const appPolicy = args.find(s => s.startsWith('apps='));
  assert.match(appPolicy, /_default = \{ enabled = false \}/);
  assert.equal((appPolicy.match(/default_tools_enabled = false/g) || []).length, 2);
  const allowed = [...appPolicy.matchAll(/"([^"]+)" = \{ enabled = true \}/g)].map(m => m[1]);
  assert.ok(allowed.includes('interactive_brokers_ibkr.get_account_orders'));
  assert.ok(allowed.includes('iol_invertironline.get_access_mode'));
  assert.ok(allowed.includes('iol_invertironline.get_order_status'));
  assert.ok(allowed.every(s => /^(interactive_brokers_ibkr|iol_invertironline)\./.test(s)));
  assert.ok(!allowed.some(s => /\.(create_|delete_|edit_|update_|set_|accept_|validate_|place_|cancel_|subscribe_|redeem_|provide_)/.test(s)));
  assert.ok(!allowed.some(s => /get_combo_identifier|get_ddjj|get_caucion_guarantee_assets/.test(s)));
  assert.ok(args.includes('mcp_servers.ibkr.enabled=false'));
  assert.ok(args.includes('mcp_servers.iol.enabled=false'));
  assert.match(instructions, /GaleCore sigue siendo la primera fuente/);
  assert.match(instructions, /debe devolver read_only/);
});
