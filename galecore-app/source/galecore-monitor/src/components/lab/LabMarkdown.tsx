import React, { createContext, memo, useContext, useRef, useState } from 'react';
import ReactMarkdown, { Components, defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnswerHandler, LabChoices, parseChoices } from './LabChoices';
import { MapaChart, MapaChartView } from './LabMapa';

const CHOICES = /```opciones[ \t]*\r?\n([\s\S]*?)```/g;

/** Renderiza la respuesta sin ejecutar HTML ni cargar imágenes externas del modelo. Un bloque ```opciones válido se
 *  muestra como preguntas para tildar; si no es válido, queda como texto. */
export const LabMarkdown = memo(function LabMarkdown({ text, active = false, onAnswer, files }: { text: string; active?: boolean; onAnswer?: AnswerHandler; files?: ProjectFiles }) {
  const parts: React.ReactNode[] = [];
  let last = 0, n = 0;
  for (const m of Array.from(text.matchAll(CHOICES))) {
    const block = parseChoices(m[1]);
    if (!block) continue;
    if (m.index! > last) parts.push(<Markdown key={n++} text={text.slice(last, m.index)} />);
    parts.push(<LabChoices key={n++} block={block} active={active} onAnswer={onAnswer} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(<Markdown key={n++} text={text.slice(last)} />);
  return <Files.Provider value={files}><div className="lab-markdown">{parts}</div></Files.Provider>;
});

/** Carpeta del proyecto (relativa a knowledge/, «.» para cartera) y cómo abrir un archivo suyo en Archivos. */
export interface ProjectFiles { folder: string; open: (path: string) => void }

const WEB = /^(https?:|mailto:)/i;

/** Un enlace a un archivo del proyecto (relativo, o absoluto dentro de knowledge/<carpeta>) → su ruta en Archivos. */
export function projectFile(href: string, folder: string): string | null {
  let p: string; try { p = decodeURI(href); } catch { return null; }
  p = p.replace(/\\/g, '/').replace(/[?#].*$/, '');
  if (WEB.test(p) || (/^[a-z][\w+.-]*:/i.test(p) && !/^[a-z]:\//i.test(p))) return null;
  if (/^([a-z]:)?\//i.test(p)) {
    const at = p.toLowerCase().lastIndexOf('/knowledge/');
    if (at < 0) return null;
    p = p.slice(at + '/knowledge/'.length);
    const base = folder.replace(/^\.\/?/, '').replace(/\/+$/, '');
    if (base) { if (!p.startsWith(base + '/')) return null; p = p.slice(base.length + 1); }
  }
  p = p.replace(/^(\.\/)+/, '');
  return p && !p.split('/').includes('..') ? p : null;
}

const Files = createContext<ProjectFiles | undefined>(undefined);

// Las rutas de archivo pasan sin tocar (el filtro por defecto vacía «C:/…»); el resto, con el filtro de siempre.
const keepFiles = (url: string, key: string) => key === 'href' && !WEB.test(url) && !/^[a-z][\w+.-]*:/i.test(url.replace(/^[a-z]:\//i, '')) ? url : defaultUrlTransform(url);

// Un archivo del proyecto se abre en Archivos; una ruta que no se puede abrir queda como texto, no como link roto.
function Link({ href = '', children }: { href?: string; children?: React.ReactNode }) {
  const files = useContext(Files);
  if (WEB.test(href)) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  const file = files && projectFile(href, files.folder);
  return file ? <a href={'#' + file} className="lab-file-link" onClick={e => { e.preventDefault(); files!.open(file); }}>{children}</a> : <span>{children}</span>;
}

// Fuera del render: si se recrean en cada render, la tabla se vuelve a montar (el scroll horizontal vuelve a cero con
// cada tic del reloj) y el gráfico se redibuja.
const COMPONENTS: Components = {
  table: ({ children }) => <LabTable>{children}</LabTable>,
  // WS-0051: número con signo (+6,80 % / −2,13 %) en verde o rojo; regla genérica, sin mirar el nombre de la columna.
  td: ({ children, style }) => <td style={style} className={cellClass(children)}>{children}</td>,
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
  // WS-0045: un bloque ```grafico (formato del Mapa) se dibuja; si el JSON no sirve, queda como código.
  code: ({ className, children }) => {
    const chart = /language-grafico/.test(className || '') ? parseChart(String(children)) : null;
    return chart ? <MapaChartView chart={chart} label={chart.series.map(x => x.nombre).join(', ')} /> : <code className={className}>{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  img: ({ alt }) => <span className="lab-image-description">{alt || 'Imagen'}</span>,
};
const PLUGINS = [remarkGfm];

/** Filas de una tabla tal como se ven (texto de cada celda). */
export function tableRows(table: HTMLTableElement): string[][] {
  return Array.from(table.rows).map(row => Array.from(row.cells).map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim()));
}
/** Texto con tabulaciones: pega bien en una planilla. */
export const toTabs = (rows: string[][]) => rows.map(r => r.join('\t')).join('\n');
/** CSV con comillas cuando la celda tiene coma, comilla o salto de línea. */
export const toCsv = (rows: string[][]) => rows.map(r => r.map(c => /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(',')).join('\r\n');

function LabTable({ children }: { children?: React.ReactNode }) {
  const table = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!table.current) return;
    try { await navigator.clipboard.writeText(toTabs(tableRows(table.current))); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* sin portapapeles */ }
  };
  const download = () => {
    if (!table.current) return;
    const url = URL.createObjectURL(new Blob(['\ufeff' + toCsv(tableRows(table.current))], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'tabla.csv'; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="lab-table-box">
    <div className="lab-table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}><table ref={table}>{children}</table></div>
    <div className="lab-table-tools"><button type="button" onClick={() => void copy()}>{copied ? 'Copiada' : 'Copiar'}</button><button type="button" onClick={download}>CSV</button></div>
  </div>;
}

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={PLUGINS} skipHtml urlTransform={keepFiles} components={COMPONENTS}>{text}</ReactMarkdown>;
});

// El signo manda aunque la celda siga con texto («+26 % trimestral»).
const SIGNED = /^\s*([+−-])\s?\d[\d.,]*/;

function plainText(node: React.ReactNode): string {
  return React.Children.toArray(node).map(c => typeof c === 'string' ? c : React.isValidElement<{ children?: React.ReactNode }>(c) ? plainText(c.props.children) : '').join('');
}

// Una celda corta (cifra, fecha, símbolo) no se parte; el texto largo corta línea dentro del ancho del chat.
function cellClass(children: React.ReactNode): string | undefined {
  const text = plainText(children);
  const m = SIGNED.exec(text);
  return [m && (m[1] === '+' ? 'lab-pos' : 'lab-neg'), text.trim().length <= 18 && 'lab-short'].filter(Boolean).join(' ') || undefined;
}

function parseChart(text: string): MapaChart | null {
  try { const c = JSON.parse(text); return Array.isArray(c?.series) && c.series.length ? c : null; } catch { return null; }
}
