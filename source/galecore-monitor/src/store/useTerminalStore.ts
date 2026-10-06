import { create } from 'zustand';

/**
 * El panel de Claude Code (P1-01c): si se ve y qué sesión tiene. Una sesión es una corrida de `claude` en una
 * carpeta; `id` cambia en cada sesión nueva para que el panel cierre la anterior y abra otra. Ocultar el panel no
 * corta la sesión.
 */
export interface TerminalSession { id: number; folder: string; prompt: string }

interface TerminalState {
  open: boolean;
  session: TerminalSession | null;
  start: (folder: string, prompt?: string) => void;
  setOpen: (open: boolean) => void;
}

let next = 1;

export const useTerminalStore = create<TerminalState>((set) => ({
  open: false,
  session: null,
  start: (folder, prompt = '') => set({ open: true, session: { id: next++, folder, prompt } }),
  setOpen: (open) => set({ open }),
}));
