import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

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
jest.mock('./components/layout/WorkspaceHeader', () => ({WorkspaceHeader:()=>null}));
jest.mock('./components/layout/WorkspaceNav', () => ({WorkspaceNav:({onChange}:any)=><nav>
  {['inicio','gex','lab'].map(tab=><button key={tab} onClick={()=>onChange(tab)}>{tab}</button>)}
</nav>}));
jest.mock('./pages/Resumen', () => ({Resumen:()=> <h1>Inicio del usuario</h1>}));
jest.mock('./pages/Macro', () => ({Macro:()=>null}));
jest.mock('./pages/Biblioteca', () => ({Biblioteca:()=>null}));
jest.mock('./pages/Lab', () => ({Lab:()=> <h1>Chat del usuario</h1>}));
jest.mock('./pages/Admin', () => ({Admin:()=>null}));
jest.mock('./pages/Rpf', () => ({Rpf:()=>null}));
jest.mock('./pages/Shadow', () => ({Shadow:()=>null}));
jest.mock('./pages/Agentes', () => ({Agentes:()=>null}));
// Las interacciones internas reales se prueban en LiveWatchlist.test y Gex.test.
jest.mock('./components/ticker/LiveWatchlist', () => ({LiveWatchlist:({onSelect}:any)=><button onClick={onSelect}>SPY en watchlist</button>}));
jest.mock('./pages/Gex', () => ({Gex:({indicator,onIndicatorChange}:any)=><section aria-label="Mercado activo">
  {indicator}<button onClick={()=>onIndicatorChange('gamma')}>Gamma</button><button onClick={()=>onIndicatorChange('iv')}>IV</button>
</section>}));

test('watchlist abre Precio desde Inicio y Lab y vuelve a Precio desde Gamma o IV', async () => {
  render(<App/>);
  await screen.findByText('Inicio del usuario');
  fireEvent.click(screen.getByRole('button',{name:'SPY en watchlist'}));
  expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('price');
  for (const indicator of ['Gamma','IV']) {
    fireEvent.click(screen.getByRole('button',{name:indicator}));
    fireEvent.click(screen.getByRole('button',{name:'SPY en watchlist'}));
    expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('price');
  }
  fireEvent.click(screen.getByRole('button',{name:'lab'}));
  expect(screen.getByText('Chat del usuario')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'SPY en watchlist'}));
  expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('price');
  fireEvent.click(screen.getByRole('button',{name:'inicio'}));
  fireEvent.click(screen.getByRole('button',{name:'gex'}));
  expect(screen.getByLabelText('Mercado activo')).toHaveTextContent('gamma');
});
