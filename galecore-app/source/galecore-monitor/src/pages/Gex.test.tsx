import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Gex } from './Gex';
import { useGexStore } from '../store/useGexStore';
import { useMarketStore } from '../store/useMarketStore';
import { fetchGexRules } from '../api/gex';
import { fetchSpace } from '../api/space';

let mockEnabled = true;
jest.mock('../api/gex', () => ({ GEX_SWITCH_ENDPOINT:'/test/switch', fetchGexRules:jest.fn(), fetchGexAnalysis:jest.fn() }));
jest.mock('../api/account', () => ({ ...jest.requireActual('../api/account'), fetchAccountOverview: () => Promise.resolve({ positions: [] }) }));
jest.mock('../api/space', () => ({ fetchSpace:jest.fn(), saveSpaceItem:jest.fn() }));
jest.mock('../api/marketdata', () => ({ ...jest.requireActual('../api/marketdata'), fetchMarketSummary: () => Promise.resolve({ symbol: 'SPY', last: 771.74, prevClose: 769.6, change: 2.14, changePct: 0.28, volume: 43300000, high: 772.87, low: 764.43, sessionDate: '2026-10-15' }) }));
jest.mock('../store/useStrategySwitchStore', () => ({ useSwitchEnabled:()=>mockEnabled, useStrategySwitchStore:(select:any)=>select({read:()=>Promise.resolve()}) }));
jest.mock('../store/useAppConfigStore', () => ({ useSwitchEndpoint:()=>'/test/switch', useAppConfigStore:(select:any)=>select({tickers:['SPY','QQQ']}) }));
jest.mock('../components/common/StrategySwitch', () => ({ StrategySwitch:()=> <span>Barrido</span> }));
jest.mock('../components/strategy/strategyReferences', () => ({ getStrategyReference:()=>null }));
jest.mock('../components/chart/GexChart', () => ({ GexChart:({symbol,layerOn,alertLevels}:any)=> <div data-testid="chart" data-alert-levels={JSON.stringify(alertLevels ?? [])}>{symbol} · {Object.keys(layerOn).filter(k=>layerOn[k]).join(',')}</div> }));
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
  (fetchSpace as jest.Mock).mockResolvedValue({items:[]});
  localStorage.clear();
  mockEnabled=true;
  useGexStore.setState({rules:{} as any,tickers:['SPY','QQQ'],rulesLoading:false,rulesError:null,display:null,selectedSymbol:'SPY',selectedExpiry:{},error:{},errorCode:{},loading:{},adHocSymbols:[],cache:{
    SPY:{updatedAt:new Date(),data:{spotPrice:100,frozen:false,macroRegime:null,structureInputs:null,gex:{config:{maxDte:60},global:{netGex:2,strikes:[],expirationsIncluded:1,expirationsRequested:1},byExpiry:[{expiration:'2026-10-12',dte:2,netGex:2,gammaZeroLevel:99,callWall:102,putWall:98,callBand:null,putBand:null,expectedMove:2,atmIv:.2,strikes:[]}]}} as any}
  },fetchGex:jest.fn() as any});
  useMarketStore.setState({tickers:{SPY:{symbol:'SPY',price:100,prevClose:98,bid:99.9,ask:100.1,open:99,lastUpdate:new Date(),isStreaming:true,loading:{},error:{}} as any}});
});

test('Precio envía al gráfico los avisos activos y distingue precio 700 de piso de puts 700', async () => {
  const rule = (id: string, threshold: number, metric = 'price') => ({ id, symbol: 'SPY', metric, condition: 'below', threshold });
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ kind: 'agent', key: 'supervisor', content: JSON.stringify({
    watches: [rule('750',750), rule('715',715), rule('700',700), rule('690',690), rule('puts',700,'put_wall'), rule('iv',70,'iv_rank')],
    unwatch: { '750': { at: '2026-11-06' } },
  }) }] });
  render(<Gex {...props} indicator="price"/>);
  await waitFor(() => expect(JSON.parse(screen.getByTestId('chart').getAttribute('data-alert-levels')!)).toHaveLength(4));
  const levels = JSON.parse(screen.getByTestId('chart').getAttribute('data-alert-levels')!);
  expect(levels.map((x: any) => [x.id, x.price])).toEqual([['715',715],['700',700],['690',690],['puts',700]]);
  expect(levels.find((x: any) => x.id === 'puts').label).toBe('Aviso Piso de puts ≤ 700');
});
test('un solo gráfico de precio con capas; Métricas conserva símbolo y scope elegido', () => {
  localStorage.setItem('galecore:market:layers', JSON.stringify({ walls: true, bars: true, positions: true, alerts: true }));   // Vencimiento sólo con barras
  render(<Gex {...props}/>);
  expect(screen.getByTestId('chart')).toHaveTextContent('SPY · walls,bars,positions,alerts');
  expect(screen.queryByRole('button',{name:'Gamma'})).not.toBeInTheDocument();
  expect(screen.queryByText('GEX Global')).not.toBeInTheDocument();   // owner 06/11: van en Métricas
  fireEvent.click(screen.getByRole('button',{name:'Toda la cadena'}));
  expect(screen.getByText('100.00')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Volatilidad'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Métricas'}));
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(screen.getByRole('region',{name:'Smile y skew'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Precio'}));
  expect(useGexStore.getState().selectedExpiry.SPY).toBe('global');
});
test('Métricas: pestaña propia con precio y gamma, sin gráfico', () => {
  render(<Gex {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Métricas'}));
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(screen.getByText('GEX Global')).toBeInTheDocument();
  expect(screen.getByText('Trend EMA')).toBeInTheDocument();
});
test('el menú de capas prende y apaga cada capa y recuerda el estado', () => {
  render(<Gex {...props}/>);
  expect(screen.queryByLabelText('Capas del gráfico')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Capas'}));
  const walls = screen.getByRole('switch',{name:'Muros GEX'}), bars = screen.getByRole('switch',{name:'Barras por strike'}), alerts = screen.getByRole('switch',{name:'Avisos'});
  expect(walls).toBeChecked(); expect(bars).not.toBeChecked(); expect(alerts).toBeChecked();
  fireEvent.click(bars);
  expect(screen.getByTestId('chart')).toHaveTextContent('SPY · walls,bars,positions,alerts');
  fireEvent.click(walls);
  expect(screen.getByTestId('chart')).toHaveTextContent('SPY · bars,positions,alerts');
  expect(JSON.parse(localStorage.getItem('galecore:market:layers')!)).toEqual({ walls: false, bars: true, positions: true, alerts: true });
});
test('las capas guardadas se restauran y el menú se cierra con Escape y con clic afuera', () => {
  localStorage.setItem('galecore:market:layers', JSON.stringify({ walls: false, bars: true }));
  render(<Gex {...props}/>);
  const toggle = screen.getByRole('button',{name:'Capas'});
  expect(toggle).toHaveAttribute('aria-expanded','false');
  fireEvent.click(toggle);
  expect(screen.getByRole('switch',{name:'Barras por strike'})).toBeChecked();
  expect(screen.getByRole('switch',{name:'Muros GEX'})).not.toBeChecked();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByLabelText('Capas del gráfico')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByLabelText('Capas del gráfico')).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByLabelText('Capas del gráfico')).not.toBeInTheDocument();
});
test('Vencimiento sólo aparece con la capa Barras por strike', () => {
  render(<Gex {...props}/>);
  expect(screen.queryByText(/^Vencimiento:/, { selector: 'summary' })).not.toBeInTheDocument();
});
test('un solo selector de vencimiento: dice el elegido, trae la lectura y no hay otro botón de vencimiento', () => {
  localStorage.setItem('galecore:market:layers', JSON.stringify({ walls: true, bars: true, positions: true, alerts: true }));
  render(<Gex {...props}/>);
  expect(screen.getAllByText(/^Vencimiento:/, { selector: 'summary' })).toHaveLength(1);
  expect(screen.getByText('Niveles del scope')).toBeInTheDocument();
  expect(screen.queryByText('Vencimiento elegido')).not.toBeInTheDocument();
  const frame = screen.getByRole('button',{name:'Encuadrar zona gamma'});
  expect(frame).toHaveAttribute('aria-pressed','true');   // prendida por defecto con las barras
  fireEvent.click(frame);
  expect(frame).toHaveAttribute('aria-pressed','false');
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
  expect(screen.getByTestId('chart')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Métricas'}));
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(useGexStore.getState().fetchGex).not.toHaveBeenCalled();
});
test('la variación y el volumen del día salen de la API; sin ellos no se inventan y el error se conserva', async () => {
  useMarketStore.setState({tickers:{SPY:{symbol:'SPY',price:100,prevClose:0,loading:{},error:{price:'Proveedor no disponible'}} as any}});
  render(<Gex {...props}/>);
  expect(screen.queryByText('+0.28%')).not.toBeInTheDocument();
  expect(screen.getByText('Proveedor no disponible')).toBeInTheDocument();
  expect(await screen.findByText('+0.28%')).toBeInTheDocument();
  expect(screen.getByText('43,3 M')).toBeInTheDocument();
  expect(screen.getByTitle(/Máx\. 772\.87 · Mín\. 764\.43 · Cierre anterior 769\.60/)).toBeInTheDocument();
});

test('el indicador controlado cambia la vista con el mismo simbolo', () => {
  const change = jest.fn();
  const {rerender} = render(<Gex {...props} indicator="metrics" onIndicatorChange={change}/>);
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Precio'}));
  expect(change).toHaveBeenCalledWith('price');
  rerender(<Gex {...props} indicator="price" onIndicatorChange={change}/>);
  expect(screen.getByTestId('chart')).toHaveTextContent('SPY');
  expect(useGexStore.getState().selectedSymbol).toBe('SPY');
});
