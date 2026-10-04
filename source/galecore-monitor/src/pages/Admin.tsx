import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2, User as UserIcon } from 'lucide-react';
import { AdminUser, deleteAdminUser, fetchAdminUsers, setAdminUserRole } from '../api/admin';
import { UserForm } from '../components/admin/UserForm';
import { SectionTitle } from '../components/common/SectionTitle';
import { useCurrentUserStore } from '../store/useCurrentUserStore';
import { tint } from '../utils/formatters';

const ACCENT = '#a78bfa';

const thStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-muted)', textAlign: 'left', fontFamily: 'var(--font-sans)',
  borderBottom: '1px solid var(--border-dark)', whiteSpace: 'nowrap', backgroundColor: 'var(--bg-tertiary)',
};
const tdStyle: React.CSSProperties = {
  padding: '10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dark)', verticalAlign: 'middle',
};

const Pill = ({ children, color, title }: { children: React.ReactNode; color: string; title?: string }) => (
  <span
    title={title}
    style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
      color, backgroundColor: tint(color, 13), border: `1px solid ${tint(color, 30)}`,
    }}
  >
    {children}
  </span>
);

/**
 * Admin — el ABM de usuarios de la plataforma. SOLO PARA ADMIN.
 *
 * ACÁ SOLO VIVE LO QUE ADMINISTRA A OTROS. Lo de cada operador —su cuenta de bróker y su
 * contraseña— se mudó al menú Mi Cuenta: era lo único que obligaba a mostrarle esta pestaña a
 * cualquiera, porque un no-admin también tiene que poder vincular la suya (sin ella no ve balances
 * ni posiciones). Con eso afuera, la pestaña volvió a ser de admin y `TabNav` no se la muestra al
 * resto.
 *
 * DA DE ALTA, EDITA Y BORRA USUARIOS desde la etapa 3. Cada operación escribe en dos sistemas —la
 * identidad en Supabase Auth y la fila de `users`— y el backend las compensa; acá solo se muestra
 * el motivo cuando algo falla. La contraseña del alta es INICIAL: la persona la cambia desde "Mi
 * contraseña" apenas entra.
 *
 * TAMPOCO MUESTRA LAS CUENTAS DE BRÓKER AJENAS. Un admin administra usuarios, no sus credenciales:
 * de la cuenta de otro solo se ve si existe, nunca el número ni el token.
 *
 * El gate real está en el endpoint (403), no en que la tabla no se renderice: ocultar una pantalla
 * no es seguridad.
 */
export function Admin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // null = el formulario está cerrado. 'nuevo' = alta. Un id = edición de ese usuario.
  const [editando, setEditando] = useState<string | null>(null);
  // Borrar se lleva puestas las cuentas de bróker por la FK en cascada y no se puede deshacer, así
  // que pide confirmación explícita en la fila en vez de irse de un click.
  const [confirmandoBaja, setConfirmandoBaja] = useState<string | null>(null);
  const reloadCurrentUser = useCurrentUserStore((s) => s.reload);
  const isAdmin = useCurrentUserStore((s) => s.user?.isAdmin ?? false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers();
      setUsers(data.users);
      setCurrentUserId(data.currentUserId);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'No se pudo leer la lista de usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  // Sin permiso no se pide la lista: pedirla para comerse un 403 ensucia los logs del servidor con
  // intentos que la propia UI ya sabe que no corresponden.
  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin, load]);

  const toggleAdmin = async (u: AdminUser) => {
    setBusyId(u.id);
    setError(null);
    try {
      await setAdminUserRole(u.id, !u.isAdmin);
      await load();

      // Si me saqué el permiso a mí mismo, la pestaña y los switches tienen que reflejarlo YA. Sin
      // esto seguirían habilitados hasta recargar la página, prometiendo algo que la API rechaza.
      if (u.id === currentUserId) await reloadCurrentUser();
    } catch (err: any) {
      // El backend rechaza dejar la plataforma sin ningún admin y explica por qué: se muestra su
      // mensaje tal cual en vez de un "error al guardar" que no ayuda a nadie.
      setError(err?.response?.data?.error || err?.message || 'No se pudo cambiar el permiso');
    } finally {
      setBusyId(null);
    }
  };

  const borrar = async (u: AdminUser) => {
    setBusyId(u.id);
    setError(null);
    setAviso(null);
    try {
      const res = await deleteAdminUser(u.id);
      setConfirmandoBaja(null);
      setAviso(res.wasSystem
        ? `Se borró a ${u.username}. TENÍA LA CUENTA DE SISTEMA: hasta que se vincule otra y se la marque, los procesos de fondo se quedan sin credencial para pedir datos de mercado.`
        : `Se borró a ${u.username}, con sus cuentas de bróker.`);
      await load();
    } catch (err: any) {
      // Las guardas del backend (el último admin, borrarse a uno mismo) explican el motivo: se
      // muestra tal cual.
      setError(err?.response?.data?.error || err?.message || 'No se pudo borrar el usuario');
    } finally {
      setBusyId(null);
    }
  };

  const cerrarFormulario = () => setEditando(null);
  const alGuardar = async () => {
    setEditando(null);
    setAviso(null);
    await load();
    // El username propio se muestra en "Mi contraseña": si me edité a mí mismo, tiene que cambiar
    // sin recargar la página.
    await reloadCurrentUser();
  };

  return (
    <div style={{ padding: '16px 18px 40px', fontFamily: 'var(--font-sans)' }}>
      {/* Sin permiso no se renderiza la tabla. La pestaña ya no se le ofrece a un no-admin, pero
          el rol puede cambiar con la pantalla abierta —un admin sacándose el permiso a sí mismo—,
          así que el guard se queda. El gate real es el 403 del endpoint. */}
      {!isAdmin ? (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Esta pantalla es para administradores.
        </div>
      ) : (
      <>
      <SectionTitle
        title="GaleCore Administrator"
        badge="usuarios · permisos"
        style={{ marginBottom: 16 }}
      >
        <button
          onClick={() => setEditando(editando === 'nuevo' ? null : 'nuevo')}
          className="btn"
          title="Dar de alta un operador"
        >
          <Plus size={11} />
          Nuevo operador
        </button>
        <button onClick={load} className="btn" title="Releer la lista" disabled={loading}>
          <RefreshCw size={11} />
          Releer
        </button>
      </SectionTitle>

      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16, maxWidth: 760 }}>
        El alta crea la identidad en Supabase y la fila de la plataforma juntas, con una contraseña
        inicial que el operador cambia desde su pantalla apenas entra.{' '}
        <strong style={{ color: 'var(--text-secondary)' }}>Admin</strong> habilita prender y apagar
        estrategias y servicios, que afecta a todos los operadores. De las cuentas de bróker ajenas
        solo se ve si existen, nunca el número ni el token.
      </div>

      {editando && (
        <UserForm
          user={editando === 'nuevo' ? null : users.find((u) => u.id === editando) ?? null}
          onSaved={alGuardar}
          onCancel={cerrarFormulario}
        />
      )}

      {error && (
        <div className="text-xs py-2 px-3 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red-gc)', marginBottom: 14, maxWidth: 760 }}>
          {error}
        </div>
      )}

      {aviso && (
        <div className="text-xs py-2 px-3 rounded" style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: 'var(--green)', marginBottom: 14, maxWidth: 760 }}>
          {aviso}
        </div>
      )}

      {loading && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Cargando usuarios…</div>}

      {!loading && users.length === 0 && !error && (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          No hay usuarios en la base todavía.
        </div>
      )}

      {!loading && users.length > 0 && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
          backgroundColor: 'var(--bg-secondary)', maxWidth: 900,
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Usuario</th>
                  <th style={thStyle}>Cuenta de bróker</th>
                  <th style={thStyle}>Desde</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Admin</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const soyYo = u.id === currentUserId;
                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id}>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <UserIcon size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          {/* El username manda: es con lo que entra. El mail queda de dato. */}
                          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{u.username}</span>
                          {soyYo && <Pill color="var(--blue-gc)">vos</Pill>}
                          {u.displayName && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>{u.displayName}</span>
                          )}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 3, marginLeft: 20 }}>
                          {u.email}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {u.hasBrokerAccount ? (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <Pill color="var(--green)">vinculada</Pill>
                            {u.hasSystemAccount && (
                              <Pill color={ACCENT} title="Con esta cuenta los procesos de fondo piden datos de mercado.">
                                sistema
                              </Pill>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 13 }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button
                          onClick={() => toggleAdmin(u)}
                          disabled={busy}
                          title={u.isAdmin
                            ? 'Sacarle el permiso de admin'
                            : 'Darle permiso de admin: podrá prender y apagar estrategias para todos'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 7,
                            padding: '3px 9px', borderRadius: 20,
                            backgroundColor: tint(u.isAdmin ? ACCENT : 'var(--text-muted)', 10),
                            border: `1px solid ${tint(u.isAdmin ? ACCENT : 'var(--text-muted)', 30)}`,
                            color: u.isAdmin ? ACCENT : 'var(--text-muted)',
                            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                            fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          <span style={{
                            width: 22, height: 12, borderRadius: 20, flexShrink: 0, position: 'relative',
                            backgroundColor: tint(u.isAdmin ? ACCENT : 'var(--text-muted)', 30),
                            transition: 'background-color 150ms',
                          }}>
                            <span style={{
                              position: 'absolute', top: 2, left: u.isAdmin ? 12 : 2,
                              width: 8, height: 8, borderRadius: '50%',
                              backgroundColor: u.isAdmin ? ACCENT : 'var(--text-muted)',
                              transition: 'left 150ms',
                            }} />
                          </span>
                          {u.isAdmin ? 'SÍ' : 'NO'}
                        </button>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {confirmandoBaja === u.id ? (
                          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: 12, color: 'var(--red-gc)', fontFamily: 'var(--font-sans)' }}>
                              {u.hasBrokerAccount ? '¿Borrar? Se va con su cuenta de bróker.' : '¿Borrar?'}
                            </span>
                            <button
                              onClick={() => borrar(u)}
                              className="btn"
                              disabled={busy}
                              style={{ color: 'var(--red-gc)', borderColor: tint('#ef4444', 40) }}
                            >
                              {busy ? '…' : 'Sí, borrar'}
                            </button>
                            <button onClick={() => setConfirmandoBaja(null)} className="btn" disabled={busy}>
                              No
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              onClick={() => { setEditando(u.id); setAviso(null); }}
                              className="btn"
                              title="Editar usuario, mail, nombre o contraseña"
                              disabled={busy}
                            >
                              <Pencil size={11} />
                              Editar
                            </button>
                            <button
                              onClick={() => { setConfirmandoBaja(u.id); setAviso(null); }}
                              className="btn"
                              title={soyYo
                                ? 'No te podés borrar a vos mismo: que te dé la baja otro admin'
                                : 'Eliminar el operador de la plataforma y de Supabase Auth'}
                              disabled={busy || soyYo}
                              style={{ opacity: soyYo ? 0.4 : 1 }}
                            >
                              <Trash2 size={11} />
                              Borrar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
