import React from 'react';
import type { PositionLeg } from '../positions/PositionRow';
import { fmtPrice } from '../../utils/formatters';

/** Piecewise strike coordinates keep the wings readable; interpolation is visual only. */
export function StrikeLadder({ legs, spot, putWall, callWall, compact = false }: { legs: PositionLeg[]; spot?: number | null; putWall?: number | null; callWall?: number | null; compact?: boolean }) {
  const ordered = [...legs].filter(leg => Number.isFinite(leg.strike)).sort((a, b) => a.strike - b.strike);
  if (!ordered.length) return <div className="strike-empty">Sin patas de opciones</div>;
  if (compact) return <span className="strike-ladder-inline" role="img" aria-label="Escalera de strikes">{ordered.map((leg, index) => <span key={index} className={`strike-inline-leg ${leg.side.toUpperCase() === 'SELL' ? 'sell' : 'buy'}`} title={`${leg.side.toUpperCase() === 'SELL' ? 'VENTA' : 'COMPRA'} ${leg.type} ${fmtPrice(leg.strike, 0)}`}><i aria-hidden="true" />{fmtPrice(leg.strike, 0)}</span>)}</span>;
  const points = ordered.map((leg, i) => ({ ...leg, x: ordered.length === 4 ? [10, 30, 70, 90][i] : ordered.length === 2 ? [22, 78][i] : ordered.length === 1 ? 50 : 10 + i * 80 / (ordered.length - 1) }));
  const sells = points.filter(leg => leg.side.toUpperCase() === 'SELL');
  const put = sells.find(leg => leg.type.toUpperCase() === 'PUT');
  const call = sells.find(leg => leg.type.toUpperCase() === 'CALL');
  const left = put?.x ?? 3, right = call?.x ?? 97;
  const outside = spot != null && ((put !== undefined && spot < put.strike) || (call !== undefined && spot > call.strike));
  const coordinate = (price: number) => {
    if (points.length === 1) return price < points[0].strike ? 15 : price > points[0].strike ? 85 : 50;
    const width = points[points.length - 1].strike - points[0].strike || 1;
    const anchors = [{ strike: points[0].strike - width, x: 3 }, ...points, { strike: points[points.length - 1].strike + width, x: 97 }];
    const upper = anchors.findIndex(anchor => anchor.strike >= price);
    if (upper <= 0) return upper === 0 ? 3 : 97;
    const a = anchors[upper - 1], b = anchors[upper];
    return a.x + (b.x - a.x) * (price - a.strike) / (b.strike - a.strike || 1);
  };
  const hasSpot = spot != null && Number.isFinite(spot) && spot > 0;
  return <div className="strike-ladder" role="img" aria-label={`Escalera de strikes${hasSpot ? `; subyacente ${fmtPrice(spot!)}${outside ? ' fuera del rango' : ''}` : ''}`}>
    <div className="strike-line" />
    {sells.length > 0 && <div className="strike-range" style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}><span>RANGO</span></div>}
    {points.map((leg, i) => <div key={`${leg.side}-${leg.type}-${leg.strike}-${i}`} className={`strike-leg ${leg.side.toUpperCase() === 'SELL' ? 'sell' : 'buy'}`} style={{ left: `${leg.x}%` }}><span>{leg.side.toUpperCase() === 'SELL' ? 'VENTA' : 'COMPRA'} {leg.type.toUpperCase()}</span><i /><strong>{fmtPrice(leg.strike, 0)}</strong></div>)}
    {hasSpot && <div className={`strike-spot${outside ? ' outside' : ''}`} style={{ left: `${coordinate(spot!)}%` }} title="Precio actual del subyacente; si no hay stream, punto medio bid/ask">{fmtPrice(spot!)}</div>}
    {[{ label: 'PUT WALL', price: putWall }, { label: 'CALL WALL', price: callWall }].map(wall => wall.price != null && Number.isFinite(wall.price) && wall.price > 0 ? <div className={`strike-wall ${wall.label === 'PUT WALL' ? 'put' : 'call'}`} key={wall.label} style={{ left: `${coordinate(wall.price)}%` }} title={`${wall.label} ${fmtPrice(wall.price, 0)}`}><span style={{ transform: coordinate(wall.price) <= 20 ? 'translateX(0)' : coordinate(wall.price) >= 80 ? 'translateX(-100%)' : undefined }}>{wall.label} {fmtPrice(wall.price, 0)}</span></div> : null)}
  </div>;
}
