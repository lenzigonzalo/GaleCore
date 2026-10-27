import React from 'react';

/**
 * Markdown chico para leer skills y notas (títulos, listas, tablas, bloques de código, negrita, código en línea).
 * Sin dependencias: lo que no entiende lo muestra como texto, nunca como HTML crudo.
 */
function inline(text: string, key: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${key}-${i}`} style={{ color: 'var(--text-primary)' }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={`${key}-${i}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92em',
        backgroundColor: 'var(--bg-tertiary)', padding: '0 4px', borderRadius: 3 }}>{p.slice(1, -1)}</code>;
    }
    return p;
  });
}

const pre: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5, backgroundColor: 'var(--bg-tertiary)',
  padding: '8px 10px', borderRadius: 4, overflowX: 'auto', margin: '4px 0 12px', whiteSpace: 'pre' };

export function Markdown({ text, fontSize = 13 }: { text: string; fontSize?: number }) {
  const codeStyle = { ...pre, fontSize: fontSize === 13 ? 11.5 : fontSize * 0.92 };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  let para: string[] = [];
  let table: string[][] = [];
  let code: string[] | null = null;
  const flushList = () => {
    if (!list.length) return;
    const items = list.map((l, i) => <li key={i} style={{ margin: '3px 0' }}>{inline(l, `li-${out.length}-${i}`)}</li>);
    const style: React.CSSProperties = { margin: '4px 0 10px', paddingLeft: 20, listStyleType: ordered ? 'decimal' : 'disc' };
    out.push(ordered ? <ol key={`ol-${out.length}`} style={style}>{items}</ol> : <ul key={`ul-${out.length}`} style={style}>{items}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    out.push(<p key={`p-${out.length}`} style={{ margin: '0 0 10px' }}>{inline(para.join(' '), `p-${out.length}`)}</p>);
    para = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const [head, ...rows] = table;
    const cell: React.CSSProperties = { padding: '4px 10px', borderBottom: '1px solid var(--border-dark)', textAlign: 'left', verticalAlign: 'top' };
    const k = out.length;
    out.push(<table key={`t-${k}`} style={{ borderCollapse: 'collapse', margin: '4px 0 12px' }}>
      <thead><tr>{head.map((c, i) => <th key={i} style={{ ...cell, color: 'var(--text-primary)', fontWeight: 600 }}>{inline(c, `th-${k}-${i}`)}</th>)}</tr></thead>
      <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, i) => <td key={i} style={cell}>{inline(c, `td-${k}-${j}-${i}`)}</td>)}</tr>)}</tbody>
    </table>);
    table = [];
  };
  const flushAll = () => { flushList(); flushPara(); flushTable(); };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().startsWith('```')) {  // bloque de código: tal cual, en monoespaciada
      if (code) { out.push(<pre key={`c-${out.length}`} style={codeStyle}>{code.join('\n')}</pre>); code = null; }
      else { flushAll(); code = []; }
      continue;
    }
    if (code) { code.push(raw); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const item = line.match(/^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/);
    if (h) {
      flushAll();
      const size = [fontSize + 3, fontSize + 1, fontSize][h[1].length - 1];
      out.push(<div key={`h-${out.length}`} style={{ fontSize: size, fontWeight: 600, color: 'var(--text-primary)',
        margin: '12px 0 6px' }}>{inline(h[2], `h-${out.length}`)}</div>);
    } else if (line.trim().startsWith('|')) {
      flushList(); flushPara();
      if (!/^\|[\s:|-]+\|$/.test(line.trim())) table.push(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    } else if (item) {
      flushPara(); flushTable();
      if (list.length && ordered !== !!item[1] && !/^\s/.test(raw)) flushList();
      if (!list.length) ordered = !!item[1];
      list.push(item[2]);
    } else if (!line.trim()) {
      flushAll();
    } else if (list.length && /^\s/.test(raw)) {  // continuación del ítem anterior
      list[list.length - 1] += ' ' + line.trim();
    } else {
      flushList(); flushTable(); para.push(line.trim());
    }
  }
  flushAll();
  if (code) out.push(<pre key="c-end" style={codeStyle}>{(code as string[]).join('\n')}</pre>);
  return <div style={{ fontSize, lineHeight: fontSize === 13 ? 1.55 : 1.65, fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)' }}>{out}</div>;
}
