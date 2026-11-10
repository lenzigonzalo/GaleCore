import React, { useEffect, useState } from 'react';
import { labRaw } from '../../api/lab';

export const isHtmlFile = (p: string) => /\.html?$/i.test(p);
export const isImageFile = (p: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(p);

/** Conmutador «Vista · Código» de un .html (WS-0083 AC-10). */
export function LabViewSwitch({ view, onView }: { view: 'vista' | 'codigo'; onView: (v: 'vista' | 'codigo') => void }) {
  return <div className="lab-view-switch lab-preview-switch" role="group" aria-label="Ver como">
    <button type="button" aria-pressed={view === 'vista'} onClick={() => onView('vista')}>Vista</button>
    <button type="button" aria-pressed={view === 'codigo'} onClick={() => onView('codigo')}>Código</button>
  </div>;
}

function LabImage({ projectId, path }: { projectId: string; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true, url = ''; setSrc(null); setError('');
    labRaw(projectId, path).then(b => { url = URL.createObjectURL(b); if (live) setSrc(url); else URL.revokeObjectURL(url); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'No se pudo abrir la imagen.'); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [projectId, path]);
  if (error) return <p className="lab-mapa-empty" role="alert">{error}</p>;
  if (!src) return <p className="lab-mapa-empty" role="status">Abriendo…</p>;
  return <div className="lab-file-image"><img src={src} alt={path.split('/').pop() || path} /></div>;
}

/** Vista previa de un archivo del proyecto: .html renderizado en un iframe aislado (sin allow-same-origin) o imagen. */
export function LabFilePreview({ projectId, path, text, view, onView }: {
  projectId: string; path: string; text?: string; view?: 'vista' | 'codigo'; onView?: (v: 'vista' | 'codigo') => void;
}) {
  const [own, setOwn] = useState<'vista' | 'codigo'>('vista');
  if (isImageFile(path)) return <LabImage projectId={projectId} path={path} />;
  const current = view ?? own, change = onView ?? setOwn;
  return <div className="lab-file-preview">
    <LabViewSwitch view={current} onView={change} />
    {current === 'vista'
      ? <iframe className="lab-file-frame" title={'Vista de ' + path} sandbox="allow-scripts allow-popups" srcDoc={text ?? ''} />
      : <pre className="lab-file-panel-body lab-file-panel-raw">{text}</pre>}
  </div>;
}
