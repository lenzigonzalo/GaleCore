import { regularSessionLabel } from './StatusBar';
import { useMarketStore } from '../../store/useMarketStore';
jest.mock('../../utils/authState',()=>({isAuthUnverified:()=>false}));
jest.mock('../../api/gex',()=>({fetchGexRules:jest.fn(),fetchGexAnalysis:jest.fn()}));
test('el horario no fabrica apertura y respeta ET incluso con DST',()=>{
  const now=new Date('2026-10-09T14:00:00Z');
  expect(regularSessionLabel(now,undefined,true)).toBe('Apertura sin confirmar');
  useMarketStore.setState({tickers:{}});
  useMarketStore.getState().updatePrice('SPY',{price:100,size:1,timestamp:now.toISOString(),extendedTradingHours:false});
  const ticker={...useMarketStore.getState().tickers.SPY,marketStatusReceivedAt:now};
  expect(regularSessionLabel(now,ticker,true)).toBe('Rueda regular abierta');
  expect(regularSessionLabel(new Date('2026-10-10T14:00:00Z'),ticker,true)).toBe('Rueda regular cerrada');
  expect(regularSessionLabel(new Date('2026-10-09T14:02:00Z'),ticker,true)).toBe('Apertura sin confirmar');
  expect(regularSessionLabel(now,ticker,false)).toBe('Apertura sin confirmar');
  expect(regularSessionLabel(new Date('2026-01-09T14:00:00Z'),undefined,true)).toBe('Rueda regular cerrada');
});
test('quotes y fallback REST no renuevan la señal de sesión del proveedor',()=>{
  useMarketStore.setState({tickers:{}});
  const store=useMarketStore.getState();
  store.updatePrice('SPY',{price:100,size:1,timestamp:'2026-10-09T14:00:00Z',extendedTradingHours:false});
  const received=useMarketStore.getState().tickers.SPY.marketStatusReceivedAt;
  store.updateQuote('SPY',{bidPrice:99,askPrice:101,timestamp:'2026-10-09T14:02:00Z'});
  store.updatePrice('SPY',{price:102,size:0,timestamp:'2026-10-09T14:03:00Z'});
  expect(useMarketStore.getState().tickers.SPY.marketStatusReceivedAt).toBe(received);
});

test('recibir ahora un trade viejo, futuro o sin timestamp válido no confirma apertura',()=>{
  const now=new Date('2026-10-09T14:00:00Z');
  useMarketStore.setState({tickers:{}});
  for (const timestamp of ['2026-10-08T14:00:00Z','2026-10-09T14:05:00Z','no-date']) {
    useMarketStore.getState().updatePrice('SPY',{price:100,size:1,timestamp,extendedTradingHours:false});
    const ticker={...useMarketStore.getState().tickers.SPY,marketStatusReceivedAt:now};
    expect(regularSessionLabel(now,ticker,true)).toBe('Apertura sin confirmar');
  }
});
