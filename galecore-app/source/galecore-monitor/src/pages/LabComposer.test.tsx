jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { items: [] } }) } }));
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Lab } from './Lab';
import { labRequest, labUpload, labAttachment } from '../api/lab';

jest.mock('../api/space', () => ({ fetchSpace: () => Promise.resolve({ items: [], shared: [] }), saveSpaceItem: () => Promise.resolve() }));
jest.mock('../api/lab', () => ({
  labRequest: jest.fn(),
  labUpload: jest.fn(),
  labAttachment: jest.fn(),
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
  (labAttachment as jest.Mock).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
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

test('cada mensaje en cola muestra qué se puede hacer: Editar, Mandar ya y Quitar', async () => {
  serve('running', [user('hola')]);
  render(<Lab active onMonitor={() => {}} />);
  const input = await box();
  for (const text of ['uno', 'dos']) { fireEvent.change(input, { target: { value: text } }); fireEvent.keyDown(input, { key: 'Enter' }); }
  const queue = await screen.findByLabelText('Mensajes en cola');
  expect(queue).toHaveTextContent('salen solos cuando termine la respuesta');
  fireEvent.click(screen.getByRole('button', { name: /^Editar en cola: uno/ }));
  expect(input).toHaveValue('uno');
  fireEvent.click(screen.getByRole('button', { name: /^Mandar ya: dos/ }));
  await waitFor(() => expect(posted('/stop')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: /^Quitar de la cola: dos/ }));
  expect(screen.queryByLabelText('Mensajes en cola')).not.toBeInTheDocument();
});

test('Preguntar sobre esto aparece aunque la selección termine fuera del texto de la respuesta', async () => {
  serve('idle', [user('hola'), reply('un texto largo para citar')]);
  render(<Lab active onMonitor={() => {}} />);
  const text = (await screen.findByText('un texto largo para citar')).firstChild as Text;
  const range = document.createRange(); range.setStart(text, 3); range.setEnd(document.body, document.body.childNodes.length);   // termina fuera de la respuesta
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  range.getBoundingClientRect = () => ({ top: 300, bottom: 320, left: 50, right: 90, width: 40, height: 20, x: 50, y: 300, toJSON() {} });
  jest.spyOn(selection, 'toString').mockReturnValue('texto largo');
  fireEvent.mouseUp(document.body);
  fireEvent.click(await screen.findByRole('button', { name: 'Preguntar sobre esto' }));
  expect(await box()).toHaveValue('> texto largo\n\n');
});

test('un archivo de la respuesta se abre a la derecha, sin salir del chat, y se puede pasar a Archivos', async () => {
  serve('idle', [user('hola'), reply('Mirá [la nota](notas/idea.md) del proyecto')]);
  const base = (labRequest as jest.Mock).getMockImplementation()!;
  (labRequest as jest.Mock).mockImplementation(async (path: string, body?: object) => path.includes('/files?path=') ? { text: '# Idea\n\nComprar volatilidad' } : path.endsWith('/files') ? { tree: [] } : base(path, body));
  render(<Lab onMonitor={() => {}} />);
  fireEvent.click(await screen.findByRole('link', { name: 'la nota' }));
  const panel = await screen.findByRole('complementary', { name: 'Archivo idea.md' });
  expect(await screen.findByText('Comprar volatilidad')).toBeInTheDocument();
  expect(await box()).toBeInTheDocument();                                   // el chat sigue ahí
  fireEvent.click(screen.getByRole('button', { name: 'Abrir en Archivos' }));
  expect(panel).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Mensaje al proyecto' })).not.toBeInTheDocument());
});

test('«/» abre las skills del espacio, se elige con el teclado y al enviar viaja como mención', async () => {
  const space = require('../api/space');
  const spy = jest.spyOn(space, 'fetchSpace').mockResolvedValue({ items: [{ kind: 'skill', key: 'valuar-empresa', title: 'Valuar empresa' }, { kind: 'agent', key: 'oportunidades', title: 'Oportunidades' }], shared: [] });
  serve('idle', [user('hola'), reply('listo')]);
  render(<Lab onMonitor={() => {}} />);
  const input = await box();
  fireEvent.change(input, { target: { value: '/val', selectionStart: 4 } });
  const list = await screen.findByRole('listbox', { name: 'Skills' });
  expect(list).toHaveTextContent('Valuar empresa');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('/valuar-empresa ');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await new Promise(r => setTimeout(r, 20));   // el cursor se acomoda un instante después de elegir
  const text = '/valuar-empresa de AAPL con @op';
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text); (input as HTMLTextAreaElement).setSelectionRange(text.length, text.length); fireEvent.input(input);
  fireEvent.mouseDown(await screen.findByRole('option', { name: /oportunidades/ }));
  expect(input).toHaveValue('/valuar-empresa de AAPL con @oportunidades ');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  await waitFor(() => expect(posted('/messages')).toHaveLength(1));
  expect(posted('/messages')[0][1].mentions.map((m: any) => m.key)).toEqual(['valuar-empresa', 'oportunidades']);
  spy.mockRestore();
});

test('copiar entrega el texto completo y el reloj muestra la hora real del mensaje', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  serve('idle', [user('hola'), reply('# Idea de SPY\n\nComprar volatilidad')]);
  render(<Lab onMonitor={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Copiar respuesta' }));
  await screen.findByRole('button', { name: 'Copiado' });
  expect(writeText).toHaveBeenCalledWith('# Idea de SPY\n\nComprar volatilidad');
  const time = new Date('2026-10-28T10:00:05Z').toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  expect(screen.getByTitle(`Enviado a las ${time}`)).toHaveAttribute('tabindex', '0');
});

test('si el portapapeles falla permite reintentar sin anunciar éxito', async () => {
  const writeText = jest.fn().mockRejectedValueOnce(new Error('denegado')).mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  serve('idle', [reply('respuesta')]);
  render(<Lab onMonitor={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Copiar respuesta' }));
  fireEvent.click(await screen.findByRole('button', { name: 'No se pudo copiar. Reintentar' }));
  await screen.findByRole('button', { name: 'Copiado' });
  expect(writeText).toHaveBeenCalledTimes(2);
});

test('los controles no aparecen mientras se genera la última respuesta', async () => {
  serve('running', [user('hola'), reply('respuesta parcial')]);
  render(<Lab onMonitor={() => {}} />);
  await screen.findByText('respuesta parcial');
  expect(screen.queryByLabelText('Acciones de la respuesta')).not.toBeInTheDocument();
});

test('Guardar como nota escribe en notas/ con la API de archivos y deja el enlace al panel', async () => {
  serve('idle', [user('hola'), reply('# Idea de SPY\n\nComprar volatilidad')]);
  const base = (labRequest as jest.Mock).getMockImplementation()!;
  (labRequest as jest.Mock).mockImplementation(async (path: string, body?: any) => path.endsWith('/files/mkdir') ? (() => { throw new Error('Ya existe.'); })() : path.endsWith('/files/write') ? { path: body.path } : path.includes('/files?path=') ? { text: 'contenido' } : base(path, body));
  render(<Lab onMonitor={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar como nota' }));
  const link = await screen.findByRole('link', { name: /notas\/\d{4}-\d{2}-\d{2}-idea-de-spy\.md/ });
  const write = (labRequest as jest.Mock).mock.calls.find(([path]) => String(path).endsWith('/files/write'))!;
  expect(write[1]).toMatchObject({ create: true, text: '# Idea de SPY\n\nComprar volatilidad' });
  fireEvent.click(link);
  expect(await screen.findByRole('complementary', { name: /Archivo .*idea-de-spy\.md/ })).toBeInTheDocument();
});

describe('reintentar y reanudar', () => {
  const failed = (extra = {}) => {
    serve('failed', [user('pedido que falló')]);
    const base = (labRequest as jest.Mock).getMockImplementation()!;
    (labRequest as jest.Mock).mockImplementation(async (path: string, body?: object) => path === '/chats/chat-1' ? { ...(await base(path, body)), error: 'No pudo completar', ...extra } : base(path, body));
  };

  test('Reintentar reenvía el mismo mensaje', async () => {
    failed();
    render(<Lab onMonitor={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(posted('/messages')).toHaveLength(1));
    expect(posted('/messages')[0][1]).toMatchObject({ text: 'pedido que falló', replace: true, retry: true });
  });

  test('con el límite de Claude y su hora, Reanudar lo reenvía solo a esa hora y se puede cancelar', async () => {
    jest.useFakeTimers('modern');
    try {
      const at = Math.floor(Date.now() / 1000) + 600;
      failed({ limitResetsAt: at });
      render(<Lab onMonitor={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: /^Reanudar a las/ }));
      expect(screen.getByText(/Se reenvía solo a las/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      jest.advanceTimersByTime(700_000);
      expect(posted('/messages')).toHaveLength(0);                 // cancelado: no se manda
      fireEvent.click(screen.getByRole('button', { name: /^Reanudar a las/ }));
      await React.act(async () => { jest.advanceTimersByTime(601_000); });
      await waitFor(() => expect(posted('/messages')).toHaveLength(1));
    } finally { jest.useRealTimers(); }
  });
});


test('imagen sola se envía, sin texto obligatorio', async () => {
  serve('idle', [user('hola')]);
  render(<Lab onMonitor={() => {}} />);
  const input = await box();
  expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'captura.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  await waitFor(() => expect(posted('/messages')[0][1]).toMatchObject({ text: '', attachments: ['adjuntos/1-captura.png'] }));
});

test.each([false, true])('adjunto persistido o histórico se muestra al abrir y se conserva al editar (%s)', async legacy => {
  const path = 'adjuntos/1-captura.png';
  serve('idle', [{ ...user(legacy ? 'mirá\n\nArchivos adjuntos (en la carpeta del proyecto): ' + path : 'mirá'), ...(legacy ? {} : { attachments: [path] }) }]);
  const view = render(<Lab onMonitor={() => {}} />);
  expect(await screen.findByRole('img', { name: 'captura.png' })).toHaveAttribute('src', 'blob:miniatura');
  expect(screen.getByRole('link', { name: 'Abrir imagen original: captura.png' })).toHaveAttribute('href', 'blob:miniatura');
  expect(screen.getByRole('link', { name: 'Abrir imagen original: captura.png' })).toHaveAttribute('target', '_blank');
  expect(screen.queryByText(/Archivos adjuntos/)).not.toBeInTheDocument();
  expect(labAttachment).toHaveBeenCalledWith('personal', path);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(await box()).toHaveValue('mirá');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  await waitFor(() => expect(posted('/messages')[0][1]).toMatchObject({ text: 'mirá', attachments: [path], replace: true }));
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:miniatura');
});

test('cola acepta imagen sola', async () => {
  serve('running', [user('hola')]);
  render(<Lab onMonitor={() => {}} />);
  const input = await box();
  fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'captura.png', { type: 'image/png' })] } });
  await screen.findByText('captura.png');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(await screen.findByLabelText('Mensajes en cola')).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'x', ctrlKey: true });
  expect(await screen.findByText('captura.png')).toBeInTheDocument();
});


test('reintentar conserva la imagen sola', async () => {
  const path = 'adjuntos/1-captura.png';
  serve('failed', [{ ...user(''), attachments: [path] }]);
  (labRequest as jest.Mock).mockImplementation(async (url: string, body?: object) => {
    if (url === '/workspaces') return { projects, chats: [{ id: 'chat-1', project: 'personal', provider: 'claude', title: 'Imagen', state: 'failed' }], providers: [{ id: 'claude', label: 'Claude', installed: true }] };
    return { id: 'chat-1', project: 'personal', provider: 'claude', state: 'failed', activity: '', error: 'Falló el motor', messages: [{ ...user(''), attachments: [path] }] };
  });
  render(<Lab onMonitor={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(posted('/messages')[0][1]).toMatchObject({ text: '', attachments: [path], replace: true, retry: true }));
});

test('adjunto ausente deja un estado visible', async () => {
  serve('idle', [{ ...user('mirá'), attachments: ['adjuntos/1-ausente.png'] }]);
  (labAttachment as jest.Mock).mockRejectedValue(new Error('No existe'));
  render(<Lab onMonitor={() => {}} />);
  expect(await screen.findByText('No se pudo abrir ausente.png.')).toBeInTheDocument();
});


test.each(['botón', 'Escape'])('cancelar edición limpia adjuntos mediante %s', async how => {
  serve('idle', [{ ...user('mirá'), attachments: ['adjuntos/1-captura.png'] }]);
  render(<Lab active onMonitor={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
  expect(screen.getByText('captura.png')).toBeInTheDocument();
  if (how === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  else fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByText('captura.png')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
});


test('tras un corte del Lab, recuperar el chat elimina el error de conexión', async () => {
  serve('idle', [user('conversación conservada')]);
  const normal = (labRequest as jest.Mock).getMockImplementation()!;
  let failRead = true;
  (labRequest as jest.Mock).mockImplementation(async (path: string, body?: object) => {
    if (path === '/chats/chat-1' && failRead) { failRead = false; throw new Error('Servicio reiniciando'); }
    return normal(path, body);
  });
  render(<Lab onMonitor={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo recuperar esta conversación.');
  expect(await screen.findByText('conversación conservada', {}, { timeout: 5000 })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
