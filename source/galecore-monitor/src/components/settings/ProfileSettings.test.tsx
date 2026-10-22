import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileSettings } from './ProfileSettings';
import { saveSpaceItem, SpaceItem } from '../../api/space';
jest.mock('../../api/space', () => ({ saveSpaceItem: jest.fn(), deleteSpaceItem: jest.fn() }));

const profile = { kind: 'profile', key: 'perfil', title: 'Perfil', format: 'json', visibility: 'private', isOwn: true, content: JSON.stringify({
  version: 15, reference_capital: { amount: 2479.13, currency: 'USD' }, horizon: '30 a 45 días', max_drawdown: '15 %',
  risk_limits: ['5 % por operación', '15 % sumado'], language: 'español' }) } as SpaceItem;
const view = (changed = jest.fn()) => render(<ProfileSettings user={{ username: 'demo', email: 'd@x.com', isAdmin: false }} items={[profile]}
  language={null} suggestions={false} onSuggestions={jest.fn()} onChanged={changed} />);

test('muestra el perfil de trading legible por campo con su versión vigente', () => {
  view();
  expect(screen.getByText('Versión vigente: v15')).toBeInTheDocument();
  expect(screen.getByText('2.479,13 USD')).toBeInTheDocument();
  expect(screen.getByText('5 % por operación')).toBeInTheDocument();
  expect(screen.getByText('30 a 45 días')).toBeInTheDocument();
});

test('editar un campo común guarda sólo ese campo y conserva el resto', async () => {
  (saveSpaceItem as jest.Mock).mockResolvedValue(undefined);
  const changed = jest.fn(); view(changed);
  fireEvent.click(screen.getByLabelText('Editar Horizonte'));
  fireEvent.change(screen.getByLabelText('Horizonte'), { target: { value: '45 a 60 días' } });
  fireEvent.click(screen.getByText('Guardar'));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  const saved = JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content);
  expect(saved.horizon).toBe('45 a 60 días');
  expect(saved.reference_capital).toEqual({ amount: 2479.13, currency: 'USD' });
  expect(saved.risk_limits).toEqual(['5 % por operación', '15 % sumado']);
  expect(saved.version).toBe(15);
});

test('un límite sólo se guarda con el ok explícito', async () => {
  (saveSpaceItem as jest.Mock).mockClear().mockResolvedValue(undefined);
  view();
  fireEvent.click(screen.getByLabelText('Editar Límites de riesgo'));
  fireEvent.change(screen.getByLabelText('Límites de riesgo'), { target: { value: '3 % por operación\n10 % sumado' } });
  expect(screen.getByText('Guardar')).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Confirmo el cambio/));
  fireEvent.click(screen.getByText('Guardar'));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalled());
  expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content).risk_limits).toEqual(['3 % por operación', '10 % sumado']);
});
