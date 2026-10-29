import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LiveWatchlist } from './LiveWatchlist';
import { useGexStore } from '../../store/useGexStore';

jest.mock('../../api/gex', () => ({ fetchGexRules: jest.fn(), fetchGexAnalysis: jest.fn() }));
jest.mock('../../api/space', () => ({ fetchSpace: async () => ({ items: [] }), saveSpaceItem: jest.fn() }));
jest.mock('./TickerGrid', () => ({ TickerGrid: () => <div>Cotizaciones</div> }));
jest.mock('../macro/CalendarDock', () => ({ CalendarDock: () => <div>Eventos del calendario</div> }));
let mockStrikeNotify: (() => void) | undefined;
jest.mock('../layout/SupervisorAlerts', () => ({
  SupervisorAlerts: () => <div>Avisos de la cuenta</div>,
  useStrikeAlerts: (_enabled: boolean, notify: () => void) => { mockStrikeNotify = notify; return { alerts: [], notice: null }; },
}));

function Dock({ autoHide = true }: { autoHide?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><textarea aria-label="Mensaje"/><LiveWatchlist open={open} enabled autoHide={autoHide}
    onClose={() => setOpen(false)} onToggle={() => setOpen(value => !value)} onSelect={() => {}}
    socketStatus="disconnected" subscribeSymbol={() => {}} unsubscribeSymbol={() => {}} /></>;
}
beforeEach(() => { useGexStore.setState({ rules: {} as any, rulesError: null, tickers: [] }); });

test('el borde revela los iconos; paneles se usan superpuestos y se cierran al retirar el mouse', async () => {
  const { container } = render(<Dock/>);
  const area = container.querySelector('.lw-reveal')!;
  const edge = screen.getByRole('button', { name: 'Mostrar paneles de mercado' });
  expect(area).not.toHaveClass('is-open');
  fireEvent.pointerEnter(area, { pointerType: 'mouse' });
  expect(edge).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Abrir watchlist' }));
  expect(screen.getByRole('complementary')).toBeVisible();
  // Un clic en texto no enfocable del panel produce blur sin destino: sigue dentro del dock.
  fireEvent.blur(screen.getByRole('button', { name: 'Cerrar panel de watchlist' }), { relatedTarget: null });
  expect(screen.getByRole('complementary')).toBeVisible();
  fireEvent.pointerLeave(area);
  expect(area).not.toHaveClass('is-open');
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.pointerEnter(area, { pointerType: 'mouse' });
  fireEvent.click(screen.getByRole('button', { name: 'Abrir calendario' }));
  expect(screen.getByText('Eventos del calendario')).toBeVisible();
  fireEvent.pointerLeave(area);
  expect(area).not.toHaveClass('is-open');
  await act(async () => {});
});

test('teclado mantiene foco al salir el mouse y Escape devuelve al borde; toque también revela los iconos', async () => {
  const { container } = render(<Dock/>);
  const area = container.querySelector('.lw-reveal')!;
  const edge = screen.getByRole('button', { name: 'Mostrar paneles de mercado' });
  act(() => edge.focus());
  expect(area).toHaveClass('is-open');
  act(() => screen.getByRole('button', { name: 'Abrir watchlist' }).focus());
  fireEvent.click(screen.getByRole('button', { name: 'Abrir watchlist' }));
  const close = screen.getByRole('button', { name: 'Cerrar panel de watchlist' });
  expect(close).toHaveFocus();
  fireEvent.pointerLeave(area);
  expect(area).toHaveClass('is-open');
  fireEvent.keyDown(close, { key: 'Escape' });
  expect(edge).toHaveFocus();
  expect(area).not.toHaveClass('is-open');
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.click(edge);
  expect(area).toHaveClass('is-open');
  act(() => screen.getByRole('textbox', { name: 'Mensaje' }).focus());
  expect(area).not.toHaveClass('is-open');
  await act(async () => {});
});

test('un aviso de strike sigue abriendo la campana aunque la barra esté oculta; fuera de Chat sigue la barra normal', async () => {
  const { container, rerender } = render(<Dock/>);
  act(() => mockStrikeNotify?.());
  expect(container.querySelector('.lw-reveal')).toHaveClass('is-open');
  expect(screen.getByText('Avisos de la cuenta')).toBeVisible();
  rerender(<Dock autoHide={false}/>);
  expect(container.querySelector('.lw-reveal')).toBeNull();
  expect(screen.getByRole('navigation', { name: 'Paneles de mercado' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mostrar paneles de mercado' })).not.toBeInTheDocument();
  await act(async () => {});
});
