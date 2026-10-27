# -*- coding: utf-8 -*-
"""
Paso 3 de la 61.9: reconstruir la banda de gamma historicamente y escribir la tabla de
observaciones.

La 61.9 se reduce a una sola afirmacion falsable:

    La probabilidad empirica de que el precio TERMINE MAS ALLA del borde externo de una banda
    de gamma dominante es menor que el delta de ese borde.

Este script no la contesta: produce la tabla sobre la cual se contesta. Un renglon por
(simbolo, vencimiento, lado), con el borde, su delta y el resultado observado.

TRES DECISIONES DE DISENO, tomadas antes de correr nada:

  1. "Cruzar" = TERMINAR MAS ALLA, no tocar. El delta aproxima P(terminar ITM), no P(tocar);
     para un proceso sin deriva P(tocar) ~ 2 x P(terminar mas alla), asi que medir toque
     contra delta da falso por construccion. El toque se registra igual (`toco`), pero como
     dato descriptivo: no tiene umbral contra el cual compararse.

  2. Se usa la historia ENTERA (2013-2025) y la dependencia entre SPY/QQQ/IWM se trata
     clusterizando por fecha de vencimiento, no asumiendo que son 1 o 3 observaciones. La
     ventana 2013-2017 queda marcada (`ventana`) para poder confirmar sobre ella, que es lo
     unico que el backtesting no agoto.

  3. La banda se mide a DTE 45 fijo -- una foto por ciclo, para que el conteo de
     observaciones sea el de caminos de precio y no el de fotos.

LA ARITMETICA DE LA BANDA NO SE REIMPLEMENTA: se importa `medir()` de `banda_de_gamma.py`,
que es el codigo que produjo los numeros de la 61. Este script solo adapta la cadena
historica (parquet) a la forma de fila que ese codigo espera y le agrega el resultado.

OJO: research/data/ esta en .gitignore. Si no encuentra nada no es un bug, es que estas en
otra maquina. La SALIDA si se versiona -- es la unica forma de que estos numeros sean
reproducibles fuera de aca (seccion 5 del hallazgo del 2026-08-27).

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/banda_historica.py [--simbolos spy,qqq,iwm]

Tarda unos minutos: lee 39 parquet de 15 a 64 MB.
"""
import argparse
import calendar
import csv
import datetime as dt
import glob
import math
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import pandas as pd
    import pyarrow.parquet as pq
except ImportError:
    sys.exit('Necesita pandas y pyarrow.')

from banda_de_gamma import medir, interpolar_strike  # noqa: E402  la MISMA banda de la 61

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data')
SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data',
                      'obs_banda_historica.csv')
# La tabla de CONTROL. Ver `calibracion()`.
SALIDA_CAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data',
                          'obs_calibracion_delta.csv')
CAL_MIN, CAL_MAX = 0.03, 0.45   # la franja de delta que la zona de la 61.3 puede tocar

DTE_OBJETIVO = 45     # decision 3
DTE_TOLERANCIA = 5    # si el dia habil mas cercano se pasa de esto, el ciclo se descarta
EXCL = 0.15           # zona del dinero excluida, en EM (61.4, adoptado el 2026-08-26)
DELTA_MAX = 0.20      # el piso de riesgo de la 61.3, para registrar cual condicion ata
FRAC_EM = 0.25        # ancho de la banda en EM (61.4). Sin calibrar: se barre con --frac
FRAC = FRAC_EM

# Hasta feb-2015 el mensual LISTADO vencia el sabado siguiente al tercer viernes. El precio
# de liquidacion sigue siendo el del viernes: el sabado no se opera.
CORTE_SABADO = dt.date(2015, 2, 1)


# ------------------------------------------------------------------ los vencimientos

def tercer_viernes(y, m):
    vs = [dt.date(y, m, d) for d in range(1, calendar.monthrange(y, m)[1] + 1)
          if dt.date(y, m, d).weekday() == 4]
    return vs[2]


def mensuales_canonicos(presentes):
    """El mensual de cada mes, y NO 'lo que caiga viernes o sabado entre el 15 y el 22'.

    Ese filtro -- el de `inventario_historia.py` -- tambien atrapa WEEKLIES: en 24 meses del
    dataset hay dos fechas que lo pasan (2014-08-16 es el mensual, 2014-08-22 es un weekly), y
    con eso el conteo de la muestra sale ~15% inflado. Es el mismo defecto que el hallazgo del
    2026-08-24 encontro en el `4-Sep`.

    Tres casos que hay que tratar aparte, y ninguno se deduce de la regla:
      * hasta feb-2015 el listado vence el SABADO siguiente al tercer viernes;
      * cuando el tercer viernes es Good Friday el mercado no abre y el mensual se corre al
        JUEVES (2019-04-18, 2022-04-14, 2025-04-17);
      * los meses en que el mensual no esta en la cadena simplemente no entran.
    """
    out = []
    for y in range(2013, 2029):
        for m in range(1, 13):
            tv = tercer_viernes(y, m)
            cand = [tv + dt.timedelta(days=1)] if tv < CORTE_SABADO else [tv]
            cand.append(tv - dt.timedelta(days=1))   # Good Friday: se corre al jueves
            for c in cand:
                if c in presentes:
                    out.append(c)
                    break
    return out


# ------------------------------------------------------------------ lectura

def cargar_cadena(sym):
    cols = ['expiration', 'strike', 'type', 'date', 'open_interest',
            'gamma', 'delta', 'implied_volatility']
    partes = []
    for p in sorted(glob.glob(os.path.join(BASE, f'{sym}_options', f'{sym}_options_*.parquet'))):
        partes.append(pq.read_table(p, columns=cols).to_pandas())
    df = pd.concat(partes, ignore_index=True)
    df['expiration'] = pd.to_datetime(df['expiration']).dt.date
    df['date'] = pd.to_datetime(df['date']).dt.date
    return df


def cargar_subyacente(sym):
    t = pq.read_table(os.path.join(BASE, f'{sym}_options', f'{sym}_underlying_prices.parquet'),
                      columns=['date', 'high', 'low', 'close']).to_pandas()
    t['date'] = pd.to_datetime(t['date']).dt.date
    return t.set_index('date').sort_index()


# ------------------------------------------------------------------ el adaptador

def filas(snap, spot):
    """La cadena historica en la forma de fila que `medir()` espera.

    GEX = gamma x OI x 100 x spot^2 / 1e6, con el put en negativo -- la formula de
    `GammaExposureHandler.cs`, que es la que produjo los CSV sobre los que se escribio la 61.
    El factor `100 x spot^2 / 1e6` es constante dentro de una foto, asi que no mueve la banda;
    se aplica igual para que las columnas signifiquen lo mismo que en los CSV.
    """
    k = 100 * spot * spot / 1e6
    por_strike = {}
    for r in snap.itertuples(index=False):
        d = por_strike.setdefault(r.strike, {'strike': r.strike})
        lado = 'call' if r.type == 'call' else 'put'
        oi = r.open_interest or 0
        gex = (r.gamma or 0.0) * oi * k
        d[lado + 'GEX_musd'] = gex if lado == 'call' else -gex
        d[lado + 'Delta'] = r.delta
        d[lado + 'IV'] = r.implied_volatility
        d[lado + 'OI'] = oi
    return [por_strike[x] for x in sorted(por_strike)]


def atm_iv(snap, spot):
    """IV del strike mas cercano al spot, PROMEDIANDO call y put.

    No se puede tomar un solo lado: el README de data/ mide `callIV - putIV` de +0.019 a
    +0.024 cerca del dinero y nunca negativo -- las dos series estan en niveles distintos por
    el forward/dividendo que asume el proveedor. El promedio cancela ese sesgo a primer orden.
    """
    ks = sorted(set(snap['strike']))
    if not ks:
        return None
    k = min(ks, key=lambda x: abs(x - spot))
    ivs = [v for v in snap[snap['strike'] == k]['implied_volatility'] if v and v == v and v > 0]
    return statistics.mean(ivs) if ivs else None


def delta_interpolado(pts, strike):
    """|delta| en un strike arbitrario, interpolando entre los dos que lo abrazan.

    `delta_en()` de `banda_de_gamma` devuelve el del strike MAS CERCANO, que alcanza con
    grilla de $1 pero no con la de $5 del ala -- y el borde de la banda cae donde cae, no
    sobre un strike listado.
    """
    pts = sorted(pts)
    if not pts:
        return None
    if strike <= pts[0][0]:
        return pts[0][1]
    if strike >= pts[-1][0]:
        return pts[-1][1]
    for (k1, d1), (k2, d2) in zip(pts, pts[1:]):
        if k1 <= strike <= k2:
            return d1 if k2 == k1 else d1 + (strike - k1) * (d2 - d1) / (k2 - k1)
    return None


def calibracion(tabla, lado, spot_venc, camino, borde):
    """El CONTROL, y sin el la medicion no significa nada.

    La hipotesis de la 61.9 compara la tasa empirica del borde contra SU delta. Pero si la
    tasa empirica esta por debajo del delta en TODA la cadena -- que es el VRP, o sea el edge
    test de la 43.3 que ya pertenece a RPF (61.8) -- entonces encontrarlo en el borde de la
    banda no dice nada sobre el muro. La pregunta que decide si GOT existe no es "el borde
    cumple?", es "el borde cumple MAS que un strike cualquiera de su mismo delta?".

    Por eso, ademas del borde, se registra el resultado de TODOS los strikes vendibles del
    ciclo con su delta. Con eso se construye la curva empirica P(terminar mas alla | delta) y
    el borde se mide contra ella, no solo contra su delta nominal.

    Es el control que este research fallo tres veces (43.2, 61.3, 43.2). Las tres veces la
    respuesta fue "eso es delta".
    """
    out = []
    lo, hi = float(camino['low'].min()), float(camino['high'].max())
    for k, d in tabla:
        if not (CAL_MIN <= d <= CAL_MAX):
            continue
        if lado == 'PUT':
            cerro, toco = spot_venc < k, lo <= k
        else:
            cerro, toco = spot_venc > k, hi >= k
        out.append((k, d, int(cerro), int(toco), int(abs(k - borde) < 1e-9)))
    return out


# ------------------------------------------------------------------ el recorrido

def observaciones(sym, df, sub, avisos):
    presentes = set(df['expiration'].unique())
    dias_sub = sub.index
    filas_out = []
    cal_out = []

    for venc in mensuales_canonicos(presentes):
        sub_venc = df[df['expiration'] == venc]

        # el precio de liquidacion: el vencimiento, o el dia habil anterior si vencia sabado
        liq = venc
        while liq not in dias_sub and liq > venc - dt.timedelta(days=5):
            liq -= dt.timedelta(days=1)
        if liq not in dias_sub:
            avisos.append(sym + ' ' + str(venc) + ': sin precio de liquidacion')
            continue

        # la fecha de medicion: el dia de cadena mas cercano a DTE 45
        objetivo = venc - dt.timedelta(days=DTE_OBJETIVO)
        dias = sorted(set(sub_venc['date']))
        if not dias:
            continue
        med = min(dias, key=lambda d: abs((d - objetivo).days))
        dte = (venc - med).days
        if abs(dte - DTE_OBJETIVO) > DTE_TOLERANCIA:
            avisos.append(sym + ' ' + str(venc) + ': el dia mas cercano a DTE '
                          + str(DTE_OBJETIVO) + ' da DTE ' + str(dte))
            continue
        if med not in dias_sub:
            avisos.append(sym + ' ' + str(venc) + ': sin spot el ' + str(med))
            continue

        snap = sub_venc[sub_venc['date'] == med]
        spot = float(sub.loc[med, 'close'])
        iv = atm_iv(snap, spot)
        if not iv:
            avisos.append(sym + ' ' + str(venc) + ': sin ATM IV el ' + str(med))
            continue
        em = spot * iv * math.sqrt(dte / 365.0)
        rows = filas(snap, spot)

        camino = sub.loc[med:liq]
        spot_venc = float(sub.loc[liq, 'close'])

        for lado in ('PUT', 'CALL'):
            col = 'putDelta' if lado == 'PUT' else 'callDelta'
            tabla = sorted((r['strike'], abs(r[col])) for r in rows
                           if r.get(col) is not None and r[col] == r[col])
            m = medir(rows, spot, em, lado, frac=FRAC, excl=EXCL)
            if not m:
                avisos.append(sym + ' ' + str(venc) + ' ' + lado + ': pool insuficiente')
                continue

            borde = m['borde']
            d_borde = delta_interpolado(tabla, borde)
            # el strike del corte de delta, y cual de las dos condiciones ata (61.7 paso 8)
            k_dmax = interpolar_strike(tabla if lado == 'CALL' else sorted(tabla, reverse=True),
                                       DELTA_MAX)
            if k_dmax is None:
                ata = ''
            elif lado == 'PUT':
                ata = 'banda' if borde < k_dmax else 'delta'
            else:
                ata = 'banda' if borde > k_dmax else 'delta'

            if lado == 'PUT':
                cerro = spot_venc < borde
                toco = float(camino['low'].min()) <= borde
            else:
                cerro = spot_venc > borde
                toco = float(camino['high'].max()) >= borde

            filas_out.append(dict(
                simbolo=sym.upper(), vencimiento=venc.isoformat(), lado=lado,
                ventana='2013-2017' if venc.year <= 2017 else '2018-2025',
                fecha_medicion=med.isoformat(), dte=dte,
                spot=round(spot, 2), atm_iv=round(iv, 5), em=round(em, 3),
                w=round(FRAC * em, 3),
                banda_lo=round(m['lo'], 2), banda_hi=round(m['hi'], 2),
                pct_lado=round(m['pct'], 2),
                xmed=round(m['xmed'], 3),
                xvalle='' if m['xvalle'] is None else round(m['xvalle'], 3),
                argmax=m['argmax'],
                borde=round(borde, 2),
                delta_borde='' if d_borde is None else round(d_borde, 4),
                k_delta_max='' if k_dmax is None else round(k_dmax, 2),
                ata=ata,
                spot_venc=round(spot_venc, 2),
                cerro_mas_alla=int(cerro),
                toco=int(toco),
            ))

            for k, d, c, t, es_borde in calibracion(tabla, lado, spot_venc, camino, borde):
                cal_out.append(dict(
                    simbolo=sym.upper(), vencimiento=venc.isoformat(), lado=lado,
                    ventana='2013-2017' if venc.year <= 2017 else '2018-2025',
                    strike=k, delta=round(d, 4),
                    cerro_mas_alla=c, toco=t, es_borde=es_borde,
                ))
    return filas_out, cal_out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--simbolos', default='spy,qqq,iwm')
    ap.add_argument('--frac', type=float, default=FRAC_EM,
                    help='ancho de banda en EM. La 61.4 lo deja sin calibrar y mide que mueve '
                         'el borde $9.6 en promedio: el barrido es el control de que el '
                         'resultado no depende de el.')
    ap.add_argument('--sufijo', default='',
                    help='se agrega al nombre de los CSV, para no pisar la corrida base')
    args = ap.parse_args()

    global FRAC, SALIDA, SALIDA_CAL
    FRAC = args.frac
    if args.sufijo:
        SALIDA = SALIDA.replace('.csv', '_' + args.sufijo + '.csv')
        SALIDA_CAL = SALIDA_CAL.replace('.csv', '_' + args.sufijo + '.csv')

    if not os.path.isdir(BASE):
        sys.exit('No existe ' + BASE + '. research/data/ esta gitignoreado: estas en otra maquina.')

    avisos, todas, cal = [], [], []
    for sym in args.simbolos.split(','):
        sym = sym.strip().lower()
        print('  ' + sym + ': leyendo cadena...', flush=True)
        df = cargar_cadena(sym)
        sub = cargar_subyacente(sym)
        obs, obs_cal = observaciones(sym, df, sub, avisos)
        print('  ' + sym + ': ' + str(len(obs)) + ' observaciones de lado ('
              + str(len(obs) // 2) + ' ciclos), ' + str(len(obs_cal))
              + ' strikes de control', flush=True)
        todas += obs
        cal += obs_cal

    if not todas:
        sys.exit('Sin observaciones.')

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    for ruta, datos in ((SALIDA, todas), (SALIDA_CAL, cal)):
        with open(ruta, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=list(datos[0].keys()))
            w.writeheader()
            w.writerows(datos)

    print('\n  ' + str(len(todas)) + ' observaciones -> ' + os.path.relpath(SALIDA))
    print('  ' + str(len(cal)) + ' strikes de control -> ' + os.path.relpath(SALIDA_CAL))
    if avisos:
        print('\n  ' + str(len(avisos)) + ' ciclos descartados:')
        for a in avisos[:25]:
            print('    ' + a)
        if len(avisos) > 25:
            print('    ... y ' + str(len(avisos) - 25) + ' mas')
    return 0


if __name__ == '__main__':
    sys.exit(main())
