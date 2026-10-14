import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsModal, needsSetup } from './SettingsModal';
import type { SpaceItem } from '../../api/space';
jest.mock('../../pages/Settings', () => ({ Settings: () => <><button>General</button><button>Conexiones</button></> }));
test('la ventana captura foco, cierra con Escape y restaura el foco', () => {
  const launcher = document.createElement('button'); document.body.appendChild(launcher); launcher.focus();
  const close = jest.fn(); const { unmount } = render(<SettingsModal onClose={close}/>);
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('button', { name: 'Cerrar configuración' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(screen.getByRole('button', { name: 'Conexiones' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1);
  unmount(); expect(launcher).toHaveFocus(); launcher.remove();
});
test('asistente sólo para falta confirmada de IA y perfil propios', () => {
  expect(needsSetup([], [{ id: 'claude', status: 'signed-out' }])).toBe(true);
  expect(needsSetup([], [{ id: 'claude', status: 'unknown' }])).toBe(false);
  expect(needsSetup([], [])).toBe(false);
  expect(needsSetup([], [{ id: 'claude', status: 'authenticated' }])).toBe(false);
  expect(needsSetup([{ kind: 'profile', isOwn: true } as SpaceItem], [{ id: 'claude', status: 'not-installed' }])).toBe(false);
  expect(needsSetup([{ kind: 'profile', isOwn: false } as SpaceItem], [{ id: 'claude', status: 'signed-out' }])).toBe(true);
});
