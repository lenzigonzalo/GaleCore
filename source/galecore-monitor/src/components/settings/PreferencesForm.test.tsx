import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PreferencesForm } from './PreferencesForm';
import { saveSpaceItem, SpaceItem } from '../../api/space';
jest.mock('../../api/space', () => ({ saveSpaceItem: jest.fn() }));
const profile = { kind: 'profile', key: 'perfil', title: 'Perfil', format: 'json', visibility: 'private', isOwn: true, content: JSON.stringify({
  reference_capital: { amount: 12000, currency: 'USD' }, horizon: '45 días', risk_limits: ['máximo 5 % por operación'],
  delivery_format: ['tablas y gráficos primero, texto mínimo', 'una regla propia'], preferred_sources: ['galecore', 'fred'], language: 'español', unknown_policy: { keep: true },
}) } as SpaceItem;

beforeEach(() => { jest.useFakeTimers(); (saveSpaceItem as jest.Mock).mockReset().mockResolvedValue(undefined); });
afterEach(() => jest.useRealTimers());

const saved = () => JSON.parse((saveSpaceItem as jest.Mock).mock.calls.at(-1)[2].content);

test('muestra lo guardado como opciones elegidas, no como texto', () => {
  render(<PreferencesForm item={profile} onChanged={() => {}}/>);
  expect(screen.getByRole('switch', { name: 'Tablas y gráficos antes que texto' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('switch', { name: 'Empezar por la conclusión' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('switch', { name: 'FRED' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('switch', { name: 'Alpha Vantage' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByLabelText('Idioma')).toHaveValue('español');
  expect(screen.queryByText('Horizonte')).toBeNull();
});

test('cambios seguidos se guardan juntos y conservan lo que la pantalla no muestra', async () => {
  const changed = jest.fn(); render(<PreferencesForm item={profile} onChanged={changed}/>);
  fireEvent.click(screen.getByRole('switch', { name: 'Alpha Vantage' }));
  fireEvent.click(screen.getByRole('switch', { name: 'FRED' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Empezar por la conclusión' }));
  expect(saveSpaceItem).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(700); });
  expect(saveSpaceItem).toHaveBeenCalledTimes(1);
  const next = saved();
  expect(next.preferred_sources).toEqual(['galecore', 'alpha_vantage']);
  expect(next.delivery_format).toEqual(['tablas y gráficos primero, texto mínimo', 'una regla propia', 'toda respuesta empieza por la conclusión en una línea']);
  expect(next.reference_capital).toEqual({ amount: 12000, currency: 'USD' });
  expect(next.horizon).toBe('45 días'); expect(next.risk_limits).toEqual(['máximo 5 % por operación']);
  expect(next.unknown_policy).toEqual({ keep: true });
  expect(changed).toHaveBeenCalledTimes(1);
});

test('apagar una opción saca sólo sus líneas', async () => {
  render(<PreferencesForm item={profile} onChanged={() => {}}/>);
  fireEvent.click(screen.getByRole('switch', { name: 'Tablas y gráficos antes que texto' }));
  await act(async () => { jest.advanceTimersByTime(700); });
  expect(saved().delivery_format).toEqual(['una regla propia']);
});
