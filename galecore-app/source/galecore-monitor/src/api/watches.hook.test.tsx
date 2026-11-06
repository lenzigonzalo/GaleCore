import { act, renderHook } from '@testing-library/react';
import { fetchSpace, saveSpaceItem } from './space';
import { useWatches } from './watches';

jest.mock('./space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));
const rule = (id: string, metric = 'price') => ({ id, symbol: 'SPY', metric, condition: 'below', threshold: 700 });
const response = (content: object) => ({ items: [{ kind: 'agent', key: 'supervisor', content: JSON.stringify(content), title: 'Avisos', format: 'json', visibility: 'private' }] });

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); (saveSpaceItem as jest.Mock).mockResolvedValue(undefined); });
afterEach(() => jest.useRealTimers());

test('refresca las líneas publicadas y conserva el piso de puts como otro aviso', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue(response({ watches: [rule('750')] }));
  const { result } = renderHook(() => useWatches('SPY'));
  await act(async () => {});
  expect(result.current.watches.map(w => w.id)).toEqual(['750']);
  (fetchSpace as jest.Mock).mockResolvedValue(response({ watches: [rule('715'), rule('700'), rule('690'), rule('puts', 'put_wall')] }));
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(result.current.watches.map(w => w.id)).toEqual(['715', '700', '690', 'puts']);
});

test('oculta la baja al instante, la guarda y restaura la línea si el supervisor la rechaza', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue(response({ watches: [rule('700')] }));
  const { result } = renderHook(() => useWatches('SPY'));
  await act(async () => {});
  await act(async () => { result.current.remove('700'); });
  expect(result.current.watches).toEqual([]);
  const saved = JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content);
  expect(saved.unwatch['700'].at).toBeTruthy();
  (fetchSpace as jest.Mock).mockResolvedValue(response({ watches: [rule('700')], unwatch: saved.unwatch, unwatch_errors: { '700': 'rechazada' } }));
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(result.current.watches.map(w => w.id)).toEqual(['700']);
});

test('una falla al guardar revierte la baja optimista y una falla al leer limpia las líneas', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue(response({ watches: [rule('700')] }));
  const { result } = renderHook(() => useWatches('SPY'));
  await act(async () => {});
  (saveSpaceItem as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { result.current.remove('700'); });
  expect(result.current.watches.map(w => w.id)).toEqual(['700']);
  (fetchSpace as jest.Mock).mockRejectedValue(new Error('offline'));
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(result.current.watches).toEqual([]);
});
