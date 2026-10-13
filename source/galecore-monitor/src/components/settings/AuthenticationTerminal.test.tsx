import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { AuthenticationTerminal } from './AuthenticationTerminal';
import { authSocketUrl } from '../../api/terminal';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
jest.mock('../../api/terminal', () => ({ authSocketUrl: jest.fn((provider, cols, rows) => `ws://test/pty?auth=${provider}&cols=${cols}&rows=${rows}`) }));
jest.mock('@xterm/xterm', () => ({ Terminal: jest.fn().mockImplementation(() => ({ cols: 80, rows: 24, loadAddon: jest.fn(), open: jest.fn(), write: jest.fn(), focus: jest.fn(), dispose: jest.fn(), onData: jest.fn(() => ({ dispose: jest.fn() })), onResize: jest.fn(() => ({ dispose: jest.fn() })) })) }));
jest.mock('@xterm/addon-fit', () => ({ FitAddon: jest.fn().mockImplementation(() => ({ fit: jest.fn() })) }));
const sockets: any[] = [];
const OriginalSocket = window.WebSocket;
const OriginalObserver = window.ResizeObserver;
beforeEach(() => {
  jest.useFakeTimers(); sockets.length = 0;
  (authSocketUrl as jest.Mock).mockImplementation((provider, cols, rows) => `ws://test/pty?auth=${provider}&cols=${cols}&rows=${rows}`);
  (Terminal as unknown as jest.Mock).mockImplementation(() => ({ cols: 80, rows: 24, loadAddon: jest.fn(), open: jest.fn(), write: jest.fn(), focus: jest.fn(), dispose: jest.fn(), onData: jest.fn(() => ({ dispose: jest.fn() })), onResize: jest.fn(() => ({ dispose: jest.fn() })) }));
  (FitAddon as unknown as jest.Mock).mockImplementation(() => ({ fit: jest.fn() }));
  window.WebSocket = class { static OPEN = 1; readyState = 1; onclose: any; onmessage: any; onerror: any; constructor(public url: string) { sockets.push(this); } send() {} close = jest.fn(); } as any;
  window.ResizeObserver = class { observe() {} disconnect() {} } as any;
});
afterEach(() => { jest.useRealTimers(); window.WebSocket = OriginalSocket; window.ResizeObserver = OriginalObserver; });
test('StrictMode starts exactly one auth socket, and refreshes state when it ends', () => {
  const onEnd = jest.fn();
  const view = render(<React.StrictMode><AuthenticationTerminal provider="codex" onEnd={onEnd} onClose={() => {}}/></React.StrictMode>);
  act(() => { jest.runOnlyPendingTimers(); });
  expect(sockets).toHaveLength(1);
  expect(authSocketUrl).toHaveBeenCalledWith('codex', 80, 24);
  act(() => { sockets[0].onclose({ code: 1000 }); });
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Proceso terminado')).toBeInTheDocument();
  view.unmount(); expect(sockets[0].close).toHaveBeenCalledTimes(1);
});
test('closing before deferred connection does not start a login', () => {
  const view = render(<AuthenticationTerminal provider="claude" onEnd={() => {}} onClose={() => {}}/>);
  view.unmount(); act(() => { jest.runOnlyPendingTimers(); });
  expect(sockets).toHaveLength(0);
});
