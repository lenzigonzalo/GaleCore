# -*- coding: utf-8 -*-
"""
Recalcula el filtro economico de GOT v5 sobre los datasets de TSLA.

Reproduce las cuatro tablas del hallazgo 2026-08-24 (la columna de credito equivocada
en las secciones 25 y 27 del v5). Para cada candidato imprime, lado a lado:

  * `credOK`  -- el credito CORRECTO del vertical de ese lado
                 (`pcsCredit_w5` para PUT, `ccsCredit_w5` para CALL)
  * `credDOC` -- lo que el v5 uso, que del lado CALL es la columna PCS

Implementa el modelo economico tal como lo declara el v5 (secciones 32 a 35):

    RRreq          = BaseRR * sqrt(30/DTE) * WDFactor(WD)     # secciones 32, 33, 34
    RequiredCredit = Width * RRreq / (1 + RRreq)              # seccion 34
    Cushion        = (Credit - RequiredCredit) / RequiredCredit  # seccion 35

y ademas chequea los dos filtros duros que lo acompanan: `WD >= 0.20` (seccion 19) y
`MaxLoss <= MaxRisk` (seccion 39).

Los muros y el Expected Move de cada vencimiento estan hardcodeados abajo: salen del
encabezado que imprime `gex-strikes.ps1` al capturar, y NO estan en el CSV. Los muros se
verificaron contra el extremo de callGEX/putGEX de cada cadena.

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/recheck_econ.py
"""
import csv
import math
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', '2026-08-24')

BASE_RR = 0.12   # seccion 32
WIDTH = 5.0      # ancho capturado en los CSV (columnas *_w5)
WD_MIN = 0.20    # seccion 19
MAX_RISK = 400.0  # seccion 39

# Seccion 33. Interpolacion lineal entre puntos; fuera de rango, plano.
WD_TABLE = [(0.20, 1.20), (0.30, 1.10), (0.40, 1.00),
            (0.50, 0.95), (0.75, 0.90), (1.00, 0.85)]


def wd_factor(wd):
    if wd <= WD_TABLE[0][0]:
        return WD_TABLE[0][1]
    if wd >= WD_TABLE[-1][0]:
        return WD_TABLE[-1][1]
    for (x0, y0), (x1, y1) in zip(WD_TABLE, WD_TABLE[1:]):
        if x0 <= wd <= x1:
            return y0 + (wd - x0) / (x1 - x0) * (y1 - y0)


def economics(width, dte, wd, credit):
    rr = BASE_RR * math.sqrt(30.0 / dte) * wd_factor(wd)
    required = width * rr / (1.0 + rr)
    return required, (credit - required) / required


def load(name):
    path = os.path.join(BASE, name)
    with open(path, encoding='utf-8-sig') as fh:
        return {float(r['strike']): r for r in csv.DictReader(fh)}


SEP4 = load('TSLA_gex_2026-09-04.csv')
SEP16 = load('TSLA_gex_2026-10-16.csv')

# (etiqueta, DTE, lado, muro, expected move, filas, strikes del sweep del v5)
CASES = [
    ('4 Sep', 11, 'PUT', 345.0, 25.7, SEP4, [325, 327.5, 330, 335, 337.5]),
    ('4 Sep', 11, 'CALL', 360.0, 25.7, SEP4, [395, 392.5, 387.5, 382.5, 380]),
    ('16 Oct', 56, 'PUT', 330.0, 59.7, SEP16, [295, 300, 305, 310, 315, 320]),
    ('16 Oct', 56, 'CALL', 400.0, 59.7, SEP16, [450, 445, 430, 425, 415, 410]),
]

HDR = '{:>7} {:>7} {:>6} {:>7} {:>8} {:>6} {:>8} {:>8}  {}'

for label, dte, side, wall, em, rows, strikes in CASES:
    print('\n=== TSLA %s  DTE %d  %s   wall %g  EM %g ===' % (label, dte, side, wall, em))
    print(HDR.format('K', 'delta', 'WD', 'credOK', 'credDOC', 'req', 'cushion', 'maxloss', 'veredicto'))
    for k in strikes:
        row = rows[k]
        if side == 'PUT':
            delta = abs(float(row['putDelta']))
            wd = (wall - k) / em
            credit = float(row['pcsCredit_w5'])
            doc = credit                       # el v5 leyo bien el lado put
        else:
            delta = float(row['callDelta'])
            wd = (k - wall) / em
            credit = float(row['ccsCredit_w5'])
            doc = float(row['pcsCredit_w5'])   # <- el error del v5

        if wd < WD_MIN:
            print(HDR.format('%g' % k, '%.4f' % delta, '%.3f' % wd, '%.2f' % credit,
                             '%.2f' % doc, '-', '-', '-', 'FALLA WD'))
            continue

        required, cushion = economics(WIDTH, dte, wd, credit)
        maxloss = (WIDTH - credit) * 100.0
        verdict = 'PASA' if cushion >= 0 else 'falla economico'
        if maxloss > MAX_RISK:
            verdict += '  [MaxRisk $%.0f > $%.0f]' % (maxloss, MAX_RISK)
        print(HDR.format('%g' % k, '%.4f' % delta, '%.3f' % wd, '%.2f' % credit,
                         '%.2f' % doc, '%.2f' % required, '%+.1f%%' % (cushion * 100),
                         '%.0f' % maxloss, verdict))

print('\nNota: credDOC del lado CALL es la columna pcsCredit_w5, que es lo que el v5 uso')
print('por error. Ver hallazgos/2026-08-24-credito-call-columna-equivocada.md')
