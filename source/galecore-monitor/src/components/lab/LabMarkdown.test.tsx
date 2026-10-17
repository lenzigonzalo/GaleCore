import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LabMarkdown } from './LabMarkdown';

test('H1 en el chat lleva a su fila del mapa; en código queda como texto (WS-0044)', () => {
  const row = document.createElement('tr'); row.id = 'mapa-h1'; row.scrollIntoView = jest.fn(); document.body.appendChild(row);
  render(<LabMarkdown text={'H1 se sostiene en promedio.\n\n```\nH2\n```'} />);
  fireEvent.click(screen.getByRole('button', { name: 'H1' }));
  expect(row.scrollIntoView).toHaveBeenCalled();
  expect(row).toHaveClass('lab-mapa-flash');
  expect(screen.queryByRole('button', { name: 'H2' })).not.toBeInTheDocument();
});
