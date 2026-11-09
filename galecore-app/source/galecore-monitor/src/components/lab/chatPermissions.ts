/**
 * Modos de permisos de cada motor (WS-0083). Los ids son los que entiende el Lab (`lab-workspaces.js`, PERMISSION_MODES);
 * ninguno saltea permisos. El modo con el que arranca cada chat nuevo es una preferencia del navegador (labChatPrefs), por motor.
 */
export type Engine = 'claude' | 'codex';
export interface PermissionMode { id: string; label: string; hint: string }
export const PERMISSION_MODES: Record<Engine, PermissionMode[]> = {
  claude: [
    { id: 'default', label: 'Preguntar siempre', hint: 'Frena y te pregunta antes de editar archivos o ejecutar comandos.' },
    { id: 'acceptEdits', label: 'Aceptar ediciones', hint: 'Edita archivos del proyecto sin preguntar; los comandos te los pregunta.' },
    { id: 'auto', label: 'Auto', hint: 'Decide solo lo seguro y te pregunta lo demás.' },
    { id: 'plan', label: 'Sólo planear', hint: 'Analiza y propone un plan; no edita ni ejecuta nada.' },
  ],
  codex: [
    { id: 'read-only', label: 'Sólo lectura', hint: 'Lee y responde; no escribe archivos ni ejecuta cambios.' },
    { id: 'workspace-write', label: 'Preguntar', hint: 'Escribe dentro del proyecto y te pregunta lo que sale de ahí.' },
    { id: 'auto', label: 'Auto', hint: 'Decide solo lo seguro y te pregunta lo demás.' },
  ],
};
export const DEFAULT_MODE: Record<Engine, string> = { claude: 'default', codex: 'workspace-write' };
export type PermissionPrefs = Record<Engine, string>;

/** Modo válido para el motor; 'manual' (el de antes) y todo lo desconocido caen al predeterminado seguro. */
export function normalizeMode(engine: Engine, raw: unknown, fallback = DEFAULT_MODE[engine]): string {
  return PERMISSION_MODES[engine].some(m => m.id === raw) ? raw as string : fallback;
}
