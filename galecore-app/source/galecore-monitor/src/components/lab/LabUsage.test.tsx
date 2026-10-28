import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LabUsage } from './LabUsage';

const claude = {
  turns: [{ at: 'a', input: 28576, output: 4, cached: 13813, costUsd: 0.06 }, { at: 'b', input: 30000, output: 200, cached: 20000, costUsd: 0.04 }],
  context: { used: 30000, window: 200000 },
  limit: { status: 'allowed_warning', windows: { five_hour: { utilization: 0.15, resetsAt: 1793222400 }, seven_day: { utilization: 0.92 } } },
};

test('con Claude muestra tokens del último turno, contexto, límites y el costo con su aclaración', () => {
  render(<LabUsage usage={claude} />);
  expect(screen.getByRole('button', { name: 'Uso del chat' })).toHaveTextContent('30,2 k tokens · contexto 15 %');
  fireEvent.click(screen.getByRole('button', { name: 'Uso del chat' }));
  const detail = screen.getByRole('group', { name: 'Detalle del uso' });
  expect(detail).toHaveTextContent('Todo el chat');
  expect(detail).toHaveTextContent('Límite semanal92 % usado');
  expect(detail).toHaveTextContent('US$ 0.10 (con suscripción es una equivalencia, no un cobro)');
});

test('con Codex sólo muestra lo que informa: sin contexto, sin límite y sin costo', () => {
  render(<LabUsage usage={{ turns: [{ at: 'a', input: 17340, output: 5, cached: 13440 }] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Uso del chat' }));
  const detail = screen.getByRole('group', { name: 'Detalle del uso' });
  expect(detail).toHaveTextContent('Último turno');
  expect(detail).not.toHaveTextContent(/Contexto|Límite|Costo/);
});

test('sin datos del motor no muestra nada', () => {
  const { container } = render(<LabUsage />);
  expect(container).toBeEmptyDOMElement();
});
