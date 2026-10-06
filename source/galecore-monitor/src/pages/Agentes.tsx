import React, { useCallback, useEffect, useState } from 'react';
import { SectionTitle } from '../components/common/SectionTitle';
import { Markdown } from '../components/settings/Markdown';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../api/space';

/**
 * Agentes (GC-0009): lo que corre solo con las instrucciones del trader — si está prendido, si su último
 * resultado está al día, cuándo corrió, qué encontró — y el botón para prenderlo o apagarlo.
 *
 * Los datos son las piezas `agent` del espacio del trader, que GaleCore-AI publica desde la PC donde corren
 * (cada 5 minutos y después de cada cambio). El monitor no llega a esa PC: prender o apagar escribe un pedido
 * en la pieza (`request`) y GaleCore-AI lo aplica en la próxima pasada. Hasta entonces se muestra como pedido.
 */

interface LastRun {
  at: string; result: string; invoked_by?: string; duration_s?: number; model?: string;
  reason?: string; error?: string; failed: boolean;
}
interface Agent {
  id: string; capability: string; status: 'active' | 'paused' | 'cancelled'; schedule: string;
  strategy?: string | null; objective: string; state: string; state_detail?: string;
  next_expected_at?: string | null; last_run?: LastRun | null; runs: number; findings?: string | null;
  result_ref?: string | null; request?: { status: 'active' | 'paused'; at?: string }; request_error?: string;
}

const REFRESH_MS = 60_000;

const WHAT: Record<string, string> = {
  supervisor: 'Supervisor de SHADOW', market_watch: 'Vigila el mercado', daily_attention: 'Briefing diario', strategy_followup: 'Seguimiento de estrategia',
};

// Estado del último resultado (freshness de GaleCore-AI) en palabras del trader.
const STATE: Record<string, { label: string; color: string; border: string }> = {
  CURRENT:      { label: 'Al día',              color: 'var(--green)',      border: 'var(--green-border)' },
  NOT_DUE_YET:  { label: 'Todavía no le tocó',  color: 'var(--text-muted)', border: 'var(--border-dark)' },
  DUE_NOW:      { label: 'Le toca ahora',       color: 'var(--text-secondary)', border: 'var(--border-dark)' },
  RUNNING:      { label: 'Corriendo',           color: 'var(--blue-gc)',    border: 'var(--blue-gc)' },
  MISSED:       { label: 'Se saltó una corrida', color: 'var(--yellow-gc)', border: 'var(--yellow-border)' },
  FAILED:       { label: 'Falló la última',     color: 'var(--red-gc)',     border: 'var(--red-border)' },
  PAUSED:       { label: 'Pausado',             color: 'var(--yellow-gc)',  border: 'var(--yellow-border)' },
};

// Qué significa un estado que pide atención (el detalle técnico queda en GaleCore-AI: `task status`).
const STATE_HELP: Record<string, string> = {
  MISSED: 'No corrió a la hora prevista (la PC estaba apagada o sin sesión iniciada): lo que ves es de la corrida anterior.',
  FAILED: 'La última corrida programada falló: lo que ves es el último resultado bueno.',
  DUE_NOW: 'Le tocaba hace poco y todavía no arrancó.',
};

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 12, padding: '14px 16px',
};
const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };
const label: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 };

const parse = (s: string): Agent | null => { try { return JSON.parse(s); } catch { return null; } };

function when(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Pill({ text, color, border }: { text: string; color: string; border: string }) {
  return (
    <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 999, whiteSpace: 'nowrap', color, border: `1px solid ${border}` }}>
      {text}
    </span>
  );
}

// Margen para que una corrida programada arranque y se publique (GaleCore-AI publica cada 5 min).
const SILENCE_MS = 40 * 60_000;

/**
 * El estado lo calcula la PC al publicar: con la PC apagada no se publica nada y lo guardado se vuelve viejo
 * (un «Al día» del viernes sigue ahí el lunes). Si ya pasó la próxima corrida esperada y no llegó nada nuevo,
 * se dice eso en vez del estado guardado.
 */
function silent(a: Agent): boolean {
  if (a.status !== 'active' || !a.next_expected_at) return false;
  const next = new Date(a.next_expected_at).getTime();
  return !Number.isNaN(next) && Date.now() > next + SILENCE_MS;
}

function StatePill({ a }: { a: Agent }) {
  if (silent(a)) return <Pill text="Sin noticias de tu PC" color="var(--yellow-gc)" border="var(--yellow-border)" />;
  const s = STATE[a.state] ?? { label: a.state, color: 'var(--text-muted)', border: 'var(--border-dark)' };
  return <Pill text={s.label} color={s.color} border={s.border} />;
}

/** El botón de prender/apagar, o el pedido que espera aplicarse en la PC. */
function Toggle({ a, onRequest, busy }: { a: Agent; onRequest: (status: 'active' | 'paused') => void; busy: boolean }) {
  if (a.status === 'cancelled') return <span style={muted}>Cancelado</span>;
  // El supervisor (WS-0007) corre con la publicación de cada 5 minutos: no es una tarea que se prenda o apague.
  if (a.capability === 'supervisor') return <span style={muted}>Siempre activo</span>;
  const pending = a.request && a.request.status !== a.status ? a.request.status : null;
  if (pending) {
    return (
      <span style={{ ...muted, color: 'var(--text-secondary)' }}>
        {pending === 'active' ? 'Prendiendo…' : 'Apagando…'}
      </span>
    );
  }
  const on = a.status === 'active';
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); onRequest(on ? 'paused' : 'active'); }}
      style={{
        fontSize: 13, padding: '5px 14px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--font-sans)',
        border: `1px solid ${on ? 'var(--border-dark)' : 'var(--accent)'}`,
        backgroundColor: on ? 'transparent' : 'var(--accent)', color: on ? 'var(--text-secondary)' : 'var(--accent-ink)',
        fontWeight: on ? 400 : 600,
      }}
    >
      {on ? 'Apagar' : 'Prender'}
    </button>
  );
}

function AgentCard({ a, publishedAt, selected, onSelect, onRequest, busy }: {
  a: Agent; publishedAt: string; selected: boolean; onSelect: () => void; onRequest: (s: 'active' | 'paused') => void; busy: boolean;
}) {
  const on = a.status === 'active';
  const last = a.last_run;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
      style={{ ...card, cursor: 'pointer', borderColor: selected ? 'var(--text-secondary)' : 'var(--border-dark)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: on ? 'var(--green)' : 'var(--text-muted)' }} />
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{a.id}</span>
        <span style={muted}>{WHAT[a.capability] ?? a.capability}</span>
        <span style={{ flex: 1 }} />
        <StatePill a={a} />
        <Toggle a={a} onRequest={onRequest} busy={busy} />
      </div>
      <div style={{ ...muted, marginTop: 8 }}>{a.schedule}{a.strategy ? ` · ${a.strategy}` : ''}</div>
      {silent(a) && (
        <div style={{ fontSize: 13, color: 'var(--yellow-gc)', marginTop: 6 }}>
          Tu PC no publica desde {when(publishedAt)}: la próxima corrida ya tendría que haber pasado. Lo de abajo es de ese momento.
        </div>
      )}
      <div style={{ display: 'flex', gap: 24, marginTop: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={label}>Última corrida</div>
          <div style={{ fontSize: 14, color: last?.failed ? 'var(--red-gc)' : 'var(--text-primary)' }} className="tabular-nums">
            {last ? `${when(last.at)} · ${last.result}` : 'Nunca corrió'}
          </div>
        </div>
        <div>
          <div style={label}>Próxima</div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }} className="tabular-nums">
            {on && !silent(a) ? when(a.next_expected_at) : '—'}
          </div>
        </div>
        <div>
          <div style={label}>Corridas</div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }} className="tabular-nums">{a.runs}</div>
        </div>
      </div>
      {a.request_error && (
        <div style={{ fontSize: 13, color: 'var(--red-gc)', marginTop: 8 }}>No se pudo aplicar: {a.request_error}</div>
      )}
    </div>
  );
}

function AgentDetail({ a, publishedAt }: { a: Agent; publishedAt: string }) {
  const last = a.last_run;
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={card}>
        <div style={label}>Qué le pediste</div>
        <div style={{ fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.55 }}>{a.objective}</div>
      </div>
      {last && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div><div style={label}>Resultado</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: last.failed ? 'var(--red-gc)' : 'var(--text-primary)' }}>{last.result}</div></div>
            <div><div style={label}>Cuándo</div><div style={{ fontSize: 14 }} className="tabular-nums">{when(last.at)}</div></div>
            {last.duration_s != null && (
              <div><div style={label}>Duración</div><div style={{ fontSize: 14 }} className="tabular-nums">{Math.round(last.duration_s)} s</div></div>
            )}
            {last.model && <div><div style={label}>Modelo</div><div style={{ fontSize: 14 }}>{last.model}</div></div>}
            <div><div style={label}>Quién la lanzó</div>
              <div style={{ fontSize: 14 }}>{last.invoked_by === 'scheduler' ? 'Programada' : 'A mano'}</div></div>
          </div>
          {(last.reason || last.error) && (
            <div style={{ fontSize: 13, color: last.failed ? 'var(--red-gc)' : 'var(--text-secondary)', marginTop: 10, lineHeight: 1.5 }}>
              {last.error ?? last.reason}
            </div>
          )}
          {STATE_HELP[a.state] && <div style={{ ...muted, marginTop: 8 }}>{STATE_HELP[a.state]}</div>}
        </div>
      )}
      <div style={card}>
        <div style={{ ...label, marginBottom: 8 }}>
          Qué encontró{a.result_ref ? ` · ${a.result_ref}` : ''} · publicado {when(publishedAt)}
        </div>
        {a.findings
          ? <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}><Markdown text={a.findings} /></div>
          : <div style={muted}>Todavía no hay un resultado guardado.</div>}
      </div>
    </div>
  );
}

export function Agentes() {
  const [items, setItems] = useState<SpaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items: own } = await fetchSpace();
      setItems(own.filter((i) => i.kind === 'agent'));
      setError(null);
    } catch (e: any) {
      setError(e?.response?.status === 401 ? 'Tu sesión venció: volvé a entrar.' : 'No se pudo leer tus agentes de GaleCore.');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const agents = (items ?? [])
    .map((i) => ({ item: i, a: parse(i.content) }))
    .filter((x): x is { item: SpaceItem; a: Agent } => !!x.a && !!x.a.id && x.a.status !== 'cancelled')
    .sort((x, y) => (x.a.status === y.a.status ? x.a.id.localeCompare(y.a.id) : x.a.status === 'active' ? -1 : 1));
  const current = agents.find((x) => x.item.key === selected) ?? agents[0];

  const request = async (item: SpaceItem, a: Agent, status: 'active' | 'paused') => {
    setBusy(item.key);
    try {
      const { request_error: _drop, ...rest } = a;
      await saveSpaceItem('agent', item.key, {
        title: item.title, format: 'json', visibility: item.visibility,
        content: JSON.stringify({ ...rest, request: { status, at: new Date().toISOString() } }),
      });
      await load();
    } catch {
      setError('No se pudo guardar el pedido. Probá de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  const pending = agents.some((x) => x.a.request && x.a.request.status !== x.a.status);

  return (
    <div style={{ padding: '14px 18px 24px' }}>
      <SectionTitle title="GaleCore Agentes" badge="CORREN SOLOS · CON TUS INSTRUCCIONES" />
      <div style={{ ...muted, margin: '8px 0 16px', maxWidth: 820, lineHeight: 1.5 }}>
        Los agentes corren en tu PC con GaleCore-AI. Se crean desde el chat («armame un agente que…»); acá ves cómo
        van y los prendés o apagás.
        {pending && ' El cambio se aplica en tu PC en hasta 5 minutos (tiene que estar prendida).'}
      </div>
      {error && <div style={{ fontSize: 14, color: 'var(--red-gc)', marginBottom: 12 }}>{error}</div>}
      {items === null && !error && <div style={muted}>Cargando…</div>}
      {items !== null && agents.length === 0 && (
        <div style={card}>
          <div style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>Todavía no tenés agentes.</div>
          <div style={muted}>Pedíselo a GaleCore-AI: «armame un agente que me avise cuando haya prima para vender en SPY».</div>
        </div>
      )}
      {current && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 10 }}>
            {agents.map(({ item, a }) => (
              <AgentCard key={item.key} a={a} publishedAt={item.updatedAt} selected={item.key === current.item.key} busy={busy === item.key}
                onSelect={() => setSelected(item.key)} onRequest={(s) => request(item, a, s)} />
            ))}
          </div>
          <AgentDetail a={current.a} publishedAt={current.item.updatedAt} />
        </div>
      )}
    </div>
  );
}
