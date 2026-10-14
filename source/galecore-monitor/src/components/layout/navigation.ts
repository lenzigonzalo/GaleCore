import { LayoutDashboard, ChartNoAxesCombined, Wallet, Layers, MessageSquare, Bot } from 'lucide-react';
import type { Tab } from './TabNav';
export const NAVIGATION = [
  { group: 'Mirar', entries: [{ id: 'inicio' as Tab, label: 'Inicio', Icon: LayoutDashboard }, { id: 'gex' as Tab, label: 'Mercado', Icon: ChartNoAxesCombined }] },
  { group: 'Operar', entries: [{ id: 'monitor' as Tab, label: 'Posiciones', Icon: Wallet }, { id: 'estrategias' as Tab, label: 'Estrategias', Icon: Layers }] },
  { group: 'Trabajar', entries: [{ id: 'lab' as Tab, label: 'Chat', Icon: MessageSquare }, { id: 'agentes' as Tab, label: 'Agentes', Icon: Bot }] },
];
export const DESTINATIONS = NAVIGATION.flatMap(group => group.entries);
