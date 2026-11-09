import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ColumnsMenu, TickerWatchlist } from './TickerWatchlist';
import { readHiddenColumns } from './watchlistColumns';
import { TickerState } from '../../types/market';
import { PremarketQuote } from '../../api/marketdata';

// Datos sintéticos de prueba; no son snapshots de mercado ni evidencia en vivo.
const ticker: TickerState = {
  symbol: 'SPY', price: 101, open: 90, prevClose: 100, bid: 100, ask: 102,
  lastUpdate: null, isStreaming: false,
  loading: { price: false, ivRank: false, iv: false, gex: false }, error: {},
};

test('cancelar limpia la marca y un arrastre externo no edita la watchlist', () => {
  const actions = {onMove:jest.fn(), onMoveGroup:jest.fn(), onRename:jest.fn(), onDelete:jest.fn()};
  render(<TickerWatchlist tickers={[ticker]} selectedSymbol={null} onSelect={jest.fn()}
    sections={[{label:'ETF',symbols:['SPY']},{label:'Vacío',symbols:[]}]} groupActions={actions}/>);
  const source = screen.getByRole('button',{name:'SPY'}).closest('tr')!;
  const target = screen.getByRole('button',{name:'Vacío'}).closest('tr')!;
  const dataTransfer = {setData:jest.fn(), getData:()=> 'AJENO'};
  fireEvent.dragOver(target,{dataTransfer});
  fireEvent.drop(target,{dataTransfer});
  expect(actions.onMove).not.toHaveBeenCalled();
  fireEvent.dragStart(source,{dataTransfer});
  fireEvent.dragOver(target,{dataTransfer});
  expect(target).toHaveClass('watchlist-drop-after');
  fireEvent.dragEnd(source,{dataTransfer});
  expect(target).not.toHaveClass('watchlist-drop-after');
  fireEvent.drop(target,{dataTransfer});
  expect(actions.onMove).not.toHaveBeenCalled();
  expect(actions.onMoveGroup).not.toHaveBeenCalled();
});

test('no sustituye cierre previo por apertura ni inventa cambio sin precio', () => {
  const { rerender } = render(<TickerWatchlist tickers={[{ ...ticker, prevClose: undefined }]}
    selectedSymbol={null} onSelect={() => {}} />);
  const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
  expect(cells[0]).toHaveTextContent('101.00');
  expect(cells[1]).toHaveTextContent('—');
  expect(cells[2]).toHaveTextContent('—');
  rerender(<TickerWatchlist tickers={[{ ...ticker, price: 0, error: { price: 'Fuente no disponible' } }]}
    selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByText('Sin datos')).toHaveAttribute('title', 'Fuente no disponible');
  expect(cells[1]).toHaveTextContent('—');
});

test('muestra cambio contra cierre y conserva selección y retiro como acciones distintas', () => {
  const select = jest.fn(); const remove = jest.fn();
  render(<TickerWatchlist tickers={[ticker]} selectedSymbol="SPY" onSelect={select}
    removableSymbols={['SPY']} onRemoveSymbol={remove} />);
  expect(screen.getByText('+1.00')).toBeInTheDocument();
  expect(screen.getByText('+1.00%')).toBeInTheDocument();
  const symbol = screen.getByRole('button', { name: 'SPY' });
  expect(symbol).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(symbol); expect(select).toHaveBeenCalledWith(null);
  select.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Quitar SPY del seguimiento' }));
  expect(remove).toHaveBeenCalledWith('SPY'); expect(select).not.toHaveBeenCalled();
});

test('no ofrece retirar instrumentos del universo y distingue recepción de origen', () => {
  render(<TickerWatchlist tickers={[ticker]} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Recepción (ET)' })).toBeInTheDocument();
  expect(screen.getByText(/La hora indica recepción, no origen/)).toBeInTheDocument();
});

test('un error posterior no oculta el último precio disponible',()=>{
  render(<TickerWatchlist tickers={[{...ticker,error:{price:'Falló el refresco'}}]}
    selectedSymbol={null} onSelect={()=>{}}/>);
  expect(screen.getByText('101.00')).toHaveAttribute('title','Falló el refresco');
});

const premarket: PremarketQuote = {
  symbol: 'SPY', price: 98, previousClose: 100, changePercent: -2,
  timestamp: new Date().toISOString(), session: 'premarket', sessionDate: '2026-10-30',
  source: 'DXLink TradeETH/Summary', freshness: 'fresh', reason: null,
};

test('premarket compacto conserva cambio regular y guarda origen y hora en el tooltip', () => {
  render(<TickerWatchlist tickers={[ticker]} premarket={{ SPY: premarket }} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByRole('columnheader', { name: 'Premarket' })).toBeInTheDocument();
  expect(screen.getByText('+1.00%')).toBeInTheDocument();
  expect(screen.getByText('-2.00%')).toBeInTheDocument();
  const cell = screen.getByText('-2.00%').closest('td')!;
  expect(cell).toHaveAttribute('title', expect.stringContaining('contra cierre regular anterior 100'));
  expect(cell).toHaveAttribute('title', expect.stringContaining(premarket.timestamp!));
  expect(cell).toHaveTextContent(/^-2.00%$/);
  expect(cell.querySelector('small, time')).toBeNull();
});

test('sin computar queda vacío; cero real se muestra como guion', () => {
  const { rerender } = render(<TickerWatchlist tickers={[ticker]} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByLabelText('Premarket no computado')).toBeEmptyDOMElement();
  expect(screen.queryByText('+0.00%')).not.toBeInTheDocument();
  rerender(<TickerWatchlist tickers={[ticker]} premarket={{ SPY: { ...premarket, timestamp: null } }} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByLabelText('Premarket no computado')).toBeEmptyDOMElement();
  rerender(<TickerWatchlist tickers={[ticker]} premarket={{ SPY: { ...premarket, changePercent: 0 } }} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByText('-')).toBeInTheDocument();
});

test.each([
  { ...premarket, freshness: 'stale' as const },
  { ...premarket, timestamp: '2026-01-01T13:00:00Z' },
])('premarket viejo conserva el valor con estado explícito', quote => {
  render(<TickerWatchlist tickers={[ticker]} premarket={{ SPY: quote }} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByText('-2.00%')).toBeInTheDocument();
  expect(screen.getByText('-2.00%').closest('td')).toHaveAttribute('title', expect.stringContaining('Dato viejo'));
});

test('fallo posterior marca viejo el premarket conservado', () => {
  render(<TickerWatchlist tickers={[ticker]} premarket={{ SPY: premarket }} premarketError selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByText('-2.00%').closest('td')).toHaveAttribute('title', expect.stringContaining('Falló la actualización'));
});

test('precio premarket sin cierre conserva hora y explica por qué no hay porcentaje', () => {
  render(<TickerWatchlist tickers={[ticker]} premarket={{ SPY: { ...premarket, previousClose: null, changePercent: null,
    reason: 'missing_previous_regular_close' } }} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByText('-')).toHaveAttribute('title', expect.stringContaining('cierre regular anterior no disponible'));
  expect(screen.queryByText('98.00')).toBeNull();
  expect(screen.queryByText('-2.00%')).toBeNull();
});

test('sin operación premarket explica el estado sin sustituir por el precio regular', () => {
  render(<TickerWatchlist tickers={[ticker]} premarket={{ SPY: { ...premarket, session: 'unavailable',
    price: null, changePercent: null, reason: 'not_premarket_trade' } }} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByLabelText('Último trade fuera de premarket')).toBeEmptyDOMElement();
  expect(screen.queryByText('Sin dato')).toBeNull();
  expect(screen.getByText('+1.00%')).toBeInTheDocument();
});

test('clic en el precio de la fila abre el símbolo; los botones de la fila no lo duplican', () => {
  const onSelect = jest.fn();
  render(<TickerWatchlist tickers={[ticker]} selectedSymbol={null} onSelect={onSelect}/>);
  fireEvent.click(screen.getByText('101.00', { exact: false }));
  expect(onSelect).toHaveBeenCalledWith('SPY');
  onSelect.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'SPY' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test('el menú de columnas lista lo visible y la tabla oculta lo elegido; el símbolo queda siempre', () => {
  const onToggle = jest.fn();
  render(<><ColumnsMenu hidden={['premarket', 'chgPct']} onToggle={onToggle}/>
    <TickerWatchlist tickers={[ticker]} selectedSymbol={null} onSelect={jest.fn()} showPremarket={false} hiddenColumns={['premarket', 'chgPct']}/></>);
  expect(screen.queryByRole('columnheader', { name: 'Chg%' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Chg' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'SPY' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Columnas' }));
  const menu = screen.getByRole('group', { name: 'Columnas visibles' });
  expect(within(menu).getByLabelText('Premarket')).not.toBeChecked();
  expect(within(menu).getByLabelText('Precio (Last)')).toBeChecked();
  fireEvent.click(within(menu).getByLabelText('Variación % (Chg%)'));
  expect(onToggle).toHaveBeenCalledWith('chgPct');
});

test('sin preferencia guardada Premarket arranca oculta y lo demás visible', () => {
  expect(readHiddenColumns([])).toEqual(['premarket']);
  expect(readHiddenColumns([{ kind: 'preference', key: 'watchlist-columnas', content: '{"hidden":["chg","otra"]}' } as any])).toEqual(['chg']);
});
