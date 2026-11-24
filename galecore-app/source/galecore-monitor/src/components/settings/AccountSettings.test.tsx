import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountSettings } from './AccountSettings';
import { passwordErrorText } from '../account/MyPasswordCard';

jest.mock('../../auth/supabase', () => ({ updateOwnPassword: jest.fn() }));

const sw = () => screen.getByRole('switch', { name: 'Sugerir temas del momento al abrir un chat' });

test('el interruptor de Chat nuevo se mueve al tocarlo, sin esperar al guardado', () => {
  render(<AccountSettings suggestions={false} onSuggestions={() => new Promise(() => undefined)} />);
  fireEvent.click(sw());
  expect(sw()).toHaveAttribute('aria-checked', 'true');
});

test('si el guardado falla vuelve atrás y lo dice', async () => {
  render(<AccountSettings suggestions={false} onSuggestions={() => Promise.reject(new Error('500'))} />);
  fireEvent.click(sw());
  await waitFor(() => expect(sw()).toHaveAttribute('aria-checked', 'false'));
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar');
});

test('mientras guarda no acepta un segundo toque', () => {
  const save = jest.fn(() => new Promise<void>(() => undefined));
  render(<AccountSettings suggestions={false} onSuggestions={save} />);
  fireEvent.click(sw());
  fireEvent.click(sw());
  expect(save).toHaveBeenCalledTimes(1);
});

test('los errores de Supabase al cambiar la contraseña salen en castellano', () => {
  expect(passwordErrorText({ code: 'same_password', message: 'New password should be different from the old password.' }))
    .toBe('La contraseña nueva tiene que ser distinta de la actual.');
  expect(passwordErrorText({ code: 'weak_password', message: 'Password should be at least 6 characters.' })).toMatch(/al menos 6/);
  expect(passwordErrorText({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toMatch(/sesión venció/);
  expect(passwordErrorText({ code: 'otro', message: 'Algo nuevo' })).toBe('Algo nuevo');
});
