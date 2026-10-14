import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useAccountStore } from '../../store/useAccountStore';
import { fetchBalances, fetchPositions, describeAccountError } from '../../api/account';
import { fmtCurrency, fmtTime, isStale } from '../../utils/formatters';

export function AccountSummary({ layout = 'compact' }: { layout?: 'compact' | 'strip' }) {
  const {
    balances,
    loadingBalances,
    errorBalances,
    lastUpdate,
    setBalances,
    setPositions,
    setLoadingBalances,
    setLoadingPositions,
    setErrorBalances,
    failPositions,
  } = useAccountStore();

  const stale = isStale(lastUpdate);

  const handleRefresh = () => {
    setLoadingBalances(true);
    fetchBalances()
      .then(setBalances)
      .catch((e) => setErrorBalances(describeAccountError(e)))
      .finally(() => setLoadingBalances(false));

    setLoadingPositions(true);
    fetchPositions()
      .then(setPositions)
      .catch(failPositions)
      .finally(() => setLoadingPositions(false));
  };

  return (
    <div
      className="rounded p-3"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-dark)',
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Cuenta{balances?.accountNumber ? ` · ${balances.accountNumber}` : ''}
        </span>
        <button
          onClick={handleRefresh}
          disabled={loadingBalances}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
          style={{
            color: 'var(--text-muted)',
            background: 'none',
            border: '1px solid var(--border-dark)',
            cursor: 'pointer',
          }}
          title={lastUpdate ? `Actualizar cuenta · Lectura ${fmtTime(lastUpdate)} ET` : 'Actualizar cuenta'} aria-label="Actualizar cuenta"
        >
          <RefreshCw size={14} className={loadingBalances ? 'animate-spin' : ''} />
        </button>
      </div>

      {errorBalances ? (
        <div className="text-xs" style={{ color: 'var(--red-gc)' }}>
          {errorBalances}
        </div>
      ) : loadingBalances ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-3 rounded animate-pulse"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          ))}
        </div>
      ) : balances ? (
        <div className={layout === 'strip' ? 'account-values-strip' : 'space-y-1.5'}>
          <Row label="Valor de la cuenta · USD" value={fmtCurrency(balances.netLiquidatingValue)} highlight />
          <Row label="Poder de compra" value={fmtCurrency(balances.buyingPower)} />
          <Row label="Efectivo" value={fmtCurrency(balances.cash)} />
        </div>
      ) : (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Sin lectura de la cuenta
        </div>
      )}

      {/* Timestamp */}
      {lastUpdate && stale && (
        <div
          className="text-xs mt-2"
          style={{ color: stale ? 'var(--yellow-gc)' : 'var(--text-muted)' }}
        >
          Cuenta sin actualizar
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? "flex flex-col gap-1 mb-3" : "flex items-center justify-between gap-2"}>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span
        className="font-mono text-sm"
        style={{ color: highlight ? 'var(--text-primary)' : 'var(--text-primary)', fontWeight: highlight ? 700 : 500, fontSize: highlight ? 28 : 16, lineHeight: 1.3, overflowWrap: 'anywhere' }}
      >
        {value}
      </span>
    </div>
  );
}
