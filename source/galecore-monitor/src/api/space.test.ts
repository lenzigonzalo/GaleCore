import { clearSpaceCache, fetchReferenceCapital, SpaceItem } from './space';
import apiClient from './client';
jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));
const get = apiClient.get as jest.Mock;
beforeEach(() => clearSpaceCache());
const profile = (currency: string, amount: unknown, isOwn = true): SpaceItem => ({ kind: 'profile', key: 'profile', title: 'Perfil', format: 'json', visibility: 'private', version: 1, updatedAt: '', owner: 'test', isOwn,
  content: JSON.stringify({ reference_capital: { amount, currency }, risk_limits: ['máximo 2 %'], cashRatePct: 4 }) });
test.each([['USD', 12000, true, 12000], ['ARS', 12000, true, undefined], ['USD', '12000', true, undefined], ['USD', 12000, false, undefined]])('reads only own numeric USD capital (%s, %s, %s)', async (currency, amount, isOwn, expected) => {
  get.mockResolvedValue({ data: { items: [profile(currency as string, amount, isOwn as boolean)], shared: [profile('USD', 99999)] } });
  expect(await fetchReferenceCapital()).toBe(expected);
});
test('profile failure or malformed JSON still permits a panel without capital', async () => {
  get.mockRejectedValueOnce(new Error('offline')); expect(await fetchReferenceCapital()).toBeUndefined();
  get.mockResolvedValue({ data: { items: [{ ...profile('USD', 12000), content: '{bad json' }] } });
  expect(await fetchReferenceCapital()).toBeUndefined();
});
