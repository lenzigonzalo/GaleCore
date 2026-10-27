const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { knowledgeDir, ensureKnowledgeDir } = require('./knowledge-dir');

test('la carpeta de datos es la variable de entorno o ~/GaleCore-datos/knowledge', () => {
  const saved = process.env.GALECORE_KNOWLEDGE_DIR;
  try {
    process.env.GALECORE_KNOWLEDGE_DIR = path.join(os.tmpdir(), 'otra');
    assert.equal(knowledgeDir(), path.resolve(os.tmpdir(), 'otra'));
    delete process.env.GALECORE_KNOWLEDGE_DIR;
    assert.equal(knowledgeDir(), path.join(os.homedir(), 'GaleCore-datos', 'knowledge'));
  } finally { if (saved === undefined) delete process.env.GALECORE_KNOWLEDGE_DIR; else process.env.GALECORE_KNOWLEDGE_DIR = saved; }
});

test('una carpeta nueva se crea desde la plantilla y una existente no se toca', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-kb-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, 'GaleCore-datos', 'knowledge');
  ensureKnowledgeDir(dir);
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore', '.claude/settings.json', 'workspaces/portfolio/workspace.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  assert.ok(fs.existsSync(path.join(dir, '.git')));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'mío');
  ensureKnowledgeDir(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'mío');
});
