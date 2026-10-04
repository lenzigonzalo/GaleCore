import React from 'react';
import { AccountSummary } from '../account/AccountSummary';
import { AccountPositionsList } from '../account/AccountPositionsList';

interface Props {
  /** Click en el logo → vuelve a la pestaña Main. */
  onLogoClick?: () => void;
}

export function Sidebar({ onLogoClick }: Props) {
  return (
    <aside className="dashboard-sidebar" style={{
      width: 270,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-primary)',
      borderRight: '1px solid var(--border-dark)',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Logo — height matches StatusBar + TabNav (40 + 60 = 100px) */}
      <div
        onClick={onLogoClick}
        title={onLogoClick ? 'Ir a Main' : undefined}
        role={onLogoClick ? 'button' : undefined}
        style={{
          height: 100,
          padding: '0 10px',
          borderBottom: '1px solid var(--border-dark)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: onLogoClick ? 'pointer' : 'default',
        }}
      >
        <img
          src="/logo-galecore.png"
          alt="GaleCore"
          style={{ width: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* Account — always visible */}
      <div style={{
        padding: '12px 10px',
        flex: 1,
        overflowY: 'auto',
      }}>
        <AccountSummary />
        <AccountPositionsList />
      </div>
    </aside>
  );
}
