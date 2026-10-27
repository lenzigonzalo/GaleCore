# -*- coding: utf-8 -*-
"""
Paso 4 de la 61.9: medir la hipotesis unica sobre la tabla de observaciones.

    La probabilidad empirica de que el precio TERMINE MAS ALLA del borde externo de una banda
    de gamma dominante es menor que el delta de ese borde.

Se mide en DOS pasos, y el segundo es el que decide:

  TEST A -- el enunciado literal. Tasa empirica de `cerro_mas_alla` en los bordes contra el
  delta medio de esos bordes. Un A negativo es condicion NECESARIA para que GOT exista.

  TEST B -- el control, y es condicion SUFICIENTE. La misma diferencia, pero contra la curva
  empirica P(terminar mas alla | delta) construida sobre TODOS los strikes del mismo dataset.
  Si el delta sobreestima el riesgo en toda la cadena -- el VRP, que es el edge test de la
  43.3 y ya pertenece a RPF (61.8) -- entonces un A negativo no dice nada sobre el muro: dice
  que se midio VRP. Lo que le queda a GOT es lo que el borde saca POR ENCIMA de la curva.

  A negativo y B ~ 0  ->  "GOT es el edge test de la 43.3 con mas pasos" (la 61.9 misma).
  A negativo y B negativo  ->  el muro aporta informacion que el delta no tiene.

INFERENCIA: bootstrap por CLUSTER de fecha de vencimiento. SPY, QQQ e IWM del mismo mes no
son tres observaciones independientes -- los tres son renta variable estadounidense y dos de
ellos casi el mismo indice -- y los dos lados del mismo ciclo tampoco. Remuestrear ciclos
enteros no supone independencia entre simbolos ni entre lados: la mide.

La ventana 2013-2017 (211 obs) es la unica que el backtesting no declaro agotada, asi que se
reporta aparte: sobre 2018-2025 el resultado es exploratorio por regla, no por estadistica.

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/medir_61_9.py

Requiere haber corrido `banda_historica.py` antes. Sus dos CSV SI estan versionados, asi que
esto reproduce fuera de la maquina donde viven las cadenas.
"""
import argparse
import csv
import os
import random
import statistics
import sys

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OBS = os.path.join(DATA, 'obs_banda_historica.csv')
CAL = os.path.join(DATA, 'obs_calibracion_delta.csv')

B = 5000            # remuestreos del bootstrap
PASO_BIN = 0.025    # ancho del bin de delta de la curva de control
MIN_BIN = 200       # strikes minimos para que un bin cuente
random.seed(61_9)


def leer(ruta):
    if not os.path.exists(ruta):
        sys.exit('Falta ' + os.path.relpath(ruta) + '. Corre banda_historica.py primero.')
    with open(ruta, encoding='utf-8') as f:
        return list(csv.DictReader(f))


# ------------------------------------------------------------------ la curva de control

def curva(cal):
    """P_emp(terminar mas alla | delta, LADO), por bin de delta y por lado.

    Se construye SIN los strikes que son borde de banda (`es_borde`): si el borde entrara a
    su propia referencia, el test B se compararia contra si mismo y perderia potencia hacia
    el cero -- justo en la direccion que favorece al negativo.

    POR LADO, y no es un refinamiento: es lo que hace que el test B mida el muro. Entre 2013
    y 2025 el indice sube, asi que los CALL terminan mas alla mucho mas seguido que los PUT
    al mismo delta (0.389 contra 0.153 en los bordes). Una curva que mezcle los dos lados
    queda en el medio, y entonces la distancia del borde a la curva mide DERIVA -- le
    atribuye al muro un +0.155 del lado call y un -0.081 del lado put que son del mercado.
    Con una curva por lado, la deriva esta en la referencia y lo que sobra es del muro.
    """
    bins = {}
    for r in cal:
        if r['es_borde'] == '1':
            continue
        b = (r['lado'], int(float(r['delta']) / PASO_BIN))
        bins.setdefault(b, []).append(int(r['cerro_mas_alla']))
    return {b: (statistics.mean(v), len(v)) for b, v in bins.items() if len(v) >= MIN_BIN}


def predicho(c, lado, delta):
    b = int(delta / PASO_BIN)
    if (lado, b) in c:
        return c[(lado, b)][0]
    cerca = sorted((k for k in c if k[0] == lado), key=lambda x: abs(x[1] - b))
    return c[cerca[0]][0] if cerca else None


# ------------------------------------------------------------------ inferencia

def boot(clusters, f):
    """Bootstrap por cluster: se remuestrean ciclos enteros, no observaciones sueltas."""
    ks = list(clusters)
    out = []
    for _ in range(B):
        m = [x for k in (random.choice(ks) for _ in ks) for x in clusters[k]]
        v = f(m)
        if v is not None:
            out.append(v)
    out.sort()
    return out


def ic(muestras):
    if not muestras:
        return None, None
    return muestras[int(0.025 * len(muestras))], muestras[int(0.975 * len(muestras)) - 1]


def p_izq(muestras):
    """P(diferencia >= 0) -- la hipotesis dice que la diferencia es NEGATIVA."""
    return sum(1 for x in muestras if x >= 0) / len(muestras) if muestras else float('nan')


def diff_a(m):
    return statistics.mean(x[0] for x in m) - statistics.mean(x[1] for x in m)


def diff_b(m):
    v = [(a, p) for a, _, p in m if p is not None]
    return (statistics.mean(x[0] for x in v) - statistics.mean(x[1] for x in v)) if v else None


def reportar(nombre, filas, c):
    """filas = [(cerro, delta, predicho)]"""
    if len(filas) < 20:
        print('  {:<22} n={:<5} muestra insuficiente'.format(nombre, len(filas)))
        return
    clusters = {}
    for k, f in filas:
        clusters.setdefault(k, []).append(f)
    datos = [f for v in clusters.values() for f in v]

    emp = statistics.mean(x[0] for x in datos)
    dl = statistics.mean(x[1] for x in datos)
    a = emp - dl
    ba = boot(clusters, lambda m: diff_a([(x[0], x[1]) for x in m]))
    lo_a, hi_a = ic(ba)

    con_p = [x for x in datos if x[2] is not None]
    cur = statistics.mean(x[2] for x in con_p) if con_p else float('nan')
    b = (statistics.mean(x[0] for x in con_p) - cur) if con_p else float('nan')
    bb = boot(clusters, diff_b)
    lo_b, hi_b = ic(bb)

    print('  {:<22} n={:<5} k={:<4} emp {:.3f}  delta {:.3f} | '
          'A {:+.3f} [{:+.3f},{:+.3f}] p={:.3f} | curva {:.3f}  '
          'B {:+.3f} [{:+.3f},{:+.3f}] p={:.3f}'.format(
              nombre, len(datos), len(clusters), emp, dl,
              a, lo_a, hi_a, p_izq(ba), cur,
              b, lo_b, hi_b, p_izq(bb)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sufijo', default='', help='mide una corrida de `banda_historica --sufijo`')
    ap.add_argument('--breve', action='store_true', help='solo la linea de todo el dataset')
    args = ap.parse_args()
    suf = ('_' + args.sufijo) if args.sufijo else ''
    obs = leer(OBS.replace('.csv', suf + '.csv'))
    # La tabla de control casi no depende de `W`: lo unico que cambia es cual strike lleva
    # `es_borde`, y son 926 filas de 26678. Por eso el barrido de `W` versiona solo su tabla
    # de bordes y reusa esta, en vez de duplicar 1.3 MB identicos por cada valor.
    ruta_cal = CAL.replace('.csv', suf + '.csv')
    cal = leer(ruta_cal if os.path.exists(ruta_cal) else CAL)
    c = curva(cal)

    print('=' * 118)
    print('61.9 -- LA HIPOTESIS UNICA. "Cruzar" = terminar mas alla. Banda a DTE 45, W = 0.25 EM,')
    print('       zona del dinero excluida. Bootstrap de {} por cluster de vencimiento.'.format(B))
    print('=' * 118)

    print('\nCURVA DE CONTROL -- P_emp(terminar mas alla | delta, lado), sobre {} strikes'
          .format(sum(v[1] for v in c.values())))
    print('  {:>12} | {:>16} | {:>16}'.format('bin delta', 'PUT  n / P_emp', 'CALL  n / P_emp'))
    for b in sorted({k[1] for k in c}):
        cel = []
        for lado in ('PUT', 'CALL'):
            v = c.get((lado, b))
            cel.append('{:6d} / {:.3f}'.format(v[1], v[0]) if v else '     -- / --  ')
        print('  {:>5.3f}-{:<6.3f} | {:>16} | {:>16}'.format(
            b * PASO_BIN, (b + 1) * PASO_BIN, cel[0], cel[1]))

    filas = []
    for r in obs:
        if not r['delta_borde']:
            continue
        d = float(r['delta_borde'])
        filas.append((r['vencimiento'],
                      (int(r['cerro_mas_alla']), d, predicho(c, r['lado'], d), r)))

    def sub(pred):
        return [(k, (f[0], f[1], f[2])) for k, f in filas if pred(f[3])]

    print('\nA = empirica - delta nominal      (la 61.9 pide A < 0)')
    print('B = empirica - curva de control   (lo que el MURO aporta sobre el delta)')
    print('p = P(diferencia >= 0) bajo el bootstrap\n')

    print('TODO EL DATASET')
    reportar('todas', sub(lambda r: True), c)
    if args.breve:
        return 0

    print('\nPOR VENTANA  -- 2013-2017 es la unica que el backtesting no agoto')
    for v in ('2013-2017', '2018-2025'):
        reportar(v, sub(lambda r, v=v: r['ventana'] == v), c)

    print('\nPOR LADO  -- la 43.4 mide un sesgo por lado en el credito; aca se ve en el riesgo')
    for lado in ('PUT', 'CALL'):
        reportar(lado, sub(lambda r, l=lado: r['lado'] == l), c)

    print('\nPOR SIMBOLO')
    for s in ('SPY', 'QQQ', 'IWM'):
        reportar(s, sub(lambda r, s=s: r['simbolo'] == s), c)

    print('\nPOR CUAL CONDICION ATA (61.7 paso 8) -- "banda" es donde la estructura aporto algo')
    for a in ('banda', 'delta'):
        reportar(a, sub(lambda r, a=a: r['ata'] == a), c)

    # El mejor caso posible para la hipotesis. La 61.4 no declara umbral de `xmed` -- no hay
    # ninguna falla observada contra la cual declararlo -- asi que en vez de fijar uno se
    # parte la muestra en cuartiles: si el muro aporta algo, el cuarto mas concentrado es
    # donde tiene que aparecer.
    xs = sorted(float(r['xmed']) for r in obs if r['xmed'])
    q = [xs[int(f * len(xs))] for f in (0.25, 0.50, 0.75)]
    print('\nPOR CUARTIL DE xmed  -- cortes {:.2f} / {:.2f} / {:.2f}. Q4 = las bandas mas '
          'concentradas'.format(*q))
    lim = [(0, q[0]), (q[0], q[1]), (q[1], q[2]), (q[2], float('inf'))]
    for i, (lo, hi) in enumerate(lim, 1):
        reportar('Q{} xmed {:.2f}-{:.2f}'.format(i, lo, hi),
                 sub(lambda r, lo=lo, hi=hi: r['xmed'] and lo <= float(r['xmed']) < hi), c)

    tocos = [int(r['toco']) for r in obs]
    cerros = [int(r['cerro_mas_alla']) for r in obs]
    print('\nDESCRIPTIVO -- el TOQUE, que NO se compara contra delta (decision 1)')
    print('  toco {:.3f}   cerro mas alla {:.3f}   cociente {:.2f}x'
          '   (el principio de reflexion predice ~2x)'
          .format(statistics.mean(tocos), statistics.mean(cerros),
                  statistics.mean(tocos) / statistics.mean(cerros)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
