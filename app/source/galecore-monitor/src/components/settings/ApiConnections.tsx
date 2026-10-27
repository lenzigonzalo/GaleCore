import React from 'react';

/** Fuentes de datos y acceso a GaleCore; las cuentas de IA se administran por separado. */
export function ApiConnections() {
  return <div className="prefs">
    <section className="prefs-group">
      <h2>GaleCore</h2>
      <div className="prefs-block"><span>Acceso con tu cuenta</span><small>El monitor usa tu sesión de GaleCore. No necesitás ingresar una API key compartida.</small></div>
    </section>
    <section className="prefs-group">
      <h2>Fuentes de datos</h2>
      <div className="prefs-block"><span>FRED</span><small>La clave se configura en el servidor de GaleCore. Todavía no se pueden guardar claves personales desde esta pantalla.</small></div>
      <div className="prefs-block"><span>Alpha Vantage</span><small>Si lo usás como conector MCP, su conexión se administra en Proveedores de IA → Servidores MCP. La carga de una API key personal en GaleCore todavía no está disponible.</small></div>
    </section>
  </div>;
}
