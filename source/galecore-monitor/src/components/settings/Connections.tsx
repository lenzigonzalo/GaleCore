import React, { useEffect, useState } from 'react';
import { ArrowRight, Bot, Check, Copy, Database, GitBranch, KeyRound, RefreshCw, Server } from 'lucide-react';
import { LabContext, LabState, labRequest } from '../../api/lab';
import { BrokerAccountState, fetchBrokerAccount } from '../../api/brokerAccount';
import { fetchSpace } from '../../api/space';

type Read<T> = { value?: T; error?: string; checkedAt?: string };
const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo comprobar el acceso.';

function Status({ children, good = false }: { children: React.ReactNode; good?: boolean }) {
  return <span className={'settings-status' + (good ? ' is-good' : '')}><i />{children}</span>;
}

export function Connections({ onBroker, onData, onLab }: { onBroker: () => void; onData: () => void; onLab?: () => void }) {
  const [lab, setLab] = useState<Read<LabState>>({});
  const [broker, setBroker] = useState<Read<BrokerAccountState>>({});
  const [api, setApi] = useState<Read<boolean>>({});
  const [history, setHistory] = useState<Read<LabContext>>({});
  const [checking, setChecking] = useState(false);
  const [guide, setGuide] = useState<'claude' | 'codex' | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setLab({}); setBroker({}); setApi({}); setHistory({});
    const read = async <T,>(operation: Promise<T>, setter: React.Dispatch<React.SetStateAction<Read<T>>>) => {
      try { const value = await operation; if (active) setter({ value, checkedAt: new Date().toLocaleTimeString() }); }
      catch (e) { if (active) setter({ error: message(e), checkedAt: new Date().toLocaleTimeString() }); }
    };
    Promise.all([
      read(labRequest<LabState>('/state'), setLab),
      read(fetchBrokerAccount(), setBroker),
      read(fetchSpace().then(() => true), setApi),
      read(labRequest<LabContext>('/projects/portfolio'), setHistory),
    ]).then(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [revision]);

  const command = guide === 'claude' ? 'claude auth login' : 'codex login';
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  const toggleGuide = (provider: 'claude' | 'codex') => { setGuide(guide === provider ? null : provider); setCopied(false); setCopyError(false); };

  return <div className="settings-connections">
    <div className="settings-connection-intro"><div><span className="settings-eyebrow">TU ENTORNO DE TRABAJO</span><h2>Antes de empezar</h2><p>Un asistente para conversar. GaleCore para consultar datos. Tu conocimiento para retomar el trabajo.</p></div>
      <button className="settings-action" disabled={checking} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16} className={checking ? 'settings-spinning' : ''} />{checking ? 'Comprobando…' : 'Volver a comprobar'}</button></div>

    <section className="settings-connection-card settings-assistant"><div className="settings-card-heading"><span className="settings-connection-icon"><Bot size={22}/></span><div><h3>Asistente</h3><p>Usa la cuenta del proveedor conectada en este equipo.</p></div><Status good={!!lab.value}>{lab.value ? 'Lab disponible' : lab.error ? 'Lab sin acceso' : 'Comprobando'}</Status></div>
      {lab.error && <p role="alert" className="settings-error">No se pudo contactar al Lab local. Revisá que su servicio esté iniciado y volvé a comprobar.</p>}
      <div className="settings-provider-grid">{(['claude', 'codex'] as const).map(id => {
        const provider = lab.value?.providers.find(p => p.id === id);
        return <div className="settings-provider" key={id}><div className="settings-provider-top"><strong>{id === 'claude' ? 'Claude Code' : 'Codex'}</strong><span>{provider ? provider.installed ? 'Instalado' : 'No instalado' : 'Sin comprobar'}</span></div>
          <p>Autenticación sin comprobar</p><small>La detección del programa no confirma el acceso a tu cuenta.</small>
          <button className="settings-action" aria-expanded={guide === id} onClick={() => toggleGuide(id)}>Conectar o reautenticar <ArrowRight size={15}/></button></div>;
      })}</div>
      {guide && <div className="settings-auth-guide"><h4>Conectar {guide === 'claude' ? 'Claude Code' : 'Codex'} en este equipo</h4><p>Abrí una terminal de tu equipo, ejecutá este comando y completá el acceso del proveedor. Después volvé al Lab.</p>
        <div className="settings-command"><code>{command}</code><button className="settings-action" onClick={copy}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copiado' : 'Copiar comando'}</button></div>
        {copyError && <p role="alert">No se pudo copiar. Seleccioná el comando y copialo manualmente.</p>}
        <p className="settings-note">Esta pantalla todavía no inicia el acceso ni comprueba la sesión del proveedor. No pegues tus claves en el chat.</p></div>}
      <div className="settings-card-foot"><span>El Lab funciona en este equipo; las cuentas del asistente pertenecen al usuario del sistema.</span>{onLab && <button className="settings-action" onClick={onLab}>Abrir Lab <ArrowRight size={15}/></button>}</div>
    </section>

    <div className="settings-connection-grid"><section className="settings-connection-card"><div className="settings-card-heading"><span className="settings-connection-icon"><Server size={21}/></span><div><h3>GaleCore</h3><p>Datos y cálculos de la plataforma</p></div></div>
      <Status good={!!api.value}>{api.value ? 'Espacio accesible' : api.error ? 'Sin acceso' : 'Comprobando'}</Status><p>{api.value ? 'La API respondió a la lectura de tu espacio. Las fuentes de mercado pueden tener un estado distinto.' : api.error ? 'No se pudo leer tu espacio. Revisá la sesión o la disponibilidad del servicio.' : 'Consultando el acceso con tu sesión actual.'}</p>
      <button className="settings-action" onClick={onData}>Ver mis fuentes <ArrowRight size={15}/></button><small className="settings-check-time">{api.checkedAt && `Comprobado a las ${api.checkedAt}`}</small></section>

      <section className="settings-connection-card"><div className="settings-card-heading"><span className="settings-connection-icon"><KeyRound size={21}/></span><div><h3>Bróker</h3><p>Tu cuenta y sus credenciales</p></div></div><Status good={!!broker.value?.linked}>{broker.value ? broker.value.linked ? 'Cuenta vinculada' : 'Sin vincular' : broker.error ? 'Sin comprobar' : 'Comprobando'}</Status>
        <p>{broker.value?.linked ? 'Hay una cuenta vinculada. Esto no comprueba que el bróker acepte la credencial ni que los datos estén actualizados.' : 'Vinculá tu cuenta para trabajar con tus posiciones y balances.'}</p>{broker.error && <p className="settings-error">No se pudo leer el estado de vinculación.</p>}
        <button className="settings-action" onClick={onBroker}>{broker.value?.linked ? 'Administrar credenciales' : 'Vincular cuenta'} <ArrowRight size={15}/></button><small className="settings-check-time">{broker.checkedAt && `Comprobado a las ${broker.checkedAt}`}</small></section></div>

    <section className="settings-connection-card"><div className="settings-card-heading"><span className="settings-connection-icon"><GitBranch size={21}/></span><div><h3>Conocimiento e historial</h3><p>Investigaciones, decisiones y versiones</p></div><Status good={!!history.value}>{history.value ? 'Historial accesible' : history.error ? 'Sin acceso al historial' : 'Comprobando'}</Status></div>
      <p>Git conserva versiones del conocimiento local. No necesitás conectar GitHub para conversar. El respaldo o la sincronización remota todavía no se configuran desde esta pantalla.</p>
      {history.value && <div className="settings-history"><Database size={17}/><span>{history.value.commits.length ? `Última versión guardada: ${new Date(history.value.commits[0].date).toLocaleString()}` : 'Sin versiones guardadas todavía.'} · {history.value.changes} cambios locales pendientes</span></div>}
      {history.error && <p className="settings-error">No se pudo leer el historial local. El acceso al Lab y el acceso a Git se comprueban por separado.</p>}
      <small className="settings-check-time">{history.checkedAt && `Comprobado a las ${history.checkedAt}. Esta lectura no prueba una nueva escritura.`}</small></section>
  </div>;
}
