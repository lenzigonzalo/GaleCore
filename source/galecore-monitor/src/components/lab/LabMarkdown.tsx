import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnswerHandler, LabChoices, parseChoices } from './LabChoices';
import { MapaChart, MapaChartView } from './LabMapa';

const CHOICES = /```opciones[ \t]*\r?\n([\s\S]*?)```/g;

/** Renderiza la respuesta sin ejecutar HTML ni cargar imágenes externas del modelo. Un bloque ```opciones válido se
 *  muestra como preguntas para tildar; si no es válido, queda como texto. */
export const LabMarkdown = memo(function LabMarkdown({ text, active = false, onAnswer }: { text: string; active?: boolean; onAnswer?: AnswerHandler }) {
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
  return <div className="lab-markdown">{parts}</div>;
});

function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    table: ({ children }) => <div className="lab-table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}><table>{children}</table></div>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    // WS-0045: un bloque ```grafico (formato del Mapa) se dibuja; si el JSON no sirve, queda como código.
    code: ({ className, children }) => {
      const chart = /language-grafico/.test(className || '') ? parseChart(String(children)) : null;
      return chart ? <MapaChartView chart={chart} label={chart.series.map(x => x.nombre).join(', ')} /> : <code className={className}>{children}</code>;
    },
    pre: ({ children }) => <>{children}</>,
    img: ({ alt }) => <span className="lab-image-description">{alt || 'Imagen'}</span>,
  }}>{text}</ReactMarkdown>;
}

function parseChart(text: string): MapaChart | null {
  try { const c = JSON.parse(text); return Array.isArray(c?.series) && c.series.length ? c : null; } catch { return null; }
}
