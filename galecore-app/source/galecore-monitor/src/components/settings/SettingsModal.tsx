import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Settings } from '../../pages/Settings';
import type { SpaceItem } from '../../api/space';
import type { ProviderAuth } from '../../api/terminal';

export function needsSetup(items: SpaceItem[], providers: ProviderAuth[]) {
  return providers.length > 0 && providers.every(provider => provider.status === 'signed-out' || provider.status === 'not-installed') && !items.some(item => item.kind === 'profile' && item.isOwn);
}
export function SettingsModal({ onClose, wizard = false }: { onClose: () => void; wizard?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const targets = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []);
      const first = targets[0], last = targets[targets.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="settings-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="settings-dialog"><header><h2 id="settings-title">{wizard ? 'Prepará tu espacio' : 'Configuración'}</h2><button aria-label="Cerrar configuración" onClick={onClose}><X size={21}/></button></header><Settings initial={wizard ? 'conexiones' : 'usuario'} wizard={wizard} onClose={onClose}/></section></div>;
}
