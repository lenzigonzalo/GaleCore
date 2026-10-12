import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renderiza la respuesta sin ejecutar HTML ni cargar imágenes externas del modelo. */
export const LabMarkdown = memo(function LabMarkdown({ text }: { text: string }) {
  return <div className="lab-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    table: ({ children }) => <div className="lab-table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}><table>{children}</table></div>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span className="lab-image-description">{alt || 'Imagen'}</span>,
  }}>{text}</ReactMarkdown></div>;
});
