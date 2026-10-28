import React, { useState } from 'react';
import { Switch } from './LanguageSetting';
import { ChatPrefs, playChatSound, readChatPrefs, saveChatPrefs } from '../lab/labChatPrefs';

/** Configuración → General → Chat (WS-0067): sonidos y aviso del navegador al terminar o pedir permiso. */
export function ChatBehaviorSettings() {
  const [prefs, setPrefs] = useState<ChatPrefs>(readChatPrefs);
  const [denied, setDenied] = useState(false);
  const change = (patch: Partial<ChatPrefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); saveChatPrefs(next); };
  const toggleNotify = async (on: boolean) => {
    setDenied(false);
    if (!on) { change({ notify: false }); return; }
    try {
      const answer = typeof Notification === 'undefined' ? 'denied' : Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (answer === 'granted') change({ notify: true }); else setDenied(true);
    } catch { setDenied(true); }
  };
  return <div className="prefs">
    <section className="prefs-group">
      <h2>Chat</h2>
      <div className="prefs-row"><span>Sonido al terminar<small>Suena cuando el chat termina de responder</small></span>
        <Switch on={prefs.finishSound} label="Sonido al terminar" onChange={on => change({ finishSound: on })} /></div>
      <div className="prefs-row"><span>Sonido al pedir permiso<small>Suena cuando el chat necesita que decidas algo</small></span>
        <Switch on={prefs.permissionSound} label="Sonido al pedir permiso" onChange={on => change({ permissionSound: on })} /></div>
      <div className="prefs-row"><label htmlFor="chat-volume">Volumen</label>
        <div className="settings-language">
          <input id="chat-volume" type="range" min={0} max={100} step={5} value={Math.round(prefs.volume * 100)} onChange={e => change({ volume: Number(e.target.value) / 100 })} />
          <button type="button" className="btn" onClick={() => playChatSound('done', prefs.volume)}>Probar</button>
        </div></div>
      <div className="prefs-row"><span>Aviso del navegador<small>{denied ? 'El navegador no dio permiso para avisar.' : 'Si la pestaña no se ve, avisa con el nombre del chat'}</small></span>
        <Switch on={prefs.notify} label="Aviso del navegador" onChange={on => { void toggleNotify(on); }} /></div>
    </section>
  </div>;
}
