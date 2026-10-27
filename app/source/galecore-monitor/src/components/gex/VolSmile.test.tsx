import React from 'react';
import { render, screen } from '@testing-library/react';
import { VolSmile } from './VolSmile';
import { GexExpiryApi } from '../../types/gex';

const expiry = (expiration: string, dte: number, ivs: [number, number, number][]): GexExpiryApi => ({
  expiration, dte, strikes: ivs.map(([strike, putIV, callIV]) => ({ strike, putIV, callIV })),
} as unknown as GexExpiryApi);

test('dibuja el lado fuera del dinero de cada vencimiento y rotula cada uno', () => {
  const main = expiry('2026-11-20', 28, [[95, 0.24, 0.30], [100, 0.2, 0.2], [105, 0.1, 0.18]]);
  const other = expiry('2026-12-18', 56, [[95, 0.22, 0.3], [100, 0.2, 0.2], [105, 0.1, 0.19]]);
  const { container } = render(<VolSmile main={main} others={[other]} spot={100} />);
  expect(container.querySelectorAll('polyline')).toHaveLength(2);
  expect(screen.getByText(/28d/)).toBeInTheDocument();
  expect(screen.getByText(/56d/)).toBeInTheDocument();
});

test('sin IV por strike lo dice y no dibuja', () => {
  render(<VolSmile main={expiry('2026-11-20', 28, [[100, 0, 0]])} others={[]} spot={100} />);
  expect(screen.getByText('Sin IV por strike para este vencimiento.')).toBeInTheDocument();
});
