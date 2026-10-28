import { parseBalances } from './account';
jest.mock('./client', () => ({ __esModule: true, default: {} }));
test('acepta un cero real y números textuales del bróker sin inventar fecha', () => {
  expect(parseBalances({ data: { 'net-liquidating-value': '12000.50', 'derivative-buying-power': '4500', 'cash-balance': 0 } })).toMatchObject({ netLiquidatingValue: 12000.5, buyingPower: 4500, cash: 0, timestamp: '' });
});
test('una lectura incompleta o no numérica no se convierte en saldo cero', () => {
  expect(() => parseBalances({})).toThrow('incompleta');
  expect(() => parseBalances({ netLiquidatingValue: 'NaN', buyingPower: 0, cash: 0 })).toThrow('incompleta');
});
