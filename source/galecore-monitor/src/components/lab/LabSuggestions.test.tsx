import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabSuggestions, SUGGESTIONS_KEY } from './LabSuggestions';
import apiClient from '../../api/client';
import { fetchSpace } from '../../api/space';
jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));

const spy = { id: 'move-SPY', kind: 'move', title: 'SPY baja', value: '−1,12 %', tone: 'down', series: [3, 2, 1], asOf: 'hoy',
  question: 'SPY baja 1,12 % hoy: ayudame a entender qué está pasando.' };
const pref = (enabled: boolean) => ({ kind: 'preference', key: SUGGESTIONS_KEY, title: '', content: JSON.stringify({ enabled }) });

beforeEach(() => jest.clearAllMocks());

test('sin preferencia están prendidas y un clic manda la pregunta', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
  (apiClient.get as jest.Mock).mockResolvedValue({ data: { items: [spy] } });
  const onPick = jest.fn();
  render(<LabSuggestions onPick={onPick}/>);
  fireEvent.click(await screen.findByRole('button', { name: /SPY baja/ }));
  expect(onPick).toHaveBeenCalledWith(spy.question);
});

test('apagadas no consultan la API ni muestran nada', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [pref(false)], shared: [] });
  const { container } = render(<LabSuggestions onPick={jest.fn()}/>);
  await waitFor(() => expect(fetchSpace).toHaveBeenCalled());
  await new Promise(r => setTimeout(r, 0));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(container).toBeEmptyDOMElement();
});
