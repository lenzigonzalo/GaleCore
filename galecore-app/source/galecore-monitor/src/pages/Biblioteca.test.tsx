import { fireEvent, render, screen } from '@testing-library/react';
import { Biblioteca, splitSections, splitSources } from './Biblioteca';
import { labRequest } from '../api/lab';

jest.mock('../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('../components/lab/LabMarkdown', () => ({ LabMarkdown: ({ text }: { text: string }) => <div>{text}</div> }));

const files: Record<string, string> = {
  'informes/mercado/gex.md': '# GEX: qué mide\n\n**GEX estima cuánto cubren los dealers.**\n\n## La fórmula\n\n| a | b |\n\n## Hoy en SPY\n\n| c | d |',
  'informes/macro/historia-macro.md': '# Historia macro\n\n**Tasas largas altas.**\n\n## Cómo se ve hoy\n\n| x | y |',
};
const folder = (name: string) => ({ name, path: 'informes/' + name, kind: 'folder',
  children: Object.keys(files).filter(p => p.split('/')[1] === name).map(p => ({ name: p.split('/')[2], path: p, kind: 'file' })) });

test('agrupa por tipo con sólo el título, abre el primero y cambia con un clic', async () => {
  (labRequest as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/files')) return { tree: [{ name: 'informes', path: 'informes', kind: 'folder', children: [folder('mercado'), folder('macro'), { name: 'calculos', path: 'informes/calculos', kind: 'folder', children: [] }] }] };
    return { text: files[decodeURIComponent(path.split('path=')[1])] };
  });
  render(<Biblioteca />);
  await screen.findByRole('button', { name: 'GEX' });
  const items = Array.from(document.querySelectorAll('.biblioteca-group button'));
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Macro', 'Mercado']);
  expect(items.map(b => b.textContent)).toEqual(['Historia macro', 'GEX']);   // títulos cortos (owner 18/10), sin resumen
  expect(screen.getByText(/## Cómo se ve hoy/)).toBeInTheDocument();
  fireEvent.click(items[1]);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('GEX');
  expect(screen.getByText('qué mide')).toBeInTheDocument();                       // el resto del título, como bajada
  expect(document.querySelectorAll('.biblioteca-card')).toHaveLength(2);               // una tarjeta por sección
  expect(items[1]).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar la lista' }));          // el informe solo, como el chat
  expect(screen.queryByRole('complementary', { name: 'Informes de la Biblioteca' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar la lista' }));
  expect(screen.getByRole('complementary', { name: 'Informes de la Biblioteca' })).toBeInTheDocument();
});

test('separa el encabezado de las secciones', () => {
  expect(splitSections('# T\n\n**C.**\n\n## A\n\nx\n\n## B\n\ny')).toEqual({ head: '# T\n\n**C.**\n\n', sections: ['## A\n\nx\n\n', '## B\n\ny'] });
});

test('las fuentes salen del texto y van detrás del «?»', () => {
  expect(splitSources('| a |\n\nFuente: GaleCore `x`, 17/10.\n\nTexto')).toEqual({ body: '| a |\n\n\nTexto', sources: ['GaleCore `x`, 17/10.'] });
});

test('sin el Lab lo dice, sin inventar informes', async () => {
  (labRequest as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<Biblioteca />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer la Biblioteca');
});
