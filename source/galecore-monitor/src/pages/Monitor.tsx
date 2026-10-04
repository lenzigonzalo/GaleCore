import React from 'react';
import { KeyRound } from 'lucide-react';
import { PositionMonitor } from '../components/positions/PositionMonitor';
import { SectionTitle } from '../components/common/SectionTitle';
import { NoticePanel } from '../components/common/NoticePanel';
import { useAccountStore } from '../store/useAccountStore';
import { ConnectionStatus } from '../socket/useMarketSocket';

interface Props {
  subscribeLeg:   (sym: string) => void;
  unsubscribeLeg: (sym: string) => void;
  /** Para los SUBYACENTES de las posiciones (sin Greeks). Ver el comentario en PositionMonitor. */
  subscribeSymbol:   (sym: string) => void;
  unsubscribeSymbol: (sym: string) => void;
  socketStatus:   ConnectionStatus;
}

/**
 * Monitor — posiciones abiertas de la cuenta. Es TRANSVERSAL: monitorea lo que hay en la cuenta sin
 * importar qué estrategia lo abrió, y por eso no tiene switch ni References.
 *
 * El título vive acá y no en `PositionMonitor` para no meterle chrome de página a un componente que
 * es contenido. `minHeight: 0` en el contenedor del scroll no es decorativo: sin él, un hijo con
 * `height: 100%` dentro de un flex column desborda en vez de scrollear.
 *
 * SIN CUENTA DE BRÓKER USABLE se reduce al encabezado más un cartel, igual que la pantalla de
 * una estrategia en OFF. No es un caso de error: es lo que ve un operador recién dado de alta, y sin
 * cuenta no hay posiciones que monitorear ni legs que suscribir. Cortar el árbol acá evita que
 * `PositionMonitor` monte sus efectos para una lista que siempre va a estar vacía.
 *
 * Son DOS estados y cada uno tiene su cartel: no vinculó ninguna, o vinculó una cuyo refresh token
 * Tastytrade rechaza. La pantalla se recorta igual en los dos —no hay datos en ninguno—, pero el
 * texto manda a hacer cosas distintas, y decirle "vinculá tu cuenta" a alguien que ya la vinculó lo
 * deja mirando un formulario lleno sin saber qué cambiar.
 */
export function Monitor({ subscribeLeg, unsubscribeLeg, subscribeSymbol, unsubscribeSymbol, socketStatus }: Props) {
  const brokerAccountIssue = useAccountStore((s) => s.brokerAccountIssue);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Inter, sans-serif' }}>
      <SectionTitle
        title="GaleCore Monitor"
        badge="Positions Manager"
        style={{ padding: '14px 18px 12px', flexShrink: 0 }}
      />

      {brokerAccountIssue ? (
        <div style={{ padding: '0 18px' }}>
          {brokerAccountIssue === 'not_linked' ? (
            <NoticePanel
              color="var(--blue-gc)"
              icon={<KeyRound size={20} />}
              title="Sin cuenta de bróker"
              detail="El Monitor muestra las posiciones de tu cuenta, y todavía no vinculaste ninguna: no hay balances, ni posiciones, ni Greeks que seguir."
              hint="Vinculala en Mi Cuenta › Configuración › Cuenta de bróker, con tu número de cuenta y el refresh token de Tastytrade."
            />
          ) : (
            <NoticePanel
              color="var(--yellow-gc)"
              icon={<KeyRound size={20} />}
              title="Credencial de bróker rechazada"
              detail="Tu cuenta está vinculada, pero Tastytrade no acepta su credencial: no se pueden leer balances ni posiciones. La causa más común es que el refresh token y el client secret sean de aplicaciones OAuth distintas."
              hint="Revisalos en Mi Cuenta › Configuración › Cuenta de bróker: los dos tienen que ser de la misma aplicación OAuth, y el token tiene que seguir vigente."
            />
          )}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <PositionMonitor
            subscribeLeg={subscribeLeg}
            unsubscribeLeg={unsubscribeLeg}
            subscribeSymbol={subscribeSymbol}
            unsubscribeSymbol={unsubscribeSymbol}
            socketStatus={socketStatus}
          />
        </div>
      )}
    </div>
  );
}
