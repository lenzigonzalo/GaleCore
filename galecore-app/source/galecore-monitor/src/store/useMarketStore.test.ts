import { useMarketStore } from './useMarketStore';

beforeEach(()=>useMarketStore.setState({tickers:{}}));

test('un trade vacío no borra el último precio válido ni su recepción',()=>{
  const store=useMarketStore.getState();
  store.updatePrice('SPY',{price:101,size:0,timestamp:'2026-10-12T20:00:00Z'},false);
  const previous=useMarketStore.getState().tickers.SPY;
  for (const price of [0,-1,NaN,Infinity]) {
    store.updatePrice('SPY',{price,size:0,timestamp:'2026-10-13T00:00:00Z'});
    expect(useMarketStore.getState().tickers.SPY).toBe(previous);
  }
  store.updatePrice('SPY',{price:102,size:1,timestamp:'2026-10-13T13:30:00Z'});
  expect(useMarketStore.getState().tickers.SPY).toMatchObject({price:102,isStreaming:true});
});
