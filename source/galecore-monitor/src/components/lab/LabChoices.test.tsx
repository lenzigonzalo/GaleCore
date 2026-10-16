import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LabChoices, parseChoices } from './LabChoices';

const block = parseChoices(JSON.stringify({
  preguntas: [
    { pregunta: '¿Qué querés capturar?', opciones: [{ texto: 'Caída de la volatilidad', recomendada: true }, { texto: 'Un movimiento grande' }] },
    { pregunta: '¿Qué datos sumo?', multiple: true, opciones: [{ texto: 'Balances pasados', recomendada: true }, { texto: 'Calendario macro' }] },
  ],
  enviar: 'Dale, buscalo',
}))!;

test('la recomendada viene marcada y «Responder» manda la elección como mensaje', () => {
  const onAnswer = jest.fn();
  render(<LabChoices block={block} active onAnswer={onAnswer} />);
  expect(screen.getByRole('radio', { name: /Caída de la volatilidad/ })).toBeChecked();
  expect(screen.getAllByText('Recomendada')).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox', { name: /Calendario macro/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
  expect(onAnswer).toHaveBeenCalledWith('Qué querés capturar: Caída de la volatilidad\nQué datos sumo: Balances pasados, Calendario macro\nDale, buscalo');
  expect(screen.queryByRole('button', { name: 'Responder' })).not.toBeInTheDocument();
});

test('una tarjeta vieja o mientras responde no se puede usar', () => {
  render(<LabChoices block={block} active={false} onAnswer={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Responder' })).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Un movimiento grande/ })).toBeDisabled();
});

test('un bloque mal formado no se toma como preguntas', () => {
  expect(parseChoices('{"preguntas":[{"pregunta":"x","opciones":[{"texto":"sola"}]}]}')).toBeNull();
  expect(parseChoices('no es json')).toBeNull();
});
