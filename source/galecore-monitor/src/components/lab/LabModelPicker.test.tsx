import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LabModelPicker } from './LabModelPicker';
const providers = [{ id: 'claude' as const, label: 'Claude', installed: true }, { id: 'codex' as const, label: 'Codex', installed: true }];
const options = { claude: { models: ['sonnet', 'opus', 'haiku'], efforts: ['medium', 'high'], defaultModel: 'sonnet' }, codex: { models: ['test-model'], efforts: ['high', 'ultra'], modelEfforts: { 'test-model': ['high'] } } };
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
