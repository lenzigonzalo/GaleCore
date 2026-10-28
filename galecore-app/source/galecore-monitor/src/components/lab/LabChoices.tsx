import { useState } from 'react';

// Preguntas con opciones para tildar (WS-0039): el agente las escribe en un bloque ```opciones con JSON; el chat las
// muestra con la recomendada marcada y «Responder» manda la elección como mensaje del trader.
export interface Choice { texto: string; recomendada?: boolean }
export interface Question { pregunta: string; multiple?: boolean; opciones: Choice[] }
export interface ChoiceBlock { preguntas: Question[]; enviar?: string }

export function parseChoices(raw: string): ChoiceBlock | null {
  try {
    const v = JSON.parse(raw);
    const ok = Array.isArray(v?.preguntas) && v.preguntas.length > 0 && v.preguntas.every((q: Question) =>
      typeof q?.pregunta === 'string' && Array.isArray(q.opciones) && q.opciones.length > 1 && q.opciones.every(o => typeof o?.texto === 'string'));
    return ok ? v : null;
  } catch { return null; }
}

export type AnswerHandler = (text: string) => boolean | void | Promise<boolean | void>;

export function LabChoices({ block, active, onAnswer }: { block: ChoiceBlock; active: boolean; onAnswer?: AnswerHandler }) {
  const [picked, setPicked] = useState<string[][]>(() => block.preguntas.map(q => q.opciones.filter(o => o.recomendada).map(o => o.texto).slice(0, q.multiple ? undefined : 1)));
  const [sent, setSent] = useState(false);
  const toggle = (qi: number, texto: string, multiple?: boolean) => setPicked(all => all.map((sel, i) => i !== qi ? sel
    : multiple ? (sel.includes(texto) ? sel.filter(t => t !== texto) : [...sel, texto]) : [texto]));
  const usable = active && !sent && !!onAnswer;
  const complete = picked.every(sel => sel.length > 0);
  const answer = () => {
    if (!usable || !complete) return;
    const lines = block.preguntas.map((q, i) => q.pregunta.replace(/^¿|\?$/g, '') + ': ' + picked[i].join(', '));
    setSent(true);
    // Si el envío no salió (red, chat ocupado), la tarjeta vuelve a habilitarse para reintentar.
    Promise.resolve(onAnswer!([...lines, block.enviar].filter(Boolean).join('\n')))
      .then(ok => { if (ok === false) setSent(false); }, () => setSent(false));
  };
  return <form className="lab-choices" onSubmit={e => { e.preventDefault(); answer(); }}>
    {block.preguntas.map((q, qi) => <fieldset key={qi} disabled={!usable}>
      <legend>{q.pregunta}</legend>
      {q.opciones.map((o, oi) => <label key={oi}className={picked[qi].includes(o.texto) ? 'on' : ''}>
        <input type={q.multiple ? 'checkbox' : 'radio'} name={'q' + qi} checked={picked[qi].includes(o.texto)} onChange={() => toggle(qi, o.texto, q.multiple)} />
        <span>{o.texto}</span>{o.recomendada && <em>Recomendada</em>}
      </label>)}
    </fieldset>)}
    {usable && <button type="submit" className="lab-choices-send" disabled={!complete}>Responder</button>}
  </form>;
}
