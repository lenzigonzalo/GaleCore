import React, { useEffect, useState } from 'react';
import { ChatMessage, labAttachment } from '../../api/lab';

// Los chats anteriores guardaban las rutas al final del texto; se leen sin modificar el historial.
export function messageContent(message: ChatMessage): { text: string; attachments: string[] } {
  if (message.attachments) return { text: message.text, attachments: message.attachments };
  const match = message.text.match(/(?:^|\n\n)Archivos adjuntos \(en la carpeta del proyecto\): (adjuntos\/[^\n]+)$/);
  const files = match?.[1].split(', ') || [];
  return match && files.every(p => /^adjuntos\/[\w.\- ]+$/.test(p))
    ? { text: message.text.slice(0, match.index).trimEnd(), attachments: files }
    : { text: message.text, attachments: [] };
}

function Attachment({ project, path }: { project: string; path: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const name = path.replace(/^adjuntos\/\d+-/, '');
  const image = /\.(png|jpe?g|gif|webp)$/i.test(path);
  useEffect(() => {
    let live = true, objectUrl = '';
    setUrl(''); setError(false);
    labAttachment(project, path).then(blob => {
      if (live) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [project, path]);
  if (error) return <span role="status">No se pudo abrir {name}.</span>;
  if (!url) return <span>Cargando {name}…</span>;
  if (!image) return <a href={url} download={name}>{name}</a>;
  return <div className="lab-message-image">
    <a className="lab-image-preview" href={url} target="_blank" rel="noreferrer" title="Abrir imagen original">
      <img src={url} alt={name} onError={() => setError(true)}/>
    </a>
    <a className="lab-image-open" href={url} target="_blank" rel="noreferrer" aria-label={'Abrir imagen original: ' + name}>Abrir tamaño original ↗</a>
  </div>;
}

export function LabMessageAttachments({ message, project }: { message: ChatMessage; project: string }) {
  const content = messageContent(message);
  return <div>{content.text && <div>{content.text}</div>}{content.attachments.length > 0 && <div className="lab-message-attachments">
    {content.attachments.map(path => <Attachment key={path} project={project} path={path}/>)}
  </div>}</div>;
}
