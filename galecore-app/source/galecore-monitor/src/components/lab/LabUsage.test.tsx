import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LabUsage, cacheLeft } from './LabUsage';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const limit = { windows: { five_hour: { utilization: 0.07, resetsAt: 1793222400 }, seven_day: { utilization: 0.92 } } };
const open = () => { fireEvent.click(screen.getByRole('button', { name: 'Uso del chat' })); return screen.getByRole('group', { name: 'Detalle del uso' }); };

test('el botón dice cuánto falta para que venza la caché y el detalle trae sólo caché, contexto, sesión y semanal', () => {
  render(<LabUsage usage={{ turns: [{ at: minutesAgo(18), input: 28576, output: 4, cached: 13813, costUsd: 0.06 }], context: { used: 30000, window: 200000 }, limit }} />);
  expect(screen.getByRole('button', { name: 'Uso del chat' })).toHaveTextContent('caché vence en 42 min');
  expect(screen.getByRole('button', { name: 'Uso del chat' }).textContent).toBe('caché vence en 42 min');
  const detail = open();
  expect(detail).toHaveTextContent('Cachévence en 42 min');
  expect(detail).toHaveTextContent('Contexto15 %');
  expect(detail).toHaveTextContent('Sesión actual7 % usado');
  expect(detail).toHaveTextContent('Semanal92 % usado');
  expect(detail).not.toHaveTextContent(/entrada|salida|turno|US\$|renueva|tokens/);
});

test('caché vencida: se marca en naranja, en el botón y en el detalle', () => {
  render(<LabUsage usage={{ turns: [{ at: minutesAgo(90), input: 10, output: 1, cached: 5 }] }} />);
  const button = screen.getByRole('button', { name: 'Uso del chat' });
  expect(button).toHaveTextContent('caché vencida');
  expect(button).toHaveClass('expired');
  expect(open()).toHaveTextContent('Cachévencida');
});

test('con Codex sólo muestra lo que informa: sin contexto ni límites si el motor no los dio', () => {
  render(<LabUsage usage={{ turns: [{ at: minutesAgo(5), input: 17340, output: 5, cached: 13440 }] }} />);
  const detail = open();
  expect(detail).toHaveTextContent('Caché');
  expect(detail).not.toHaveTextContent(/Contexto|Sesión|Semanal/);
});

test('caché: minutos que faltan (1 h desde el último turno), vencida o sin dato', () => {
  const at = new Date('2026-10-28T20:00:00Z').toISOString(), t = (min: number) => Date.parse(at) + min * 60000;
  expect(cacheLeft({ at, cached: 100 }, t(18))).toBe(42);
  expect(cacheLeft({ at, cached: 100 }, t(59.5))).toBe(1);
  expect(cacheLeft({ at, cached: 100 }, t(61))).toBe(0);
  expect(cacheLeft({ at, cached: 0 }, t(1))).toBeUndefined();
  expect(cacheLeft(undefined)).toBeUndefined();
});

test('sin datos del motor no muestra nada', () => {
  const { container } = render(<LabUsage />);
  expect(container).toBeEmptyDOMElement();
});


test('Codex conserva el formato de Claude: botón compacto y las mismas etiquetas en el detalle', () => {
  render(<LabUsage usage={{turns:[],context:{used:52912,window:475000},limit}}/>);
  const button=screen.getByRole('button',{name:'Uso del chat'});
  expect(button.textContent).toBe('Uso');
  const detail = open();
  expect(detail).toHaveTextContent('Contexto11 %');
  expect(detail).toHaveTextContent('Sesión actual7 % usado');
  expect(detail).toHaveTextContent('Semanal92 % usado');
});
