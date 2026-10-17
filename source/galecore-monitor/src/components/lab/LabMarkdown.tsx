import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnswerHandler, LabChoices, parseChoices } from './LabChoices';

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
    img: ({ alt }) => <span className="lab-image-description">{alt || 'Imagen'}</span>,
  }}>{text}</ReactMarkdown>;
}
