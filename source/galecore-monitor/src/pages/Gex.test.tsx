import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Gex } from './Gex';
import { useGexStore } from '../store/useGexStore';
import { useMarketStore } from '../store/useMarketStore';

let mockEnabled = true;
jest.mock('../api/gex', () => ({ GEX_SWITCH_ENDPOINT:'/test/switch', fetchGexRules:jest.fn(), fetchGexAnalysis:jest.fn() }));
jest.mock('../store/useStrategySwitchStore', () => ({ useSwitchEnabled:()=>mockEnabled }));
jest.mock('../store/useAppConfigStore', () => ({ useSwitchEndpoint:()=>'/test/switch', useAppConfigStore:(select:any)=>select({tickers:['SPY','QQQ']}) }));
jest.mock('../components/common/StrategySwitch', () => ({ StrategySwitch:()=> <span>Barrido</span> }));
jest.mock('../components/strategy/strategyReferences', () => ({ getStrategyReference:()=>null }));
jest.mock('../components/chart/GexChart', () => ({ GexChart:({symbol,gexData}:any)=> <div data-testid="chart">{symbol} · {gexData ? 'Gamma combinado' : 'Velas de precio'}</div> }));
jest.mock('../components/gex/OptionsChainList', () => ({ OptionsChainList:({onSelect}:any)=> <button onClick={()=>onSelect('global')}>Toda la cadena</button> }));
jest.mock('../components/gex/ExpiryEngine', () => ({ ExpiryEngine:()=> <div>Niveles del scope</div> }));

const props = {externalWatchlist:true, subscribeSymbol:jest.fn(),unsubscribeSymbol:jest.fn(),socketStatus:'connected' as const};
beforeEach(() => {
  mockEnabled=true;
  useGexStore.setState({tickers:['SPY','QQQ'],rulesLoading:false,rulesError:null,display:null,selectedSymbol:'SPY',selectedExpiry:{},error:{},errorCode:{},loading:{},adHocSymbols:[],cache:{
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
test('Precio sigue disponible con barrido OFF y no inicia un barrido', () => {
  mockEnabled=false;
  render(<Gex {...props}/>);
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Precio'}));
  expect(screen.getByTestId('chart')).toHaveTextContent('Velas de precio');
  expect(useGexStore.getState().fetchGex).not.toHaveBeenCalled();
});
test('sin precio válido o cierre previo no inventa variación y conserva errores', () => {
  useMarketStore.setState({tickers:{SPY:{symbol:'SPY',price:100,prevClose:0,loading:{},error:{price:'Proveedor no disponible'}} as any}});
  render(<Gex {...props}/>);
  expect(screen.getByText('Variación —')).toBeInTheDocument();
  expect(screen.getByText('Proveedor no disponible')).toBeInTheDocument();
  act(()=>useMarketStore.setState({tickers:{SPY:{symbol:'SPY',price:100,prevClose:98,loading:{},error:{}} as any}}));
  expect(screen.getByText(/\+2.00/)).toBeInTheDocument();
});
