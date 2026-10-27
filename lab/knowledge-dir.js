/**
 * Carpeta de datos del usuario (la «knowledge»): GALECORE_KNOWLEDGE_DIR o ~/GaleCore-datos/knowledge.
 * El Lab la crea al arrancar si falta, desde la plantilla ai/config/knowledge-template, y la deja como repo git local.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TEMPLATE = path.resolve(__dirname, '..', 'ai', 'config', 'knowledge-template');

function knowledgeDir() {
  const configured = process.env.GALECORE_KNOWLEDGE_DIR;
  return configured ? path.resolve(configured) : path.join(os.homedir(), 'GaleCore-datos', 'knowledge');
}

function ensureKnowledgeDir(dir = knowledgeDir()) {
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true, timeout: 20000 });
  try {
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=GaleCore', '-c', 'user.email=galecore@localhost', 'commit', '-q', '-m', 'plantilla inicial');
  } catch { /* sin git: la carpeta funciona igual; el Lab no la versiona hasta que haya git */ }
  return dir;
}

module.exports = { knowledgeDir, ensureKnowledgeDir, TEMPLATE };
