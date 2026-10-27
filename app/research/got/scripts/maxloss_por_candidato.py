# -*- coding: utf-8 -*-
"""Cuantos candidatos sobreviven al limite de MaxRisk, y por que el limite no puede funcionar.

Reproduce los numeros de la seccion 39. El maxloss de un vertical de riesgo definido es

    MaxLoss = (Width - Credit) x 100

y el filtro pide MaxLoss <= MaxRisk. La seccion 39 lo midio el 2026-08-24 sobre TSLA y
encontro que elimina el 100%; esto lo corre sobre cualquier carpeta de capturas.

Ademas imprime la cuenta que muestra que el problema NO es el valor del umbral:

  * Con un ancho w, el maxloss maximo posible es w x 100 (credito cero). Si w x 100 <= MaxRisk
    el filtro no puede rechazar NADA, sea cual sea el credito.
  * Si puede rechazar, exige Credit >= w - MaxRisk/100, o sea Credit/Width >= 1 - MaxRisk/(100w).
    Y Credit/Width no supera aproximadamente el delta del short leg, asi que el filtro se
    traduce en un piso de DELTA -- que compite con el techo que le pone WD (43.2).

O sea que MaxRisk en dolares absolutos no expresa el riesgo que uno quiere tomar: es una
consecuencia del ancho y del precio del subyacente. Por eso la 39 y la 72 plantean moverlo a
un porcentaje del capital.

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/maxloss_por_candidato.py [carpeta] [maxrisk]

`carpeta` es un subdirectorio de research/got/data/ (por defecto el mas reciente).
`maxrisk` en dolares (por defecto 400, el parametro historico de la 39).
"""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skew_por_lado import ROOT, TARGETS, WIDTH, candidato, carpeta_por_defecto, load


def main():
    argv = sys.argv[1:]
    carpeta = os.path.join(ROOT, argv[0]) if argv else carpeta_por_defecto()
    maxrisk = float(argv[1]) if len(argv) > 1 else 400.0

    archivos = sorted(glob.glob(os.path.join(carpeta, '*_gex_*.csv')))
    if not archivos:
        print('Sin CSV en %s' % carpeta)
        return 1

    print('MaxLoss = (Width - Credit) x 100   contra   MaxRisk = $%.0f' % maxrisk)
    print('Captura: %s   |   Width = %.1f (el unico que traen los CSV)\n'
          % (os.path.basename(os.path.normpath(carpeta)), WIDTH))
    print('%-6s %-11s %-5s %-5s %-8s %-9s %s'
          % ('sim', 'vencimiento', 'lado', 'delta', 'credito', 'maxloss', 'pasa'))
    print('-' * 62)

    total = pasan = 0
    for path in archivos:
        sym, exp = os.path.basename(path).replace('.csv', '').split('_gex_')
        rows, _ = load(path)
        for side in ('PUT', 'CALL'):
            for t in TARGETS:
                got = candidato(rows, side, t)
                if not got:
                    continue
                _, d, c = got
                ml = (WIDTH - c) * 100
                ok = ml <= maxrisk
                total += 1
                pasan += 1 if ok else 0
                print('%-6s %-11s %-5s %-5.3f $%-7.2f $%-8.0f %s'
                      % (sym, exp, side, d, c, ml, 'si' if ok else 'NO'))

    print('\n%d de %d candidatos pasan (%.0f%%)' % (pasan, total, 100.0 * pasan / total if total else 0))

    # La cuenta que dice que el umbral no tiene un valor bueno, solo anchos donde es vacuo
    # y anchos donde es letal.
    print('\nPor que el umbral no puede calibrarse solo:')
    for w in (1.0, 2.5, 5.0, 10.0):
        techo = w * 100
        if techo <= maxrisk:
            print('  width %-5.1f  maxloss maximo posible $%-6.0f  ->  el filtro NO puede rechazar nada'
                  % (w, techo))
        else:
            cred = w - maxrisk / 100.0
            print('  width %-5.1f  exige Credit >= $%.2f  ->  Credit/Width >= %.2f  ->  delta del short >= ~%.2f'
                  % (w, cred, cred / w, cred / w))
    print('\n  El piso de delta que impone compite con el techo que le pone WD (43.2): los dos')
    print('  filtros terminan pidiendo cosas contrarias sobre la misma variable.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
