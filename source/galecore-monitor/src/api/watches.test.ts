import { priceWatchesFor, watchLabel, Watch } from './watches';

const w = (o: object): Watch => ({ id: 'a', symbol: 'SPY', metric: 'price', condition: 'below', threshold: 489, words: 'x', created_at: '', ...o });

test('filtra por símbolo y métrica de precio, sin distinguir mayúsculas', () => {
  const content = { watches: [w({}), w({ id: 'b', symbol: 'qqq' }), w({ id: 'c', metric: 'vix' }), w({ id: 'd', symbol: 'spy' }), { id: 5 }, null] };
  expect(priceWatchesFor(content, 'Spy').map(x => x.id)).toEqual(['a', 'd']);
});

test('contenido sin watches da lista vacía', () => {
  expect(priceWatchesFor({}, 'SPY')).toEqual([]);
  expect(priceWatchesFor(null, 'SPY')).toEqual([]);
});

test('rótulo con formato es-AR', () => {
  expect(watchLabel(w({}))).toBe('≤ 489');
  expect(watchLabel(w({ condition: 'above', threshold: 222.29 }))).toBe('≥ 222,29');
});
