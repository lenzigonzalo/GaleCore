import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsDemo } from './SettingsDemo';

test('el catálogo conserva selección y contenido; habilitar sólo cambia el inventario demo', () => {
  const lab = jest.fn();
  render(<SettingsDemo onLab={lab}/>);
  fireEvent.click(screen.getByRole('button',{name:'Habilidades y conexiones'}));
  fireEvent.click(screen.getByRole('button',{name:'Ver Diseño de estrategia'}));
  fireEvent.click(screen.getByRole('button',{name:/Contenido/}));
  fireEvent.click(screen.getByRole('button',{name:'checklist.md'}));
  expect(screen.getByText('/references/checklist.md')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Ver código'}));
  expect(screen.getByText(/# Checklist de diseño/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch',{name:'Habilitar Diseño de estrategia en demo'}));
  fireEvent.click(screen.getByRole('button',{name:'Tus habilidades'}));
  expect(screen.queryByRole('button',{name:'Ver Diseño de estrategia'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Descubrir'}));
  expect(screen.getByRole('button',{name:'Ver Diseño de estrategia'})).toBeInTheDocument();
  expect(lab).not.toHaveBeenCalled();
});

test('la propuesta de tarea se puede cancelar y agregar con un horario sin activar ejecución', () => {
  const lab = jest.fn();
  render(<SettingsDemo onLab={lab}/>);
  fireEvent.click(screen.getByRole('button',{name:'Tareas programadas'}));
  fireEvent.click(screen.getByRole('button',{name:/Resumen diario/}));
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  expect(screen.getByText('Aún no hay tareas programadas')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/Resumen diario/}));
  fireEvent.change(screen.getByLabelText('Horario · Buenos Aires'),{target:{value:'09:30'}});
  fireEvent.click(screen.getByRole('button',{name:'Agregar a la demo'}));
  expect(screen.getByText('Días laborables · 09:30 · demo')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('no tiene ejecución programada');
  expect(lab).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Quitar'}));
  expect(screen.getByText('Aún no hay tareas programadas')).toBeInTheDocument();
});
