import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextSizeKind, TextSizeSettings, useApplyTextSizes, useTextSize } from './TextSizeSettings';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';
jest.mock('../../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));
const preference = (key: string, content: string) => [{ kind: 'preference', key, content } as SpaceItem];
function Size({ kind }: { kind: TextSizeKind }) { return <output data-testid={kind}>{useTextSize(kind) ?? 'default'}</output>; }
const type = (label: RegExp, value: string) => { const input = screen.getByLabelText(label); fireEvent.change(input, { target: { value } }); fireEvent.blur(input); };
function Apply() { useApplyTextSizes(); return null; }
beforeEach(() => { jest.clearAllMocks(); (fetchSpace as jest.Mock).mockResolvedValue({ items: [] }); });

test('sin preferencia o con una preferencia rota quedan los predeterminados', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: preference('tamano-chat', '{broken') });
  render(<><TextSizeSettings items={[]} onChanged={() => {}}/><Size kind="chat"/></>);
  for (const label of ['Watchlist', 'Chat']) expect(screen.getByLabelText(new RegExp('^' + label))).toHaveValue(null);
  expect(screen.queryByLabelText(/^General/)).toBeNull();
  await waitFor(() => expect(fetchSpace).toHaveBeenCalled());
  expect(screen.getByTestId('chat')).toHaveTextContent('default');
});

test('acepta cualquier número del rango, lo guarda como preferencia privada y actualiza al instante', async () => {
  (saveSpaceItem as jest.Mock).mockResolvedValue({});
  const changed = jest.fn();
  render(<><TextSizeSettings items={[]} onChanged={changed}/><Size kind="chat"/><Size kind="watchlist"/></>);
  type(/^Chat/, '20');
  await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('20'));
  expect(saveSpaceItem).toHaveBeenCalledWith('preference', 'tamano-chat', expect.objectContaining({ content: '{"size":20}', visibility: 'private' }));
  type(/^Watchlist/, '12');
  await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('12'));
  expect(saveSpaceItem).toHaveBeenCalledWith('preference', 'tamano-watchlist', expect.objectContaining({ content: '{"size":12}' }));
  expect(changed).toHaveBeenCalledTimes(2);
});

test('lo guardado de antes se conserva y si falla el guardado no cambia nada', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: preference('tamano-chat', '{"size":22}') });
  (saveSpaceItem as jest.Mock).mockRejectedValue(new Error('offline'));
  const changed = jest.fn();
  render(<><TextSizeSettings items={preference('tamano-chat', '{"size":22}')} onChanged={changed}/><Size kind="chat"/></>);
  await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('22'));
  type(/^Chat/, '14');
  await screen.findByText('No se pudo guardar');
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByTestId('chat')).toHaveTextContent('22');
  expect(screen.getByLabelText(/^Chat/)).toHaveValue(22);
});

test('Watchlist se aplica en la raíz y una preferencia vieja de General ya no escala la plataforma', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [...preference('tamano-general', '{"size":20}'), ...preference('tamano-watchlist', '{"size":12}')] });
  render(<Apply/>);
  const root = document.documentElement;
  await waitFor(() => expect(root.style.getPropertyValue('--watchlist-font-size')).toBe('12px'));
  expect(root.style.getPropertyValue('zoom')).toBe('');
});

test('fuera de rango no guarda y vacío vuelve al predeterminado', async () => {
  (saveSpaceItem as jest.Mock).mockResolvedValue({});
  render(<><TextSizeSettings items={preference('tamano-watchlist', '{"size":15}')} onChanged={() => {}}/><Size kind="watchlist"/></>);
  type(/^Watchlist/, '40');
  expect(await screen.findByText('Entre 9 y 24')).toBeInTheDocument();
  expect(saveSpaceItem).not.toHaveBeenCalled();
  type(/^Watchlist/, '');
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledWith('preference', 'tamano-watchlist', expect.objectContaining({ content: '{"size":null}' })));
  await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('default'));
});

