import { fireEvent, render, screen } from '@testing-library/react';
import { LabMarkdown, projectFile } from './LabMarkdown';

const TABLE = `| Acción | Cierre | Variación | Lectura |
|---|---|---|---|
| MSFT | 531,87 | +6,80 % | Alcista |
| AAPL | 339,50 | −2,13 % | Frena |
| QQQ | 717,63 | -0,07 | — |
| NVDA | **−0,27** | 0 | — |
| TSM | 28/10 | 1,64 | ya presentó (15/10) |`;

describe('LabMarkdown (WS-0051)', () => {
  it('colorea sólo los números con signo en las celdas de tabla', () => {
    render(<LabMarkdown text={TABLE} />);
    expect(screen.getByText('+6,80 %')).toHaveClass('lab-pos');
    expect(screen.getByText('−2,13 %')).toHaveClass('lab-neg');
    expect(screen.getByText('−0,27').closest('td')).toHaveClass('lab-neg');
    expect(screen.getByText('-0,07')).toHaveClass('lab-neg');
    for (const t of ['531,87', '1,64', '28/10', 'Alcista']) expect(screen.getByText(t)).not.toHaveClass('lab-pos', 'lab-neg');
  });

  it('muestra la lista de fuentes web con links que abren en otra pestaña', () => {
    render(<LabMarkdown text={'Fuentes web:\n- [CNBC: caen por dudas](https://www.cnbc.com/a)\n- [Bloomberg: máximo](https://www.bloomberg.com/b)\n\n```opciones\n{"preguntas":[{"pregunta":"¿Cómo seguimos?","opciones":[{"texto":"A"},{"texto":"B"}]}],"enviar":"Dale"}\n```'} />);
    const link = screen.getByRole('link', { name: 'CNBC: caen por dudas' });
    expect(link).toHaveAttribute('href', 'https://www.cnbc.com/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('colorea por el signo inicial aunque la celda siga con texto, y marca las celdas cortas', () => {
    render(<LabMarkdown text={'| A | B | C |\n|---|---:|---|\n| CRWD | **+26 % trimestral** | Demanda atractiva, pero la valuación y el volumen piden cautela |'} />);
    expect(screen.getByRole('cell', { name: '+26 % trimestral' })).toHaveClass('lab-pos');
    expect(screen.getByText('CRWD')).toHaveClass('lab-short');
    expect(screen.getByText(/Demanda atractiva/)).not.toHaveClass('lab-short');
    expect(screen.getByRole('cell', { name: '+26 % trimestral' })).toHaveStyle('text-align: right');
  });

  it('un enlace a un archivo del proyecto lo abre en Archivos; lo que no se puede abrir queda como texto', () => {
    const open = jest.fn();
    render(<LabMarkdown files={{ folder: '.', open }} text={'[informe](C:/Users/x/GaleCore/knowledge/files/tecno.md) · [datos](files/datos.md) · [afuera](C:/Windows/a.md) · [raro](javascript:alert(1))'} />);
    fireEvent.click(screen.getByRole('link', { name: 'informe' }));
    fireEvent.click(screen.getByRole('link', { name: 'datos' }));
    expect(open.mock.calls).toEqual([['files/tecno.md'], ['files/datos.md']]);
    expect(screen.queryByRole('link', { name: 'afuera' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'raro' })).toBeNull();
  });

  it('resuelve la ruta relativa a la carpeta del proyecto', () => {
    expect(projectFile('C:\\k\\knowledge\\workspaces\\personal\\files\\a.md', 'workspaces/personal')).toBe('files/a.md');
    expect(projectFile('C:/k/knowledge/files/a.md', 'workspaces/personal')).toBeNull();
    expect(projectFile('./files/a%20b.md#x', '.')).toBe('files/a b.md');
    expect(projectFile('../afuera.md', '.')).toBeNull();
    expect(projectFile('https://sec.gov/a', '.')).toBeNull();
  });
});
