import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabFilePreview } from './LabFilePreview';
import { labRaw } from '../../api/lab';

jest.mock('../../api/lab', () => ({ labRaw: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  (global.URL as any).createObjectURL = jest.fn(() => 'blob:x');
  (global.URL as any).revokeObjectURL = jest.fn();
});

test('un html se ve en un iframe aislado, sin allow-same-origin, y Código muestra el texto', () => {
  const { container } = render(<LabFilePreview projectId="p" path="files/t.html" text="<h1>hola</h1>" />);
  const frame = container.querySelector('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups');
  expect(frame.getAttribute('sandbox')).not.toMatch(/allow-same-origin/);
  expect(frame.getAttribute('srcdoc')).toBe('<h1>hola</h1>');
  fireEvent.click(screen.getByRole('button', { name: 'Código' }));
  expect(container.querySelector('iframe')).toBeNull();
  expect(screen.getByText('<h1>hola</h1>')).toBeInTheDocument();
});

test('una imagen se pide por raw y se muestra en un img', async () => {
  (labRaw as jest.Mock).mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  render(<LabFilePreview projectId="p" path="files/g.png" />);
  const img = await screen.findByRole('img');
  expect(img).toHaveAttribute('src', 'blob:x');
  expect(labRaw).toHaveBeenCalledWith('p', 'files/g.png');
});
