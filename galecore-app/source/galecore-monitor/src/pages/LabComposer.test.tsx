import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Lab } from './Lab';
import { labRequest, labUpload } from '../api/lab';

jest.mock('../api/space', () => ({ fetchSpace: () => Promise.resolve({ items: [], shared: [] }), saveSpaceItem: () => Promise.resolve() }));
jest.mock('../api/lab', () => ({
  labRequest: jest.fn(),
  labUpload: jest.fn(),
}));
jest.mock('./LabShadow', () => ({ LabShadow: () => <div>Seguimiento</div> }));
jest.mock('../components/lab/LabShell', () => ({ LabShell: () => <div>Terminal</div> }));

const projects = [{ id: 'personal', label: 'Personal', type: 'personal', relative: 'workspaces/personal' }];
const user = (text: string) => ({ id: 'u1', role: 'user', text, at: '2026-10-28T10:00:00Z' });
const reply = (text: string, id = 'a1') => ({ id, role: 'assistant', text, at: '2026-10-28T10:00:05Z' });

function serve(chatState: string, messages: object[]) {
  (labRequest as jest.Mock).mockImplementation(async (path: string, body?: object) => {
    if (path === '/workspaces') return { projects, chats: [{ id: 'chat-1', project: 'personal', provider: 'claude', title: 'Hola', state: chatState }], providers: [{ id: 'claude', label: 'Claude', installed: true }] };
    if (path === '/chats/chat-1') return { id: 'chat-1', project: 'personal', provider: 'claude', title: 'Hola', state: chatState, activity: '', steps: [], error: null, messages };
    return body ? { id: 'chat-1', project: 'personal', provider: 'claude', title: 'Hola', state: 'running', activity: '', messages } : {};
  });
}
const box = () => screen.findByRole('textbox', { name: 'Mensaje al proyecto' });
const posted = (suffix: string) => (labRequest as jest.Mock).mock.calls.filter(([path, body]) => String(path).endsWith(suffix) && body);

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  sessionStorage.clear(); sessionStorage.setItem('galecore:lab:chat', 'chat-1'); jest.clearAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
  (labUpload as jest.Mock).mockImplementation(async (_project: string, file: File) => ({ path: 'adjuntos/1-' + file.name, name: file.name, size: 1 }));
  (URL as any).createObjectURL = jest.fn(() => 'blob:miniatura'); (URL as any).revokeObjectURL = jest.fn();
});

test('Esc corta la respuesta en curso, igual que el botón ■', async () => {
  serve('running', [user('hola')]);
  render(<Lab active onMonitor={() => {}} />);
  await box();
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(posted('/stop')).toHaveLength(1));
});

test('Esc no hace nada si no hay respuesta en curso', async () => {
  serve('idle', [user('hola'), reply('listo')]);
  render(<Lab active onMonitor={() => {}} />);
  await box();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(posted('/stop')).toHaveLength(0);
});

test('Enter mientras responde encola; Ctrl+X devuelve el último a la caja', async () => {
  serve('running', [user('hola')]);
  render(<Lab active onMonitor={() => {}} />);
  const input = await box();
  fireEvent.change(input, { target: { value: 'y después esto' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(await screen.findByLabelText('Mensajes en cola')).toHaveTextContent('y después esto');
  expect(posted('/messages')).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'x', ctrlKey: true });
  expect(screen.queryByLabelText('Mensajes en cola')).not.toBeInTheDocument();
  expect(input).toHaveValue('y después esto');
});

test('Ctrl+S manda ya: corta la respuesta y envía lo escrito al terminar el corte', async () => {
  serve('running', [user('hola')]);
  render(<Lab active onMonitor={() => {}} />);
  const input = await box();
  fireEvent.change(input, { target: { value: 'mejor esto' } });
  fireEvent.keyDown(input, { key: 's', ctrlKey: true });
  await waitFor(() => expect(posted('/stop')).toHaveLength(1));
  expect(await screen.findByLabelText('Mensajes en cola')).toHaveTextContent('mejor esto');
});

test('Editar carga el último mensaje y al enviar reemplaza al anterior', async () => {
  serve('idle', [user('pregunta vieja'), reply('respuesta')]);
  render(<Lab onMonitor={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
  const input = await box();
  expect(input).toHaveValue('pregunta vieja');
  fireEvent.change(input, { target: { value: 'pregunta nueva' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  await waitFor(() => expect(posted('/messages')).toHaveLength(1));
  expect(posted('/messages')[0][1]).toMatchObject({ text: 'pregunta nueva', replace: true });
});

test('sólo el último mensaje del trader se puede editar', async () => {
  serve('idle', [{ ...user('primero'), id: 'u0' }, reply('uno', 'a0'), user('segundo'), reply('dos')]);
  render(<Lab onMonitor={() => {}} />);
  await screen.findByText('segundo');
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1);
});

test('pegar una imagen la adjunta igual que el botón + y muestra su miniatura', async () => {
  serve('idle', [user('hola'), reply('listo')]);
  const { container } = render(<Lab onMonitor={() => {}} />);
  const input = await box();
  const image = new File(['x'], 'captura.png', { type: 'image/png' });
  fireEvent.paste(input, { clipboardData: { files: [image], getData: () => '' } });
  await waitFor(() => expect(labUpload).toHaveBeenCalledWith('personal', image));
  await waitFor(() => expect(container.querySelector('.lab-attachments img')).toBeInTheDocument());
});

test('soltar un archivo sobre el chat lo adjunta', async () => {
  serve('idle', [user('hola'), reply('listo')]);
  const { container } = render(<Lab onMonitor={() => {}} />);
  await box();
  const file = new File(['x'], 'datos.csv', { type: 'text/csv' });
  fireEvent.drop(container.querySelector('.lab-chat-column')!, { dataTransfer: { files: [file], types: ['Files'] } });
  await waitFor(() => expect(labUpload).toHaveBeenCalledWith('personal', file));
  expect(await screen.findByText('datos.csv')).toBeInTheDocument();
});

describe('dictado con el espacio apretado', () => {
  const recognizer = () => {
    const rec: any = { start: jest.fn(), stop: jest.fn(() => rec.onend?.()) };
    (window as any).SpeechRecognition = jest.fn(() => rec);
    return rec;
  };
  afterEach(() => { delete (window as any).SpeechRecognition; });

  test('apretar y mantener dicta; soltar corta; un toque solo no hace nada; se ve lo que se va diciendo', async () => {
    const rec = recognizer();
    serve('idle', [user('hola'), reply('listo')]);
    render(<Lab active onMonitor={() => {}} />);
    const input = await box();
    fireEvent.keyDown(document.body, { code: 'Space' });
    expect(rec.start).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { code: 'Space', repeat: true });
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(rec.interimResults).toBe(true);
    fireEvent.keyDown(document.body, { code: 'Space', repeat: true });          // el teclado repite: no arranca otra vez
    expect(rec.start).toHaveBeenCalledTimes(1);
    rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'comprame' }], { isFinal: false })] });
    expect(await screen.findByText('comprame')).toHaveClass('lab-interim');
    rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'comprame cien' }], { isFinal: true })] });
    await waitFor(() => expect(input).toHaveValue('comprame cien'));
    fireEvent.keyUp(document.body, { code: 'Space' });
    expect(rec.stop).toHaveBeenCalled();
  });

  test('con texto escrito en la caja, el espacio escribe un espacio', async () => {
    const rec = recognizer();
    serve('idle', [user('hola'), reply('listo')]);
    render(<Lab active onMonitor={() => {}} />);
    const input = await box();
    fireEvent.change(input, { target: { value: 'hola' } });
    fireEvent.keyDown(input, { code: 'Space', repeat: true });
    expect(rec.start).not.toHaveBeenCalled();
  });
});
