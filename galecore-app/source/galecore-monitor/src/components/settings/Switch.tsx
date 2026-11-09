import React from 'react';

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (next: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="pref-switch" onClick={() => onChange(!on)}><i/></button>;
}
