import React from 'react';
import { render, screen } from '@testing-library/react';
import { ExpiryEngine } from './ExpiryEngine';
import { GexScopeApi } from '../../types/gex';

const selection = {
  spot: 100, callGex: 1, putGex: -1, netGex: 0.5, gammaZeroLevel: 99, callWall: 105, putWall: 95,
  expirationsIncluded: 2, expirationsRequested: 2, coveragePct: 100, strikes: [],
} as unknown as GexScopeApi;

test('con varios vencimientos muestra la lectura de la selección', () => {
  render(<ExpiryEngine scope={{ kind: 'selection', selection, requested: 2 }} />);
  expect(screen.getByText('Selección')).toBeTruthy();
  expect(screen.getByText('105')).toBeTruthy();
  expect(screen.getByText('95')).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy();
});
