import { regularSessionCountdown, fmtRemaining } from './marketSession';

const iso = (d: Date) => d.toISOString();

test('abierto: cuenta hasta el cierre (verano, 16:00 ET = 20:00Z)', () => {
  const r = regularSessionCountdown(new Date('2026-10-09T17:45:00Z')); // 13:45 ET
  expect(r.open).toBe(true);
  expect(iso(r.closesAt)).toBe('2026-10-09T20:00:00.000Z');
  expect(r.remainingMs).toBe(135 * 60000);
  expect(fmtRemaining(r.remainingMs)).toBe('2h 15m');
});
test('antes de abrir: cuenta hasta la apertura del mismo día', () => {
  const r = regularSessionCountdown(new Date('2026-10-09T10:00:00Z')); // 06:00 ET
  expect(r.open).toBe(false);
  expect(iso(r.opensAt)).toBe('2026-10-09T13:30:00.000Z');
  expect(fmtRemaining(r.remainingMs)).toBe('3h 30m');
});
test('después de cerrar: apertura del próximo día hábil', () => {
  const r = regularSessionCountdown(new Date('2026-10-09T21:00:00Z')); // viernes 17:00 ET
  expect(r.open).toBe(false);
  expect(iso(r.opensAt)).toBe('2026-10-12T13:30:00.000Z'); // lunes
});
test('fin de semana: abre el lunes; invierno usa -5', () => {
  const r = regularSessionCountdown(new Date('2026-01-10T15:00:00Z')); // sábado
  expect(r.open).toBe(false);
  expect(iso(r.opensAt)).toBe('2026-01-12T14:30:00.000Z');
  expect(iso(r.closesAt)).toBe('2026-01-12T21:00:00.000Z');
});
test('fmtRemaining con días', () => {
  expect(fmtRemaining(((2 * 24 + 3) * 60) * 60000)).toBe('2d 3h');
  expect(fmtRemaining(14 * 3600000 + 3 * 60000)).toBe('14h 03m');
});
