import { fireEvent, render, screen } from '@testing-library/react';
import { Biblioteca } from './Biblioteca';
import { labRequest } from '../api/lab';

jest.mock('../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('../components/lab/LabMarkdown', () => ({ LabMarkdown: ({ text }: { text: string }) => <div>{text}</div> }));

const files: Record<string, string> = {
  'informes/2-gex.md': '# GEX: qué mide\n\n**GEX estima cuánto cubren los dealers.**',
  'informes/1-historia-macro.md': '# Historia macro\n\n**Tasas largas altas.**',
};

test('lista los informes en orden, abre el primero y cambia con un clic', async () => {
  (labRequest as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/files')) return { tree: [{ name: 'informes', path: 'informes', kind: 'folder', children: Object.keys(files).map(p => ({ name: p.split('/')[1], path: p, kind: 'file' })) }] };
    return { text: files[decodeURIComponent(path.split('path=')[1])] };
  });
  render(<Biblioteca />);
  const items = await screen.findAllByRole('button');
  expect(items.map(b => b.querySelector('strong')?.textContent)).toEqual(['Historia macro', 'GEX: qué mide']);
  expect(screen.getByText(/# Historia macro/)).toBeInTheDocument();
  fireEvent.click(items[1]);
  expect(screen.getByText(/# GEX: qué mide/)).toBeInTheDocument();
  expect(items[1]).toHaveAttribute('aria-current', 'page');
});

test('sin el Lab lo dice, sin inventar informes', async () => {
  (labRequest as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<Biblioteca />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer la Biblioteca');
});
