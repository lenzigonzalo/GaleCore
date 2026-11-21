import { setVisibleInterval } from './visibleInterval';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => { jest.useFakeTimers(); setVisibility('visible'); });
afterEach(() => { jest.useRealTimers(); });

test('con la pestaña visible corre en cada intervalo', () => {
  const fn = jest.fn();
  const stop = setVisibleInterval(fn, 1000);
  jest.advanceTimersByTime(3000);
  expect(fn).toHaveBeenCalledTimes(3);
  stop();
});

test('oculta no corre; al volver corre al instante y retoma', () => {
  const fn = jest.fn();
  const stop = setVisibleInterval(fn, 1000);
  setVisibility('hidden');
  jest.advanceTimersByTime(5000);
  expect(fn).not.toHaveBeenCalled();
  setVisibility('visible');
  expect(fn).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(2000);
  expect(fn).toHaveBeenCalledTimes(3);
  stop();
});

test('cancelado no vuelve a correr', () => {
  const fn = jest.fn();
  const stop = setVisibleInterval(fn, 1000);
  stop();
  jest.advanceTimersByTime(3000); setVisibility('hidden'); setVisibility('visible');
  expect(fn).not.toHaveBeenCalled();
});
