import { resolveWatchlist, addSymbol, removeSymbol, restoreSymbol, createGroup, renameGroup, deleteGroup, parseWatchlist } from './watchlistPrefs';

const base = ['SPY', 'QQQ', 'AAPL'];

test('sin preferencia arma ETF e Instrumentos; lo nuevo de la plataforma entra al último grupo', () => {
  expect(resolveWatchlist(null, base).groups).toEqual([{ name: 'ETF', symbols: ['SPY', 'QQQ'] }, { name: 'Instrumentos', symbols: ['AAPL'] }]);
  const saved = { groups: [{ name: 'Mía', symbols: ['SPY'] }, { name: 'Otra', symbols: [] }], hidden: ['QQQ'] };
  expect(resolveWatchlist(saved, base).groups[1].symbols).toEqual(['AAPL']);
});

test('agregar, quitar y restaurar', () => {
  let list = resolveWatchlist(null, base);
  list = addSymbol(list, 'MSFT', 'ETF');
  expect(list.groups[0].symbols).toEqual(['SPY', 'QQQ', 'MSFT']);
  list = removeSymbol(list, 'SPY', base);
  list = removeSymbol(list, 'MSFT', base);
  expect(list.hidden).toEqual(['SPY']);
  expect(resolveWatchlist(restoreSymbol(list, 'SPY'), base).groups[1].symbols).toContain('SPY');
});

test('grupos: nombre libre, renombrar sin repetir, borrar pasa sus tickers al primero', () => {
  let list = createGroup(createGroup(resolveWatchlist(null, base)));
  expect(list.groups.map(g => g.name)).toEqual(['ETF', 'Instrumentos', 'Grupo', 'Grupo 2']);
  expect(renameGroup(list, 'Grupo', 'ETF')).toBe(list);
  list = deleteGroup(list, 'Instrumentos');
  expect(list.groups[0].symbols).toEqual(['SPY', 'QQQ', 'AAPL']);
  expect(parseWatchlist({ groups: [] })).toBeNull();
});
