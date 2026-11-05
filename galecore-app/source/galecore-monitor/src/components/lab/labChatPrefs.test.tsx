import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { notifyChat, playChatSound, readChatPrefs, saveChatPrefs } from './labChatPrefs';
import { ChatBehaviorSettings } from '../settings/ChatBehaviorSettings';
import { LabMarkdown, toCsv, toTabs } from './LabMarkdown';

jest.mock('../../api/lab', () => ({ labRequest: () => Promise.resolve({ projects: [], chats: [], providers: [{ id: 'claude', label: 'Claude', installed: true }, { id: 'codex', label: 'Codex', installed: true }],
  chatOptions: { claude: { models: ['sonnet', 'opus', 'haiku'], efforts: ['low', 'medium', 'high'], modelEfforts: { haiku: [] }, defaultModel: 'sonnet' }, codex: { models: ['gpt-x'], efforts: ['high'] } } }) }));
beforeEach(() => { localStorage.clear(); });

test('por defecto suenan al terminar y al pedir permiso; el aviso del navegador está apagado', () => {
  expect(readChatPrefs()).toMatchObject({ finishSound: true, permissionSound: true, notify: false });
});

test('un valor guardado roto no rompe: vuelve a los de siempre', () => {
  localStorage.setItem('galecore:lab:chat-prefs', '{no es json');
  expect(readChatPrefs().finishSound).toBe(true);
});

test('Configuración → Chat guarda en el navegador y «Probar» hace sonar', () => {
  const oscillator = { type: '', frequency: { value: 0 }, connect: jest.fn(), start: jest.fn(), stop: jest.fn() };
  const gain = { gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }, connect: jest.fn() };
  (window as any).AudioContext = jest.fn(() => ({ state: 'running', currentTime: 0, destination: {}, createOscillator: () => oscillator, createGain: () => gain, resume: jest.fn() }));
  render(<ChatBehaviorSettings />);
  fireEvent.click(screen.getByRole('switch', { name: 'Sonido al terminar' }));
  expect(readChatPrefs().finishSound).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Probar' }));
  expect(oscillator.start).toHaveBeenCalled();
});

test('sin AudioContext el sonido no rompe nada', () => {
  (window as any).AudioContext = undefined; (window as any).webkitAudioContext = undefined;
  expect(() => playChatSound('done', 0.5)).not.toThrow();
});

test('el aviso del navegador sólo sale si está encendido, con permiso y con la pestaña oculta', () => {
  const Notice = jest.fn(function (this: any) { this.close = jest.fn(); });
  (Notice as any).permission = 'granted'; (window as any).Notification = Notice;
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  notifyChat('Hola', 'Terminó de responder', () => {});
  expect(Notice).not.toHaveBeenCalled();                                    // apagado por defecto
  localStorage.setItem('galecore:lab:chat-prefs', JSON.stringify({ notify: true }));
  notifyChat('Hola', 'Terminó de responder', () => {});
  expect(Notice).toHaveBeenCalledWith('Hola', { body: 'Terminó de responder' });
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

test('una tabla de la respuesta se copia con tabulaciones y se exporta como CSV', () => {
  expect(toTabs([['a', 'b'], ['1', '2']])).toBe('a\tb\n1\t2');
  expect(toCsv([['x, y', 'dice "hola"'], ['1', '2']])).toBe('"x, y","dice ""hola"""\r\n1,2');
  render(<LabMarkdown text={'| Sym | Delta |\n|---|---|\n| SPY | +0,5 |'} />);
  expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
});

test('Configuración → Chat guarda con qué proveedor, modelo y esfuerzo abre un chat nuevo', async () => {
  render(<ChatBehaviorSettings />);
  expect(readChatPrefs()).toMatchObject({ provider: '', model: '', effort: '' });
  await screen.findByRole('option', { name: 'Claude' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Proveedor inicial' }), { target: { value: 'claude' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Modelo inicial' }), { target: { value: 'opus' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Esfuerzo inicial' }), { target: { value: 'high' } });
  expect(readChatPrefs()).toMatchObject({ provider: 'claude', model: 'opus', effort: 'high' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Modelo inicial' }), { target: { value: 'haiku' } });
  expect(readChatPrefs().effort).toBe('');
  expect(screen.getByRole('combobox', { name: 'Esfuerzo inicial' })).toBeDisabled();
});

test('los permisos iniciales de cada motor se guardan y migran el valor viejo', () => {
  expect(readChatPrefs().modes).toEqual({ claude: 'default', codex: 'workspace-write' });
  saveChatPrefs({ ...readChatPrefs(), modes: { claude: 'plan', codex: 'read-only' } });
  expect(readChatPrefs().modes).toEqual({ claude: 'plan', codex: 'read-only' });
  localStorage.setItem('galecore:lab:chat-prefs', JSON.stringify({ mode: 'auto' }));   // formato anterior: un solo Manual/Auto
  expect(readChatPrefs().modes).toEqual({ claude: 'auto', codex: 'auto' });
  localStorage.setItem('galecore:lab:chat-prefs', JSON.stringify({ mode: 'manual', modes: { claude: 'bypassPermissions', codex: 'danger-full-access' } }));
  expect(readChatPrefs().modes).toEqual({ claude: 'default', codex: 'workspace-write' });
});
