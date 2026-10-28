import { useGexStore } from './useGexStore';
import { resetUserScopedStores } from './resetUserScoped';
import { fetchGexAnalysis } from '../api/gex';
jest.mock('../api/client',()=>({__esModule:true,default:{get:jest.fn(),post:jest.fn()}}));
jest.mock('../api/gex',()=>({fetchGexAnalysis:jest.fn(),fetchGexRules:jest.fn()}));
test('cambiar de usuario limpia selección y caché GEX; una respuesta anterior no los repuebla',async()=>{
  const universe=['SPY'];
  useGexStore.setState({tickers:universe,selectedSymbol:'TSLA',adHocSymbols:['TSLA'],selectedExpiry:{TSLA:'2026-10-16'},cache:{TSLA:{data:{} as any,updatedAt:new Date()}},loading:{},error:{TSLA:'error anterior'},errorCode:{}});
  let resolve!:(value:any)=>void;
  (fetchGexAnalysis as jest.Mock).mockReturnValueOnce(new Promise(res=>{resolve=res;}));
  const pending=useGexStore.getState().fetchGex('TSLA');
  resetUserScopedStores();
  expect(useGexStore.getState()).toMatchObject({selectedSymbol:null,adHocSymbols:[],cache:{},selectedExpiry:{},loading:{},error:{}});
  expect(useGexStore.getState().tickers).toBe(universe);
  resolve({symbol:'TSLA'});
  await pending;
  expect(useGexStore.getState().cache).toEqual({});
});
