import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatFontSetting, useChatFontSize } from './ChatFontSetting';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';
jest.mock('../../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));
const preference = (content: string) => [{ kind: 'preference', key: 'tamano-chat', content } as SpaceItem];
function Chat() { return <output data-testid="size">{useChatFontSize() || 'default'}</output>; }
beforeEach(() => { jest.clearAllMocks(); (fetchSpace as jest.Mock).mockResolvedValue({ items: [] }); });

test('missing or malformed preference preserves the existing defaults', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: preference('{broken') });
  render(<><ChatFontSetting items={[]} onChanged={() => {}}/><Chat/></>);
  expect(screen.getByLabelText(/^Tamaño del texto del chat/)).toHaveValue('');
  await waitFor(() => expect(fetchSpace).toHaveBeenCalled());
  expect(screen.getByTestId('size')).toHaveTextContent('default');
});

test('saves a private preference and updates the mounted chat without reload', async () => {
  (saveSpaceItem as jest.Mock).mockResolvedValue({});
  const changed = jest.fn();
  render(<><ChatFontSetting items={[]} onChanged={changed}/><Chat/></>);
  fireEvent.change(screen.getByLabelText(/^Tamaño del texto del chat/), { target: { value: '20' } });
  await waitFor(() => expect(screen.getByTestId('size')).toHaveTextContent('20px'));
  expect(saveSpaceItem).toHaveBeenCalledWith('preference', 'tamano-chat', expect.objectContaining({ content: '{"size":20}', visibility: 'private' }));
  expect(changed).toHaveBeenCalled();
});

test('loads the saved size and retains it when saving fails', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: preference('{"size":22}') });
  (saveSpaceItem as jest.Mock).mockRejectedValue(new Error('offline'));
  const changed = jest.fn();
  render(<><ChatFontSetting items={preference('{"size":22}')} onChanged={changed}/><Chat/></>);
  await waitFor(() => expect(screen.getByTestId('size')).toHaveTextContent('22px'));
  fireEvent.change(screen.getByLabelText(/^Tamaño del texto del chat/), { target: { value: '14' } });
  await screen.findByText('No se pudo guardar');
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByTestId('size')).toHaveTextContent('22px');
  expect(screen.getByLabelText(/^Tamaño del texto del chat/)).toHaveValue('22');
});

