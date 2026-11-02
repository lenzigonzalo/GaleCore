import React, { useState } from 'react';
import { Check, Clock, Copy, NotebookPen } from 'lucide-react';
import type { ChatMessage } from '../../api/lab';

export function LabMessageActions({ message, note, onSave, onOpen }: {
  message: ChatMessage; note?: string; onSave: () => Promise<void>; onOpen: (path: string) => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [saving, setSaving] = useState(false);
  const date = new Date(message.at);
  const sentAt = Number.isNaN(date.getTime()) ? 'Hora no disponible' : `Enviado a las ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  const copyLabel = copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'No se pudo copiar. Reintentar' : 'Copiar respuesta';
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.text); setCopyState('copied'); }
    catch { setCopyState('failed'); }
  };
  const save = async () => {
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  };
  return <footer className="lab-message-actions" aria-label="Acciones de la respuesta">
    <button type="button" aria-label={copyLabel} title={copyLabel} onClick={() => void copy()} onBlur={() => setCopyState('idle')} onMouseLeave={() => setCopyState('idle')}>
      {copyState === 'copied' ? <Check size={19}/> : <Copy size={19}/>}
    </button>
    {note ? <a href={'#' + note} aria-label={'Abrir nota: ' + note} title={'Abrir nota: ' + note} onClick={e => { e.preventDefault(); onOpen(note); }}><NotebookPen size={19}/></a>
      : <button type="button" aria-label={saving ? 'Guardando nota' : 'Guardar como nota'} title={saving ? 'Guardando nota' : 'Guardar como nota'} disabled={saving} onClick={() => void save()}><NotebookPen size={19}/></button>}
    <span className="lab-message-time" tabIndex={0} aria-label={sentAt} title={sentAt}><Clock size={18}/></span>
    <span className="sr-only" role="status">{copyState === 'copied' ? 'Respuesta copiada' : copyState === 'failed' ? 'No se pudo copiar la respuesta' : ''}</span>
  </footer>;
}
