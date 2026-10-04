import React from 'react';

/**
 * Markdown chico para leer skills y notas (títulos, listas, negrita, código en línea, párrafos). Sin dependencias:
 * lo que no entiende lo muestra como texto, nunca como HTML crudo.
 */
function inline(text: string, key: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${key}-${i}`} style={{ color: 'var(--text-primary)' }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={`${key}-${i}`} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.92em',
        backgroundColor: 'var(--bg-tertiary)', padding: '0 4px', borderRadius: 3 }}>{p.slice(1, -1)}</code>;
    }
    return p;
  });
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    out.push(<ul key={`ul-${out.length}`} style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
      {list.map((l, i) => <li key={i} style={{ margin: '3px 0' }}>{inline(l, `li-${out.length}-${i}`)}</li>)}
    </ul>);
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    out.push(<p key={`p-${out.length}`} style={{ margin: '0 0 10px' }}>{inline(para.join(' '), `p-${out.length}`)}</p>);
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (h) {
      flushList(); flushPara();
      const size = [16, 14, 13][h[1].length - 1];
      out.push(<div key={`h-${out.length}`} style={{ fontSize: size, fontWeight: 600, color: 'var(--text-primary)',
        margin: '12px 0 6px' }}>{inline(h[2], `h-${out.length}`)}</div>);
    } else if (li) {
      flushPara(); list.push(li[1]);
    } else if (!line.trim()) {
      flushList(); flushPara();
    } else {
      flushList(); para.push(line.trim());
    }
  }
  flushList(); flushPara();
  return <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{out}</div>;
}
