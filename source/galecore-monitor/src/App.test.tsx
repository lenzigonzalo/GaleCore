import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./auth/supabase', () => ({
  getSession: jest.fn(async () => null),
  supabaseConfigured: true,
  supabase: { auth: { onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) } },
}));
jest.mock('lightweight-charts', () => ({}));

test('shows login when there is no authenticated session', async () => {
  render(<App />);
  expect(await screen.findByLabelText('Usuario')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Entrar' })).toBeDisabled();
});
