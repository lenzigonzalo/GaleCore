import { render, screen } from '@testing-library/react';
import { LabMarkdown } from './LabMarkdown';

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
});
