const fs = require('fs');
const path = require('path');

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

function brokerQueries(local) {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(local, 'broker-queries.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new Error('No se pudo leer la configuración local de consultas a brokers.'); }
  if (settings.enabled !== true) return null;
  const apps = '{ _default = { enabled = false }, ' + BROKERS.map(b =>
    JSON.stringify(b.id) + ' = { enabled = true, default_tools_enabled = false, destructive_enabled = false, tools = { ' +
    b.tools.map(t => JSON.stringify(b.prefix + '.' + t) + ' = { enabled = true }').join(', ') + ' } }'
  ).join(', ') + ' }';
  return {
    args: ['--enable', 'apps', '-c', 'apps=' + apps,
      '-c', 'mcp_servers.ibkr.enabled=false', '-c', 'mcp_servers.iol.enabled=false'],
    instructions: '\nBrokers externos habilitados sólo para consultas: IBKR e IOL, mediante las conexiones de ChatGPT del usuario. ' +
      'GaleCore sigue siendo la primera fuente. Para datos propios de esos brokers usá sus consultas y presentá fuente y fecha por separado. ' +
      'No envíes, prepares, modifiques ni canceles operaciones, ni cambies alertas, listas, permisos o fondos. ' +
      'En IOL comprobá get_access_mode antes de consultar la cuenta; debe devolver read_only. ' +
      'No uses shell, HTTP ni otro canal para evitar estas restricciones. Si falta una consulta, declará el faltante.\n',
  };
}

// Interruptor de Configuración → Mis conectores (WS-0083): lee y escribe el mismo broker-queries.json. Un archivo ilegible cuenta como apagado.
function brokerSetting(local) {
  try { return JSON.parse(fs.readFileSync(path.join(local, 'broker-queries.json'), 'utf8')).enabled === true; } catch { return false; }
}
function setBrokerQueries(local, enabled) {
  fs.mkdirSync(local, { recursive: true });
  const file = path.join(local, 'broker-queries.json'), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ enabled: enabled === true }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return enabled === true;
}

module.exports = { brokerQueries, brokerSetting, setBrokerQueries };
