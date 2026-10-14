import React from 'react';
import { render } from '@testing-library/react';
import { PositionMonitor } from './PositionMonitor';
import { useAccountStore } from '../../store/useAccountStore';

jest.mock('../monitor/PortfolioRiskBar', () => ({ PortfolioRiskBar: () => null }));
jest.mock('../monitor/PositionCard', () => ({ PositionCard: () => null }));
jest.mock('../../api/analytics', () => ({ fetchGammaExposure: jest.fn(), fetchIVRank: jest.fn() }));

test('suscribe toda la cuenta aunque no forme spreads y vuelve a suscribir tras reconexión', () => {
  useAccountStore.getState().setPositions([
    { symbol: 'SPY   261120P00730000', underlyingSymbol: 'SPY', instrumentType: 'Equity Option', quantity: 1, quantityDirection: 'Short' },
    { symbol: 'TLT', underlyingSymbol: 'TLT', instrumentType: 'Equity', quantity: 2, quantityDirection: 'Long' },
    { symbol: 'QQQ   261120P00500000', underlyingSymbol: 'QQQ', instrumentType: 'Equity Option', quantity: 0 },
  ] as any);
  const props = { subscribeLeg: jest.fn(), unsubscribeLeg: jest.fn(), subscribeSymbol: jest.fn(), unsubscribeSymbol: jest.fn() };
  const { rerender, unmount } = render(<PositionMonitor {...props} socketStatus="connected" />);
  expect(props.subscribeLeg.mock.calls).toEqual([['.SPY261120P730']]);
  expect(props.subscribeSymbol.mock.calls.map(call => call[0])).toEqual(['SPY', 'TLT']);
  rerender(<PositionMonitor {...props} socketStatus="connecting" />);
  rerender(<PositionMonitor {...props} socketStatus="connected" />);
  expect(props.subscribeLeg).toHaveBeenCalledTimes(2);
  expect(props.subscribeSymbol).toHaveBeenCalledTimes(4);
  unmount();
  expect(props.unsubscribeLeg).toHaveBeenCalledWith('.SPY261120P730');
  useAccountStore.getState().reset();
});
