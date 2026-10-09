import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarketWatchlist } from './MarketWatchlist';
test('contraer conserva la lista montada y resize de teclado respeta límites', () => {
  render(<MarketWatchlist><div>SPY</div></MarketWatchlist>);
  const resize = screen.getByRole('separator', { name: 'Ancho de watchlist' });
  fireEvent.keyDown(resize, { key: 'ArrowLeft' }); expect(resize).toHaveAttribute('aria-valuenow', '400');
  for (let i = 0; i < 30; i++) fireEvent.keyDown(resize, { key: 'ArrowRight' });
  expect(resize).toHaveAttribute('aria-valuenow', '300');
  fireEvent.click(screen.getByRole('button', { name: 'Contraer watchlist' }));
  expect(screen.getByText('SPY')).toBeInTheDocument(); expect(screen.getByText('SPY')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Expandir watchlist' })); expect(screen.getByText('SPY')).toBeVisible();
});

test('arrastre ajusta ancho y termina al soltar el puntero', () => {
  render(<MarketWatchlist><div>SPY</div></MarketWatchlist>);
  const resize = screen.getByRole('separator');
  let captured = false;
  resize.setPointerCapture = jest.fn(() => { captured = true; });
  resize.hasPointerCapture = jest.fn(() => captured);
  resize.releasePointerCapture = jest.fn(() => { captured = false; });
  resize.parentElement!.getBoundingClientRect = jest.fn(() => ({ right: 900 } as DOMRect));
  const event = (type: string, clientX = 0) => { const e = new Event(type, { bubbles: true }); Object.assign(e, { pointerId: 7, clientX }); fireEvent(resize, e); };
  event('pointerdown'); event('pointermove', 500);
  expect(resize).toHaveAttribute('aria-valuenow', '400');
  event('pointerup'); event('pointermove', 200);
  expect(resize).toHaveAttribute('aria-valuenow', '400');
});
