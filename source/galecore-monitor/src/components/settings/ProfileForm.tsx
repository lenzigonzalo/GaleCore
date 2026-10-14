import React, { useState } from 'react';
import { saveSpaceItem, SpaceItem } from '../../api/space';

const fields = [['horizon', 'Horizonte'], ['max_drawdown', 'Pérdida máxima tolerada'], ['risk_limits', 'Límites de riesgo'], ['delivery_format', 'Formato de las respuestas'], ['preferred_sources', 'Fuentes preferidas'], ['language', 'Idioma']] as const;
export function ProfileForm({ item, onChanged }: { item?: SpaceItem; onChanged: () => void }) {
  const original = (() => { try { return item ? JSON.parse(item.content) : {}; } catch { return null; } })();
  const [editing, setEditing] = useState(!item);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([key]) => [key, Array.isArray(original?.[key]) ? original[key].join('\n') : String(original?.[key] ?? '')])));
  const [capital, setCapital] = useState(String(original?.reference_capital?.amount ?? ''));
  const [currency, setCurrency] = useState(String(original?.reference_capital?.currency ?? ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    setDraft(Object.fromEntries(fields.map(([key]) => [key, Array.isArray(original?.[key]) ? original[key].join('\n') : String(original?.[key] ?? '')])));
    setCapital(String(original?.reference_capital?.amount ?? ''));
    setCurrency(String(original?.reference_capital?.currency ?? ''));
    setError(''); setEditing(false);
  };
  if (!original) return <p role="alert">No se pudo interpretar el perfil guardado. Recuperalo desde el chat antes de editarlo.</p>;
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if ((capital !== '' && (!Number.isFinite(Number(capital)) || Number(capital) < 0)) || (!!capital !== !!currency.trim())) { setError('Completá el capital y su moneda, o dejá ambos vacíos.'); return; }
    const next = { ...original };
    if (capital !== '') next.reference_capital = { ...original.reference_capital, amount: Number(capital), currency: currency.trim().toUpperCase() };
    else delete next.reference_capital;
    fields.forEach(([key]) => {
      if (draft[key] === '') { delete next[key]; return; }
      // Conserva el tipo publicado. Los límites se guardan como texto, sin interpretarlos.
      next[key] = Array.isArray(original[key]) ? draft[key].split('\n').filter(Boolean) : draft[key];
    });
    setBusy(true);
    try { await saveSpaceItem('profile', item?.key || 'perfil', { title: item?.title || 'Mi perfil', content: JSON.stringify(next), format: 'json', visibility: item?.visibility || 'private' }); setEditing(false); onChanged(); }
    catch { setError('No se pudo guardar el perfil. Tus cambios siguen en el formulario.'); }
    finally { setBusy(false); }
  };
  return <form className="profile-form" onSubmit={save}>{!item && <p>Definí tu capital, horizonte y límites. Podés dejar sin completar lo que todavía no decidiste.</p>}
    <div className="profile-capital"><label>Capital de referencia<input aria-label="Capital de referencia" inputMode="decimal" value={capital} readOnly={!editing} onChange={event => setCapital(event.target.value)}/></label><label>Moneda<input aria-label="Moneda" maxLength={8} value={currency} readOnly={!editing} onChange={event => setCurrency(event.target.value)}/></label></div>
    {fields.map(([key, label]) => <label key={key}>{label}<textarea aria-label={label} rows={key === 'risk_limits' ? 3 : 1} value={draft[key]} readOnly={!editing} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))}/></label>)}
    {error && <p role="alert">{error}</p>}<div className="profile-actions">{editing ? <><button type="button" disabled={busy} onClick={cancel}>Cancelar</button><button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar perfil'}</button></> : <button type="button" onClick={() => setEditing(true)}>Editar perfil</button>}</div>
  </form>;
}
