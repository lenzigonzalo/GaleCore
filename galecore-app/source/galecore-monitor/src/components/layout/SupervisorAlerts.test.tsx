import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { SupervisorAlerts, useAgentAlerts } from './SupervisorAlerts';
import { fetchSpace } from '../../api/space';
import { fetchAgentAlerts } from '../../api/agents';

jest.mock('../../api/space', () => ({ fetchSpace: jest.fn() }));
jest.mock('../../api/account', () => ({ fetchStrikeAlerts: jest.fn().mockResolvedValue({ alerts: [] }) }));
jest.mock('../../api/agents', () => ({ fetchAgentAlerts: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
});

const alert = { id: 'ruptura-1', agent_key: 'cierre-spy', title: 'SPY rompió', created_at: '2026-11-10T15:00:00Z' };

test('un aviso de agente aparece en la campana con la categoría Agente y el título «agente: aviso»', async () => {
  render(<SupervisorAlerts embedded agents={[alert]} />);
  expect(await screen.findByText('cierre-spy: SPY rompió')).toBeInTheDocument();
  expect(screen.getByText('Agente')).toBeInTheDocument();
});

test('useAgentAlerts trae los avisos y avisa una sola vez por cada uno', async () => {
  (fetchAgentAlerts as jest.Mock).mockResolvedValue([alert]);
  const onNew = jest.fn();
  const { result, rerender } = renderHook(() => useAgentAlerts(true, onNew));
  await waitFor(() => expect(result.current).toEqual([alert]));
  expect(onNew).toHaveBeenCalledTimes(1);
  await act(async () => { rerender(); });
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('galecore.agents.seen') ?? '[]')).toEqual(['cierre-spy:ruptura-1']);
});

test('useAgentAlerts no consulta si no está activo', async () => {
  renderHook(() => useAgentAlerts(false));
  expect(fetchAgentAlerts).not.toHaveBeenCalled();
});
