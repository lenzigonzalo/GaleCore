import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { TradeSuggestion } from '../../types/rpf';
import { tint } from '../../utils/formatters';

interface Props {
  suggestion: TradeSuggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}

// Cuenta regresiva del TTL (createdAt + ttlSeconds). Al llegar a 0, la sugerencia expiró:
// el backend deja de refrescarla y el estado cae a COOLDOWN — la card se desmonta sola.
function useTtlRemaining(createdAt: string, ttlSeconds: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const deadline = new Date(createdAt).getTime() + ttlSeconds * 1000;
  return Math.max(0, Math.round((deadline - now) / 1000));
}

function Leg({ action, strike, delta, streamerSymbol }: TradeSuggestion['legs'][number]) {
  const isSell = action === 'sell';
  const color = isSell ? 'var(--green)' : 'var(--text-secondary)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', color, fontFamily: 'JetBrains Mono, monospace', width: 42 }}>
        {isSell ? 'SELL' : 'BUY'}
      </span>
      <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
        {strike}
      </span>
      {delta != null && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>Δ {Math.abs(delta).toFixed(2)}</span>
      )}
      {streamerSymbol && (
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{streamerSymbol}</span>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: '6px 8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  );
}

export function RpfSuggestionCard({ suggestion: s, onAccept, onDismiss }: Props) {
  const ttl = useTtlRemaining(s.createdAt, s.ttlSeconds);
  const [confirmHighRisk, setConfirmHighRisk] = useState(false);
  const accent = s.highRisk ? 'var(--red-gc)' : 'var(--green)';

  const handleAccept = () => {
    // high_risk exige confirmación reforzada (definición §7.2 / diseño §6).
    if (s.highRisk && !confirmHighRisk) { setConfirmHighRisk(true); return; }
    onAccept(s.id);
  };

  return (
    <div style={{
      backgroundColor: 'var(--bg-secondary)', border: `1px solid ${tint(accent, 45)}`,
      borderRadius: 8, padding: '14px 16px', boxShadow: `0 0 0 1px ${tint(accent, 12)}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: accent, letterSpacing: '0.04em' }}>
          {s.symbol} · PUT CREDIT SPREAD
        </span>
        {s.highRisk && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--red-gc)',
            backgroundColor: tint('var(--red-gc)', 15), border: `1px solid ${tint('var(--red-gc)', 40)}`, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em' }}>
            <AlertTriangle size={10} /> HIGH RISK
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
          color: ttl <= 10 ? 'var(--red-gc)' : 'var(--text-muted)' }}>
          TTL {ttl}s
        </span>
      </div>

      {/* Legs */}
      <div style={{ borderTop: '1px solid var(--border-dark)', borderBottom: '1px solid var(--border-dark)', padding: '4px 0', marginBottom: 10 }}>
        {s.legs.map((l, i) => <Leg key={i} {...l} />)}
      </div>

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
        <Metric label="Crédito" value={`$${s.credit.toFixed(2)}`} />
        <Metric label="Ancho" value={`$${s.width}`} />
        <Metric label="Edge" value={s.edgeEmp != null ? `${s.edgeEmp.toFixed(2)}${s.bar != null ? ` / ${s.bar.toFixed(2)}` : ''}` : '—'} />
        <Metric label="DTE" value={s.dte || '—'} />
        <Metric label="Δ short" value={s.deltaShort ? s.deltaShort.toFixed(2) : '—'} />
        <Metric label="1/3" value={s.creditRatio != null ? `${(s.creditRatio * 100).toFixed(0)}%` : '—'} />
        <Metric label="Contratos" value={s.contracts || '—'} />
        <Metric label="Riesgo" value={s.riskPerTradePct != null ? `${(s.riskPerTradePct * 100).toFixed(1)}%` : '—'} />
      </div>

      {/* Aviso: sugiere, nunca ejecuta */}
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', marginBottom: 10 }}>
        El sistema sugiere, nunca ejecuta. <b>Aceptar</b> confirma la intención y arranca el cooldown — la apertura del spread es manual.
      </div>

      {/* Confirmación reforzada high_risk */}
      {s.highRisk && confirmHighRisk && (
        <div style={{ fontSize: 12.5, color: 'var(--red-gc)', fontFamily: 'var(--font-sans)', marginBottom: 8,
          padding: '6px 10px', borderRadius: 6, backgroundColor: tint('var(--red-gc)', 11), border: `1px solid ${tint('var(--red-gc)', 33)}` }}>
          ⚠ Banda high_risk (riesgo/trade 5–8%). Confirmá de nuevo para aceptar.
        </div>
      )}

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleAccept}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', borderRadius: 6,
            cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
            color: 'var(--bg-primary)', backgroundColor: accent, border: 'none' }}
        >
          <Check size={13} /> {s.highRisk && confirmHighRisk ? 'Confirmar aceptación' : 'Aceptar'}
        </button>
        <button
          onClick={() => onDismiss(s.id)}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', borderRadius: 6,
            cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
            color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
        >
          <X size={13} /> Descartar
        </button>
      </div>
    </div>
  );
}
