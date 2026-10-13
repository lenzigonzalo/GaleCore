import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Lab } from './Lab';
import { labRequest } from '../api/lab';
jest.mock('../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('../components/lab/LabMarkdown', () => ({ LabMarkdown: () => null }));
jest.mock('./LabShadow', () => ({ LabShadow: () => null }));
beforeEach(() => {
  sessionStorage.clear(); jest.clearAllMocks();
  (labRequest as jest.Mock).mockResolvedValue({ projects: [{ id: 'personal', label: 'Personal', type: 'personal' }], chats: [], providers: [{ id: 'codex', label: 'Codex', installed: true }] });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
test('Lab mantiene proyectos y borrador, sin logo ni segundo control de barra', async () => {
  const props = { onMonitor: () => {}, onSidebarToggle: jest.fn() };
  const { rerender, container } = render(<Lab {...props} />);
  await screen.findByRole('button', { name: 'Personal' });
  expect(screen.queryByRole('button', { name: 'Ir a Monitor' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ocultar proyectos' })).not.toBeInTheDocument();
  const composer = screen.getByRole('textbox', { name: 'Mensaje al proyecto' });
  fireEvent.change(composer, { target: { value: 'Mi borrador' } });
  rerender(<Lab {...props} sidebarHidden />);
  expect(container.querySelector('.lab-chat-workspace')).toHaveClass('sidebar-hidden');
  expect(screen.queryByRole('separator', { name: 'Ancho de proyectos' })).not.toBeInTheDocument();
  expect(composer).toHaveValue('Mi borrador');
  rerender(<Lab {...props} sidebarHidden={false} />);
  expect(screen.getByRole('separator', { name: 'Ancho de proyectos' })).toBeInTheDocument();
  expect(composer).toHaveValue('Mi borrador');
});
