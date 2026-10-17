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

// WS-0044: «H1», «H2»… se definen una vez en la tabla de hipótesis del mapa; en el chat, nombrarlas lleva a su fila.
const HYPOTHESIS = /(?<![\w[`])H(\d{1,2})\b(?![\]`])/g;
function showInMapa(id: string) {
  const row = document.getElementById(id);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('lab-mapa-flash');
  window.setTimeout(() => row.classList.remove('lab-mapa-flash'), 2500);
}

// Fuera de los bloques de código (```), que se muestran tal cual.
const linkHypotheses = (text: string) => text.split('```').map((part, i) => i % 2 ? part : part.replace(HYPOTHESIS, (h, n) => '[' + h + '](#mapa-h' + n + ')')).join('```');

function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    table: ({ children }) => <div className="lab-table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}><table>{children}</table></div>,
    a: ({ href, children }) => href?.startsWith('#mapa-')
      ? <button type="button" className="lab-hypothesis-ref" title="Ver en el mapa" onClick={() => showInMapa(href.slice(1))}>{children}</button>
      : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span className="lab-image-description">{alt || 'Imagen'}</span>,
  }}>{linkHypotheses(text)}</ReactMarkdown>;
}
