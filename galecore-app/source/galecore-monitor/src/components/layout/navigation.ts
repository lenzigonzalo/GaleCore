import { LayoutDashboard, ChartNoAxesCombined, Globe, Layers, MessageSquare, Bot, BookOpen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Tab } from './TabNav';
export interface NavChild { id: Tab; label: string }
export interface NavEntry { id: Tab; label: string; Icon: LucideIcon; children?: NavChild[] }
// Macro se despliega en dos hijos (WS-0095): Global (la página Macro de siempre) y Argentina. El click en «Macro» abre el último usado.
export const MACRO_CHILDREN: NavChild[] = [{ id: 'macro', label: 'Global' }, { id: 'macro-ar', label: 'Argentina' }];
export const NAVIGATION: Array<{ group: string; entries: NavEntry[] }> = [
  { group: 'Mirar', entries: [{ id: 'inicio', label: 'Inicio', Icon: LayoutDashboard }, { id: 'gex', label: 'Mercado', Icon: ChartNoAxesCombined }, { id: 'macro', label: 'Macro', Icon: Globe, children: MACRO_CHILDREN }, { id: 'biblioteca', label: 'Biblioteca', Icon: BookOpen }] },
  { group: 'Operar', entries: [{ id: 'estrategias', label: 'Estrategias', Icon: Layers }] },
  { group: 'Trabajar', entries: [{ id: 'lab', label: 'Chat', Icon: MessageSquare }, { id: 'agentes', label: 'Agentes', Icon: Bot }] },
];
/** Cada pantalla alcanzable (los hijos de un grupo cuentan como destinos propios, con el nombre del grupo). */
export const DESTINATIONS: Array<{ id: Tab; label: string; Icon: LucideIcon }> = NAVIGATION.flatMap(group => group.entries)
  .flatMap(entry => entry.children ? entry.children.map(child => ({ id: child.id, label: `${entry.label} · ${child.label}`, Icon: entry.Icon })) : [entry]);

const MACRO_LAST_KEY = 'galecore:macro:last';
export const isMacroTab = (tab: Tab) => MACRO_CHILDREN.some(child => child.id === tab);
/** Último hijo de Macro usado en este navegador (Global por defecto). */
export function lastMacroTab(): Tab {
  try { const saved = localStorage.getItem(MACRO_LAST_KEY); return MACRO_CHILDREN.find(child => child.id === saved)?.id || 'macro'; }
  catch { return 'macro'; }
}
export function rememberMacroTab(tab: Tab) { try { localStorage.setItem(MACRO_LAST_KEY, tab); } catch { /* sin guardado */ } }
