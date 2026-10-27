import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageSetting } from './LanguageSetting';
import { saveSpaceItem, SpaceItem } from '../../api/space';
jest.mock('../../api/space', () => ({ saveSpaceItem: jest.fn() }));
const profile = { kind: 'profile', key: 'perfil', title: 'Perfil', format: 'json', visibility: 'private', isOwn: true, content: JSON.stringify({
  reference_capital: { amount: 12000, currency: 'USD' }, risk_limits: ['máximo 5 % por operación'], preferred_sources: ['galecore'], language: 'español' }) } as SpaceItem;

test('cambiar el idioma guarda sólo ese campo y conserva el resto del perfil', async () => {
  (saveSpaceItem as jest.Mock).mockResolvedValue(undefined);
  const changed = jest.fn(); render(<LanguageSetting item={profile} onChanged={changed}/>);
  expect(screen.getByLabelText('Idioma')).toHaveValue('español');
  fireEvent.change(screen.getByLabelText('Idioma'), { target: { value: 'English' } });
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content)).toEqual({
    reference_capital: { amount: 12000, currency: 'USD' }, risk_limits: ['máximo 5 % por operación'], preferred_sources: ['galecore'], language: 'English' });
});
