import { filterMentions, findTrigger, mentionsIn, mentionsFromSpace, Mention } from './labMentions';

const pieces: Mention[] = [
  { kind: 'skill', key: 'valuar-empresa', title: 'Valuar empresa' },
  { kind: 'skill', key: 'cierre-semana', title: 'Cierre de la semana' },
  { kind: 'agent', key: 'oportunidades', title: 'Oportunidades' },
];

test('«/» sólo abre el menú al inicio del mensaje; «@» en cualquier parte', () => {
  expect(findTrigger('/val', 4)).toEqual({ char: '/', query: 'val', start: 0 });
  expect(findTrigger('hola /val', 9)).toBeNull();
  expect(findTrigger('mirá con @opor', 14)).toEqual({ char: '@', query: 'opor', start: 9 });
  expect(findTrigger('mail@dominio', 12)).toBeNull();                       // una arroba pegada a una palabra no es una mención
  expect(findTrigger('/valuar-empresa de AAPL', 23)).toBeNull();           // ya no está escribiendo la etiqueta
});

test('el menú filtra por clave o título y separa skills de agentes', () => {
  expect(filterMentions(pieces, { char: '/', query: '', start: 0 }).map(m => m.key)).toEqual(['valuar-empresa', 'cierre-semana']);
  expect(filterMentions(pieces, { char: '/', query: 'semana', start: 0 }).map(m => m.key)).toEqual(['cierre-semana']);
  expect(filterMentions(pieces, { char: '@', query: 'opor', start: 0 }).map(m => m.key)).toEqual(['oportunidades']);
});

test('al enviar sólo cuentan las etiquetas que quedaron en el texto y existen', () => {
  expect(mentionsIn('/valuar-empresa de AAPL con @oportunidades', pieces).map(m => m.key)).toEqual(['valuar-empresa', 'oportunidades']);
  expect(mentionsIn('contame de /valuar-empresa y @nadie', pieces)).toEqual([]);   // «/» fuera del inicio y agente inexistente
  expect(mentionsIn('@valuar-empresa', pieces)).toEqual([]);                         // una skill no se nombra como agente
});

test('del espacio sólo se toman skills y agentes, sin repetir', () => {
  const item = (kind: string, key: string) => ({ kind, key, title: key } as any);
  expect(mentionsFromSpace([item('skill', 'a'), item('memory', 'm'), item('agent', 'b'), item('skill', 'a')]).map(m => m.kind + '/' + m.key)).toEqual(['skill/a', 'agent/b']);
});
