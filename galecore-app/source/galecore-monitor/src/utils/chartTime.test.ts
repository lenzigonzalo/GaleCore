import { formatAxisTick, formatCrosshairTime } from './chartTime';

const t = Date.UTC(2026, 9, 9, 17, 45) / 1000; // 14:45 ART
test('intradía: hora ART', () => {
  expect(formatAxisTick(t, 3, 300)).toBe('14:45');
  expect(formatCrosshairTime(t, 300)).toMatch(/^0?9\/10 14:45$/);
});
test('diarias: fecha', () => {
  expect(formatCrosshairTime(Date.UTC(2026, 9, 9) / 1000, 86400)).toMatch(/^0?9\/10\/2026$/);
  expect(formatAxisTick(Date.UTC(2026, 9, 9) / 1000, 2, 86400)).toMatch(/^0?9\/10$/);
});
