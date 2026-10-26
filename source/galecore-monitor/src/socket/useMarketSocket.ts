import { useEffect, useRef, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { useMarketStore } from '../store/useMarketStore';
import { useRpfStore } from '../store/useRpfStore';
import { useStrategySwitchStore } from '../store/useStrategySwitchStore';
import { RPF_SWITCH_ENDPOINT } from '../api/rpf';
import { TradePayload, QuotePayload, GreeksPayload } from '../types/api';
import { getAccessToken } from '../auth/supabase';
import { RpfStateUpdate, TradeSuggestion } from '../types/rpf';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useMarketSocket(tickers: string[] = []) {
  const connectionRef = useRef<signalR.HubConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const { updatePrice, updateQuote, updateGreeks, setStreaming } = useMarketStore();

  const tickersKey = tickers.join(',');

  // Universo vigente para los callbacks del hub. Se registran una sola vez, así que sin el ref
  // capturarían el array del primer render — vacío, porque la config todavía no cargó.
  const tickersRef = useRef<string[]>(tickers);
  tickersRef.current = tickers;

  // ── Ciclo de vida de la conexión ────────────────────────────────────────────
  // Se abre UNA vez y vive lo que vive el tablero. Deliberadamente sin `tickers` en las deps:
  // el hub transporta mucho más que precios de subyacentes (orquestación de RPF, quotes/Greeks
  // de los legs del Monitor, flow), así que atarlo al universo lo reconstruía cada vez que la
  // config cargaba y el `stop()` del cleanup pisaba un `start()` todavía en vuelo.
  useEffect(() => {
    const hubUrl = process.env.REACT_APP_SIGNALR_HUB_URL;
    if (!hubUrl) {
      console.error('REACT_APP_SIGNALR_HUB_URL is not set');
      setStatus('error');
      return;
    }
    // Marca esta conexión como descartada (cleanup del efecto). La leen los handlers de abajo para
    // no tocar el estado compartido una vez que el efecto se desmontó — ver el comentario largo en
    // "Reconnect logic".
    let disposed = false;

    // SIN `transport`: se deja negociar. SignalR intenta WebSocket y sólo cae a SSE o long-polling
    // si el entorno no lo permite.
    //
    // Hasta 2026-08-10 acá había `transport: HttpTransportType.LongPolling`, forzado desde el commit
    // inicial del monitor y sin ninguna razón registrada. El motivo habitual para forzarlo — que el
    // navegador no puede mandar headers custom en el upgrade de WebSocket, y la API key viaja en
    // header — acá no aplica: `/hubs` está exento del ApiKeyMiddleware.
    //
    // Y no era gratis. El long-polling es lo que hizo posible el cuelgue del loop de RPF (f1a6179):
    // un cliente que deja de pollear sin cerrar limpio deja al servidor escribiendo en un buffer que
    // nunca drena, y el SendAsync al grupo espera para siempre. Con WebSocket la conexión muerta se
    // detecta. Además llenaba el log de red del navegador con cientos de GET, lo que hizo mucho más
    // difícil diagnosticar ese mismo cuelgue.
    //
    // Se NEGOCIA en vez de forzar WebSocket: forzarlo sería cambiar un absolutismo por otro, y en
    // Azure App Service los WebSockets son un setting por aplicación que viene apagado por defecto.
    // Negociando, ese entorno cae solo a long-polling en vez de quedarse sin conexión.
    //
    // El token va por accessTokenFactory y NO por la query string a mano, que es lo que hacía el
    // viejo `?apiKey=`: la librería lo manda como header cuando el transporte lo permite y solo cae
    // a `?access_token=` en el WebSocket, donde el navegador no deja poner headers propios.
    //
    // Se lo llama en CADA (re)conexión, así que una reconexión después de una hora usa un token
    // renovado y no el que ya venció. Devolver '' cuando no hay sesión es válido: hoy el hub acepta
    // conexiones anónimas (Supabase:RequireAuthOnHub=false en la API).
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: async () => (await getAccessToken()) ?? '',
      })
      // Reintenta sin rendirse (0, 2, 10 s y después cada 30 s). La política por defecto abandona a
      // los ~40 s: un reinicio de la API dejaba el indicador en Offline hasta recargar la página,
      // aunque los datos por HTTP siguieran llegando.
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => [0, 2000, 10000][ctx.previousRetryCount] ?? 30000 })
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connectionRef.current = connection;

    // ── Price handlers ────────────────────────────────────────────────────
    connection.on('ReceiveTrade', (symbol: string, data: TradePayload) => {
      updatePrice(symbol, data);
    });

    connection.on('ReceiveQuote', (symbol: string, data: QuotePayload) => {
      updateQuote(symbol, data);
    });

    // ── Greeks handler (option legs subscribed with includeGreeks) ────────
    connection.on('ReceiveGreeks', (symbol: string, data: GreeksPayload) => {
      updateGreeks(symbol, data);
    });

    // ── RPF orchestration handlers (Fase 6b) ───────────────────────────────
    connection.on('ReceiveRpfState', (symbol: string, data: RpfStateUpdate) => {
      useRpfStore.getState().applyState(symbol, data);
    });
    connection.on('ReceiveTradeSuggestion', (symbol: string, data: TradeSuggestion) => {
      useRpfStore.getState().applySuggestion(symbol, data);
    });
    // El operador toco el switch de la estrategia, quiza desde otra pestana del navegador o desde
    // la card de Main de otro cliente. Va al store compartido: lo ven la pantalla de RPF y Main.
    connection.on('ReceiveRpfSwitch', (enabled: boolean) => {
      useStrategySwitchStore.getState().apply(RPF_SWITCH_ENDPOINT, enabled);
    });

    // ── Reconnect logic ───────────────────────────────────────────────────
    // Los tres handlers de ciclo de vida se guardan con `disposed`, igual que el then/catch del
    // start. En StrictMode React monta el efecto dos veces: crea la conexión A, la descarta y crea
    // la B. Sin el guard, el `onclose` de A —que dispara cuando termina su stop(), YA con B
    // conectada y suscripta— pisaba el estado compartido con 'disconnected'; el efecto de
    // suscripción veía el cambio de status, corría su cleanup y desuscribía el universo de la B
    // (que sí estaba Connected, así que el guard del cleanup lo dejaba pasar). Resultado: hub
    // conectado, cero suscripciones de market data y nada que las repusiera.
    connection.onreconnecting(() => {
      if (disposed) return;
      setStatus('connecting');
      tickersRef.current.forEach((s) => setStreaming(s, false));
    });

    connection.onreconnected(() => {
      if (disposed) return;
      setStatus('connected');
      // Re-subscribe price tickers
      tickersRef.current.forEach((symbol) => {
        connection.invoke('Subscribe', symbol, false).catch(console.error);
        setStreaming(symbol, true);
      });
      // Re-join the RPF board group
      connection.invoke('SubscribeRpf').catch(console.error);
    });

    connection.onclose(() => {
      if (disposed) return;
      setStatus('disconnected');
      tickersRef.current.forEach((s) => setStreaming(s, false));
    });

    // ── Start connection ──────────────────────────────────────────────────
    // El universo NO se suscribe acá: de eso se encarga el efecto de abajo, que reacciona a
    // `tickers`. Acá solo va lo que no depende del universo.
    // Si la API no está al abrir el tablero, el primer start() falla y la reconexión automática no
    // lo cubre: se reintenta cada 10 s hasta que conecte o se desmonte.
    setStatus('connecting');
    const start = (): Promise<void> => connection
      .start()
      .then(() => {
        if (disposed) return;
        setStatus('connected');
        // Join the RPF board group (loop puede estar inerte → no llega nada, es esperado)
        connection.invoke('SubscribeRpf').catch(console.error);
      })
      .catch((err) => {
        if (disposed) return;
        console.error('SignalR connection error:', err);
        setStatus('error');
        return new Promise<void>((r) => setTimeout(r, 10000)).then(() => (disposed ? undefined : start()));
      });
    const started = start();

    return () => {
      disposed = true;
      connectionRef.current = null;

      // Llamar stop() antes de que start() resuelva tira "Failed to start the HttpConnection
      // before stop() was called". Hay que esperar a que el start termine, salga bien o mal —
      // pasa siempre en el doble montaje de StrictMode en dev.
      started.finally(() => { connection.stop().catch(() => {}); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Suscripción al universo ─────────────────────────────────────────────────
  // Separado del ciclo de vida: cambiar de universo re-suscribe símbolos, no reconstruye el hub.
  useEffect(() => {
    const conn = connectionRef.current;
    if (status !== 'connected' || !conn) return;

    const symbols = tickersKey ? tickersKey.split(',') : [];
    symbols.forEach((symbol) => {
      conn.invoke('Subscribe', symbol, false).catch(console.error);
      setStreaming(symbol, true);
    });

    return () => {
      if (conn.state !== signalR.HubConnectionState.Connected) return;
      symbols.forEach((symbol) => {
        conn.invoke('Unsubscribe', symbol, false).catch(() => {});
        setStreaming(symbol, false);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey, status]);

  // ── Underlying subscription (para universos de estrategia fuera del universo de plataforma) ──
  // El universo de la plataforma lo suscribe el efecto de arriba (App pasa universe.tickers del
  // config de app). Una estrategia con su propio universo — GEX declara el suyo en su JSON — usa
  // esto para completar el delta: los símbolos que la plataforma no streamea. includeGreeks=false,
  // igual que la suscripción de plataforma.
  const subscribeSymbol = useCallback((symbol: string) => {
    const conn = connectionRef.current;
    if (conn?.state === signalR.HubConnectionState.Connected) {
      conn.invoke('Subscribe', symbol, false).catch(console.error);
      setStreaming(symbol, true);
    }
  }, [setStreaming]);

  const unsubscribeSymbol = useCallback((symbol: string) => {
    const conn = connectionRef.current;
    if (conn?.state === signalR.HubConnectionState.Connected) {
      conn.invoke('Unsubscribe', symbol, false).catch(() => {});
      setStreaming(symbol, false);
    }
  }, [setStreaming]);

  // ── Option leg subscription (para quotes live en Portfolio Manager) ──
  const subscribeLeg = useCallback((occSymbol: string) => {
    const conn = connectionRef.current;
    if (conn?.state === signalR.HubConnectionState.Connected) {
      // includeGreeks=true → also receive ReceiveGreeks for this option leg
      conn.invoke('Subscribe', occSymbol, true).catch(console.error);
    }
  }, []);

  const unsubscribeLeg = useCallback((occSymbol: string) => {
    const conn = connectionRef.current;
    if (conn?.state === signalR.HubConnectionState.Connected) {
      conn.invoke('Unsubscribe', occSymbol, true).catch(() => {});
    }
  }, []);

  // ── RPF ack methods (Fase 6b) ─────────────────────────────────────────
  // El sistema sugiere, nunca ejecuta: Accept confirma intención + cooldown, NO abre la orden.
  const acceptSuggestion = useCallback((suggestionId: string) => {
    const conn = connectionRef.current;
    if (conn?.state === signalR.HubConnectionState.Connected) {
      conn.invoke('AcceptSuggestion', suggestionId).catch(console.error);
    }
  }, []);

  const dismissSuggestion = useCallback((suggestionId: string) => {
    const conn = connectionRef.current;
    if (conn?.state === signalR.HubConnectionState.Connected) {
      conn.invoke('DismissSuggestion', suggestionId).catch(console.error);
    }
  }, []);

  return { status, subscribeSymbol, unsubscribeSymbol, subscribeLeg, unsubscribeLeg, acceptSuggestion, dismissSuggestion };
}
