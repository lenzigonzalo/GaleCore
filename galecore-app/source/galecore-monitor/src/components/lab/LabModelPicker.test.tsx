import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LabModelPicker } from './LabModelPicker';
const providers = [{ id: 'claude' as const, label: 'Claude', installed: true }, { id: 'codex' as const, label: 'Codex', installed: true }];
const options = { claude: { models: ['sonnet', 'opus', 'haiku'], efforts: ['medium', 'high'], defaultModel: 'sonnet' }, codex: { models: ['test-model'], efforts: ['high', 'ultra'], modelEfforts: { 'test-model': ['high'] } } };

test('menu escapes clipping ancestors, opens above a bottom trigger, and adapts on resize', () => {
  const { container } = render(<LabModelPicker provider="claude" model="sonnet" effort="medium" providers={providers} options={options} locked={false} onChange={jest.fn()}/>);
  const trigger = screen.getByRole('button', { name: 'Proveedor y modelo: Claude - Sonnet' });
  const rect = jest.spyOn(trigger, 'getBoundingClientRect');
  rect.mockReturnValue({ top: window.innerHeight - 50, bottom: window.innerHeight - 20, right: 300 } as DOMRect);
  fireEvent.click(trigger);
  const menu = screen.getByRole('dialog');
  expect(container.contains(menu)).toBe(false);
  expect(menu.style.bottom).toBe('58px');
  expect(menu.style.left).toBe('16px');
  rect.mockReturnValue({ top: 20, bottom: 50, right: 300 } as DOMRect);
  fireEvent(window, new Event('resize'));
  expect(menu.style.top).toBe('58px');
  expect(menu.style.bottom).toBe('');
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('combined provider/model selection returns a valid effort and closes the popup', () => {
  const onChange=jest.fn();
  render(<LabModelPicker provider="claude" model="sonnet" effort="medium" providers={providers} options={options} locked={false} onChange={onChange}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Proveedor y modelo: Claude - Sonnet' }));
  fireEvent.click(screen.getByRole('option', { name: 'Codex — test-model' }));
  expect(onChange).toHaveBeenCalledWith({ provider:'codex',model:'test-model',effort:'' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('existing conversations remain locked and Escape returns focus to the header trigger', () => {
  const onChange=jest.fn();
  render(<LabModelPicker provider="claude" model="opus" effort="high" providers={providers} options={options} locked onChange={onChange}/>);
  const trigger=screen.getByRole('button', { name:'Proveedor y modelo: Claude - Opus' });
  fireEvent.click(trigger);
  const choice=screen.getByRole('option', { name:'Claude — Sonnet' });
  expect(choice).toBeDisabled();fireEvent.click(choice);expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();expect(trigger).toHaveFocus();
});
test('unavailable providers cannot be selected and Haiku clears effort', () => {
  const onChange=jest.fn();
  render(<LabModelPicker provider="claude" model="opus" effort="high" providers={[providers[0]]} options={options} locked={false} onChange={onChange}/>);
  fireEvent.click(screen.getByRole('button', { name:'Proveedor y modelo: Claude - Opus' }));
  expect(screen.getByRole('option', { name:'Codex — test-model' })).toBeDisabled();
  fireEvent.click(screen.getByRole('option', { name:'Claude — Haiku' }));
  expect(onChange).toHaveBeenCalledWith({provider:'claude',model:'haiku',effort:''});
});
test('effort is its own control next to the model, disabled for Haiku and when locked', () => {
  const onChange = jest.fn();
  const { rerender } = render(<LabModelPicker provider="claude" model="opus" effort="high" providers={providers} options={options} locked={false} onChange={onChange}/>);
  const select = screen.getByRole('combobox', { name: 'Esfuerzo de la conversación' });
  expect(select).toHaveValue('high');
  fireEvent.change(select, { target: { value: 'medium' } });
  expect(onChange).toHaveBeenCalledWith({ provider: 'claude', model: 'opus', effort: 'medium' });
  rerender(<LabModelPicker provider="claude" model="haiku" effort="" providers={providers} options={options} locked={false} onChange={onChange}/>);
  expect(screen.getByRole('combobox', { name: 'Esfuerzo de la conversación' })).toBeDisabled();
  rerender(<LabModelPicker provider="claude" model="opus" effort="high" providers={providers} options={options} locked onChange={onChange}/>);
  expect(screen.getByRole('combobox', { name: 'Esfuerzo de la conversación' })).toBeDisabled();
});
