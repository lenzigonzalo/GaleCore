import React, { useState, useEffect, useRef } from 'react';
import './index.css';
import { LoginScreen } from './components/LoginScreen';
import { supabase, getSession, signOut } from './auth/supabase';
import { LiveWatchlist } from './components/ticker/LiveWatchlist';
import { StatusBar } from './components/layout/StatusBar';
import type { Tab } from './components/layout/TabNav';
import { Resumen } from './pages/Resumen';
import { Macro } from './pages/Macro';
import { WorkspaceNav } from './components/layout/WorkspaceNav';
import { WorkspaceHeader } from './components/layout/WorkspaceHeader';
import './components/layout/SingleWorkspace.css';
import { Lab } from './pages/Lab';
import { useGexStore } from './store/useGexStore';
import { ClaudeTerminal } from './components/layout/ClaudeTerminal';
import { useTerminalStore } from './store/useTerminalStore';
import { SettingsModal, needsSetup } from './components/settings/SettingsModal';
import { fetchSpace } from './api/space';
import { fetchProviderAuth } from './api/terminal';
import { Admin } from './pages/Admin';
import { Rpf } from './pages/Rpf';
import { Gex } from './pages/Gex';
import { Shadow } from './pages/Shadow';
import { Inteligencia } from './pages/Inteligencia';
import { Agentes } from './pages/Agentes';
import { useMarketSocket, ConnectionStatus } from './socket/useMarketSocket';
import { useAppConfigStore } from './store/useAppConfigStore';
import { useAccountStore } from './store/useAccountStore';
import { useCurrentUserStore } from './store/useCurrentUserStore';
import { resetUserScopedStores } from './store/resetUserScoped';
import { fetchAppConfig } from './api/rules';
import { fetchBalances, fetchPositions, describeAccountError } from './api/account';

interface DashboardProps {
  onLogout: () => void;
}

function Dashboard({ onLogout }: DashboardProps) {
  const [tab, setCurrentTab] = useState<Tab>(new URLSearchParams(window.location.search).has('macro') ? 'macro' : 'inicio');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setup, setSetup] = useState(false);
  const [strategiesVisited, setStrategiesVisited] = useState(false);
  const [labVisited, setLabVisited] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null);
  const [projectRequest, setProjectRequest] = useState<{ id: string; sequence: number }>();
  const setTab = (next: Tab) => {
    if (next === 'config') { setSetup(false); setSettingsOpen(true); return; }
    if (next === 'rpf') { setSelectedSpec('rpf'); next = 'estrategias'; }
    if (next === 'shadow') next = 'estrategias';
    // Cartera e Inicio son una sola pantalla desde el 15/10 (owner): los enlaces viejos llevan a Inicio.
    if (next === 'operativa' || next === 'monitor') next = 'inicio';
    if (next === 'estrategias') setStrategiesVisited(true);
    if (next === 'lab') setLabVisited(true);
    setCurrentTab(next);
  };
  const openProject = (id: string) => { setProjectRequest(previous => ({ id, sequence: (previous?.sequence || 0) + 1 })); setTab('lab'); };
  const followStrategy = (spec: string) => { setSelectedSpec(spec); setTab('estrategias'); };
  const isLabWorkspace = tab === 'lab';
  const [watchlistOpen,setWatchlistOpen] = useState(false);
  // Barra lateral: oculta o visible y su ancho, recordados en este navegador (preferencia de vista, 14/10).
  const readPref = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const [navHidden, setNavHidden] = useState(() => readPref('galecore:nav:hidden') === '1');
  const [navWidth, setNavWidth] = useState(() => Number(readPref('galecore:nav:width')) || 230);
  useEffect(() => { try { localStorage.setItem('galecore:nav:hidden', navHidden ? '1' : '0'); localStorage.setItem('galecore:nav:width', String(navWidth)); } catch { /* sin guardado */ } }, [navHidden, navWidth]);
  const [watchlistWidth,setWatchlistWidth] = useState(420);
  const [socketStatus, setSocketStatus] = useState<ConnectionStatus>('disconnected');

  const { setConfig, setLoading: setConfigLoading, setError: setConfigError, tickers } = useAppConfigStore();
  const { setBalances, setPositions, setLoadingBalances, setLoadingPositions, setErrorBalances, failPositions, lastUpdate } = useAccountStore();
  const reloadCurrentUser = useCurrentUserStore((s) => s.reload);

  const refreshAccount = () => {
    // Balances
    setLoadingBalances(true);
    fetchBalances()
      .then(setBalances)
      .catch((e) => setErrorBalances(describeAccountError(e)))
      .finally(() => setLoadingBalances(false));

    // Positions. Si fallan se vacían: dejar las de la lectura anterior es mostrarle a este operador
    // las posiciones de otro.
    setLoadingPositions(true);
    fetchPositions()
      .then(setPositions)
      .catch(failPositions)
      .finally(() => setLoadingPositions(false));
  };

  useEffect(() => {
    // Quién está logueado y qué le deja hacer la plataforma. Va primero porque de acá sale qué
    // pestañas se muestran y si los switches se ven habilitados: sin esto, un no-admin clickearía
    // para cobrar un 403.
    //
    // `reload` y no `load`: el store es de módulo y sobrevive al logout, así que la versión
    // idempotente se iba sin preguntar cuando alguien salía y entraba con otra cuenta sin recargar
    // la página — el tablero del segundo mostraba los permisos del primero. Este efecto corre una
    // vez por login (el Dashboard se monta recién cuando hay sesión), así que no es un fetch de más.
    reloadCurrentUser();

    // Config de la app (universo, estrategias, monitor)
    setConfigLoading(true);
    fetchAppConfig()
      .then(setConfig)
      .catch((e) => setConfigError(e.message ?? 'Error cargando la configuración'))
      .finally(() => setConfigLoading(false));

    if (!new URLSearchParams(window.location.search).has('macro')) refreshAccount();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    Promise.all([fetchSpace(), fetchProviderAuth()]).then(([space, auth]) => {
      if (active && needsSetup(space.items, auth.providers)) { setSetup(true); setSettingsOpen(true); }
    }).catch(() => { /* Una lectura fallida no equivale a una cuenta sin configurar. */ });
    return () => { active = false; };
  }, []);

  const terminalOpen = useTerminalStore((t) => t.open);

  const { status, subscribeSymbol, unsubscribeSymbol, subscribeLeg, unsubscribeLeg, acceptSuggestion, dismissSuggestion } = useMarketSocket(tickers);
  useEffect(() => { setSocketStatus(status); }, [status]);

  return (
    <div className={'workspace-shell flex flex-col has-watchlist-dock' + (watchlistOpen ? ' watchlist-expanded' : '')} style={{ height: '100vh', backgroundColor: 'var(--bg-primary)', '--watchlist-width': `${watchlistWidth}px` } as React.CSSProperties}>
        <WorkspaceHeader status={<StatusBar connectionStatus={socketStatus} lastUpdate={lastUpdate}/>} active={tab} onChange={setTab} onLogout={onLogout}
          onSymbol={async symbol => {
            let store = useGexStore.getState();
            if (!store.rules) { await store.loadRules(); store = useGexStore.getState(); }
            if (store.rulesError) throw new Error('No se pudo cargar Mercado.');
            if (!store.tickers.includes(symbol) && !store.adHocSearch?.enabled) throw new Error('La búsqueda de nuevos símbolos no está habilitada.');
            const selected = store.pinAdHoc(symbol);
            if (!selected) throw new Error('No se pudo abrir el símbolo.');
            store.setSelectedSymbol(selected); setTab('gex');
          }} conversationOpen={terminalOpen} onConversation={() => useTerminalStore.getState().setOpen(!terminalOpen)} navHidden={navHidden} onNavToggle={() => setNavHidden(v => !v)} />
      <div className="workspace-body flex flex-1">
      {!navHidden && <WorkspaceNav active={tab} onChange={setTab} onLogout={onLogout} width={navWidth} onResize={setNavWidth} />}
      <div className="flex flex-col flex-1 min-w-0" style={{ position: 'relative' }}>




        <main className={"dashboard-main flex-1 " + (isLabWorkspace ? "lab-dashboard-main" : "overflow-auto")} style={{ position: 'relative' }}>
          <>
          {tab === 'inicio' && <Resumen onNavigate={setTab} />}

          {/* Se montan recién al entrar: leen la cuenta de bróker y la lista de usuarios — nada de
              eso tiene sentido traerlo en cada arranque del tablero. */}
          {tab === 'admin' && <Admin />}
          {/* GEX se monta recién al entrar: el barrido de la cadena completa es caro y no tiene
              sentido dispararlo si el operador nunca abre la pestaña. */}
          {tab === 'gex' && <Gex externalWatchlist subscribeSymbol={subscribeSymbol} unsubscribeSymbol={unsubscribeSymbol} socketStatus={socketStatus} />}
          {/* SHADOW (GC-0004) se monta al entrar y se refresca solo mientras está abierta. */}
          {tab === 'macro' && <Macro />}
          {strategiesVisited && <div hidden={tab !== 'estrategias'}><Shadow selectedSpec={selectedSpec} onSelectSpec={setSelectedSpec} onOpenChat={openProject} rpf={<Rpf acceptSuggestion={acceptSuggestion} dismissSuggestion={dismissSuggestion} subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus}/>} /></div>}
          {/* Inteligencia se monta al entrar: lee el adapter local de GaleCore-AI, no la API. */}
          {tab === 'inteligencia' && <Inteligencia />}
          {/* Agentes (GC-0009) se monta al entrar y se refresca cada minuto mientras está abierta. */}
          {tab === 'agentes' && <Agentes />}
          </>
          {labVisited && <div className="lab-page-host" hidden={!isLabWorkspace}><Lab projectRequest={projectRequest} onFollowStrategy={followStrategy} onMonitor={() => setTab('estrategias')} onNavigate={setTab}/></div>}
        </main>
      </div>
      <LiveWatchlist open={watchlistOpen} enabled width={watchlistWidth} onWidthChange={setWatchlistWidth} onClose={() => setWatchlistOpen(false)} onToggle={() => setWatchlistOpen(v => !v)} onSelect={() => { setTab('gex'); }} socketStatus={socketStatus} subscribeSymbol={subscribeSymbol} unsubscribeSymbol={unsubscribeSymbol}/>
      <ClaudeTerminal onOpenSettings={() => setTab('config')} />
      </div>
      {settingsOpen && <SettingsModal wizard={setup} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function App() {
  // null = todavía no sabemos. La sesión de Supabase vive en localStorage y leerla es asincrónico,
  // así que hay un instante inicial sin respuesta. Sin este tercer estado, ese instante se
  // renderizaría como "no autenticado" y mostraría el login por un parpadeo a quien YA tiene sesión.
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  // De quién es la sesión. Es la `key` del tablero: cambiar de persona lo REMONTA, y con eso vuelve
  // a correr su efecto de arranque (quién soy, config, balances, posiciones). Sin remontar no basta
  // con limpiar los stores — quedan vacíos y nadie los vuelve a llenar, que es peor que el arrastre
  // que se quería evitar: sin `canManagePlatform` los switches quedan deshabilitados para siempre y
  // clickearlos no hace nada.
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    const aplicar = (id: string | null) => {
      sessionUserIdRef.current = id;
      setSessionUserId(id);
    };

    getSession().then((session) => {
      if (!alive) return;
      aplicar(session?.user.id ?? null);
      setAuthenticated(!!session);
    });

    // Mantiene el tablero en sincronía con la sesión real: cierre desde otra pestaña, token que no
    // se pudo renovar, logout. Sin esto, una sesión vencida dejaría la UI montada pidiendo datos
    // que la API ya rechaza.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;

      // La sesión se puede ir o CAMBIAR DE PERSONA sin pasar por el botón: cierre desde otra
      // pestaña, token vencido, o alguien que entra con otra cuenta en otra ventana del mismo
      // navegador —la sesión de Supabase es por origen, así que ese login se ve acá también—. En
      // los dos casos hay que olvidar al anterior, o el siguiente hereda sus permisos y sus datos.
      const nuevo = session?.user.id ?? null;
      if (nuevo !== sessionUserIdRef.current) resetUserScopedStores();

      aplicar(nuevo);
      setAuthenticated(!!session);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await signOut();
    sessionStorage.removeItem('galecore:apiKey');
    // Que no quede NADA del que se va: los stores son de módulo y el logout solo desmonta el
    // tablero. Sin esto, el próximo en entrar hereda sus permisos, su número de cuenta y sus
    // posiciones hasta que cada fetch los pise — y los que fallen no los pisan nunca.
    resetUserScopedStores();
    setAuthenticated(false);
  };

  if (authenticated === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <span className="spinner" style={{ width: 20, height: 20 }} />
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  // La `key` es la persona: si cambia, el tablero se remonta entero y se vuelve a preguntar todo
  // con la sesión nueva. No es una optimización — es lo que garantiza que nada del anterior quede
  // en pantalla y que lo del nuevo llegue.
  return <Dashboard key={sessionUserId ?? 'anon'} onLogout={handleLogout} />;
}


export default App;
