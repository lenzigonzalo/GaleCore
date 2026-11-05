const fs = require('fs');
const path = require('path');

// Reglas de permisos de Claude Code (WS-0083, Configuración → Permisos). Las del producto viven en knowledge/.claude/settings.json
// y son fijas; las del usuario se guardan en <local>/claude-permissions.json (por PC, no se versiona). `--setting-sources project,local`
// busca .claude/ en la carpeta del proyecto, no en knowledge/, así que el Lab arma por turno un único --settings con las dos.
const LISTS = ['allow', 'ask', 'deny'];
const RULE = /^[A-Za-z_][\w.-]*(\(.+\))?$/;   // Herramienta  o  Herramienta(patrón)

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
const rules = (o, k) => (Array.isArray(o?.[k]) ? o[k].filter(r => typeof r === 'string' && r) : []);

function productSettings(kb) { return readJson(path.join(kb, '.claude', 'settings.json')); }

function userRules(local) {
  const saved = readJson(path.join(local, 'claude-permissions.json'));
  return Object.fromEntries(LISTS.map(k => [k, rules(saved, k)]));
}

function permissionRules(kb, local) {
  const p = productSettings(kb).permissions || {};
  return { product: Object.fromEntries(LISTS.map(k => [k, rules(p, k)])), user: userRules(local) };
}

// Reemplaza las reglas del usuario. Sólo allow/ask/deny con reglas de forma válida; el modo nunca se toca desde acá.
function saveUserRules(local, body, fail) {
  const out = {};
  for (const k of LISTS) {
    const list = body?.[k] === undefined ? [] : body[k];
    if (!Array.isArray(list)) throw fail('Las reglas de «' + k + '» tienen que ser una lista.');
    out[k] = [];
    for (const r of list) {
      const rule = typeof r === 'string' ? r.trim() : '';
      if (!RULE.test(rule) || /bypassPermissions/i.test(rule)) throw fail('Regla inválida: «' + String(r).slice(0, 60) + '». Usá Herramienta o Herramienta(patrón).');
      if (!out[k].includes(rule)) out[k].push(rule);
    }
  }
  fs.mkdirSync(local, { recursive: true });
  const file = path.join(local, 'claude-permissions.json'), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return out;
}

// Settings de un turno: los del producto más las reglas del usuario (sin duplicar).
function mergedSettings(kb, local) {
  const base = productSettings(kb), user = userRules(local);
  const permissions = { ...(base.permissions || {}) };
  for (const k of LISTS) { const all = [...rules(permissions, k), ...user[k]]; if (all.length) permissions[k] = [...new Set(all)]; }
  return { ...base, permissions };
}

module.exports = { permissionRules, saveUserRules, mergedSettings };
