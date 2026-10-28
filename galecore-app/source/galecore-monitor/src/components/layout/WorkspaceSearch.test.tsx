import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceSearch } from './WorkspaceSearch';
import { searchSymbols } from '../../api/marketdata';
jest.mock('../../api/marketdata', () => ({ searchSymbols: jest.fn() }));
jest.mock('../../store/useGexStore', () => ({ useGexStore: { getState: () => ({ rules: {}, adHocSearch: { enabled: true, min_query_length: 1, max_results: 8, allowed_instrument_types: ['Equity'] } }) } }));
beforeEach(() => (searchSymbols as jest.Mock).mockReset());
test('busca una sección local y no promete documentos', () => {
  const navigate = jest.fn(); render(<WorkspaceSearch onNavigate={navigate} onSymbol={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Buscar en GaleCore' }));
  fireEvent.focus(screen.getByRole('textbox', { name: 'Buscar símbolo o sección' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chat' })); expect(navigate).toHaveBeenCalledWith('lab');
  expect(searchSymbols).not.toHaveBeenCalled();
});
test('busca símbolos reales y no oculta el error al abrirlos', async () => {
  (searchSymbols as jest.Mock).mockResolvedValue([{ symbol: 'SPY', description: 'ETF' }]);
  const symbol = jest.fn().mockRejectedValue(new Error('Mercado no disponible'));
  render(<WorkspaceSearch expanded onNavigate={() => {}} onSymbol={symbol} />);
  expect(screen.getByRole('button', { name: 'Buscar en GaleCore' })).toHaveTextContent('Buscar ticker');
  fireEvent.click(screen.getByRole('button', { name: 'Buscar en GaleCore' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SPY' } });
  fireEvent.click(await screen.findByRole('button', { name: 'SPY ETF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Mercado no disponible');
  expect(symbol).toHaveBeenCalledWith('SPY'); expect(searchSymbols).toHaveBeenCalledWith('SPY', ['Equity']);
});
test('una falla de búsqueda no se presenta como ausencia de símbolos', async () => {
  (searchSymbols as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<WorkspaceSearch onNavigate={() => {}} onSymbol={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Buscar en GaleCore' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SPY' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron buscar símbolos.');
  expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument();
});

test('Ctrl K abre, Escape cierra y devuelve foco a la lupa',()=>{
  render(<WorkspaceSearch onNavigate={()=>{}} onSymbol={async()=>{}}/>);
  fireEvent.keyDown(document,{key:'k',ctrlKey:true});expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveFocus();fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Buscar en GaleCore'})).toHaveFocus();
});
