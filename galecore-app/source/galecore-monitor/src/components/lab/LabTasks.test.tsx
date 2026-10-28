import React from 'react';
import { render, screen } from '@testing-library/react';
import { LabTasks } from './LabTasks';

test('una línea por tarea: el subagente con su último paso y el comando en segundo plano con su estado', () => {
  render(<LabTasks tasks={[
    { id: 'a', kind: 'agent', label: 'Contar archivos del directorio', agentType: 'Explore', status: 'running', tools: 3, last: 'Running find . -type f' },
    { id: 'b', kind: 'command', label: 'Sleep 4 seconds in background', status: 'completed', summary: 'Background command completed (exit code 0)' },
  ]} />);
  const group = screen.getByRole('group', { name: 'En segundo plano' });
  expect(group).toHaveTextContent('Subagente Contar archivos del directorio · Explore');
  expect(group).toHaveTextContent('Trabajando · 3 pasos');
  expect(group).toHaveTextContent('Running find . -type f');
  expect(group).toHaveTextContent('En segundo plano Sleep 4 seconds in background');
  expect(group).toHaveTextContent('Terminó');
});

test('sin tareas no muestra nada', () => {
  const { container } = render(<LabTasks />);
  expect(container).toBeEmptyDOMElement();
});
