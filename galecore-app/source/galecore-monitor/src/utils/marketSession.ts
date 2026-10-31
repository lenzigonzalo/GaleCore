import { TickerState } from '../types/market';
import { fmtTime, MARKET_TZ } from './formatters';

/** Horario regular ET; dentro del horario sólo se confirma apertura con señal reciente del proveedor. */
export function regularSessionLabel(now:Date, ticker:TickerState|undefined, connected:boolean):string {
  const day=now.toLocaleDateString('en-US',{timeZone:MARKET_TZ,weekday:'short'});
  const time=fmtTime(now).split(':').map(Number);
  const minutes=time[0]*60+time[1];
  if (day === 'Sat' || day === 'Sun' || minutes < 570 || minutes >= 960) return 'Rueda regular cerrada';
  const statusTime=ticker?.marketStatusReceivedAt;
  const sourceTime=ticker?.marketStatusSourceAt;
  if (!connected || !statusTime || !sourceTime || !Number.isFinite(sourceTime.getTime()) || sourceTime.getTime() > now.getTime() || now.getTime()-sourceTime.getTime() > 60000 || now.getTime()-statusTime.getTime() > 60000) return 'Apertura sin confirmar';
  return ticker?.extendedTradingHours === false ? 'Rueda regular abierta' : ticker?.extendedTradingHours === true ? 'Fuera de rueda regular' : 'Apertura sin confirmar';
}
