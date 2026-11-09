import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clearSuggestionsCache, LabSuggestions, SUGGESTIONS_KEY } from './LabSuggestions';
import apiClient from '../../api/client';
import { fetchSpace } from '../../api/space';
jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));

const spy = { id: 'move-SPY', kind: 'move', title: 'SPY baja', value: '−1,12 %', tone: 'down', series: [3, 2, 1], asOf: 'hoy',
  question: 'SPY baja 1,12 % hoy: ayudame a entender qué está pasando.' };
const pref = (enabled: boolean) => ({ kind: 'preference', key: SUGGESTIONS_KEY, title: '', content: JSON.stringify({ enabled }) });

beforeEach(() => { jest.clearAllMocks(); clearSuggestionsCache(); });

test('prendidas por el usuario, un clic manda la pregunta', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [pref(true)], shared: [] });
  (apiClient.get as jest.Mock).mockResolvedValue({ data: { items: [spy] } });
  const onPick = jest.fn();
  render(<LabSuggestions onPick={onPick}/>);
  fireEvent.click(await screen.findByRole('button', { name: /SPY baja/ }));
  expect(onPick).toHaveBeenCalledWith(spy.question);
});

test('volver a montarlas reusa la consulta', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [pref(true)], shared: [] });
  (apiClient.get as jest.Mock).mockResolvedValue({ data: { items: [spy] } });
  const first = render(<LabSuggestions onPick={jest.fn()}/>);
  await screen.findByRole('button', { name: /SPY baja/ });
  first.unmount();
  render(<LabSuggestions onPick={jest.fn()}/>);
  await screen.findByRole('button', { name: /SPY baja/ });
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('sin preferencia o con el JSON roto están apagadas', async () => {
  for (const items of [[], [{ ...pref(true), content: '{roto' }]]) {
    clearSuggestionsCache();
    (fetchSpace as jest.Mock).mockResolvedValue({ items, shared: [] });
    const { container, unmount } = render(<LabSuggestions onPick={jest.fn()}/>);
    await waitFor(() => expect(fetchSpace).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    unmount();
  }
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('apagadas no consultan la API ni muestran nada', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [pref(false)], shared: [] });
  const { container } = render(<LabSuggestions onPick={jest.fn()}/>);
  await waitFor(() => expect(fetchSpace).toHaveBeenCalled());
  await new Promise(r => setTimeout(r, 0));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});
