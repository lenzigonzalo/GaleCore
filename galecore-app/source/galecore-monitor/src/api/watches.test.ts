import { allWatches, priceWatchesFor, watchLabel, watchText, Watch } from './watches';

const w = (o: object): Watch => ({ id: 'a', symbol: 'SPY', metric: 'price', condition: 'below', threshold: 489, words: 'x', created_at: '', ...o });

test('filtra por símbolo y métrica de precio, sin distinguir mayúsculas', () => {
  const content = { watches: [w({}), w({ id: 'b', symbol: 'qqq' }), w({ id: 'c', metric: 'vix' }), w({ id: 'd', symbol: 'spy' }), { id: 5 }, null] };
  expect(priceWatchesFor(content, 'Spy').map(x => x.id)).toEqual(['a', 'd']);
});

test('contenido sin watches da lista vacía', () => {
  expect(priceWatchesFor({}, 'SPY')).toEqual([]);
  expect(priceWatchesFor(null, 'SPY')).toEqual([]);
});

test('SPY incluye niveles y piso de puts; no mezcla volatilidad ni reglas inactivas con el precio', () => {
  const content = { watches: [
    w({ id: '750', threshold: 750, status: 'cancelled' }),
    ...[715, 700, 690].map(n => w({ id: String(n), threshold: n })),
    w({ id: 'puts', metric: 'put_wall', threshold: 700 }),
    w({ id: 'gamma', metric: 'gamma_zero' }), w({ id: 'calls', metric: 'call_wall' }),
    w({ id: 'iv', metric: 'iv_rank' }), w({ id: 'date', metric: 'date' }),
    w({ id: 'met', status: 'met' }), w({ id: 'expired', status: 'expired' }),
    w({ id: 'bad', threshold: NaN }), w({ id: '', threshold: 700 }),
  ] };
  expect(priceWatchesFor(content, 'SPY').map(x => x.id)).toEqual(['715', '700', '690', 'puts', 'gamma', 'calls']);
});

test('una baja pendiente sigue oculta al recargar; si fue rechazada vuelve a verse', () => {
  const content = { watches: [w({})], unwatch: { a: { at: '2026-11-06' } } };
  expect(priceWatchesFor(content, 'SPY')).toEqual([]);
  expect(priceWatchesFor({ ...content, unwatch_errors: { a: 'No se pudo cancelar' } }, 'SPY')).toHaveLength(1);
});

test('rótulo con formato es-AR', () => {
  expect(watchLabel(w({}))).toBe('≤ 489');
  expect(watchLabel(w({ condition: 'above', threshold: 222.29 }))).toBe('≥ 222,29');
  expect(watchLabel(w({ metric: 'put_wall', threshold: 700 }))).toBe('Piso de puts ≤ 700');
  expect(watchLabel(w({ metric: 'put_wall', label: 'muro de puts de SPY ≤ 700' }))).toBe('muro de puts de SPY ≤ 700');
  expect(watchLabel(w({ metric: 'gamma_zero' }))).toBe('Gamma cero ≤ 489');
});

test('allWatches devuelve todas las métricas y descarta lo mal formado', () => {
  const content = { watches: [w({}), w({ id: 'b', metric: 'time' }), { id: 5 }, null, { symbol: 'X' }] };
  expect(allWatches(content).map(x => x.id)).toEqual(['a', 'b']);
  expect(allWatches(null)).toEqual([]);
});

test('watchText usa label y, sin él, símbolo + condición + umbral', () => {
  expect(watchText(w({ label: ' precio de SPY ≤ 489 ' }))).toBe('precio de SPY ≤ 489');
  expect(watchText(w({}))).toBe('SPY ≤ 489');
  expect(watchText(w({ metric: 'time', condition: undefined, threshold: undefined }))).toBe('SPY');
});
