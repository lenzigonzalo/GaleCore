import { notePath, noteTitle } from './labNotes';

test('el título sale del primer encabezado o línea, sin marcas', () => {
  expect(noteTitle('## Plan de **SPY**\n\ncuerpo')).toBe('Plan de SPY');
  expect(noteTitle('| a | b |\n|---|---|')).toBe('a | b |');
});

test('la nota va a notas/<fecha>-<título>.md, sin acentos ni símbolos', () => {
  const day = new Date(2026, 9, 28);
  expect(notePath('# Condor de hierro en SPY: ¿conviene?\n\ntexto', day)).toBe('notas/2026-10-28-condor-de-hierro-en-spy-conviene.md');
  expect(notePath('# Igual', day, 1)).toBe('notas/2026-10-28-igual-2.md');
  expect(notePath('???', day)).toBe('notas/2026-10-28-nota.md');
});
