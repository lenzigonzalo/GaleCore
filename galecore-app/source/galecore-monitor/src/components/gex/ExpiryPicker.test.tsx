import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExpiryPicker } from './ExpiryPicker';
import { GexExpiryApi } from '../../types/gex';

const expiries = [0, 7, 30, 60].map((dte, i) => ({ expiration: `2026-11-0${i + 1}`, dte, netGex: 1 })) as GexExpiryApi[];

test('rango numérico selecciona sólo fechas disponibles y cambia el elegido si queda afuera', () => {
  const onSelect = jest.fn(), onCompare = jest.fn();
  render(<ExpiryPicker expiries={expiries} selected={expiries[0].expiration} onSelect={onSelect} compared={[]} onCompare={onCompare} />);
  fireEvent.click(screen.getByText(/^Vencimiento:/, { selector: 'summary' }));
  fireEvent.change(screen.getByLabelText('Desde DTE'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Hasta DTE'), { target: { value: '45' } });
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
  expect(onSelect).toHaveBeenCalledWith(expiries[1].expiration);
  expect(onCompare).toHaveBeenCalledWith([expiries[1].expiration, expiries[2].expiration]);
  fireEvent.change(screen.getByLabelText('Hasta DTE'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
});

test('todos, selección individual y Escape funcionan dentro del desplegable', () => {
  const onCompare = jest.fn();
  render(<ExpiryPicker expiries={expiries} selected={expiries[0].expiration} onSelect={jest.fn()} compared={[]} onCompare={onCompare} />);
  const summary = screen.getByText(/^Vencimiento:/, { selector: 'summary' });
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole('button', { name: 'Seleccionar todos' }));
  expect(onCompare).toHaveBeenLastCalledWith(expiries.map(e => e.expiration));
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  expect(onCompare).toHaveBeenLastCalledWith([expiries[1].expiration]);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(summary.parentElement).not.toHaveAttribute('open');
});

test('el botón dice el vencimiento elegido y cuántos se comparan, y lleva la lectura del elegido', () => {
  const { rerender } = render(<ExpiryPicker expiries={expiries} selected={expiries[1].expiration} onSelect={jest.fn()} compared={[]} onCompare={jest.fn()} engine={<p>Lectura del elegido</p>} />);
  const summary = screen.getByText(/^Vencimiento:/, { selector: 'summary' });
  expect(summary).toHaveTextContent('7 DTE');
  expect(screen.getByText('Lectura del elegido')).toBeInTheDocument();
  rerender(<ExpiryPicker expiries={expiries} selected={expiries[1].expiration} onSelect={jest.fn()} compared={[expiries[1].expiration, expiries[2].expiration]} onCompare={jest.fn()} />);
  expect(summary).toHaveTextContent("2 Nov '26, 3 Nov '26");
  rerender(<ExpiryPicker expiries={expiries} selected="global" onSelect={jest.fn()} compared={[]} onCompare={jest.fn()} />);
  expect(summary).toHaveTextContent('Toda la cadena');
});

test('destildar el principal pasa el siguiente elegido a principal', () => {
  const onSelect = jest.fn(), onCompare = jest.fn();
  render(<ExpiryPicker expiries={expiries} selected={expiries[0].expiration} onSelect={onSelect} compared={[expiries[0].expiration, expiries[1].expiration]} onCompare={onCompare} />);
  fireEvent.click(screen.getByText(/^Vencimiento:/, { selector: 'summary' }));
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  expect(onSelect).toHaveBeenCalledWith(expiries[1].expiration);
  expect(onCompare).toHaveBeenCalledWith([expiries[1].expiration]);
});

test('Sólo regulares selecciona los Regular y Borrar selección deja sólo el primero', () => {
  const list = expiries.map((e, i) => ({ ...e, expirationType: i % 2 ? 'Regular' : 'Weekly' })) as GexExpiryApi[];
  const onSelect = jest.fn(), onCompare = jest.fn();
  render(<ExpiryPicker expiries={list} selected={list[0].expiration} onSelect={onSelect} compared={[]} onCompare={onCompare} />);
  fireEvent.click(screen.getByText(/^Vencimiento:/, { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sólo regulares' }));
  expect(onSelect).toHaveBeenLastCalledWith(list[1].expiration);
  expect(onCompare).toHaveBeenLastCalledWith([list[1].expiration, list[3].expiration]);
  fireEvent.click(screen.getByRole('button', { name: 'Borrar selección' }));
  expect(onSelect).toHaveBeenLastCalledWith(list[0].expiration);
  expect(onCompare).toHaveBeenLastCalledWith([]);
});

test('Sólo regulares queda deshabilitado si no hay regulares', () => {
  render(<ExpiryPicker expiries={expiries.map(e => ({ ...e, expirationType: 'Weekly' })) as GexExpiryApi[]} selected={expiries[0].expiration} onSelect={jest.fn()} compared={[]} onCompare={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Sólo regulares' })).toBeDisabled();
});
