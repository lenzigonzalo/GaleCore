import { labRequest } from '../../api/lab';

const TEXT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Título de una respuesta: el primer encabezado o la primera línea con texto, sin marcas de markdown. */
export function noteTitle(text: string): string {
  const line = text.split(/\r?\n/).map(l => l.replace(/^[#>\-*\s|]+/, '').replace(/[*_`[\]]/g, '').trim()).find(Boolean) || 'nota';
  return line.length > 70 ? line.slice(0, 70).trim() : line;
}

/** notas/<fecha>-<título>.md, sólo con letras, números y guiones. */
export function notePath(text: string, now = new Date(), attempt = 0): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const slug = TEXT(noteTitle(text)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'nota';
  return `notas/${day}-${slug}${attempt ? '-' + (attempt + 1) : ''}.md`;
}

/** Guarda la respuesta en notas/ del proyecto con la API de archivos; devuelve la ruta (si ya existe una igual, numera). */
export async function saveNote(projectId: string, text: string): Promise<string> {
  const base = '/workspaces/' + encodeURIComponent(projectId) + '/files/';
  try { await labRequest(base + 'mkdir', { path: 'notas' }); } catch { /* ya existe */ }
  for (let attempt = 0; attempt < 6; attempt++) {
    const path = notePath(text, new Date(), attempt);
    try { await labRequest(base + 'write', { path, text, create: true }); return path; }
    catch (e) { if (!(e instanceof Error) || !/Ya existe/.test(e.message)) throw e; }
  }
  throw new Error('No se pudo guardar la nota.');
}
