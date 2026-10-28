import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Gex } from './Gex';
import { useGexStore } from '../store/useGexStore';
import { useMarketStore } from '../store/useMarketStore';
import { fetchGexRules } from '../api/gex';

let mockEnabled = true;
jest.mock('../api/gex', () => ({ GEX_SWITCH_ENDPOINT:'/test/switch', fetchGexRules:jest.fn(), fetchGexAnalysis:jest.fn() }));
jest.mock('../api/marketdata', () => ({ ...jest.requireActual('../api/marketdata'), fetchMarketSummary: () => Promise.resolve({ symbol: 'SPY', last: 771.74, prevClose: 769.6, change: 2.14, changePct: 0.28, volume: 43300000, high: 772.87, low: 764.43, sessionDate: '2026-10-15' }) }));
jest.mock('../store/useStrategySwitchStore', () => ({ useSwitchEnabled:()=>mockEnabled, useStrategySwitchStore:(select:any)=>select({read:()=>Promise.resolve()}) }));
jest.mock('../store/useAppConfigStore', () => ({ useSwitchEndpoint:()=>'/test/switch', useAppConfigStore:(select:any)=>select({tickers:['SPY','QQQ']}) }));
jest.mock('../components/common/StrategySwitch', () => ({ StrategySwitch:()=> <span>Barrido</span> }));
jest.mock('../components/strategy/strategyReferences', () => ({ getStrategyReference:()=>null }));
jest.mock('../components/chart/GexChart', () => ({ GexChart:({symbol,gexData}:any)=> <div data-testid="chart">{symbol} · {gexData ? 'Gamma combinado' : 'Velas de precio'}</div> }));
jest.mock('../components/gex/OptionsChainList', () => ({ OptionsChainList:({onSelect}:any)=> <button onClick={()=>onSelect('global')}>Toda la cadena</button> }));
jest.mock('../components/gex/ExpiryEngine', () => ({ ExpiryEngine:()=> <div>Niveles del scope</div> }));

const props = {externalWatchlist:true, subscribeSymbol:jest.fn(),unsubscribeSymbol:jest.fn(),socketStatus:'connected' as const};
test('abrir Mercado lee las reglas aunque el dock de Watchlist nunca se haya abierto', async () => {
  (fetchGexRules as jest.Mock).mockResolvedValue({ universe: { tickers: ['SPY','QQQ'] }, display_config: {} });
  useGexStore.setState({ rules: null, rulesLoading: true });
  render(<Gex {...props}/>);
  await waitFor(() => expect(fetchGexRules).toHaveBeenCalledTimes(1));
  expect(await screen.findByTestId('chart')).toBeInTheDocument();
});
beforeEach(() => {
  mockEnabled=true;
  useGexStore.setState({rules:{} as any,tickers:['SPY','QQQ'],rulesLoading:false,rulesError:null,display:null,selectedSymbol:'SPY',selectedExpiry:{},error:{},errorCode:{},loading:{},adHocSymbols:[],cache:{
    SPY:{updatedAt:new Date(),data:{spotPrice:100,frozen:false,macroRegime:null,structureInputs:null,gex:{config:{maxDte:60},global:{netGex:2,strikes:[],expirationsIncluded:1,expirationsRequested:1},byExpiry:[{expiration:'2026-10-12',dte:2,netGex:2,gammaZeroLevel:99,callWall:102,putWall:98,callBand:null,putBand:null,expectedMove:2,atmIv:.2,strikes:[]}]}} as any}
  },fetchGex:jest.fn() as any});
  useMarketStore.setState({tickers:{SPY:{symbol:'SPY',price:100,prevClose:98,bid:99.9,ask:100.1,open:99,lastUpdate:new Date(),isStreaming:true,loading:{},error:{}} as any}});
});
test('separa indicadores conservando símbolo y scope elegido', () => {
  render(<Gex {...props}/>);
  expect(screen.getByTestId('chart')).toHaveTextContent('SPY · Gamma combinado');
  fireEvent.click(screen.getByRole('button',{name:'Toda la cadena'}));
  fireEvent.click(screen.getByRole('button',{name:'Precio'}));
  expect(screen.getByTestId('chart')).toHaveTextContent('Velas de precio');
  expect(screen.getByText('100.00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'IV y volatilidad'}));
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(screen.getByText('IV Rank')).toBeInTheDocument();
  expect(screen.queryByText('GEX Global')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Gamma'}));
  expect(useGexStore.getState().selectedExpiry.SPY).toBe('global');
});
test('si el vencimiento elegido ya no está en la cadena pasa al más cercano', () => {
  useGexStore.setState({selectedExpiry:{SPY:'2026-10-09'}});
  render(<Gex {...props}/>);
  expect(screen.queryByText('Sin datos GEX disponibles')).not.toBeInTheDocument();
  expect(screen.getByTestId('chart')).toBeInTheDocument();
});
test('Precio sigue disponible con barrido OFF y no inicia un barrido', () => {
  mockEnabled=false;
  render(<Gex {...props}/>);
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Precio'}));
  expect(screen.getByTestId('chart')).toHaveTextContent('Velas de precio');
  expect(useGexStore.getState().fetchGex).not.toHaveBeenCalled();
});
test('la variación y el volumen del día salen de la API; sin ellos no se inventan y el error se conserva', async () => {
  useMarketStore.setState({tickers:{SPY:{symbol:'SPY',price:100,prevClose:0,loading:{},error:{price:'Proveedor no disponible'}} as any}});
  render(<Gex {...props}/>);
  expect(screen.queryByText(/\(\+0.28%\)/)).not.toBeInTheDocument();
  expect(screen.getByText('Proveedor no disponible')).toBeInTheDocument();
  expect(await screen.findByText(/\+2.14 \(\+0.28%\)/)).toBeInTheDocument();
  expect(screen.getByText('43,3 M')).toBeInTheDocument();
  expect(screen.getByText('769.60')).toBeInTheDocument();
});

test('el indicador controlado cambia la vista con el mismo simbolo', () => {
  const change = jest.fn();
  const {rerender} = render(<Gex {...props} indicator="gamma" onIndicatorChange={change}/>);
  expect(screen.getByTestId('chart')).toHaveTextContent('Gamma combinado');
  fireEvent.click(screen.getByRole('button',{name:'Precio'}));
  expect(change).toHaveBeenCalledWith('price');
  rerender(<Gex {...props} indicator="price" onIndicatorChange={change}/>);
  expect(screen.getByTestId('chart')).toHaveTextContent('SPY \u00b7 Velas de precio');
  expect(useGexStore.getState().selectedSymbol).toBe('SPY');
});
