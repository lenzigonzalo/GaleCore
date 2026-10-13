import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CalendarDock } from './CalendarDock';
import api from '../../api/client';
jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
test('una fuente fallida conserva el calendario de la otra y muestra detalle legible', async () => {
  const day = new Date(); day.setDate(day.getDate() + 1);
  const date = day.toISOString().slice(0, 10);
  (api.get as jest.Mock).mockImplementation((path: string) => path.includes('Fred') ? Promise.reject(new Error('offline'))
    : Promise.resolve({ data: { data: [{ end: date }], upstreamUrl: 'https://example.test/fed', retrievedAt: new Date().toISOString() } }));
  render(<CalendarDock />);
  const event = await screen.findByRole('button', { name: /Reunión FOMC/ });
  expect(event).toHaveAccessibleName(`${date} · Reunión FOMC`);
  expect(screen.getByText('Agenda actual')).toBeInTheDocument();
  expect(screen.getByText('FRED: no se pudo actualizar el calendario.')).toBeInTheDocument();
  fireEvent.click(event);
  expect(screen.getByRole('link', { name: 'Ver publicación original ↗' })).toHaveAttribute('href', 'https://example.test/fed');
  expect(screen.getByText(/El horario aún no está disponible/)).toBeInTheDocument();
});
