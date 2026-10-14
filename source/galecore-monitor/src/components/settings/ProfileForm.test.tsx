import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileForm } from './ProfileForm';
import { saveSpaceItem, SpaceItem } from '../../api/space';
jest.mock('../../api/space', () => ({ saveSpaceItem: jest.fn() }));
const profile = { kind: 'profile', key: 'owner-profile', title: 'Perfil', format: 'json', visibility: 'private', isOwn: true, content: JSON.stringify({ reference_capital: { amount: 12000, currency: 'USD' }, horizon: '45 días', risk_limits: 'No abrir en FOMC; máximo definido por mí', unknown_policy: { preserve: true } }) } as SpaceItem;
test('Cancelar restaura todos los datos guardados y no escribe el perfil', () => {
  render(<ProfileForm item={profile} onChanged={() => {}}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Editar perfil' }));
  fireEvent.change(screen.getByLabelText('Capital de referencia'), { target: { value: '50000' } });
  fireEvent.change(screen.getByLabelText('Horizonte'), { target: { value: 'Otro' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByLabelText('Capital de referencia')).toHaveValue('12000');
  expect(screen.getByLabelText('Horizonte')).toHaveValue('45 días');
  expect(saveSpaceItem).not.toHaveBeenCalled();
});
test('guardar conserva campos desconocidos y límites como texto libre, sin crear defaults', async () => {
  (saveSpaceItem as jest.Mock).mockResolvedValue(undefined);
  const changed = jest.fn(); render(<ProfileForm item={profile} onChanged={changed}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Editar perfil' }));
  fireEvent.change(screen.getByLabelText('Horizonte'), { target: { value: '60 días' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  const payload = JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content);
  expect(payload.unknown_policy).toEqual({ preserve: true });
  expect(payload.risk_limits).toBe('No abrir en FOMC; máximo definido por mí');
  expect(payload.horizon).toBe('60 días'); expect(payload.max_drawdown).toBeUndefined();
});
