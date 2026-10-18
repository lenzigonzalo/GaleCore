import { LayoutDashboard, ChartNoAxesCombined, Globe, Layers, MessageSquare, Bot, BookOpen } from 'lucide-react';
import type { Tab } from './TabNav';
export const NAVIGATION = [
  { group: 'Mirar', entries: [{ id: 'inicio' as Tab, label: 'Inicio', Icon: LayoutDashboard }, { id: 'gex' as Tab, label: 'Mercado', Icon: ChartNoAxesCombined }, { id: 'macro' as Tab, label: 'Macro', Icon: Globe }, { id: 'biblioteca' as Tab, label: 'Biblioteca', Icon: BookOpen }] },
  { group: 'Operar', entries: [{ id: 'estrategias' as Tab, label: 'Estrategias', Icon: Layers }] },
  { group: 'Trabajar', entries: [{ id: 'lab' as Tab, label: 'Chat', Icon: MessageSquare }, { id: 'agentes' as Tab, label: 'Agentes', Icon: Bot }] },
];
export const DESTINATIONS = NAVIGATION.flatMap(group => group.entries);
