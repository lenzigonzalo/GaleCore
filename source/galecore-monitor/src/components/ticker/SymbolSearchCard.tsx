import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { searchSymbols } from '../../api/marketdata';
import { SymbolSearchResult } from '../../types/api';

interface Props {
  /** El símbolo elegido. Quien la monta decide qué hacer con él (pinearlo, seleccionarlo). */
  onPick: (symbol: string) => void;
  /** Todo sale del JSON de la estrategia: la card no tiene política propia. */
  minQueryLength?: number;
  maxResults?: number;
  instrumentTypes?: string[];
}

const DEBOUNCE_MS = 300;

/**
 * La última card de la grilla: buscar un símbolo que no está en el universo.
 *
 * Es una card y no un input en la cabecera a propósito — lo que produce es otra card al lado de las
 * del universo, y el lugar donde se pide algo debería parecerse a lo que devuelve.
 *
 * No sabe nada de GEX: recibe sus parámetros y avisa qué eligieron.
 */
export function SymbolSearchCard({ onPick, minQueryLength = 1, maxResults = 8, instrumentTypes }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // Cada búsqueda lleva número: la respuesta de un prefijo viejo puede llegar DESPUÉS de la del
  // texto actual y pisar la lista con resultados de lo que el operador ya terminó de escribir.
  const reqRef = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < Math.max(1, minQueryLength)) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }

    const id = ++reqRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchSymbols(q, instrumentTypes)
        .then((items) => {
          if (id !== reqRef.current) return;
          setResults(items.slice(0, maxResults));
          setError(null);
        })
        .catch((e: any) => {
          if (id !== reqRef.current) return;
          setResults([]);
          setError(e?.response?.data?.error ?? e.message ?? 'Error buscando');
        })
        .finally(() => {
          if (id !== reqRef.current) return;
          setLoading(false);
          setSearched(true);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, minQueryLength, maxResults, instrumentTypes?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setOpen(false);
    setQuery('');
    setResults([]);
    setError(null);
    setSearched(false);
    reqRef.current++;
  }

  function pick(symbol: string) {
    onPick(symbol);
    close();
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    border: `1px ${open ? 'solid' : 'dashed'} ${open ? 'var(--blue-gc)' : 'var(--border)'}`,
    borderRadius: 10,
    padding: '14px 16px',
    minWidth: 210,
    position: 'relative',
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left card-interactive"
        style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 108 }}
        title="Analizar un símbolo que no está en el universo de la estrategia"
      >
        <Plus size={14} style={{ color: 'var(--text-muted)' }} />
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--text-muted)', fontFamily: 'var(--font-sans)',
        }}>
          Buscar símbolo
        </span>
      </button>
    );
  }

  return (
    <div style={{ ...cardStyle, minHeight: 108 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'Enter' && results.length) pick(results[0].symbol);
          }}
          placeholder="Símbolo…"
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
          }}
        />
        <span
          onClick={close}
          title="Cerrar"
          style={{ display: 'inline-flex', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
        >
          <X size={12} />
        </span>
      </div>

      <div style={{ maxHeight: 180, overflowY: 'auto', margin: '0 -6px' }}>
        {loading && (
          <div style={{ padding: '6px', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
            Buscando…
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: '6px', fontSize: 10, color: 'var(--red-gc)', fontFamily: 'var(--font-sans)' }}>
            {error}
          </div>
        )}

        {!loading && !error && searched && !results.length && (
          <div style={{ padding: '6px', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
            Sin resultados
          </div>
        )}

        {!loading && !error && results.map((r) => (
          <div
            key={r.symbol}
            onClick={() => pick(r.symbol)}
            title={r.description ?? r.symbol}
            style={{
              padding: '5px 6px', borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'baseline', gap: 8,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.05em', color: 'var(--text-primary)', flexShrink: 0,
            }}>
              {r.symbol}
            </span>
            <span style={{
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.description}
            </span>
          </div>
        ))}
      </div>

      {/* La búsqueda matchea también contra la descripción: "AAPL" devuelve siete ETFs apalancados
          sobre AAPL, y ninguno tiene cadena propia. Que el tipo sea Equity no promete que se pueda
          barrer — eso se sabe al pedir la cadena. */}
      {!loading && !error && results.length > 1 && (
        <div style={{
          marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-dark)',
          fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.4,
        }}>
          Matchea símbolo y descripción. No todos tienen cadena de opciones.
        </div>
      )}
    </div>
  );
}
