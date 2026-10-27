# -*- coding: utf-8 -*-
"""Cuantos vencimientos regulares entran en el bucle de la seccion 47.

El alcance inicial de GOT recorre, por simbolo, sus *vencimientos regulares* con
DTE <= 60. "Regular" es el vencimiento estandar mensual: el tercer viernes del mes
(Tastytrade lo devuelve como expiration-type "Regular"; los demas son "Weekly",
"Quarterly" o "Mini"). Este script contesta dos cosas que entran a la definicion:

  1. cuantos vencimientos tiene el bucle segun el dia desde el que se mire, y
  2. si un vencimiento dado es regular o weekly.

Sin dependencias externas. No lee data/: es una cuenta de calendario, no una medicion.

    python research/got/scripts/vencimientos_regulares.py
    python research/got/scripts/vencimientos_regulares.py 2026-09-04 2026-10-16
"""
import datetime as dt
import sys
from collections import Counter

MAX_DTE = 60


def tercer_viernes(anio, mes):
    d = dt.date(anio, mes, 1)
    d += dt.timedelta(days=(4 - d.weekday()) % 7)   # primer viernes
    return d + dt.timedelta(days=14)


def regulares(desde, hasta):
    out, y, m = [], desde.year, desde.month
    while dt.date(y, m, 1) <= hasta:
        out.append(tercer_viernes(y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return [d for d in out if desde <= d <= hasta]


def bucle(obs):
    """Los vencimientos regulares que el flujo recorre mirando desde `obs`."""
    return regulares(obs, obs + dt.timedelta(days=MAX_DTE))


def es_regular(fecha):
    return fecha == tercer_viernes(fecha.year, fecha.month)


def main():
    argv = sys.argv[1:]

    if argv:
        # Modo consulta: clasificar las fechas que se pasen.
        print('Vencimiento   tipo      tercer viernes de su mes')
        for a in argv:
            f = dt.date(*map(int, a.split('-')))
            tv = tercer_viernes(f.year, f.month)
            tipo = 'REGULAR' if es_regular(f) else 'weekly '
            print('%s    %s   %s' % (f, tipo, tv))
        return

    hoy = dt.date.today()
    print('Bucle de la seccion 47 -- vencimientos regulares con DTE <= %d\n' % MAX_DTE)
    print('Desde hoy (%s): %s' % (
        hoy, ', '.join('%s (%dd)' % (d, (d - hoy).days) for d in bucle(hoy)) or 'ninguno'))

    # Cuantos hay, segun el dia de observacion, sobre un anio completo.
    c = Counter()
    ejemplo = {}
    for i in range(365):
        obs = hoy + dt.timedelta(days=i)
        n = bucle(obs)
        c[len(n)] += 1
        ejemplo.setdefault(len(n), (obs, n))

    print('\nSobre 365 dias de observacion consecutivos:')
    for k in sorted(c):
        obs, n = ejemplo[k]
        print('  %d vencimiento(s): %3d dias (%4.1f%%)   ej. %s -> %s' % (
            k, c[k], 100.0 * c[k] / 365, obs,
            ', '.join('%s (%dd)' % (d, (d - obs).days) for d in n)))

    # Los dos vencimientos sobre los que se valido el v5.
    print('\nLos vencimientos de data/2026-08-24/:')
    for a in ('2026-09-04', '2026-10-16'):
        f = dt.date(*map(int, a.split('-')))
        print('  %s  %s  (tercer viernes de ese mes: %s)' % (
            f, 'REGULAR' if es_regular(f) else 'WEEKLY -- fuera del bucle',
            tercer_viernes(f.year, f.month)))


if __name__ == '__main__':
    main()
