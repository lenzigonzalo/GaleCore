# -*- coding: utf-8 -*-
"""
Que explica el sesgo por lado: el nivel de IV, su pendiente, o el decaimiento del delta?

La seccion 43.5 dice que el sesgo por lado "no es una propiedad del motor: es la pendiente
local de la superficie de volatilidad". Hasta el 2026-08-25 esa frase no se podia verificar,
porque la API calculaba la IV por strike y la descartaba al mapear. Desde que
`/App/Gex/Analysis` la expone (`callIV` / `putIV`) y `gex-strikes.ps1` la escribe al CSV, se
puede medir en vez de inferirla de los precios.

Corre cuatro mediciones sobre la misma captura:

  1. NIVEL      IV de cada lado al MISMO |delta|, interpolada. Es la lectura ingenua:
                "los puts valen mas". Resulta que su signo va al REVES del sesgo.
  2. PENDIENTE  IV(pata comprada) - IV(pata vendida), que es de lo que depende el credito de
                un vertical -- no del nivel, porque el spread vende una y compra la otra.
  3. DESGLOSE   delta del short, delta del long, delta que abarca el spread, credito/ancho, y
                la metrica (credito/ancho)/|delta| de la 43.4, lado por lado.
  4. ANCHO      el cociente CALL/PUT del delta abarcado, barriendo el ancho en dolares. Es el
                control: si el sesgo fuera un artefacto de haber elegido width 5, el cociente
                se moveria con el ancho. No se mueve.

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/iv_por_lado.py [carpeta]

`carpeta` es un subdirectorio de research/got/data/ (por defecto el mas reciente). Necesita
las columnas callIV/putIV, que solo tienen las capturas desde el 2026-08-25-t2; contra una
carpeta mas vieja avisa y sale.
"""
import csv
import glob
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
WIDTH = 5.0
DELTA_OBJETIVO = 0.20
NIVELES = (0.10, 0.20, 0.30)
ANCHOS = (5.0, 10.0, 15.0, 20.0)

# El lado hacia el que queda la pata COMPRADA: el put credit spread compra mas abajo y el call
# credit spread mas arriba. De ese signo depende todo el calculo de pendiente.
LADOS = (('put', -1, 'pcsCredit_w5'), ('call', +1, 'ccsCredit_w5'))


def num(x):
    try:
        return float((x or '').strip())
    except (TypeError, ValueError):
        return None


def carpeta_por_defecto():
    subs = [d for d in glob.glob(os.path.join(ROOT, '*')) if os.path.isdir(d)]
    if not subs:
        sys.exit('No hay capturas en research/got/data/')
    return max(subs, key=os.path.basename)


def cargar(path):
    rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
    por_strike = {}
    for r in rows:
        k = num(r.get('strike'))
        if k is not None:
            por_strike[round(k, 2)] = r
    return rows, por_strike


def short_leg(rows, side, objetivo=DELTA_OBJETIVO, exigir=None):
    """La fila cuyo |delta| del lado pedido es el mas cercano al objetivo."""
    mejor = None
    for r in rows:
        d = num(r.get(side + 'Delta'))
        if d is None:
            continue
        if exigir and num(r.get(exigir)) is None:
            continue
        if mejor is None or abs(abs(d) - objetivo) < abs(abs(num(mejor[side + 'Delta'])) - objetivo):
            mejor = r
    return mejor


def iv_interpolada(rows, side, objetivo):
    """IV del lado pedido al |delta| objetivo, interpolando entre los dos strikes vecinos."""
    pts = []
    for r in rows:
        d, iv = num(r.get(side + 'Delta')), num(r.get(side + 'IV'))
        if d is None or iv is None or iv <= 0:
            continue
        ad = abs(d)
        if 0.02 < ad < 0.98:
            pts.append((ad, iv))
    if len(pts) < 2:
        return None
    pts.sort()
    for a, b in zip(pts, pts[1:]):
        if a[0] <= objetivo <= b[0]:
            if b[0] == a[0]:
                return a[1]
            return a[1] + (objetivo - a[0]) / (b[0] - a[0]) * (b[1] - a[1])
    return None


def delta_abarcado(rows, por_strike, side, sgn, ancho):
    """Cuanto delta cubre un vertical de ese ancho con el short en ~DELTA_OBJETIVO."""
    s = short_leg(rows, side)
    if s is None:
        return None
    ds = abs(num(s[side + 'Delta']))
    largo = por_strike.get(round(num(s['strike']) + sgn * ancho, 2))
    if largo is None:
        return None
    dl = num(largo.get(side + 'Delta'))
    return None if dl is None else ds - abs(dl)


def archivos(carpeta):
    # No recursivo a proposito: 2026-08-25/descartado-banda12/ tiene capturas invalidas y queda
    # fuera del glob, igual que en skew_por_lado.py.
    for path in sorted(glob.glob(os.path.join(carpeta, '*_gex_*.csv'))):
        sym, _, exp = os.path.basename(path)[:-4].split('_')
        yield sym, exp, path


def carpetas():
    return sorted((d for d in glob.glob(os.path.join(ROOT, '*')) if os.path.isdir(d)),
                  key=os.path.basename)


def metrica_por_lado(rows, por_strike, side, sgn, col, ancho=WIDTH):
    """((credito/ancho) / |delta del short|, delta abarcado). La primera necesita quotes; la
    segunda sale de la columna de delta sola."""
    s = short_leg(rows, side, exigir=col)
    if s is None:
        return None, None
    ds, cred = abs(num(s[side + 'Delta'])), num(s[col])
    largo = por_strike.get(round(num(s['strike']) + sgn * ancho, 2))
    dl = num(largo.get(side + 'Delta')) if largo else None
    abarca = (ds - abs(dl)) if dl is not None else None
    ef = (cred / ancho) / ds if (cred is not None and ds) else None
    return ef, abarca


def main():
    carpeta = sys.argv[1] if len(sys.argv) > 1 else None
    carpeta = os.path.join(ROOT, carpeta) if carpeta else carpeta_por_defecto()
    if not os.path.isdir(carpeta):
        sys.exit('No existe la carpeta ' + carpeta)
    print('Captura: ' + os.path.basename(carpeta) + '\n')

    primero = next(archivos(carpeta), None)
    if primero is None:
        sys.exit('La carpeta no tiene CSV.')
    tiene_iv = 'callIV' in cargar(primero[2])[0][0]
    if not tiene_iv:
        print('Esta captura no tiene columnas callIV/putIV (es anterior al 2026-08-25-t2):')
        print('se omiten las secciones 1 y 2. Las 3, 4 y 5 no necesitan IV.\n')

    # ── 1. NIVEL ──────────────────────────────────────────────────────────────
    if tiene_iv:
        print('1. NIVEL DE IV al mismo |delta|  (put/call > 1 = el put esta mas caro)')
        print(f"   {'sim':5} {'vencimiento':12} {'|d|':>5} {'callIV':>8} {'putIV':>8} {'put/call':>9}")
    for sym, exp, path in archivos(carpeta):
        rows, _ = cargar(path)
        for tgt in NIVELES:
            c, p = iv_interpolada(rows, 'call', tgt), iv_interpolada(rows, 'put', tgt)
            if c and p:
                print(f"   {sym:5} {exp:12} {tgt:5.2f} {c:8.4f} {p:8.4f} {p / c:9.3f}")

    # ── 2. PENDIENTE ──────────────────────────────────────────────────────────
    if tiene_iv:
        print('\n2. PENDIENTE entre las dos patas del vertical (width %g, short ~ delta %.2f)' %
              (WIDTH, DELTA_OBJETIVO))
        print('   IV(comprada) - IV(vendida). Positivo = la pata comprada es mas cara, se pierde credito')
        print(f"   {'sim':5} {'vencimiento':12} {'PUT dIV':>9} {'CALL dIV':>9}  {'el put pierde mas?':>19}")
    for sym, exp, path in archivos(carpeta):
        rows, por_strike = cargar(path)
        d = {}
        for side, sgn, _ in LADOS:
            s = short_leg(rows, side)
            if s is None:
                d[side] = None
                continue
            ivs = num(s.get(side + 'IV'))
            largo = por_strike.get(round(num(s['strike']) + sgn * WIDTH, 2))
            ivl = num(largo.get(side + 'IV')) if largo else None
            d[side] = (ivl - ivs) if (ivs and ivl) else None
        if d['put'] is None or d['call'] is None:
            continue
        print(f"   {sym:5} {exp:12} {d['put']:+9.4f} {d['call']:+9.4f}  {str(d['put'] > d['call']):>19}")

    # ── 3. DESGLOSE ───────────────────────────────────────────────────────────
    print('\n3. DESGLOSE de la metrica de la 43.4, lado por lado')
    print(f"   {'sim':5} {'venc':11} {'lado':5} {'d_short':>8} {'d_long':>7} {'abarca':>7} "
          f"{'cred/W':>7} {'(c/W)/d':>8}")
    for sym, exp, path in archivos(carpeta):
        rows, por_strike = cargar(path)
        for side, sgn, col in LADOS:
            s = short_leg(rows, side, exigir=col)
            if s is None:
                continue
            ds, cred = abs(num(s[side + 'Delta'])), num(s[col])
            largo = por_strike.get(round(num(s['strike']) + sgn * WIDTH, 2))
            dl = abs(num(largo[side + 'Delta'])) if largo and num(largo.get(side + 'Delta')) is not None else None
            cw = cred / WIDTH
            print(f"   {sym:5} {exp:11} {side:5} {ds:8.3f} {(dl or 0):7.3f} {((ds - dl) if dl else 0):7.3f} "
                  f"{cw:7.3f} {cw / ds:8.3f}")

    # ── 4. ANCHO ──────────────────────────────────────────────────────────────
    print('\n4. CONTROL: cociente CALL/PUT del delta abarcado, segun el ancho en dolares')
    print('   Si el sesgo fuera un artefacto del width 5, esta fila se moveria con el ancho.')
    print(f"   {'sim':5} {'vencimiento':12}" + ''.join(f"{('W=' + str(int(w))):>8}" for w in ANCHOS))
    for sym, exp, path in archivos(carpeta):
        rows, por_strike = cargar(path)
        fila = f"   {sym:5} {exp:12}"
        for w in ANCHOS:
            p = delta_abarcado(rows, por_strike, 'put', -1, w)
            c = delta_abarcado(rows, por_strike, 'call', +1, w)
            fila += f"{(c / p):8.2f}" if (p and c and p > 0) else f"{'-':>8}"
        print(fila)

    seccion_5_retroactiva()


def seccion_5_retroactiva():
    """El delta abarcado, que sale de la columna de delta sola, contra la metrica de la 43.4,
    que necesita el barrido de quotes. Sobre TODAS las capturas, no solo la del dia: las
    anteriores no tienen IV pero si delta y credito, que es lo unico que hace falta aca.

    Si los dos cocientes coinciden, el diagnostico de sesgo por lado se puede hacer sin cotizar
    la cadena -- que es el barrido caro y el que obliga a acertarle a la banda por simbolo."""
    print('\n5. RETROACTIVA: el delta abarcado predice el sesgo? (todas las capturas)')
    print('   "abarca" no necesita quotes; "metrica" si. Si coinciden, el barrido caro sobra.')
    print(f"   {'captura':14} {'sim':5} {'vencimiento':12} {'abarca C/P':>11} {'metrica C/P':>12} {'dif':>7}")
    pares = []
    for carpeta in carpetas():
        for sym, exp, path in archivos(carpeta):
            rows, por_strike = cargar(path)
            ef, ab = {}, {}
            for side, sgn, col in LADOS:
                ef[side], ab[side] = metrica_por_lado(rows, por_strike, side, sgn, col)
            if not all([ef['put'], ef['call'], ab['put'], ab['call']]):
                continue
            if ab['put'] <= 0 or ef['put'] <= 0:
                continue
            r_ab, r_ef = ab['call'] / ab['put'], ef['call'] / ef['put']
            pares.append((r_ab, r_ef))
            print(f"   {os.path.basename(carpeta):14} {sym:5} {exp:12} "
                  f"{r_ab:11.2f} {r_ef:12.2f} {r_ef - r_ab:+7.2f}")
    if len(pares) >= 3:
        xs = [p[0] for p in pares]
        ys = [p[1] for p in pares]
        n = len(pares)
        mx, my = sum(xs) / n, sum(ys) / n
        sx = (sum((x - mx) ** 2 for x in xs) / n) ** 0.5
        sy = (sum((y - my) ** 2 for y in ys) / n) ** 0.5
        r = sum((x - mx) * (y - my) for x, y in pares) / (n * sx * sy) if sx and sy else 0.0
        eam = sum(abs(y - x) for x, y in pares) / n
        signo = sum(1 for x, y in pares if (x - 1) * (y - 1) > 0)
        print(f'\n   n = {n}   correlacion r = {r:+.4f}   error absoluto medio = {eam:.3f}')
        print(f'   coinciden en de que lado del 1 caen: {signo} de {n}')


if __name__ == '__main__':
    main()
