const fs = require('fs');
const os = require('os');
const path = require('path');
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:\-]{0,119}$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function modelOptions(home = os.homedir()) {
  let models = [];
  let modelEfforts = {};
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'models_cache.json'), 'utf8'));
    const visible = (cache.models || []).filter(m => m.visibility === 'list' && MODEL.test(m.slug));
    models = visible.map(m => m.slug);
    modelEfforts = Object.fromEntries(visible.map(m => [m.slug, (m.supported_reasoning_levels || []).map(level => level.effort).filter(e => EFFORTS.includes(e))]));
  } catch { /* No cache: only the CLI default is offered. */ }
  return {
    claude: { models: [...new Set(['sonnet', 'opus', 'haiku', process.env.GALECORE_LAB_MODEL || 'sonnet'])], efforts: EFFORTS.filter(e => e !== 'ultra'), modelEfforts: { haiku: [] }, defaultModel: process.env.GALECORE_LAB_MODEL || 'sonnet' },
    codex: { models, efforts: models.length ? EFFORTS.filter(e => models.every(m => modelEfforts[m].includes(e))) : [], modelEfforts },
  };
}
function normalize(provider, body) {
  if ((body.model !== undefined && typeof body.model !== 'string') || (body.effort !== undefined && typeof body.effort !== 'string')) throw new Error('Modelo o esfuerzo inválido.');
  const model = body.model || (provider === 'claude' ? process.env.GALECORE_LAB_MODEL || 'sonnet' : '');
  const effort = body.effort || (provider === 'claude' && !model.includes('haiku') ? process.env.GALECORE_LAB_EFFORT || 'medium' : '');
  if (model && !MODEL.test(model)) throw new Error('Modelo inválido.');
  if (typeof effort !== 'string' || (effort && (!EFFORTS.includes(effort) || (provider === 'claude' && effort === 'ultra')))) throw new Error('Esfuerzo inválido.');
  return { model, effort: model.includes('haiku') ? '' : effort };
}
function selection(provider, body, options = modelOptions()) {
  const chosen = normalize(provider, body), catalog = options[provider];
  if (!catalog || (chosen.model && !catalog.models.includes(chosen.model))) throw new Error('Modelo no disponible para este proveedor.');
  const supported = catalog.modelEfforts?.[chosen.model] || catalog.efforts;
  if ((body.effort && !supported.includes(body.effort)) || (chosen.effort && !supported.includes(chosen.effort))) throw new Error('Esfuerzo no disponible para este modelo.');
  return chosen;
}
function modelFlags(chat) {
  const chosen = normalize(chat.provider, chat);
  if (chat.provider === 'claude') return ['--model', chosen.model, ...(chosen.effort ? ['--effort', chosen.effort] : [])];
  return [...(chosen.model ? ['--model', chosen.model] : []), ...(chosen.effort ? ['-c', 'model_reasoning_effort=' + JSON.stringify(chosen.effort)] : [])];
}
module.exports = { modelOptions, selection, modelFlags, normalize };
