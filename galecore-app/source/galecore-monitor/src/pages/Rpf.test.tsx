import React from 'react';
import { render, screen } from '@testing-library/react';
import { Rpf } from './Rpf';
import { useRpfStore } from '../store/useRpfStore';

jest.mock('../components/common/ReferencesModal', () => ({ ReferencesModal: () => null }));

const noop = () => undefined;

test('muestra estado, ejes en filas y el candidato con números, sin rótulos viejos', () => {
  useRpfStore.setState({
    states: {
      SPY: {
        symbol: 'SPY', state: 'ARMED', timestamp: new Date().toISOString(), edge: 0.8, bar: 1.2, regime: 'normal',
        openPositions: 0, maxPositions: 2, capacityAvailable: true, cooldownRemainingSec: 0,
        macroChecks: [{ id: 'vix', label: 'VIX bajo el umbral', status: 'pass', value: 16.2, threshold: 22 }],
        gates: [{ id: 'tail', label: 'Cola tranquila', status: 'fail', value: 0.7, threshold: 0.5, detail: 'skew alto' }],
        candidate: { shortPutStrike: 640, longPutStrike: 635, shortPutDelta: -0.16, dte: 38, expiration: '2026-11-20', credit: 1.1, pop: 81, fromCascade: true },
      },
    } as any,
    suggestions: {},
  });
  render(<Rpf acceptSuggestion={noop} dismissSuggestion={noop} subscribeLeg={noop} unsubscribeLeg={noop} socketStatus="connected" />);
  expect(screen.getByRole('heading', { name: /SPY\s*Armado/ })).toBeInTheDocument();
  expect(screen.getByText('VIX bajo el umbral')).toBeInTheDocument();
  expect(screen.getByText('skew alto')).toBeInTheDocument();
  expect(screen.getByText('0.80 < 1.20')).toBeInTheDocument();
  expect(screen.getByText('Put spread')).toBeInTheDocument();
  expect(screen.getByText('$110')).toBeInTheDocument();
  expect(screen.getAllByText('$390')).toHaveLength(2);
  expect(screen.queryByText(/GaleCore RPF|MOTOR|Prima real · simulado/)).not.toBeInTheDocument();
});
