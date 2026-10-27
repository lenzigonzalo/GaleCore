# -*- coding: utf-8 -*-
"""
Que hay en research/data/, y alcanza para medir la 61.9?

La 61.9 dice que hacen falta ~300 observaciones independientes -- un camino de precio por par
(simbolo, vencimiento), no un strike -- y plantea tres salidas, la segunda de las cuales es
"comprar historia de cadenas con open interest". Este script verifica que esa historia YA
ESTA en la maquina, y cuenta cuanta muestra da.

Reproduce todos los numeros del hallazgo 2026-08-27-la-historia-ya-existe.md.

OJO: research/data/ esta en .gitignore. Los datos NO viajan con el repo, viven solo en la
maquina donde se bajaron. Si este script no encuentra nada, no es un bug: es que estas en otra
maquina. Ver la seccion 5 del hallazgo.

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/inventario_historia.py

Tarda unos minutos: lee la columna expiration de 39 parquet de varios cientos de MB.
"""
import glob
import os
import sys

try:
    import pandas as pd
    import pyarrow.parquet as pq
except ImportError:
    sys.exit('Necesita pandas y pyarrow.')

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data')
SIMBOLOS = ('spy', 'qqq', 'iwm')

# Lo que la banda de gamma de la 61.4 necesita de una cadena historica.
REQUERIDAS = ('strike', 'expiration', 'type', 'date', 'open_interest', 'gamma', 'delta',
              'implied_volatility')

# La ventana OOS que el README de research/backtesting declara AGOTADA: "cualquier corrida
# nueva sobre ella es exploratoria (genera hipotesis) -- no habilita nada". Lo anterior nunca
# se toco, asi que sirve de holdout limpio.
OOS_AGOTADA = (2018, 2025)


def es_mensual(d):
    """Tercer viernes -- o SABADO. Hasta febrero de 2015 los mensuales vencian el sabado
    siguiente al tercer viernes, y filtrar solo por viernes se come 2013 y 2014 enteros."""
    return d.weekday() in (4, 5) and 15 <= d.day <= 22


def archivos(sym):
    return sorted(glob.glob(os.path.join(BASE, f'{sym}_options', f'{sym}_options_*.parquet')))


def main():
    if not os.path.isdir(BASE):
        sys.exit(f'No existe {BASE}. research/data/ esta gitignoreado: estas en otra maquina.')

    print('=' * 78)
    print('1. COLUMNAS -- tiene la cadena lo que la banda necesita?')
    print('=' * 78)
    falta_algo = False
    for sym in SIMBOLOS:
        fs = archivos(sym)
        if not fs:
            print(f'  {sym.upper():5} sin archivos')
            falta_algo = True
            continue
        cols = set(pq.ParquetFile(fs[-1]).schema_arrow.names)
        faltan = [c for c in REQUERIDAS if c not in cols]
        print(f'  {sym.upper():5} {len(fs):2} archivos | ' +
              ('TODAS las columnas requeridas' if not faltan else f'FALTAN: {faltan}'))
        falta_algo |= bool(faltan)
    if falta_algo:
        print('\n  Sin open_interest y gamma por strike no se puede reconstruir la banda.')

    print('\n' + '=' * 78)
    print('2. COBERTURA Y CALIDAD -- una muestra por simbolo, el archivo mas reciente')
    print('=' * 78)
    for sym in SIMBOLOS:
        fs = archivos(sym)
        if not fs:
            continue
        d = pd.read_parquet(fs[-1], columns=['date', 'expiration', 'open_interest', 'gamma'])
        oi = d.open_interest
        print(f'  {sym.upper():5} {os.path.basename(fs[-1])}: {len(d):>9,} filas | '
              f'{d.date.nunique():3} dias | {d.expiration.nunique():3} vencimientos | '
              f'OI no nulo {100 * oi.notna().mean():5.1f}% | OI>0 {100 * (oi.fillna(0) > 0).mean():5.1f}% | '
              f'gamma no nula {100 * d.gamma.notna().mean():5.1f}%')

    print('\n' + '=' * 78)
    print('3. MUESTRA -- ciclos (simbolo, vencimiento mensual) con resultado ya observable')
    print('=' * 78)
    por_sym, vtos_todos = {}, {}
    for sym in SIMBOLOS:
        fs = archivos(sym)
        if not fs:
            continue
        v = set()
        for f in fs:
            v |= set(pd.to_datetime(
                pd.read_parquet(f, columns=['expiration']).expiration.unique()).date)
        vtos_todos[sym] = v
        # Solo los que ya vencieron dentro del dataset: hay camino de precio completo.
        # Los posteriores existen en la cadena (LEAPS) pero no tienen resultado.
        m = sorted(x for x in v if es_mensual(x) and x.year <= 2025)
        por_sym[sym] = m
        print(f'  {sym.upper():5} vencimientos totales {len(v):5} | MENSUALES ya vencidos {len(m):4}'
              f' | {m[0]} -> {m[-1]}')

    tot = sum(len(v) for v in por_sym.values())
    print(f'\n  TOTAL ciclos: {tot}   ->   {tot * 2} observaciones de lado')
    print(f'  La 61.9 pide del orden de 300.')

    print('\n' + '=' * 78)
    print('4. VENTANAS -- que parte es holdout limpio')
    print('=' * 78)
    lo, hi = OOS_AGOTADA
    limpia = {s: [x for x in m if x.year < lo] for s, m in por_sym.items()}
    gastada = {s: [x for x in m if lo <= x.year <= hi] for s, m in por_sym.items()}
    nl = sum(len(v) for v in limpia.values())
    ng = sum(len(v) for v in gastada.values())
    print(f'  2013-{lo - 1}  NO tocada por el OOS de backtesting : {nl:4} ciclos -> {nl * 2:4} obs')
    print(f'  {lo}-{hi}  ventana OOS declarada AGOTADA        : {ng:4} ciclos -> {ng * 2:4} obs')
    ciclos_unicos = len(set().union(*[set(v) for v in limpia.values()])) if limpia else 0
    print(f'\n  Conteo conservador por independencia (SPY/QQQ/IWM del mismo vencimiento NO son')
    print(f'  tres observaciones independientes): {ciclos_unicos} ciclos unicos en la ventana limpia,')
    print(f'  o sea {ciclos_unicos * 2} observaciones de lado. Para llegar a 300 hace falta la historia entera.')

    print('\n' + '=' * 78)
    print('5. DERIVADOS -- que ya esta calculado')
    print('=' * 78)
    for f in sorted(glob.glob(os.path.join(BASE, 'derived', '*.parquet'))):
        try:
            pf = pq.ParquetFile(f)
            print(f'  {os.path.basename(f):34} {pf.metadata.num_rows:>8,} filas | '
                  f'{list(pf.schema_arrow.names)}')
        except Exception as e:
            print(f'  {os.path.basename(f):34} ilegible: {e}')


if __name__ == '__main__':
    main()
