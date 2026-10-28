import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';
jest.mock('../../utils/authState', () => ({ isAuthUnverified: () => false }));
jest.mock('../../api/gex', () => ({ fetchGexRules: jest.fn(), fetchGexAnalysis: jest.fn() }));

test.each(['2026-10-13T14:00:00Z', '2026-01-13T14:00:00Z'])('el reloj superior muestra Argentina en verano e invierno: %s', date => {
  jest.useFakeTimers().setSystemTime(new Date(date));
  try {
    render(<StatusBar connectionStatus="disconnected" lastUpdate={null} />);
    expect(screen.getByText('ARG')).toBeInTheDocument();
    expect(screen.getByText('11:00:00')).toHaveAttribute('datetime', date.replace('Z', '.000Z'));
  } finally { jest.useRealTimers(); }
});
