import { resolveWatchlist, addSymbol, removeSymbol, restoreSymbol, createGroup, renameGroup, deleteGroup, parseWatchlist, moveSymbol, moveGroup } from './watchlistPrefs';

const base = ['SPY', 'QQQ', 'AAPL'];

test('reordena en ambos sentidos y entre grupos sin perder ni duplicar símbolos', () => {
  const original = resolveWatchlist(null, base);
  const moved = moveSymbol(original, 'QQQ', 'ETF', 'SPY');
  expect(moved.groups[0].symbols).toEqual(['QQQ', 'SPY']);
  expect(moveSymbol(moved, 'QQQ', 'ETF', 'SPY', true)).toEqual(original);
  const cross = moveSymbol(moved, 'AAPL', 'ETF', 'SPY');
  expect(cross.groups).toEqual([{name:'ETF', symbols:['QQQ', 'AAPL', 'SPY']}, {name:'Instrumentos', symbols:[]}]);
  expect(moveSymbol(cross, 'SPY', 'Instrumentos').groups[1].symbols).toEqual(['SPY']);
  expect(original.groups[0].symbols).toEqual(['SPY', 'QQQ']);
  expect(moveSymbol(original, 'SPY', 'ETF', 'SPY')).toBe(original);
  expect(moveSymbol(original, 'AJENO', 'ETF')).toBe(original);
  expect(moveSymbol(original, 'SPY', 'Inexistente')).toBe(original);
});

test('reordena grupos arriba y abajo, conservando sus tickers y los ocultos', () => {
  const original = {...createGroup(resolveWatchlist(null, base)), hidden:['MSFT']};
  const down = moveGroup(original, 'ETF', 'Grupo', true);
  expect(down.groups.map(g => g.name)).toEqual(['Instrumentos', 'Grupo', 'ETF']);
  expect(moveGroup(down, 'ETF', 'Instrumentos')).toEqual(original);
  expect(parseWatchlist(JSON.parse(JSON.stringify(down)))).toEqual(down);
  expect(moveGroup(original, 'ETF', 'ETF')).toBe(original);
  expect(moveGroup(original, 'ETF', 'Inexistente')).toBe(original);
});

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
