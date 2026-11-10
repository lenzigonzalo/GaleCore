import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { labRequest } from '../../api/lab';
import { LabMarkdown } from './LabMarkdown';
import { LabFilePreview, isHtmlFile, isImageFile } from './LabFilePreview';
import './LabMapa.css';

/** Archivo del proyecto en modo lectura, a la derecha del chat (WS-0067). Edición y árbol siguen en la vista Archivos. */
export function LabFilePanel({ projectId, folder, path, narrow, onOpen, onClose, onOpenInFiles }: {
  projectId: string; folder: string; path: string; narrow: boolean;
  onOpen: (path: string) => void; onClose: () => void; onOpenInFiles: (path: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true; setText(null); setError('');
    if (isImageFile(path)) return () => { live = false; };
    labRequest<{ text: string }>('/workspaces/' + encodeURIComponent(projectId) + '/files?path=' + encodeURIComponent(path))
      .then(f => { if (live) setText(f.text); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo.'); });
    return () => { live = false; };
  }, [projectId, path]);
  const name = path.split('/').pop() || path;
  return <aside className="lab-mapa lab-file-panel" aria-label={'Archivo ' + name}>
    <header>
      <div><h2 title={path}>{name}</h2><span>{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'Raíz del proyecto'}</span></div>
      <div className="lab-file-panel-actions">
        <button type="button" className="lab-mapa-results" onClick={() => onOpenInFiles(path)}><ExternalLink size={14} />Abrir en Archivos</button>
        <button type="button" className="lab-icon" aria-label={narrow ? 'Volver al chat' : 'Cerrar archivo'} onClick={onClose}>{narrow ? <ArrowLeft size={18} /> : <X size={18} />}</button>
      </div>
    </header>
    {isImageFile(path) ? <LabFilePreview projectId={projectId} path={path} />
      : error ? <p className="lab-mapa-empty" role="alert">{error}</p>
      : text === null ? <p className="lab-mapa-empty" role="status">Abriendo…</p>
      : isHtmlFile(path) ? <LabFilePreview projectId={projectId} path={path} text={text} />
      : /\.md$/i.test(path) ? <div className="lab-file-panel-body"><LabMarkdown text={text} files={{ folder, open: onOpen }} /></div>
      : <pre className="lab-file-panel-body lab-file-panel-raw">{text}</pre>}
  </aside>;
}
