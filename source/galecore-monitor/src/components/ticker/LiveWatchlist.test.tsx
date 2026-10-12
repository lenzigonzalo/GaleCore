import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { LiveWatchlist } from './LiveWatchlist';
import { useGexStore } from '../../store/useGexStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { useMarketStore } from '../../store/useMarketStore';
import { fetchMarketDataBatch, searchSymbols } from '../../api/marketdata';
jest.mock('../../api/gex',()=>({fetchGexRules:jest.fn(),fetchGexAnalysis:jest.fn()}));
jest.mock('../../api/marketdata',()=>({fetchMarketDataBatch:jest.fn(),searchSymbols:jest.fn()}));
const batch=fetchMarketDataBatch as jest.Mock;
const props={open:true,enabled:true,onClose:jest.fn(),onSelect:jest.fn(),socketStatus:'connected' as const,subscribeSymbol:jest.fn(),unsubscribeSymbol:jest.fn()};
beforeEach(()=>{
  jest.clearAllMocks();
  useMarketStore.setState({tickers:{}});
  useAppConfigStore.setState({tickers:['SPY']});
  // Universo sintético de prueba, no una lectura financiera real.
  useGexStore.setState({rules:{} as any,tickers:['SPY','AAPL'],rulesLoading:false,rulesError:null,adHocSymbols:[],selectedSymbol:null,adHocSearch:null});
  batch.mockImplementation(async(symbols:string[])=>symbols.map(symbol=>({symbol,last:101,prevClose:100,open:99,bid:100,ask:102,volume:1000})));
});
test('lee cotizaciones por la API existente y retirar/restaurar no altera el universo de reglas',async()=>{
  render(<LiveWatchlist {...props}/>);
  await waitFor(()=>expect(screen.getAllByText('101.00')).toHaveLength(2));
  expect(screen.getAllByText('+1.00%')).toHaveLength(2);
  expect(batch).toHaveBeenCalledWith(['SPY','AAPL']);
  expect(props.subscribeSymbol).toHaveBeenCalledWith('AAPL');
  expect(props.subscribeSymbol).not.toHaveBeenCalledWith('SPY');
  fireEvent.click(screen.getByRole('button',{name:'Quitar AAPL del seguimiento'}));
  expect(useGexStore.getState().tickers).toEqual(['SPY','AAPL']);
  expect(props.unsubscribeSymbol).toHaveBeenCalledWith('AAPL');
  fireEvent.click(screen.getByRole('button',{name:'AAPL'}));
  await waitFor(()=>expect(screen.getAllByText('101.00')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button',{name:'SPY'}));
  expect(useGexStore.getState().selectedSymbol).toBe('SPY');
  expect(props.onSelect).toHaveBeenCalledTimes(1);
});
test('el panel conserva la lista al cerrar, Escape cierra y errores de lectura no generan precios',async()=>{
  batch.mockRejectedValue(new Error('Fuente no disponible'));
  const {rerender}=render(<LiveWatchlist {...props}/>);
  await waitFor(()=>expect(screen.getAllByText('Sin datos')).toHaveLength(2));
  expect(screen.queryByText('101.00')).not.toBeInTheDocument();
  fireEvent.keyDown(document,{key:'Escape'});
  expect(props.onClose).toHaveBeenCalledTimes(1);
  rerender(<LiveWatchlist {...props} open={false}/>);
  expect(screen.getByRole('complementary',{hidden:true})).not.toBeVisible();
  expect(useGexStore.getState().tickers).toEqual(['SPY','AAPL']);
});

test('agregar dos cotizaciones no desplaza la anterior por el límite de un barrido GEX',async()=>{
  useGexStore.setState({adHocSearch:{enabled:true,max_pinned:1,min_query_length:1,max_results:8,allowed_instrument_types:['Equity'],auto_refresh:false}});
  (searchSymbols as jest.Mock).mockImplementation(async(query:string)=>[{symbol:query,description:'Instrumento de prueba'}]);
  render(<LiveWatchlist {...props}/>);
  for (const symbol of ['MSFT','TSLA']) {
    fireEvent.click(screen.getByRole('button',{name:'Agregar símbolo a la watchlist'}));
    const search=screen.getByPlaceholderText('Símbolo…');
    fireEvent.change(search,{target:{value:symbol}});
    await screen.findByText(symbol);
    fireEvent.keyDown(search,{key:'Enter'});
    await waitFor(()=>expect(screen.getByRole('button',{name:symbol})).toBeInTheDocument());
  }
  expect(screen.getByRole('button',{name:'MSFT'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'TSLA'})).toBeInTheDocument();
  expect(useGexStore.getState().adHocSymbols).toEqual([]);
  fireEvent.click(screen.getByRole('button',{name:'MSFT'}));
  expect(useGexStore.getState().adHocSymbols).toEqual(['MSFT']);
  expect(screen.getByRole('button',{name:'TSLA'})).toBeInTheDocument();
});

test('una lectura posterior válida recupera el ticker tras un error REST',async()=>{
  batch.mockRejectedValueOnce(new Error('Fallo temporal'));
  render(<LiveWatchlist {...props}/>);
  await waitFor(()=>expect(screen.getAllByText('Sin datos')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button',{name:'Quitar AAPL del seguimiento'}));
  fireEvent.click(screen.getByRole('button',{name:'AAPL'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Quitar AAPL del seguimiento'})).toBeInTheDocument());
  await waitFor(()=>expect(within(screen.getByRole('button',{name:'AAPL'}).closest('tr')!).getByText('101.00')).toBeInTheDocument());
  expect(useMarketStore.getState().tickers.AAPL.error.price).toBeUndefined();
  act(() => { useMarketStore.getState().setError('SPY','price','Fallo temporal');
  useMarketStore.getState().updatePrice('SPY',{price:102,size:1,timestamp:new Date().toISOString()}); });
  expect(useMarketStore.getState().tickers.SPY.error.price).toBeUndefined();
});

test('los separadores se contraen sin sacar tickers del seguimiento',async()=>{
  const toggle=jest.fn();
  render(<LiveWatchlist {...props} onToggle={toggle}/>);
  await waitFor(()=>expect(screen.getAllByText('101.00')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button',{name:'ETF'}));
  expect(screen.queryByRole('button',{name:'SPY'})).not.toBeInTheDocument();
  expect(useGexStore.getState().tickers).toEqual(['SPY','AAPL']);
  fireEvent.click(screen.getByRole('button',{name:'ETF'}));
  expect(screen.getByRole('button',{name:'SPY'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Abrir watchlist'}));
  expect(toggle).toHaveBeenCalledTimes(1);
});
