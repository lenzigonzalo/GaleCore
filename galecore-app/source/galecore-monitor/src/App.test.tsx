import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./auth/supabase', () => ({
  getSession: async () => null,
  supabaseConfigured: true,
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));
jest.mock('lightweight-charts', () => ({}));
jest.mock('@xterm/xterm', () => ({ Terminal: jest.fn() }));

test('shows login when there is no authenticated session', async () => {
  render(<App />);
  expect(await screen.findByLabelText('Usuario')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Entrar' })).toBeDisabled();
});
