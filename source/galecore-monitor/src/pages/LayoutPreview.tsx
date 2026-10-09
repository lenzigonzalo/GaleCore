import React, { useState } from 'react';
import type { Tab } from '../components/layout/TabNav';
import { WorkspaceNav } from '../components/layout/WorkspaceNav';
import { WorkspaceHeader } from '../components/layout/WorkspaceHeader';

function EmptyTable({ columns }: { columns: string[] }) {
  return <div className="preview-table"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
    <tbody><tr><td colSpan={columns.length}>Sin datos conectados en esta vista de diseño.</td></tr></tbody></table></div>;
}

/** Preview local de composición: no monta vistas operacionales ni consulta APIs. */
export function LayoutPreview() {
  const [tab, setTab] = useState<Tab>('inicio');
  const [conversation, setConversation] = useState(false);
  return <div className="workspace-shell flex" style={{ height: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>
    <WorkspaceNav active={tab} onChange={setTab} onConversation={() => setConversation(true)} />
    <div className="flex flex-col flex-1 min-w-0">
      <div className="preview-banner">Vista local de diseño · Navegación y composición · Sin datos conectados</div>
      <WorkspaceHeader active={tab} onChange={setTab} onLogout={() => {}} preview
        conversationOpen={conversation} onConversation={() => setConversation(v => !v)} />
      <main className="dashboard-main flex-1 overflow-auto">
        <div className="preview-workspace">
          {tab === 'inicio' && <>
            <div className="today-intro"><p>Sesión diaria</p><h2>Atención y continuidad</h2><span>Un lugar para ver qué cambió, qué revisar y qué trabajo retomar.</span></div>
            <section className="today-section"><div className="today-section-heading"><h3>Necesita tu atención</h3><button onClick={() => setTab('estrategias')}>Ver estrategias →</button></div>
              <p className="preview-empty">Acá se mostrarán avisos con motivo, fecha y una acción concreta. Esta vista no consulta el supervisor.</p></section>
            <section className="today-section"><div className="today-section-heading"><h3>Qué cambió</h3></div><p className="preview-empty">Comparación y fuentes, cuando haya una revisión disponible.</p></section>
            <section className="today-section"><div className="today-section-heading"><h3>Continuar un trabajo</h3><button onClick={() => setConversation(true)}>Abrir conversación →</button></div><p className="preview-empty">Investigaciones, decisiones y pendientes recuperables.</p></section>
          </>}
          {tab === 'gex' && <>
            <div className="preview-section-heading"><h2>Instrumento y contexto</h2><span>Precio · opciones · GEX · eventos</span></div>
            <div className="preview-market-layout"><div><div className="preview-chart-space"><strong>Espacio del gráfico</strong><span>Precio, niveles y eventos con datos reales</span></div>
              <section className="today-section"><div className="today-section-heading"><h3>Opciones por vencimiento</h3></div><EmptyTable columns={['Strike', 'Bid', 'Ask', 'Delta', 'IV']} /></section></div>
              <aside className="preview-watchlist-space"><h3>Seguimiento</h3><EmptyTable columns={['Símbolo', 'Último', 'Cambio %']} /><p>Lista lateral que se puede ocultar para ampliar el gráfico.</p></aside></div>
          </>}
          {['estrategias', 'rpf', 'shadow'].includes(tab) && <>
            <div className="preview-section-heading"><h2>{tab === 'shadow' ? 'Ejecuciones SHADOW' : tab === 'rpf' ? 'Evaluaciones RPF' : 'Proyectos de estrategia'}</h2><span>Hipótesis, reglas, versiones y resultados en un contexto común.</span></div>
            <EmptyTable columns={tab === 'shadow' ? ['Estrategia', 'Versión', 'Instancia', 'Estado', 'Última evaluación'] : ['Estrategia', 'Objetivo', 'Versión', 'Modo', 'Estado']} />
            <section className="today-section"><div className="today-section-heading"><h3>Detalle de estrategia</h3><button onClick={() => setConversation(true)}>Conversar →</button></div>
              <p className="preview-empty">Resumen, reglas, posiciones, evaluaciones e investigación. El detalle tendrá espacio para comparar y entender gráficos.</p></section>
          </>}
          {tab === 'monitor' && <>
            <div className="preview-balance"><div><span>Valor de cuenta</span><strong>—</strong></div><div><span>Poder de compra</span><strong>—</strong></div><div><span>Efectivo</span><strong>—</strong></div></div>
            <section className="today-section"><div className="today-section-heading"><h3>Posiciones</h3></div><EmptyTable columns={['Instrumento', 'Estructura', 'Vencimiento', 'Riesgo', 'Resultado']} /></section>
            <section className="today-section"><div className="today-section-heading"><h3>Exposición y resultados</h3></div><p className="preview-empty">La cuenta real y SHADOW tendrán su alcance identificado; esta vista no lee balances ni posiciones.</p></section>
          </>}
          {tab === 'agentes' && <><div className="preview-section-heading"><h2>Tareas bajo tu control</h2><span>Objetivo, horario, resultado y estado efectivo.</span></div><EmptyTable columns={['Agente', 'Objetivo', 'Estado', 'Última corrida', 'Próxima']} /></>}
          {tab === 'inteligencia' && <><div className="preview-section-heading"><h2>Conocimiento guardado</h2><span>Investigaciones · informes · decisiones · métodos</span></div><EmptyTable columns={['Documento', 'Tipo', 'Vinculado a', 'Fecha', 'Vigencia']} /></>}
          {tab === 'config' && <><div className="preview-section-heading"><h2>Tus preferencias y conexiones</h2></div><div className="preview-settings-list">{['Mi trading', 'Objetivos y convenciones', 'Memoria', 'Métodos y agentes', 'Conexiones', 'Avisos', 'Apariencia'].map(label => <section key={label}><h3>{label}</h3><span>Contenido de configuración en su lugar, con campos legibles y alcance visible.</span></section>)}</div></>}
        </div>
      </main>
    </div>
    {conversation && <aside className="workspace-terminal preview-conversation"><div><h2>Conversación</h2><button onClick={() => setConversation(false)} aria-label="Ocultar conversación">×</button></div>
      <p>El trabajo seleccionado se conversa acá, con su contexto visible. Podés ocultar este panel y recuperar espacio.</p>
      <p className="preview-empty">Vista de diseño. No se abre una sesión de modelo.</p></aside>}
  </div>;
}
