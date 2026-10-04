import React from 'react';
import { BrokerAccountCard } from '../components/account/BrokerAccountCard';
import { SectionTitle } from '../components/common/SectionTitle';

/**
 * Cuenta de bróker del operador — la pestaña que abre "Mi Cuenta › Cuenta de bróker".
 *
 * NO TIENE PESTAÑA EN LA BARRA: se llega solo desde el menú. Es de cada uno y no es algo que se
 * mire seguido —se entra a vincular la cuenta o a rotar el refresh token—, así que no gasta un
 * lugar en la nav.
 *
 * ES PARA TODOS, admin o no: de esta cuenta salen los balances y las posiciones de quien la
 * vincula. Hasta ahora vivía en la pestaña Admin, que por eso se le mostraba a cualquiera; con la
 * mudanza, Admin quedó con lo que administra a OTROS y volvió a ser solo de admin.
 */
export function MyAccount() {
  return (
    <div style={{ padding: '16px 18px 40px', fontFamily: 'var(--font-sans)' }}>
      <SectionTitle
        title="GaleCore Account"
        badge="credenciales del operador"
        style={{ marginBottom: 16 }}
      />

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 460px))',
        gap: 16, alignItems: 'start',
      }}>
        <BrokerAccountCard />
      </div>
    </div>
  );
}
