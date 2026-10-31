import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useGexStore as mockUseGexStore } from './store/useGexStore';

jest.mock('./auth/supabase', () => ({getSession:async()=>({user:{id:'test'}}),supabase:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}})}}}));
jest.mock('./api/rules', () => ({fetchAppConfig:async()=>({})}));
jest.mock('./api/account', () => ({fetchBalances:async()=>[],fetchPositions:async()=>[],describeAccountError:()=>''}));
jest.mock('./api/space', () => ({fetchSpace:async()=>({items:[]})}));
jest.mock('./api/terminal', () => ({fetchProviderAuth:async()=>({providers:[]})}));
jest.mock('./store/useCurrentUserStore', () => ({useCurrentUserStore:(select:any)=>select({reload:()=>{}})}));
jest.mock('./store/useAppConfigStore', () => ({useAppConfigStore:()=>({setConfig:()=>{},setLoading:()=>{},setError:()=>{},tickers:[]})}));
jest.mock('./socket/useMarketSocket', () => ({useMarketSocket:()=>({status:'disconnected'})}));
jest.mock('./components/settings/SettingsModal', () => ({SettingsModal:()=>null,needsSetup:()=>false}));
jest.mock('./components/layout/StatusBar', () => ({StatusBar:()=>null}));
jest.mock('./components/layout/WorkspaceHeader', () => ({WorkspaceHeader:({onSymbol}:any)=><button onClick={()=>onSymbol('QQQ')}>QQQ en buscador</button>}));
jest.mock('./components/layout/WorkspaceNav', () => ({WorkspaceNav:({onChange}:any)=><nav>
  {['inicio','gex','lab'].map(tab=><button key={tab} onClick={()=>onChange(tab)}>{tab}</button>)}
</nav>}));
jest.mock('./pages/Resumen', () => ({Resumen:()=> <h1>Inicio del usuario</h1>}));
jest.mock('./pages/Macro', () => ({Macro:()=>null}));
jest.mock('./pages/Biblioteca', () => ({Biblioteca:()=>null}));
jest.mock('./pages/Lab', () => ({Lab:()=> <h1>Chat del usuario</h1>}));
jest.mock('./pages/Admin', () => ({Admin:()=>null}));
jest.mock('./pages/Rpf', () => ({Rpf:()=>null}));
jest.mock('./pages/Shadow', () => ({Shadow:()=> <h1>Estrategias del usuario</h1>}));
jest.mock('./pages/Agentes', () => ({Agentes:()=>null}));
// Las interacciones internas reales se prueban en LiveWatchlist.test y Gex.test.
jest.mock('./components/ticker/LiveWatchlist', () => ({LiveWatchlist:({onSelect}:any)=><>
  {['SPY','AAPL'].map(symbol=><button key={symbol} onClick={()=>{mockUseGexStore.getState().setSelectedSymbol(symbol);onSelect();}}>{symbol} en watchlist</button>)}
</>}));
jest.mock('./pages/Gex', () => ({Gex:({indicator,onIndicatorChange}:any)=><section aria-label="Mercado activo">
  {mockUseGexStore(s=>s.selectedSymbol)} {indicator}<button onClick={()=>onIndicatorChange('price')}>Precio</button><button onClick={()=>onIndicatorChange('gamma')}>Gamma</button><button onClick={()=>onIndicatorChange('iv')}>IV</button>
</section>}));

beforeEach(() => sessionStorage.clear());

test('watchlist abre Precio desde Inicio y Lab y conserva el indicador al cambiar ticker dentro de Mercado', async () => {
  mockUseGexStore.setState({selectedSymbol:null,tickers:['SPY','AAPL','QQQ'],rules:{} as any,rulesError:null});
  render(<App/>);
  await screen.findByText('Inicio del usuario');
  fireEvent.click(screen.getByRole('button',{name:'SPY en watchlist'}));
  expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('price');
  for (const [label,indicator] of [['Gamma','gamma'],['IV','iv'],['Precio','price']]) {
    fireEvent.click(screen.getByRole('button',{name:label}));
    fireEvent.click(screen.getByRole('button',{name:'AAPL en watchlist'}));
    expect(screen.getByLabelText('Mercado activo')).toHaveTextContent(`AAPL ${indicator}`);
    fireEvent.click(screen.getByRole('button',{name:'SPY en watchlist'}));
    expect(screen.getByLabelText('Mercado activo')).toHaveTextContent(`SPY ${indicator}`);
  }
  fireEvent.click(screen.getByRole('button',{name:'lab'}));
  expect(screen.getByText('Chat del usuario')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'SPY en watchlist'}));
  expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('price');
  fireEvent.click(screen.getByRole('button',{name:'inicio'}));
  fireEvent.click(screen.getByRole('button',{name:'gex'}));
  expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('gamma');
});

test('recargar conserva Chat y monta su contenido sin pasar por Inicio', async () => {
  const first = render(<App/>);
  await screen.findByText('Inicio del usuario');
  fireEvent.click(screen.getByRole('button', { name: 'lab' }));
  expect(screen.getByText('Chat del usuario')).toBeVisible();
  first.unmount();
  render(<App/>);
  expect(await screen.findByText('Chat del usuario')).toBeVisible();
  expect(screen.queryByText('Inicio del usuario')).not.toBeInTheDocument();
});

test('recargar Estrategias monta la pantalla restaurada', async () => {
  sessionStorage.setItem('galecore:screen:test', 'estrategias');
  render(<App/>);
  expect(await screen.findByText('Estrategias del usuario')).toBeVisible();
  expect(screen.queryByText('Inicio del usuario')).not.toBeInTheDocument();
});

test.each(['pantalla-inexistente', 'config'])('una pantalla guardada inválida (%s) vuelve a Inicio', async saved => {
  sessionStorage.setItem('galecore:screen:test', saved);
  render(<App/>);
  expect(await screen.findByText('Inicio del usuario')).toBeVisible();
});

test('no restaura la pantalla guardada de otra persona', async () => {
  sessionStorage.setItem('galecore:screen:other-user', 'lab');
  render(<App/>);
  expect(await screen.findByText('Inicio del usuario')).toBeVisible();
  expect(screen.queryByText('Chat del usuario')).not.toBeInTheDocument();
});

test('el buscador conserva Gamma e IV dentro de Mercado y abre Precio desde otra pantalla', async () => {
  mockUseGexStore.setState({selectedSymbol:'SPY',tickers:['SPY','QQQ'],rules:{} as any,rulesError:null});
  render(<App/>);
  await screen.findByText('Inicio del usuario');
  fireEvent.click(screen.getByRole('button',{name:'QQQ en buscador'}));
  await waitFor(()=>expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('QQQ price'));
  for (const [label,indicator] of [['Gamma','gamma'],['IV','iv'],['Precio','price']]) {
    fireEvent.click(screen.getByRole('button',{name:label}));
    fireEvent.click(screen.getByRole('button',{name:'SPY en watchlist'}));
    fireEvent.click(screen.getByRole('button',{name:'QQQ en buscador'}));
    await waitFor(()=>expect(screen.getByLabelText('Mercado activo')).toHaveTextContent(`QQQ ${indicator}`));
  }
  fireEvent.click(screen.getByRole('button',{name:'lab'}));
  fireEvent.click(screen.getByRole('button',{name:'QQQ en buscador'}));
  await waitFor(()=>expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('QQQ price'));
});
