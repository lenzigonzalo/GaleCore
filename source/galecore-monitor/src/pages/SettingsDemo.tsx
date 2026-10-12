import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Clock, Code, FileText, Folder, Puzzle, Search, Settings2, SlidersHorizontal, Sparkles, User, Plug, Eye, Plus } from 'lucide-react';
import { Markdown } from '../components/settings/Markdown';
import { settingsSkills, settingsConnections } from './SettingsDemo.fixture';
import './SettingsDemo.css';

type Section = 'general' | 'profile' | 'memory' | 'capabilities' | 'tasks';
const sections = [
  {id:'general' as const,label:'General',Icon:Settings2},
  {id:'profile' as const,label:'Perfil y objetivos',Icon:User},
  {id:'memory' as const,label:'Memoria y convenciones',Icon:BookOpen},
  {id:'capabilities' as const,label:'Habilidades y conexiones',Icon:Sparkles},
  {id:'tasks' as const,label:'Tareas programadas',Icon:Clock},
];
/** TEMPORAL GC-0011: interacciones locales para decidir UX; no instala ni configura el harness. */
export function SettingsDemo({ onLab }: { onLab: () => void }) {
  const [section,setSection] = useState<Section>('general');
  const [kind,setKind] = useState<'Skills'|'Conectores'|'Plugins'>('Skills');
  const [scope,setScope] = useState<'Tuyos'|'Descubrir'>('Tuyos');
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState<string|null>(null);
  const [detailTab,setDetailTab] = useState<'Resumen'|'Contenido'>('Resumen');
  const [file,setFile] = useState('SKILL.md');
  const [source,setSource] = useState(false);
  const [enabled,setEnabled] = useState(settingsSkills.filter(s => s.enabled).map(s => s.id));
  const [notice,setNotice] = useState('');
  const [task,setTask] = useState<string|null>(null);
  const [tasks,setTasks] = useState<{name:string; time:string}[]>([]);
  const [taskTime,setTaskTime] = useState('08:00');
  const [preferences,setPreferences] = useState({language:'Español',zone:'Buenos Aires'});
  const [profile,setProfile] = useState({name:'Trader demo',goal:'Investigar estrategias con opciones, documentar decisiones y mejorar la consistencia.',capital:'10.000 USD',horizon:'30–45 días',target:'10–15%',risk:'Máximo 5%'});
  const [memory,setMemory] = useState('Prefiero explicaciones en español, riesgo definido y fuentes con fecha. Antes de avanzar, explicitar los supuestos.');
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!task) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
    const keys = (e:KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setTask(null); }
      if (e.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('input, button:not(:disabled)'));
      const first = controls[0], last = controls[controls.length-1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown',keys);
    return () => { document.removeEventListener('keydown',keys); opener?.focus(); };
  },[task]);
  const skill = settingsSkills.find(s => s.id === selected);
  const selectSkill = (id:string) => { setSelected(id); setDetailTab('Resumen'); setFile('SKILL.md'); setSource(false); };
  const filtered = settingsSkills.filter(s => (scope === 'Descubrir' || enabled.includes(s.id)) && (s.name+' '+s.description).toLowerCase().includes(query.toLowerCase()));
  const toggle = (id:string) => setEnabled(v => v.includes(id) ? v.filter(x => x !== id) : [...v,id]);
  const navigate = (s:Section) => { setSection(s); setSelected(null); setNotice(''); setQuery(''); };
  return <div className="sd-layout">
    <nav className="sd-nav" aria-label="Secciones de configuración"><div className="sd-nav-title">Tu espacio</div>{sections.map(({id,label,Icon}) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={17}/>{label}</button>)}<div className="sd-nav-note">Configurá tu experiencia.<br/>Los archivos de cada proyecto están en Lab → Files.</div></nav>
    <main className="sd-main">
      {notice && <div className="sd-notice" role="status">{notice}<button onClick={() => setNotice('')}>Cerrar</button></div>}
      {section !== 'capabilities' && <header className="sd-page-heading"><h1>{sections.find(s => s.id === section)?.label}</h1><p>{section === 'general' ? 'Las preferencias que usás todos los días.' : section === 'profile' ? 'Tu contexto para investigar y tomar decisiones.' : section === 'memory' ? 'Lo que querés conservar entre conversaciones.' : 'Revisiones y resúmenes, en el momento que elijas.'}</p></header>}
      {section === 'general' && <div className="sd-preferences">
        <section><h2>Apariencia e idioma</h2><div className="sd-setting-row"><div><strong>Tema</strong><p>Una vista cómoda para seguir el mercado.</p></div><select aria-label="Tema" defaultValue="Carbón"><option>Carbón</option></select></div><div className="sd-setting-row"><div><strong>Idioma</strong><p>Idioma de la interfaz.</p></div><select aria-label="Idioma" value={preferences.language} onChange={e => setPreferences({...preferences,language:e.target.value})}><option>Español</option><option>English</option></select></div><div className="sd-setting-row"><div><strong>Zona horaria</strong><p>Para tareas y eventos personales. Mercado usa ET.</p></div><select aria-label="Zona horaria" value={preferences.zone} onChange={e => setPreferences({...preferences,zone:e.target.value})}><option>Buenos Aires</option><option>Nueva York</option><option>UTC</option></select></div></section>
        <section><h2>Tu cuenta</h2><div className="sd-setting-row"><div><strong>{profile.name}</strong><p>Perfil de ejemplo · operador</p></div><button className="sd-button" onClick={() => navigate('profile')}>Ver perfil</button></div><div className="sd-setting-row"><div><strong>Conexiones</strong><p>Broker y fuentes que usás en GaleCore.</p></div><button className="sd-button" onClick={() => {navigate('capabilities');setKind('Conectores');}}>Gestionar <ArrowUpRight size={14}/></button></div></section>
        <p className="sd-footnote">Vista de ejemplo. Las preferencias se reinician al recargar.</p>
      </div>}
      {section === 'profile' && <form className="sd-profile" onSubmit={e => {e.preventDefault();setNotice('Perfil guardado sólo en esta demo.');}}>
        <section><h2>Sobre vos</h2><label>Nombre<input value={profile.name} onChange={e => setProfile({...profile,name:e.target.value})}/></label><label>Qué querés lograr<textarea value={profile.goal} onChange={e => setProfile({...profile,goal:e.target.value})}/></label></section>
        <section><h2>Objetivos y límites</h2><div className="sd-fields"><label>Capital de referencia<input value={profile.capital} onChange={e => setProfile({...profile,capital:e.target.value})}/></label><label>Horizonte<input value={profile.horizon} onChange={e => setProfile({...profile,horizon:e.target.value})}/></label><label>Objetivo anual<input value={profile.target} onChange={e => setProfile({...profile,target:e.target.value})}/></label><label>Riesgo por operación<input value={profile.risk} onChange={e => setProfile({...profile,risk:e.target.value})}/></label></div><p className="sd-footnote">Contexto de ejemplo para diseñar la experiencia.</p></section><button className="sd-button primary" type="submit">Guardar en demo</button>
      </form>}
      {section === 'memory' && <div className="sd-preferences"><section><h2>Memoria personal</h2><p>Preferencias y contexto que acompañan tus conversaciones.</p><textarea aria-label="Memoria personal" value={memory} onChange={e => setMemory(e.target.value)}/><button className="sd-button" onClick={() => setNotice('Memoria guardada sólo en esta demo.')}>Guardar en demo</button></section><section><h2>Convenciones</h2><div className="sd-setting-row"><div><strong>Documentar decisiones</strong><p>Conservar la pregunta, evidencia y próximos pasos.</p></div><FileText size={20}/></div><div className="sd-setting-row"><div><strong>Contexto por proyecto</strong><p>Files, memoria y reglas propias de cada workspace.</p></div><button className="sd-button" onClick={onLab}>Abrir Lab <ArrowUpRight size={14}/></button></div></section></div>}
      {section === 'capabilities' && !skill && <>
        <header className="sd-page-heading"><h1>Habilidades y conexiones</h1><p>Elegí las herramientas que acompañan tu trabajo.</p></header>
        <div className="sd-toolbar"><nav className="sd-tabs" aria-label="Tipo de herramienta">{(['Skills','Conectores','Plugins'] as const).map(k => <button key={k} aria-pressed={kind === k} onClick={() => {setKind(k);setQuery('');}}>{k}</button>)}</nav>{kind !== 'Plugins' && <><span className="sd-toolbar-divider"/><div className="sd-segment">{(['Tuyos','Descubrir'] as const).map(s => <button key={s} aria-pressed={scope === s} onClick={() => setScope(s)}>{s}</button>)}</div><label className="sd-search"><Search size={16}/><input aria-label="Buscar herramientas" placeholder="Buscar" value={query} onChange={e => setQuery(e.target.value)}/></label></>}</div>
        {kind === 'Skills' && <>
          {scope === 'Descubrir' && !query && <div className="sd-feature"><div><span>Para investigar mejor</span><h2>De una idea a una estrategia</h2><p>Un método claro para ordenar hipótesis, datos y reglas.</p><button className="sd-button primary" onClick={() => selectSkill('strategy_design')}>Explorar habilidad</button></div><SlidersHorizontal size={66} strokeWidth={1}/></div>}
          <div className="sd-list-heading"><h2>{scope === 'Tuyos' ? 'Tus habilidades' : 'Para tu trabajo'}</h2><span>{filtered.length} habilidades · catálogo de ejemplo</span></div>
          <div className="sd-cards">{filtered.map(s => <article className="sd-card" key={s.id}><div className="sd-card-icon"><Sparkles size={23} strokeWidth={1.4}/></div><button className="sd-card-copy" onClick={() => selectSkill(s.id)}><strong>{s.name}</strong><p>{s.description}</p><small>{s.category} · contenido de ejemplo</small></button><button className="sd-square" aria-label={'Ver '+s.name} onClick={() => selectSkill(s.id)}><ChevronIcon/></button></article>)}</div>
          {!filtered.length && <div className="sd-empty"><Search size={32}/><h2>Sin habilidades para esta búsqueda</h2><p>Probá otro nombre o explorá el catálogo.</p><button className="sd-button" onClick={() => {setQuery('');setScope('Descubrir');}}>Ver todas</button></div>}
        </>}
        {kind === 'Conectores' && <><div className="sd-list-heading"><h2>{scope === 'Tuyos' ? 'Tus conexiones' : 'Fuentes disponibles'}</h2><span>Inventario de ejemplo</span></div><div className="sd-cards">{settingsConnections.filter(c => (scope === 'Descubrir' || c.status.startsWith('Conectado')) && (c.name+' '+c.description).toLowerCase().includes(query.toLowerCase())).map(c => <article className="sd-card" key={c.name}><div className="sd-card-icon">{c.initials}</div><div className="sd-card-copy"><strong>{c.name}</strong><p>{c.description}</p><small>{c.category} · {c.status}</small></div><button className="sd-square" aria-label={'Ver conexión '+c.name} onClick={() => setNotice(c.name+' · vista de ejemplo. No se cambió ninguna conexión.')}><Plug size={17}/></button></article>)}</div><p className="sd-footnote">La conexión real del broker sigue en la configuración de cuenta existente.</p></>}
        {kind === 'Plugins' && <div className="sd-empty"><Puzzle size={40} strokeWidth={1.2}/><h2>Tus herramientas, en un solo lugar</h2><p>Un plugin reúne habilidades y conexiones para un mismo trabajo.<br/>El catálogo de plugins todavía no está conectado.</p><button className="sd-button" onClick={() => setKind('Skills')}>Explorar habilidades</button></div>}
      </>}
      {section === 'capabilities' && skill && <div className="sd-detail">
        <button className="sd-back" onClick={() => setSelected(null)}><ArrowLeft size={16}/>Tus habilidades</button>
        <header className="sd-detail-heading"><div className="sd-card-icon"><Sparkles size={25}/></div><div><h1>{skill.name}</h1><p>Contenido de ejemplo · {skill.category}</p></div><button className="sd-button" onClick={onLab}>Abrir Lab <ArrowUpRight size={15}/></button><button className="sd-switch" role="switch" aria-label={'Habilitar '+skill.name+' en demo'} aria-checked={enabled.includes(skill.id)} onClick={() => toggle(skill.id)}><i/></button></header>
        <nav className="sd-detail-tabs">{(['Resumen','Contenido'] as const).map(t => <button key={t} aria-pressed={detailTab === t} onClick={() => setDetailTab(t)}>{t}{t === 'Contenido' ? ' · '+Object.keys(skill.files).length : ''}</button>)}</nav>
        {detailTab === 'Resumen' ? <div className="sd-summary"><h2>Qué hace</h2><p>{skill.description}</p><h2>Cuándo usarla</h2><p>Cuando necesites ordenar una pregunta de {skill.category.toLowerCase()} y conservar el razonamiento junto con la evidencia del proyecto.</p><h2>Contenido</h2>{Object.keys(skill.files).map(f => <button key={f} onClick={() => {setFile(f);setDetailTab('Contenido');}}><FileText size={16}/>{f}</button>)}<p className="sd-footnote">Este texto ilustra el lector. No modifica las skills existentes del harness.</p></div> :
        <div className="sd-file-view"><nav aria-label="Archivos de la habilidad"><button className={file === 'SKILL.md' ? 'selected' : ''} onClick={() => setFile('SKILL.md')}><FileText size={16}/>SKILL.md</button>{Object.keys(skill.files).some(f => f.startsWith('references/')) && <div className="sd-folder"><Folder size={16}/>references</div>}{Object.keys(skill.files).filter(f => f !== 'SKILL.md').map(f => <button className={file === f ? 'selected sd-file-child' : 'sd-file-child'} key={f} onClick={() => setFile(f)}>{f.split('/').pop()}</button>)}</nav><article><header><code>/{file}</code><button className="sd-square" aria-label={source ? 'Ver documento' : 'Ver código'} onClick={() => setSource(!source)}>{source ? <Eye size={17}/> : <Code size={17}/>}</button></header><div className="sd-file-content">{source ? <pre>{skill.files[file]}</pre> : <Markdown text={skill.files[file]}/>}</div></article></div>}
      </div>}
      {section === 'tasks' && <>
        <div className="sd-task-top">{tasks.length ? <div className="sd-task-list">{tasks.map((t,i) => <div className="sd-setting-row" key={i}><div><strong>{t.name}</strong><p>Días laborables · {t.time} · demo</p></div><button className="sd-button" onClick={() => setTasks(v => v.filter((_,j) => i !== j))}>Quitar</button></div>)}</div> : <div className="sd-empty"><Clock size={62} strokeWidth={1}/><h2>Aún no hay tareas programadas</h2><p>Elegí una sugerencia para armar tu primera revisión.</p></div>}</div>
        <div className="sd-list-heading"><h2>Podés empezar por acá</h2><span>Sugerencias</span></div><div className="sd-cards">{[{name:'Resumen diario',description:'Posiciones, próximos eventos y lo que requiere tu atención.'},{name:'Revisión de vencimientos',description:'Una lectura de las posiciones que vencen esta semana.'},{name:'Resumen semanal',description:'Resultados, decisiones y preguntas abiertas de tus proyectos.'},{name:'Seguimiento de una hipótesis',description:'Volvé a contrastar la evidencia de una investigación.'}].map(t => <article key={t.name} className="sd-card"><div className="sd-card-icon"><Clock size={22}/></div><button className="sd-card-copy" onClick={() => {setTask(t.name);setTaskTime('08:00');}}><strong>{t.name}</strong><p>{t.description}</p><small>Elegir horario <Plus size={12}/></small></button></article>)}</div>
        {task && <div className="sd-dialog-backdrop"><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sd-task-title" className="sd-dialog"><h2 id="sd-task-title">{task}</h2><p>Vista previa de una tarea. No se ejecutará ni se enviará al harness.</p><label>Horario · Buenos Aires<input type="time" value={taskTime} onChange={e => setTaskTime(e.target.value)}/></label><footer><button className="sd-button" onClick={() => setTask(null)}>Cancelar</button><button className="sd-button primary" disabled={!taskTime} onClick={() => {setTasks(v => [...v,{name:task,time:taskTime}]);setTask(null);setNotice('Tarea agregada sólo en la demo; no tiene ejecución programada.');}}>Agregar a la demo</button></footer></section></div>}
      </>}
    </main>
  </div>;
}
function ChevronIcon() { return <ArrowUpRight size={17}/>; }
