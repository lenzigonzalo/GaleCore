import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { GexExpiryApi, GLOBAL_SCOPE } from '../../types/gex';
import { fmtExpiry } from '../../utils/formatters';
import { OptionsChainList } from './OptionsChainList';

interface Props {
  expiries: GexExpiryApi[];
  selected: string | null;
  onSelect: (scope: string) => void;
  compared: string[];
  onCompare: (expirations: string[]) => void;
  globalNetGex?: number;
  maxDte?: number;
  /** Lectura numérica del vencimiento elegido (Expiry Engine): va al pie del mismo desplegable. */
  engine?: ReactNode;
}

/**
 * El selector de vencimiento único. Elige el vencimiento (o toda la cadena), marca cuáles se comparan
 * y arma el conjunto por rango de DTE; al pie muestra la lectura del elegido. El botón dice qué
 * está elegido. El rango selecciona sólo vencimientos servidos.
 */
export function ExpiryPicker({ expiries, selected, onSelect, compared, onCompare, globalNetGex, maxDte, engine }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('45');
  const valid = from !== '' && to !== '' && Number(from) >= 0 && Number(to) >= Number(from)
    && Number.isInteger(Number(from)) && Number.isInteger(Number(to));
  const inRange = valid ? expiries.filter(e => e.dte >= Number(from) && e.dte <= Number(to)) : [];
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const current = expiries.find(e => e.expiration === selected);
  const others = compared.filter(e => e !== selected).length;
  const caption = selected === GLOBAL_SCOPE ? 'Toda la cadena'
    : current ? `${fmtExpiry(current.expiration)} · ${current.dte} DTE` : 'Sin vencimiento';
  const selectSet = (items: GexExpiryApi[]) => {
    if (!items.length) return;
    if (!items.some(e => e.expiration === selected)) onSelect(items[0].expiration);
    onCompare(items.map(e => e.expiration));
  };
  return (
    <details ref={ref} className="market-popover market-expiry-picker">
      <summary title="Elegir vencimiento">Vencimiento: <b>{caption}</b>{others > 0 && <span> +{others}</span>}</summary>
      <div className="market-popover-content">
        <div className="market-expiry-actions">
          <button className="btn" onClick={() => selectSet(expiries)} disabled={!expiries.length}>Seleccionar todos</button>
          <button className="btn" onClick={() => onCompare([])}>Sólo elegido</button>
        </div>
        <div className="market-dte-range">
          <label>Desde DTE<input type="number" min="0" step="1" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>Hasta DTE<input type="number" min="0" step="1" value={to} onChange={e => setTo(e.target.value)} /></label>
          <button className="btn" disabled={!valid || !inRange.length} onClick={() => selectSet(inRange)}>Aplicar</button>
        </div>
        {!valid && <p role="status">Ingresá un rango de días válido.</p>}
        {valid && !inRange.length && <p role="status">Sin vencimientos disponibles en ese rango.</p>}
        <p className="market-expiry-hint">Elegí la fecha para las barras; marcá casillas para comparar sus muros y smiles. El rango usa la cadena disponible{maxDte != null ? ` (hasta ${maxDte} DTE)` : ''}.</p>
        <OptionsChainList expiries={expiries} selected={selected} onSelect={onSelect}
          compared={compared} onToggleCompare={exp => onCompare(compared.includes(exp) ? compared.filter(x => x !== exp) : [...compared, exp])}
          globalNetGex={globalNetGex} maxDte={maxDte} />
        {engine && <div className="market-expiry-engine">{engine}</div>}
      </div>
    </details>
  );
}
