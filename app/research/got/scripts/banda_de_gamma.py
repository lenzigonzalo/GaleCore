# -*- coding: utf-8 -*-
"""
El muro de gamma como BANDA en vez de argmax, y si esa banda sirve para algo.

La 61.4 encontro que `SelectCallWall` es un argmax sobre un solo strike y que eso no
alcanza para ser una referencia: nunca concentra mas del 19% del GEX del lado, la
dominancia contra el segundo candidato baja a 1.0x, y el muro salta. Pidio un umbral de
dominancia. Este script prueba OTRA salida al mismo problema: que el muro sea la ventana
de strikes mas densa, no el strike mas alto.

Corre las mediciones del hallazgo 2026-08-25 sobre la banda, en ese orden:

  0. EL BORDE POR EM -- correlacion de rango entre `distancia/EM` y el delta, que es lo que
                     decide si la segunda condicion de la 61.3 aporta algo.
  1. ESTABILIDAD  -- la banda contra el argmax, en las tandas que haya de cada vencimiento.
  2. RESTRICCION  -- el borde externo de la banda contra un corte de delta 0.20: la
                     estructura, empuja mas afuera de lo que ya empujaba el delta?
  3. PREMIO       -- cuanto mas paga vender en el borde de la banda, Y el control de si
                     ese pago sobrevive a descontar el delta.

Mas una cuarta, de sanidad: la sensibilidad de la banda al ancho elegido.

Y una sexta, del 2026-08-26, que mide los TRES DEFECTOS DE CONSTRUCCION que la 61.4 dejo
anotados -- la ventana continua sobre una grilla discreta, el competidor contaminado por la
pila del dinero, y el muro que ES la pila del dinero. Las secciones 0 a 5 quedan como estan
a proposito: reproducen los numeros publicados de los hallazgos del 24 y del 25, y esa
reproducibilidad es la que deja ver que movio el arreglo.

DEFINICIONES

`EM*` -- proxy de 1 sigma computable desde cualquier captura: la distancia del spot al
strike de delta 0.1587, promediada entre lados. NO es el Expected Move de la 15
(`spot * atmIv * sqrt(dte/365)`): en SPY 16-Oct da 42.9 contra 39.0, un 10% mas, porque
absorbe el smile y la brecha d1/d2. Se usa aca porque el CSV no trae ni el ATM IV ni el
DTE -- el encabezado del script de captura los imprime y no los escribe -- y porque las
capturas del 2026-08-24 son anteriores a las columnas de IV. Como solo fija el ANCHO de
la banda, la diferencia de escala no cambia ninguna conclusion (ver seccion 4).

`spot` -- se interpola del strike de callDelta 0.5, por la misma razon.

`banda` -- la ventana de ancho `FRAC_EM * EM*` que maximiza la suma de |GEX| del lado. Su
borde EXTERNO (el mas lejos del spot) es el que define la zona vendible.

`xmed`  -- la banda contra la ventana MEDIANA del mismo lado. Mide si hay concentracion o
           si la "banda mas densa" es una banda cualquiera.
`xdisj` -- la banda contra la mejor ventana DISJUNTA. Mide si el muro es uno o son dos.

Los dos tests hacen falta: TSLA 09-18 CALL da xmed 8.6x y xdisj 1.01x -- muy concentrado,
pero en dos lugares distintos, o sea que no hay UN muro.

`eficiencia` -- `(credito / width) / |delta del short|`. Es la metrica de skew_por_lado.py:
cuanto paga el mercado por unidad de probabilidad. Se usa aca para el control del premio.

EL CONTROL, QUE ES EL PUNTO DE LA SECCION 3

Vender en el borde de la banda paga mas que vender delta 0.15, pero el borde ESTA a delta
mas alto, asi que tiene que pagar mas. La pregunta es si paga mas de lo que le corresponde
por su delta. Se ajusta `eficiencia ~ a + b*d + c*d^2` con los strikes LEJOS de la banda y
se mide el residuo del borde en unidades de la desviacion de ese ajuste. Si el muro tuviera
un premio propio, el borde caeria sistematicamente por encima de la curva.

Es el control que este research fallo tres veces: WD contra delta (43.2), `d_min x EM`
contra delta (61.3), y `RequiredCredit` como gate economico (43.2). Las tres veces la
respuesta fue "eso es delta".

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/banda_de_gamma.py [carpeta]

`carpeta` es un subdirectorio de research/got/data/ para las secciones 2-4 (por defecto
2026-08-25, la unica con los tres simbolos en sesion). La seccion 1 recorre todas.
"""
import csv
import glob
import os
import statistics
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
WIDTH = 5.0          # el width del vertical que trae el CSV
FRAC_EM = 0.25       # ancho de la banda, en EM*
DELTA_REF = 0.20     # el corte de delta contra el que se mide si la estructura restringe
DELTA_CMP = 0.15     # el delta contra el que se compara el credito del borde
SIGMA_1 = 0.1587     # N(-1): el strike de este delta esta a ~1 sigma


# ---------------------------------------------------------------- lectura

def num(row, col):
    v = row.get(col, '')
    return float(v) if v not in ('', None) else None


def interpolar_strike(pts, objetivo):
    """pts = [(strike, delta)] ordenado por strike. Strike donde delta = objetivo."""
    for i in range(len(pts) - 1):
        (k1, d1), (k2, d2) = pts[i], pts[i + 1]
        if (d1 - objetivo) * (d2 - objetivo) <= 0 and d1 != d2:
            return k1 + (objetivo - d1) * (k2 - k1) / (d2 - d1)
    return None


def contexto(rows):
    """spot y EM* interpolados de la curva de delta. Ver DEFINICIONES."""
    call = sorted([(num(r, 'strike'), num(r, 'callDelta')) for r in rows
                   if num(r, 'strike') is not None and num(r, 'callDelta') is not None])
    put = sorted([(num(r, 'strike'), abs(num(r, 'putDelta') or 0)) for r in rows
                  if num(r, 'strike') is not None and num(r, 'putDelta') is not None])
    spot = interpolar_strike(call, 0.5)
    kc = interpolar_strike(call, SIGMA_1)
    kp = interpolar_strike(put, SIGMA_1)
    if spot is None or kc is None or kp is None:
        return None, None, call, put
    return spot, statistics.mean([kc - spot, spot - kp]), call, put


def gex_del_lado(rows, spot, lado):
    col = 'putGEX_musd' if lado == 'PUT' else 'callGEX_musd'
    c = [(num(r, 'strike'), abs(num(r, col) or 0)) for r in rows if num(r, 'strike') is not None]
    return [x for x in c if ((x[0] < spot) if lado == 'PUT' else (x[0] > spot)) and x[1] > 0]


def delta_en(tabla, strike):
    return min(tabla, key=lambda x: abs(x[0] - strike))[1]


# ---------------------------------------------------------------- la grilla

def grilla(rows):
    """Todos los strikes listados del vencimiento, ordenados. La grilla NO es uniforme:
    SPY y QQQ tienen paso $1 en una franja alrededor del dinero (700-800 en SPY 16-Oct) y
    $5 afuera; TSLA va de $2.5 a $10. Por eso el anclaje se hace con el paso LOCAL y no
    con un paso global, que le daria a la banda de TSLA cinco veces el ancho en dolares
    que a la de SPY."""
    return sorted({num(r, 'strike') for r in rows if num(r, 'strike') is not None})


VECINOS = 10         # cuantos escalones de grilla mira `paso_local`


def paso_local(ks, centro, vecinos=VECINOS):
    """Paso de la grilla alrededor de `centro`: mediana de los `vecinos` escalones mas
    cercanos. Mediana y no moda, para que el escalon donde el paso salta de 1 a 5 no lo
    decida.

    El vecindario se mide en CANTIDAD de strikes, no en dolares, y eso no es un detalle: la
    primera version lo media en dolares con radio `W`, asi que el ancho anclado dependia de
    `W` dos veces -- por el cociente y por el paso -- y el veredicto volvia a moverse ante
    un cambio vacio de ancho, que es exactamente lo que el anclaje viene a arreglar. En TSLA,
    donde la grilla mezcla 2.5, 5 y 10, mover `W` un 10% cambiaba la mediana del paso y con
    ella la banda entera."""
    d = sorted((abs((a + b) / 2 - centro), b - a) for a, b in zip(ks, ks[1:]))[:vecinos]
    return statistics.median([x[1] for x in d]) if d else 1.0


def ancho_anclado(ks, k0, ancho, lado):
    """DEFECTO 1 de la 61.4: la ventana es continua y la grilla de strikes no.

    `W = 0.25 x EM` es un numero real; los strikes estan cada $1 o cada $5. Una ventana de
    9.8 puntos que arranca en 790 termina en 799.8 y deja el strike 800 AFUERA por veinte
    centavos; una de 10.6 lo mete. Ese strike vale 6.5% del lado y mueve el `xdisj` de
    1.01x a 1.22x: un strike redondo decide si hay muro.

    El arreglo propuesto era que la ventana midiera un numero ENTERO de escalones de la
    grilla local: el borde cae siempre sobre un strike listado y ningun strike puede quedar a
    centimetros de el.

    MEDIDO EL 2026-08-26 Y RECHAZADO. No saca el redondeo, lo muda: de "que strike cae
    adentro" a "cuantos escalones mide la ventana", y el segundo es mas grueso -- un escalon
    de $5 en TSLA es la mitad de la banda. El swing del veredicto ante un cambio vacio de `W`
    sube de 3.8% a 13.5%, y el borde entre tandas no mejora (16.1 -> 15.0). Se conserva
    porque la seccion 6b es lo que reproduce el rechazo."""
    centro = k0 + ancho / 2 if lado == 'CALL' else k0 - ancho / 2
    paso = paso_local(ks, centro)
    n = max(1, int(round(ancho / paso)))
    return n * paso


# ---------------------------------------------------------------- la banda

def barrer(c, ks, ancho, lado, anclar):
    """Todas las ventanas del lado, ordenadas por masa. Cada una arranca en un strike."""
    out = []
    for k0, _ in c:
        w = ancho_anclado(ks, k0, ancho, lado) if anclar else ancho
        lo, hi = (k0, k0 + w) if lado == 'CALL' else (k0 - w, k0)
        dentro = frozenset(x[0] for x in c if lo - 1e-9 <= x[0] <= hi + 1e-9)
        out.append((sum(x[1] for x in c if x[0] in dentro), lo, hi, dentro))
    out.sort(key=lambda x: -x[0])
    return out


def separacion(v, mejor):
    """Dolares de cadena vacia entre el intervalo del competidor y el de la banda."""
    if v[1] > mejor[2]:
        return v[1] - mejor[2]
    if v[2] < mejor[1]:
        return mejor[1] - v[2]
    return 0.0


def paso_gamma(c):
    """Separacion tipica entre los strikes que cargan gamma de verdad -- los que estan por
    encima de la mediana del lado. En SPY y QQQ da ~$5 aunque se listen strikes de $1: el gamma
    vive en una empalizada de $5. Se usa para probar el crecimiento con una resolucion
    DESACOPLADA de `W` (seccion 8b)."""
    med = statistics.median([g for _, g in c])
    ks = sorted(k for k, g in c if g > med)
    if len(ks) < 3:
        return None
    return statistics.median([b - a for a, b in zip(ks, ks[1:])])


def crecer_banda_por_strike(c, mejor, ancho, lado, f, res=None):
    """Igual que `crecer_banda`, pero absorbiendo de a UN STRIKE en vez de una rebanada entera,
    y midiendo la densidad del tramo de ancho `W` mas externo de la banda ya crecida.

    El paso es todo. Absorber de a una rebanada de ancho `W` es una decision gruesa que se da
    vuelta entre dos fotos de la misma cadena --por eso la version por rebanadas se rechazo el
    27, con el movimiento del borde oscilando 1.3 / 29.8 / 20.4 / 1.6 / 11.2 al barrer `f`--.
    De a un strike la decision es fina y el borde se queda quieto: 0.3 con `f` entre 0.65 y
    0.45, mejor que los 1.3 de no crecer.

    No alcanza igual, y el motivo esta en la seccion 8: crecer AMPLIFICA lo que el borde le debe
    a `W`, que es un parametro sin calibrar."""
    lo, hi, masa = mejor[1], mejor[2], mejor[0]
    r = res or ancho
    if res:
        # con resolucion propia, la referencia es el tramo `res` mas denso DE la semilla
        dentro = [x for x in c if lo - 1e-9 <= x[0] <= hi + 1e-9]
        ref = max((sum(y[1] for y in dentro if k - 1e-9 <= y[0] <= k + r + 1e-9) / r)
                  for k, _ in dentro) if dentro else 0.0
    else:
        ref = mejor[0] / ancho
    ks = [k for k, _ in c]
    while True:
        fuera = [k for k in ks if k > hi + 1e-9] if lado == 'CALL' \
            else [k for k in ks if k < lo - 1e-9]
        if not fuera:
            return lo, hi, masa
        k = min(fuera) if lado == 'CALL' else max(fuera)
        nlo, nhi = (lo, k) if lado == 'CALL' else (k, hi)
        a, b = (nhi - r, nhi) if lado == 'CALL' else (nlo, nlo + r)
        if sum(x[1] for x in c if a - 1e-9 <= x[0] <= b + 1e-9) / r < f * ref:
            return lo, hi, masa
        lo, hi = nlo, nhi
        masa = sum(x[1] for x in c if lo - 1e-9 <= x[0] <= hi + 1e-9)


def banda_dual(c, p, lado):
    """La construccion DUAL: en vez de fijar el ancho y maximizar la masa, fija la masa y
    minimiza el ancho. Es la unica candidata que no necesita `W`, y por eso valia probarla: el
    ancho lo pondria la cadena y una concentracion ancha no quedaria truncada.

    Medida el 2026-08-28 y RECHAZADA: el borde entre tandas se mueve 16 a 43 dolares segun `p`,
    contra 1.3 de la construccion de hoy. Cambia el filo de lugar --de "que strike entra en la
    ventana" a "que strike completa la masa"-- y el segundo es peor."""
    tot = sum(x[1] for x in c)
    objetivo = p * tot
    mejor, j, acum = None, 0, 0.0
    for i in range(len(c)):
        if j < i:
            j, acum = i, 0.0
        while j < len(c) and acum < objetivo:
            acum += c[j][1]
            j += 1
        if acum < objetivo:
            break
        lo, hi = c[i][0], c[j - 1][0]
        if mejor is None or (hi - lo) < (mejor[1] - mejor[0]) - 1e-9:
            mejor = (lo, hi, acum)
        acum -= c[i][1]
    return mejor


def crecer_banda(c, mejor, ancho, lado, f):
    """Extiende la banda hacia AFUERA mientras la rebanada contigua de ancho `W` tenga al menos
    `f` de la densidad de la banda ORIGINAL.

    Es la otra salida al competidor contiguo, y la unica que toca el BORDE: si una concentracion
    es mas ancha que `W`, la ventana la parte y se queda con la mitad de adentro -- entonces el
    borde cae DENTRO del muro, que es justo lo que la 17 dice que no hay que hacer.

    La referencia es la densidad ORIGINAL a proposito. Comparando contra la banda ya crecida el
    criterio se afloja solo: cada rebanada absorbida baja el promedio y hace mas facil absorber
    la siguiente. Con referencia movil el crecimiento se dispara (bandas de 5 a 9 anchos) y el
    borde se vuelve inestable entre tandas."""
    lo, hi, masa = mejor[1], mejor[2], mejor[0]
    ref = mejor[0] / ancho
    while True:
        nlo, nhi = (hi, hi + ancho) if lado == 'CALL' else (lo - ancho, lo)
        rebanada = [x[1] for x in c if nlo - 1e-9 <= x[0] <= nhi + 1e-9
                    and not (lo - 1e-9 <= x[0] <= hi + 1e-9)]
        if not rebanada or sum(rebanada) / ancho < f * ref:
            return lo, hi, masa
        masa += sum(rebanada)
        lo, hi = (lo, nhi) if lado == 'CALL' else (nlo, hi)


def calcular_xvalle(c, lo, hi, d_lo, d_hi):
    """Densidad de la rebanada mas vacia que entra ENTERA entre la banda y su competidor,
    relativa a la densidad de la banda. La rebanada mide lo mismo que la banda.

    Es lo que `xdisj` cree que mide y no mide. "Hay un muro o hay dos" es una pregunta sobre lo
    que hay EN EL MEDIO, no sobre el cociente de dos masas: dos masas iguales sin nada entre
    ellas son una losa ancha, y dos masas iguales con un valle son dos muros. `xdisj` no puede
    distinguirlas porque no mira el medio.

    Devuelve None cuando no hay lugar para la rebanada -- la banda y su competidor son contiguos
    o casi--, que no es un valle de cero: es que no hay valle, y son un solo objeto."""
    if d_lo != d_lo:
        return None
    ancho = hi - lo
    a, b = (hi, d_lo) if d_lo > hi else (d_hi, lo)
    if b - a < ancho:
        return None
    dens = sum(x[1] for x in c if lo - 1e-9 <= x[0] <= hi + 1e-9) / ancho
    rebanadas = [sum(x[1] for x in c if k - 1e-9 <= x[0] <= k + ancho + 1e-9) / ancho
                 for k, _ in c if k >= a - 1e-9 and k + ancho <= b + 1e-9]
    return (min(rebanadas) / dens) if rebanadas and dens else None


def medir(rows, spot, em, lado, frac=FRAC_EM, excl=0.0, anclar=False,
          hueco=0.0, crecer=0.0, crecer_modo='rebanada', crecer_res=False):
    """`excl` y `anclar` son los dos arreglos que la 61.4 pedia para sus tres defectos,
    apagados por defecto para que las secciones 0-5 sigan reproduciendo los numeros
    publicados. Medidos el 2026-08-26: `excl` arregla los defectos 2 y 3 y se adopta;
    `anclar` no arregla el 1 y se rechaza (ver `ancho_anclado` y la seccion 6).

    `excl` -- semiancho de la ZONA DEL DINERO a excluir, en EM. Arregla los defectos 2 y 3:
    los strikes pegados al spot siempre concentran gamma, y con eso adentro el test compara
    el muro contra la pila del dinero (SPY 16-Oct CALL: 790-800 contra 766-776 con spot
    765.45) o directamente lo elige como muro (QQQ 18-Sep del 24-ago: argmax 710 con spot
    708.02). Se excluyen del POOL, asi que no entran ni a la banda, ni al competidor, ni a
    la mediana, ni al total del lado.

    `anclar` -- ver `ancho_anclado`.

    `hueco` y `crecer` son las dos salidas al COMPETIDOR CONTIGUO, el defecto que quedo abierto
    el 26 y se midio el 27. Ver `separacion` y `crecer_banda`."""
    c = gex_del_lado(rows, spot, lado)
    if excl:
        c = [x for x in c if abs(x[0] - spot) >= excl * em]
    if len(c) < 6:
        return None
    total = sum(x[1] for x in c)
    ancho = frac * em
    ks = grilla(rows)

    ventanas = barrer(c, ks, ancho, lado, anclar)
    mejor = ventanas[0]

    if crecer:
        if crecer_modo == 'strike':
            lo, hi, masa = crecer_banda_por_strike(
                c, mejor, ancho, lado, crecer, paso_gamma(c) if crecer_res else None)
        else:
            lo, hi, masa = crecer_banda(c, mejor, ancho, lado, crecer)
        if hi - lo > ancho + 1e-9:
            # La banda crecio, asi que los tests tienen que medirse AL ANCHO CRECIDO: un
            # competidor de ancho W contra una banda de 2W no es una comparacion.
            ventanas = barrer(c, ks, hi - lo, lado, False)
            dentro = frozenset(x[0] for x in c if lo - 1e-9 <= x[0] <= hi + 1e-9)
            mejor = (masa, lo, hi, dentro)

    mediana = statistics.median(v[0] for v in ventanas)
    # Disjunta = sin NINGUN strike en comun, no "sin solapamiento de intervalos". Comparar los
    # intervalos deja pasar al competidor que toca la banda en su borde y por lo tanto comparte
    # ese strike -- con la banda anclada a la grilla los bordes caen sobre strikes y eso pasa
    # siempre. En QQQ 18-Sep PUT el "competidor" 700-708 contenia el 700, que es el strike mas
    # grande de la banda 692-700: el test comparaba el muro contra si mismo.
    #
    # `hueco` va mas lejos: exige que el competidor este separado de la banda por al menos
    # `hueco` anchos de banda. Sin eso, el competidor tipico es la COLA de la propia banda --
    # 8 de 12 estan a menos de un ancho, y dos a un dolar-- y `xdisj` termina castigando a una
    # concentracion ancha por ser ancha (61.4).
    disjunta = next((v for v in ventanas
                     if not (v[3] & mejor[3])
                     and separacion(v, mejor) >= hueco * (mejor[2] - mejor[1]) - 1e-9), None)

    orden = sorted(c, key=lambda x: -x[1])
    return dict(
        argmax=orden[0][0],
        dom=orden[0][1] / orden[1][1] if len(orden) > 1 else float('inf'),
        lo=mejor[1], hi=mejor[2],
        borde=mejor[2] if lado == 'CALL' else mejor[1],
        pct=mejor[0] / total * 100,
        xmed=mejor[0] / mediana if mediana else 0.0,
        xdisj=mejor[0] / disjunta[0] if disjunta and disjunta[0] else float('inf'),
        disj_lo=disjunta[1] if disjunta else float('nan'),
        disj_hi=disjunta[2] if disjunta else float('nan'),
        xvalle=calcular_xvalle(c, mejor[1], mejor[2],
                               disjunta[1] if disjunta else float('nan'),
                               disjunta[2] if disjunta else float('nan')),
        em=em, spot=spot,
    )


def vendibles(rows, lado):
    """(strike, |delta|, credito) de los strikes con quote viva y credito valido."""
    dcol, ccol, bcol = ('putDelta', 'pcsCredit_w5', 'putBid') if lado == 'PUT' \
                       else ('callDelta', 'ccsCredit_w5', 'callBid')
    out = []
    for r in rows:
        k, d, c, b = num(r, 'strike'), num(r, dcol), num(r, ccol), num(r, bcol)
        if None in (k, d, c, b) or c <= 0 or b <= 0:
            continue
        out.append((k, abs(d), c))
    return out


def ajuste_cuadratico(xs, ys):
    n = len(xs)
    S = [sum(x ** p for x in xs) for p in range(5)]
    T = [sum(ys[i] * xs[i] ** p for i in range(n)) for p in range(3)]
    A = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]]
    b = T[:]
    for i in range(3):
        p = max(range(i, 3), key=lambda r: abs(A[r][i]))
        A[i], A[p] = A[p], A[i]
        b[i], b[p] = b[p], b[i]
        for r in range(i + 1, 3):
            m = A[r][i] / A[i][i]
            for col in range(i, 3):
                A[r][col] -= m * A[i][col]
            b[r] -= m * b[i]
    x = [0.0, 0.0, 0.0]
    for i in (2, 1, 0):
        x[i] = (b[i] - sum(A[i][col] * x[col] for col in range(i + 1, 3))) / A[i][i]
    return x


# ---------------------------------------------------------------- recorrido

def capturas():
    subs = sorted(d for d in glob.glob(os.path.join(ROOT, '*')) if os.path.isdir(d))
    return [d for d in subs if glob.glob(os.path.join(d, '*_gex_*.csv'))]


def casos(carpeta):
    for path in sorted(glob.glob(os.path.join(carpeta, '*_gex_*.csv'))):
        nombre = os.path.basename(path)[:-4]
        sym, _, exp = nombre.split('_')
        rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
        spot, em, call, put = contexto(rows)
        if spot is None:
            continue
        yield sym, exp, rows, spot, em, call, put


# ---------------------------------------------------------------- secciones

def rangos(xs):
    orden = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(orden):
        j = i
        while j + 1 < len(orden) and xs[orden[j + 1]] == xs[orden[i]]:
            j += 1
        for k in range(i, j + 1):
            r[orden[k]] = (i + j) / 2.0 + 1
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = rangos(a), rangos(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    num_ = sum((ra[i] - ma) * (rb[i] - mb) for i in range(n))
    da = sum((x - ma) ** 2 for x in ra) ** 0.5
    db = sum((x - mb) ** 2 for x in rb) ** 0.5
    return num_ / (da * db) if da and db else float('nan')


def seccion_0_borde_por_em(carpeta):
    """La 61.3 pone dos condiciones sobre el mismo eje: pasar el muro Y separarse `d_min x EM`.

    La segunda no es una condicion estructural. Dentro de UN vencimiento, `distancia/EM` es
    una transformacion afin del strike -- EM es una constante -- y el delta es monotono en
    el strike. Las dos ordenan la cadena igual, al revés. Un corte en `d_min x EM` ES un
    corte de delta, y no puede aportar informacion que el delta no tenga.

    Esto se mide, no se argumenta: rho de Spearman entre las dos, por caso.
    """
    print('\n' + '=' * 100)
    print(f'0. EL BORDE POR EM -- rho(distancia/EM, |delta|)   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"n":>4} {"rho":>8}')
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            v = [(k, d) for k, d, _ in vendibles(rows, lado) if 0 < d < 1]
            v = [(k, d) for k, d in v if ((k < spot) if lado == 'PUT' else (k > spot))]
            if len(v) < 8:
                continue
            # distancia/EM crece alejandose del spot: -strike del lado put, +strike del call
            dist = [(spot - k) / em if lado == 'PUT' else (k - spot) / em for k, _ in v]
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {len(v):4d} '
                  f'{spearman(dist, [d for _, d in v]):+8.4f}')
    print('\n  rho = -1 exacto significa que las dos variables ordenan la cadena identico: el')
    print('  borde por `d_min x EM` de la 61.3 es un corte de delta escrito de otra manera.')


def seccion_1_estabilidad():
    print('\n' + '=' * 100)
    print('1. ESTABILIDAD -- la banda contra el argmax, misma serie en tandas distintas')
    print('=' * 100)
    serie = {}
    for carpeta in capturas():
        tanda = os.path.basename(carpeta)
        for sym, exp, rows, spot, em, call, put in casos(carpeta):
            for lado in ('PUT', 'CALL'):
                m = medir(rows, spot, em, lado)
                if m:
                    serie.setdefault((sym, exp, lado), []).append((tanda, m))
    for clave in sorted(serie):
        tandas = serie[clave]
        if len(tandas) < 2:
            continue
        print(f'\n  {clave[0]} {clave[1]} {clave[2]}')
        print(f'    {"tanda":>14} | {"argmax":>7} {"dom":>6} | {"banda":>15} {"%lado":>6} '
              f'{"xmed":>6} {"xdisj":>6} | {"borde":>7}')
        for tanda, m in tandas:
            print(f'    {tanda:>14} | {m["argmax"]:7.0f} {m["dom"]:5.2f}x | '
                  f'{m["lo"]:7.1f}-{m["hi"]:<7.1f} {m["pct"]:5.1f}% {m["xmed"]:5.1f}x '
                  f'{m["xdisj"]:5.2f}x | {m["borde"]:7.1f}')


def seccion_2_restriccion(carpeta):
    print('\n' + '=' * 100)
    print(f'2. RESTRICCION -- borde de la banda contra un corte de delta {DELTA_REF:.2f}'
          f'   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"borde":>7} {"delta":>6} {"xmed":>6} {"xdisj":>6} | ata?')
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado)
            if not m:
                continue
            tabla = put if lado == 'PUT' else call
            d = delta_en(tabla, m['borde'])
            ata = 'SI' if d < DELTA_REF else 'no'
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {m["borde"]:7.1f} {d:6.3f} '
                  f'{m["xmed"]:5.1f}x {m["xdisj"]:5.2f}x | {ata}')


def seccion_3_premio(carpeta):
    print('\n' + '=' * 100)
    print(f'3. PREMIO -- credito en el borde contra delta {DELTA_CMP:.2f}, y el control'
          f'   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"K":>6} {"dlt":>5} {"cred":>6} | {"K":>6} {"dlt":>5} {"cred":>6} '
          f'| {"x cred":>7} | {"ef obs":>7} {"ef fit":>7} {"z":>6}')
    zs = []
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado)
            if not m:
                continue
            venta = vendibles(rows, lado)
            if len(venta) < 12:
                continue
            cand = [x for x in venta if (x[0] <= m['borde'] if lado == 'PUT' else x[0] >= m['borde'])]
            if not cand:
                continue
            a = min(cand, key=lambda x: abs(x[0] - m['borde']))
            b = min(venta, key=lambda x: abs(x[1] - DELTA_CMP))
            etiqueta = f'{sym} {exp[5:]} {lado}'
            if a[0] == b[0]:
                print(f'  {etiqueta:>17} | mismo strike ({a[0]:.0f}): el borde cae donde ya vendia '
                      f'delta {DELTA_CMP:.2f}')
                continue

            # control: ef ~ f(delta) ajustado SIN los strikes de la banda
            pts = [(k, d, (c / WIDTH) / d) for k, d, c in venta if 0.05 <= d <= 0.45]
            fuera = [x for x in pts if not (m['lo'] - em * 0.1 <= x[0] <= m['hi'] + em * 0.1)]
            fit_txt = z_txt = '     --'
            if len(fuera) >= 8:
                coef = ajuste_cuadratico([x[1] for x in fuera], [x[2] for x in fuera])
                fit = lambda d: coef[0] + coef[1] * d + coef[2] * d * d
                sd = statistics.pstdev([x[2] - fit(x[1]) for x in fuera]) or 1e-9
                ef = (a[2] / WIDTH) / a[1]
                z = (ef - fit(a[1])) / sd
                zs.append(z)
                fit_txt = f'{ef:7.3f} {fit(a[1]):7.3f}'
                z_txt = f'{z:+6.2f}'
                print(f'  {etiqueta:>17} | {a[0]:6.0f} {a[1]:5.3f} {a[2]:6.2f} | '
                      f'{b[0]:6.0f} {b[1]:5.3f} {b[2]:6.2f} | {a[2] / b[2]:6.2f}x | {fit_txt} {z_txt}')
    if zs:
        media = statistics.mean(zs)
        err = statistics.pstdev(zs) / (len(zs) ** 0.5)
        print(f'\n  z medio {media:+.2f} +/- {err:.2f} sobre {len(zs)} casos '
              f'({sum(1 for z in zs if z > 0)} positivos, {sum(1 for z in zs if z <= 0)} negativos)')
        print('  Un z medio indistinguible de cero = el borde de la banda NO paga por encima de lo')
        print('  que le corresponde por su delta: el premio de credito es delta, no estructura.')


def seccion_4_sensibilidad(carpeta):
    print('\n' + '=' * 100)
    print(f'4. SENSIBILIDAD -- el borde segun el ancho de banda   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    fracs = (0.15, 0.20, 0.25, 0.30, 0.40)
    print(f'  {"caso":>17} | ' + ' '.join(f'{f"{fr:.2f} EM*":>9}' for fr in fracs) +
          f' | {"rango delta":>13} {"xdisj":>7}')
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            base = medir(rows, spot, em, lado)
            if not base:
                continue
            tabla = put if lado == 'PUT' else call
            bordes, deltas = [], []
            for fr in fracs:
                m = medir(rows, spot, em, lado, fr)
                bordes.append(m['borde'])
                deltas.append(delta_en(tabla, m['borde']))
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | ' +
                  ' '.join(f'{b:9.1f}' for b in bordes) +
                  f' | {min(deltas):.3f}-{max(deltas):.3f} {base["xdisj"]:6.2f}x')
    print('\n  El borde externo se corre con el ancho por construccion (la banda crece hacia afuera).')
    print('  Lo que importa es si la banda se MUDA de lugar: eso pasa en QQQ 10-16 PUT y TSLA 09-18')
    print('  CALL, y las dos estaban marcadas por xdisj ~ 1.0x.')


# Encabezado de cada captura, tal como lo imprime gex-strikes.ps1 en pantalla. NO va al CSV, asi
# que se transcribe -- mismo criterio que recheck_econ.py. Sirve para el EM de la 15
# (`spot * atmIv * sqrt(dte/365)`), que es el que usa el procedimiento de la 61.7; el EM* de las
# secciones 0-4 es otro numero y no se mezclan (ver DEFINICIONES).
#
# El DTE es el REAL mirando desde el dia de captura, no el que imprime el encabezado: en la tanda
# del 2026-08-25 los de SPY y TSLA salieron corridos un dia (ver data/README.md).
ENCABEZADOS = {
    ('2026-08-25', 'TSLA', '2026-09-18'): dict(spot=351.105, iv=0.4152, dte=24, zgl=352.42),
    ('2026-08-25', 'TSLA', '2026-10-16'): dict(spot=351.105, iv=0.4206, dte=52, zgl=364.08),
    ('2026-08-25', 'SPY', '2026-09-18'): dict(spot=765.23, iv=0.1306, dte=24, zgl=765.94),
    ('2026-08-25', 'SPY', '2026-10-16'): dict(spot=765.23, iv=0.1367, dte=52, zgl=764.39),
    ('2026-08-25', 'QQQ', '2026-09-18'): dict(spot=710.595, iv=0.1971, dte=24, zgl=709.00),
    ('2026-08-25', 'QQQ', '2026-10-16'): dict(spot=710.595, iv=0.2032, dte=52, zgl=708.85),
    ('2026-08-25-t2', 'SPY', '2026-09-18'): dict(spot=765.45, iv=0.1288, dte=24, zgl=765.94),
    ('2026-08-25-t2', 'SPY', '2026-10-16'): dict(spot=765.45, iv=0.1351, dte=52, zgl=764.27),
}

# Los tres ejemplos trabajados de la 61.7. El de QQQ va con la tanda del 25 porque la del 24 no
# tiene log versionado; su movimiento entre tandas lo imprime la seccion 1.
EJEMPLOS = (('2026-08-25-t2', 'SPY', '2026-10-16'),
            ('2026-08-25', 'TSLA', '2026-09-18'),
            ('2026-08-25', 'QQQ', '2026-09-18'))


def seccion_5_ejemplos():
    """Los ejemplos de la 61.7, corridos con el EM de la 15 y no con el EM* de las secciones 0-4.

    Es el unico lugar del script que sigue el procedimiento tal como esta definido: el resto mide
    la banda con un proxy para poder recorrer capturas que no traen encabezado.
    """
    print('\n' + '=' * 100)
    print('5. EJEMPLOS TRABAJADOS -- el procedimiento de la 61.7, con el EM real')
    print('=' * 100)
    for tanda, sym, exp in EJEMPLOS:
        h = ENCABEZADOS[(tanda, sym, exp)]
        spot, zgl = h['spot'], h['zgl']
        em = spot * h['iv'] * (h['dte'] / 365.0) ** 0.5
        path = os.path.join(ROOT, tanda, f'{sym}_gex_{exp}.csv')
        rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
        print(f'\n  {sym} {exp} [{tanda}]  spot {spot:.2f}  atmIv {h["iv"]:.4f}  DTE {h["dte"]}'
              f'  ->  EM {em:.1f}   W = {FRAC_EM * em:.1f}')
        print(f'    paso 2 · spot - ZGL = {spot - zgl:+.2f} = {(spot - zgl) / em:+.3f} EM')
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado)
            if not m:
                continue
            dcol = 'putDelta' if lado == 'PUT' else 'callDelta'
            tabla = sorted([(num(r, 'strike'), abs(num(r, dcol) or 0)) for r in rows
                            if num(r, 'strike') is not None and num(r, dcol) is not None])
            d_borde = delta_en(tabla, m['borde'])
            venta = [x for x in vendibles(rows, lado)
                     if ((x[0] < spot) if lado == 'PUT' else (x[0] > spot))]
            dmax = min((x for x in venta if x[1] <= DELTA_REF),
                       key=lambda x: abs(x[1] - DELTA_REF), default=None)
            # de que lado esta el competidor disjunto: pegado al spot, o afuera en el ala
            comp = m['disj_lo'] if lado == 'CALL' else m['disj_hi']
            atm = abs(comp - spot) / em < 0.15
            print(f'    {lado:4s} paso 4 · banda {m["lo"]:.1f}-{m["hi"]:.1f}  {m["pct"]:.1f}% del lado')
            print(f'         paso 5 · xmed {m["xmed"]:.1f}x  xdisj {m["xdisj"]:.2f}x'
                  f'  contra {m["disj_lo"]:.0f}-{m["disj_hi"]:.0f}'
                  f'{"  [PEGADA AL SPOT: ver 61.4]" if atm else ""}')
            print(f'         paso 6 · borde {m["borde"]:.1f}  delta {d_borde:.3f}'
                  f'  {abs(m["borde"] - spot) / em:.2f} EM')
            if dmax:
                print(f'         paso 7 · delta_max {DELTA_REF:.2f}  ->  K {dmax[0]:.0f}'
                      f'  delta {dmax[1]:.3f}  credito {dmax[2]:.2f}  c/w {dmax[2] / WIDTH:.3f}')
            print(f'         paso 8 · con muro ata {"la BANDA" if d_borde < DELTA_REF else "el DELTA"}'
                  f'; sin muro ata el DELTA')
    print('\n  NO se imprime un veredicto de "hay muro": el umbral de xmed y xdisj todavia no esta')
    print('  declarado (61.4). Estos numeros son los de la construccion PUBLICADA, con la zona del')
    print('  dinero adentro; los mismos tres ejemplos con la zona del dinero afuera estan en 6e, y')
    print('  ahi el xdisj de SPY 10-16 CALL pasa de 1.01x a 1.49x sin que el borde se mueva.')


# ---------------------------------------------------------------- 6. los tres defectos

"""La 61.4 dejo anotados tres defectos de construccion de la banda, y dijo que arreglarlos
era cambiar la definicion y que habia que medir el arreglo antes de escribirlo. Esta seccion
es esa medicion.

  6a  DEFECTO 1, el diagnostico -- cuantas bandas dejan afuera un strike por centavos.
  6b  DEFECTO 1, el arreglo propuesto -- anclar la ventana a la grilla, contra un cambio
      VACIO de W (+/-10%), en las cuatro construcciones.
  6c  DEFECTOS 2 y 3 -- barrido de cuanto excluir de la zona del dinero.
  6d  LA QUE DECIDE -- cuanto se mueve el borde entre tandas con cada construccion. Es lo
      unico que la banda vino a comprar, asi que un arreglo que empeore esto no sirve.
  6e  Los tres ejemplos de la 61.7, antes y despues.
  6f  El conteo de restriccion de la 61.3 (`ata la banda en 3 de 12`), recontado.
"""

EXCL = 0.15          # semiancho de la zona del dinero excluida, en EM. Se barre en 6c y 6d


def veredicto(m):
    return (m['xmed'], m['xdisj']) if m else (float('nan'), float('nan'))


def dist_comp(m, spot, em, lado):
    """Distancia del competidor disjunto al spot, en EM, medida por su borde INTERNO."""
    comp = m['disj_lo'] if lado == 'CALL' else m['disj_hi']
    return abs(comp - spot) / em if comp == comp else float('nan')


def casos_em_real(carpeta):
    """Igual que casos(), pero con el spot y el EM del ENCABEZADO cuando la captura lo tiene
    versionado -- que es el EM de la 15, el que manda el paso 3 del procedimiento. El `EM*`
    de las secciones 0-4 es un proxy 5-10% mas grande, y los tres defectos de la 61.4 se
    encontraron justamente porque esa diferencia mueve veredictos: las mediciones del arreglo
    van con el EM real o no son comparables con la 61.7. La tanda 2026-08-25 tiene encabezado
    para sus seis series, asi que 6a, 6b, 6c y 6f corren enteras con el EM real."""
    tanda = os.path.basename(carpeta)
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        h = ENCABEZADOS.get((tanda, sym, exp))
        if h:
            spot = h['spot']
            em = spot * h['iv'] * (h['dte'] / 365.0) ** 0.5
        yield sym, exp, rows, spot, em, call, put


MODOS = (('hoy', dict()),
         ('anclada', dict(anclar=True)),
         ('sin ATM', dict(excl=EXCL)),
         ('las dos', dict(anclar=True, excl=EXCL)))


def seccion_6a_holgura(carpeta):
    """DEFECTO 1, medido por lo que es: un strike que queda afuera por centavos.

    Para cada banda se mide la HOLGURA -- la distancia entre su borde externo y el primer
    strike que quedo afuera, en unidades del paso de la grilla. Holgura 0.02 significa que
    ese strike quedo afuera por un 2% de un escalon: nada en el mercado decidio eso, lo
    decidio el redondeo de `W = 0.25 x EM`.
    """
    print('\n' + '=' * 100)
    print(f'6a. DEFECTO 1 (diagnostico) -- que tan por centavos queda afuera el primer strike'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"borde":>8} {"1er fuera":>9} {"holgura":>9} | '
          f'{"xdisj":>7} | {"xdisj anclada":>13}')
    apretados = total = 0
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado, FRAC_EM)
            a = medir(rows, spot, em, lado, FRAC_EM, anclar=True)
            if not m or not a:
                continue
            ks = grilla(rows)
            fuera = [k for k in ks if k > m['hi'] + 1e-9] if lado == 'CALL' \
                else [k for k in ks if k < m['lo'] - 1e-9]
            if not fuera:
                continue
            k1 = min(fuera) if lado == 'CALL' else max(fuera)
            holgura = abs(k1 - m['borde']) / paso_local(ks, m['borde'])
            total += 1
            apretados += 1 if holgura < 0.25 else 0
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {m["borde"]:8.1f} '
                  f'{k1:9.1f} {holgura:8.2f}p{"!" if holgura < 0.25 else " "}| '
                  f'{m["xdisj"]:6.2f}x | {a["xdisj"]:12.2f}x')
    print(f'\n  ! = el primer strike de afuera esta a menos de un cuarto de escalon del borde:')
    print(f'  entra o no entra por redondeo. Pasa en {apretados} de {total} casos.')


def seccion_6b_anclaje(carpeta):
    """DEFECTO 1, el arreglo propuesto: la ventana anclada a un numero entero de escalones.

    La prueba no es que el veredicto cambie, sino que deje de moverse por nada: se compara el
    veredicto a `W` con el veredicto a `W +/- 10%`, que es un cambio de ancho sin contenido --
    el mismo 8% que en SPY 16-Oct CALL movia el `xdisj` de 1.01x a 1.22x.

    Se imprime el RANGO de `xdisj` y no solo su swing, porque no todo swing es igual de grave:
    de 1.61x a 1.96x no cambia ningun veredicto, y de 1.01x a 1.22x los cambia todos.
    """
    print('\n' + '=' * 100)
    print(f'6b. DEFECTO 1 (arreglo) -- el veredicto ante un cambio VACIO de W (+/-10%)'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    print(f'  {"caso":>17} |' + '|'.join(f'{e:^17}' for e, _ in MODOS))
    print(f'  {"":>17} |' + '|'.join(f'{"rango de xdisj":^17}' for _ in MODOS))
    peor = {e: [] for e, _ in MODOS}
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            fila = f'  {sym + " " + exp[5:] + " " + lado:>17} |'
            for etiqueta, kw in MODOS:
                vs = [medir(rows, spot, em, lado, FRAC_EM * f, **kw) for f in (0.9, 1.0, 1.1)]
                xs = [v['xdisj'] for v in vs if v and v['xdisj'] == v['xdisj']
                      and v['xdisj'] != float('inf')]
                if not xs:
                    fila += f'{"--":^17}|'
                    continue
                peor[etiqueta].append(max(xs) / min(xs) - 1 if min(xs) else 0.0)
                fila += f'{f"{min(xs):.2f}-{max(xs):.2f}x":^17}|'
            print(fila.rstrip('|'))
    print()
    for etiqueta, _ in MODOS:
        v = peor[etiqueta]
        if v:
            print(f'  {etiqueta:>8} -> swing medio {statistics.mean(v) * 100:5.1f}%   '
                  f'maximo {max(v) * 100:5.1f}%   casos con swing > 20%: '
                  f'{sum(1 for x in v if x > 0.20)}/{len(v)}')


def seccion_6c_exclusion(carpeta):
    """DEFECTOS 2 y 3 -- excluir la zona del dinero del pool, y cuanto excluir.

    El umbral no se declara sobre un caso: se barre. Por columna, el borde (que es lo que la
    zona usa), el `xdisj` (que es lo que los defectos contaminan) y `dcomp`, la distancia del
    competidor al spot en EM.

    `dcomp` reemplaza al flag de "pegada al spot" que imprimia la seccion 5: ese flag usaba el
    mismo 0.15 EM que este barrido recorre, asi que de m = 0.15 en adelante no podia
    encenderse -- habria dado el defecto por arreglado por construccion.
    """
    print('\n' + '=' * 100)
    print(f'6c. DEFECTOS 2 y 3 -- barrido de la zona del dinero excluida'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    ms = (0.0, 0.10, 0.15, 0.25, 0.35)
    print(f'  {"caso":>17} |' + ' '.join(f'{"m=" + f"{m:.2f}":^22}' for m in ms))
    print(f'  {"":>17} |' + ' '.join(f'{"borde  xdisj  dcomp":^22}' for _ in ms))
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            fila = f'  {sym + " " + exp[5:] + " " + lado:>17} |'
            for m in ms:
                r = medir(rows, spot, em, lado, FRAC_EM, excl=m)
                if not r:
                    fila += f'{"--":^22} '
                    continue
                fila += (f'{r["borde"]:8.1f} {r["xdisj"]:5.2f}x '
                         f'{dist_comp(r, spot, em, lado):5.2f} ')
            print(fila)
    print('\n  dcomp chico = el competidor es la pila del dinero y el test no midio nada.')
    print('  Subir m de mas mueve bordes que estaban bien: eso es comerse la banda, no el dinero.')


def seccion_6d_estabilidad():
    """LA QUE DECIDE: cuanto se mueve el BORDE entre tandas, con cada construccion.

    Es lo unico que la banda vino a comprar -- el argmax saltaba y por eso se lo reemplazo
    (61.4) --, asi que un arreglo que mejore los veredictos y empeore esto no sirve. Se mide
    sobre las 10 series con dos o mas tandas, con `EM*` porque la tanda del 24-ago no tiene
    encabezado versionado y las dos tienen que medirse con la misma vara.
    """
    print('\n' + '=' * 100)
    print('6d. LA QUE DECIDE -- cuanto se mueve el borde entre tandas, por construccion')
    print('=' * 100)
    modos = [('hoy', dict()), ('anclada', dict(anclar=True))]
    modos += [(f'm={m:.2f}', dict(excl=m)) for m in (0.10, 0.15, 0.25, 0.35)]
    modos += [('ancl+0.15', dict(anclar=True, excl=0.15))]
    serie = {}
    for carpeta in capturas():
        for sym, exp, rows, spot, em, call, put in casos(carpeta):
            for lado in ('PUT', 'CALL'):
                for etiqueta, kw in modos:
                    m = medir(rows, spot, em, lado, FRAC_EM, **kw)
                    if m:
                        serie.setdefault((sym, exp, lado, etiqueta), []).append(m['borde'])
    claves = sorted({k[:3] for k in serie if len(serie[k]) > 1})
    print(f'  {"caso":>17} |' + ' '.join(f'{e:>9}' for e, _ in modos))
    total = {e: 0.0 for e, _ in modos}
    for clave in claves:
        fila = f'  {clave[0] + " " + clave[1][5:] + " " + clave[2]:>17} |'
        for etiqueta, _ in modos:
            b = serie.get(clave + (etiqueta,), [])
            mov = max(b) - min(b) if len(b) > 1 else 0.0
            total[etiqueta] += mov
            fila += f' {mov:8.1f} '
        print(fila)
    print(f'  {"MOVIMIENTO TOTAL":>17} |' + ' '.join(f'{total[e]:8.1f} ' for e, _ in modos))
    print('\n  Cada dolar de la ultima fila es una banda que cambio de lugar entre dos fotos de la')
    print('  misma cadena. El borde de la construccion de hoy no es un strike, asi que se mueve')
    print('  unos centavos siempre; los saltos de verdad son los enteros.')


def seccion_6e_ejemplos():
    """Los tres ejemplos de la 61.7, con el EM real, antes y despues."""
    print('\n' + '=' * 100)
    print(f'6e. LOS TRES EJEMPLOS DE LA 61.7 -- antes y despues (m = {EXCL:.2f} EM)')
    print('=' * 100)
    for tanda, sym, exp in EJEMPLOS:
        h = ENCABEZADOS[(tanda, sym, exp)]
        spot = h['spot']
        em = spot * h['iv'] * (h['dte'] / 365.0) ** 0.5
        path = os.path.join(ROOT, tanda, f'{sym}_gex_{exp}.csv')
        rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
        print(f'\n  {sym} {exp} [{tanda}]  spot {spot:.2f}  EM {em:.1f}  W {FRAC_EM * em:.1f}'
              f'  zona del dinero: {spot - EXCL * em:.1f}-{spot + EXCL * em:.1f}')
        for lado in ('PUT', 'CALL'):
            dcol = 'putDelta' if lado == 'PUT' else 'callDelta'
            tabla = sorted([(num(r, 'strike'), abs(num(r, dcol) or 0)) for r in rows
                            if num(r, 'strike') is not None and num(r, dcol) is not None])
            for etiqueta, kw in (('hoy    ', dict()), ('sin ATM', dict(excl=EXCL))):
                m = medir(rows, spot, em, lado, FRAC_EM, **kw)
                if not m:
                    continue
                print(f'    {lado:4s} {etiqueta} banda {m["lo"]:7.1f}-{m["hi"]:<7.1f} '
                      f'{m["pct"]:5.1f}%  xmed {m["xmed"]:5.1f}x  xdisj {m["xdisj"]:5.2f}x '
                      f'contra {m["disj_lo"]:6.1f}-{m["disj_hi"]:<6.1f} '
                      f'(dcomp {dist_comp(m, spot, em, lado):.2f} EM)  borde {m["borde"]:7.1f} '
                      f'delta {delta_en(tabla, m["borde"]):.3f}')


def seccion_6f_restriccion(carpeta):
    """Si el arreglo mueve el conteo de la 61.3: `ata la banda en 3 de 12`.

    Es el numero que dice cuantas veces la estructura aporto algo que el corte de delta no
    tenia, asi que cambiar la construccion de la banda obliga a recontarlo.
    """
    print('\n' + '=' * 100)
    print(f'6f. RESTRICCION -- ata la banda o el delta, antes y despues'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"borde":>7} {"delta":>6} {"ata":>6} | '
          f'{"borde":>7} {"delta":>6} {"ata":>6} |')
    cuenta = {'hoy': 0, 'fix': 0}
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            tabla = put if lado == 'PUT' else call
            fila, atas = f'  {sym + " " + exp[5:] + " " + lado:>17} |', []
            for modo, kw in (('hoy', dict()), ('fix', dict(excl=EXCL))):
                m = medir(rows, spot, em, lado, FRAC_EM, **kw)
                if not m:
                    fila += f' {"--":>7} {"--":>6} {"--":>6} |'
                    atas.append(None)
                    continue
                d = delta_en(tabla, m['borde'])
                ata = d < DELTA_REF
                cuenta[modo] += 1 if ata else 0
                atas.append(ata)
                fila += f' {m["borde"]:7.1f} {d:6.3f} {"BANDA" if ata else "delta":>6} |'
            print(fila + ('  <-- cambia' if atas[0] != atas[1] else ''))
    print(f'\n  ata la BANDA:  hoy {cuenta["hoy"]} de 12   ->   con el arreglo '
          f'{cuenta["fix"]} de 12')


# ---------------------------------------------------------------- 7. el competidor contiguo

"""El unico defecto de la 61.4 que quedo abierto el 2026-08-26: cuando el competidor disjunto
es la COLA DE LA PROPIA BANDA, `xdisj` compara el muro contra si mismo, da bajo, y castiga a
una concentracion ancha por ser ancha.

Medido el 2026-08-27, no es un caso de borde: es el caso NORMAL. Y los dos parches obvios
fallan, cada uno por su lado, hasta que aparece que el problema no es el competidor sino el
test.

  7a  Cuanto pasa -- la separacion entre la banda y el competidor que define `xdisj`.
  7b  PARCHE A -- exigirle al competidor un hueco de `g` anchos de banda.
  7c  PARCHE B -- dejar crecer la banda sobre la masa contigua. Es el unico que toca el BORDE,
      que es la parte del problema que la 61.4 no habia visto.
  7d  LA QUE DECIDE -- el borde entre tandas, con el barrido fino de `f`.
  7e  EL DIAGNOSTICO -- `xvalle`: lo que `xdisj` cree que mide y no mide.
  7f  Lo que el parche B habria movido en el conteo de restriccion, y no se cobra.
"""

HUECO = 1.0          # separacion minima del competidor, en anchos de banda. Se barre en 7b
CRECER = 0.60        # densidad minima de la rebanada contigua, en fraccion de la banda (7c)


def seccion_7a_hueco(carpeta):
    print('\n' + '=' * 100)
    print(f'7a. EL COMPETIDOR CONTIGUO -- a que distancia esta el que define xdisj'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"banda":>15} {"competidor":>15} {"hueco":>7} {"en W":>6} | {"xdisj":>7}')
    pegados = total = 0
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado, FRAC_EM, excl=EXCL)
            if not m or m['disj_lo'] != m['disj_lo']:
                continue
            h = min(abs(m['disj_lo'] - m['hi']), abs(m['lo'] - m['disj_hi']))
            w = m['hi'] - m['lo']
            total += 1
            pegados += 1 if h < w else 0
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {m["lo"]:7.1f}-{m["hi"]:<7.1f} '
                  f'{m["disj_lo"]:7.1f}-{m["disj_hi"]:<7.1f} {h:7.1f} '
                  f'{h / w:6.2f}{"!" if h < w else " "}| {m["xdisj"]:6.2f}x')
    print(f'\n  ! = el competidor esta a menos de UN ancho de banda. Pasa en {pegados} de {total}:')
    print('  el competidor tipico no es otro muro, es el borde de afuera del mismo.')


def seccion_7b_parche_a(carpeta):
    """PARCHE A -- el competidor tiene que estar separado de la banda por `g` anchos.

    Sube `xdisj` en casi todos los casos, que es lo que se le pide. Lo que hay que preguntarle es
    otra cosa: si lo que sube es informacion o es aritmetica. Ver 7e.
    """
    print('\n' + '=' * 100)
    print(f'7b. PARCHE A -- exigir un hueco de g anchos de banda'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    gs = (0.0, 0.25, 0.5, 1.0, 2.0)
    print(f'  {"caso":>17} |' + ' '.join(f'{"g=" + f"{g:.2f}":>9}' for g in gs))
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            fila = f'  {sym + " " + exp[5:] + " " + lado:>17} |'
            for g in gs:
                m = medir(rows, spot, em, lado, FRAC_EM, excl=EXCL, hueco=g)
                if not m:
                    fila += f' {"--":>9}'
                elif m['xdisj'] == float('inf'):
                    fila += f' {"sin comp":>9}'
                else:
                    fila += f' {m["xdisj"]:8.2f}x'
            print(fila)
    print('\n  TSLA 18-Sep CALL no se mueve con ningun hueco: su competidor esta a 2.5 anchos. Es el')
    print('  unico "no hay muro" que el dataset tiene -- y la 7e muestra que tampoco lo es.')


def seccion_7c_parche_b(carpeta):
    """PARCHE B -- la banda crece sobre la masa contigua, y sus tests se miden al ancho crecido."""
    print('\n' + '=' * 100)
    print(f'7c. PARCHE B -- dejar crecer la banda sobre la masa contigua'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    fs = (0.75, 0.60, 0.50, 0.35)
    print(f'  {"caso":>17} |{"sin crecer":^24}|' + '|'.join(f'{"f=" + f"{f:.2f}":^24}' for f in fs))
    print(f'  {"":>17} |{"banda    xW xmed xdisj":^24}|' +
          '|'.join(f'{"banda    xW xmed xdisj":^24}' for _ in fs))
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            fila = f'  {sym + " " + exp[5:] + " " + lado:>17} |'
            for f in (0.0,) + fs:
                m = medir(rows, spot, em, lado, FRAC_EM, excl=EXCL, crecer=f)
                if not m:
                    fila += f'{"--":^24}|'
                    continue
                n = (m['hi'] - m['lo']) / (FRAC_EM * em)
                fila += '{:^24}|'.format('{:.0f}-{:.0f} x{:.0f} {:4.1f}x {:4.2f}x'.format(
                    m['lo'], m['hi'], n, m['xmed'], m['xdisj']))
            print(fila.rstrip('|'))
    print('\n  xW = cuantos anchos mide la banda crecida. Crecer mueve el BORDE, que es lo que')
    print('  ninguna otra correccion de la 61.4 movia: si la concentracion es mas ancha que W, la')
    print('  ventana la parte y el borde queda DENTRO del muro -- lo que la 17 dice que no se hace.')
    print('  Y crecer infla `xdisj` por construccion: la banda se come a su propio competidor.')


def seccion_7d_estabilidad():
    """LA QUE DECIDE, otra vez: el borde entre tandas. El parche A no lo toca por construccion.

    El barrido de `f` es fino a proposito: lo que descalifica al parche B no es su nivel sino que
    la estabilidad NO ES MONOTONA en el parametro.
    """
    print('\n' + '=' * 100)
    print('7d. LA QUE DECIDE -- el borde entre tandas, barrido fino de f')
    print('=' * 100)
    fs = (0.90, 0.80, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45)
    modos = [('sin crecer', dict())] + [(f'{f:.2f}', dict(crecer=f)) for f in fs]
    serie = {}
    for carpeta in capturas():
        for sym, exp, rows, spot, em, call, put in casos(carpeta):
            for lado in ('PUT', 'CALL'):
                for etiqueta, kw in modos:
                    m = medir(rows, spot, em, lado, FRAC_EM, excl=EXCL, **kw)
                    if m:
                        serie.setdefault((sym, exp, lado, etiqueta), []).append(m['borde'])
    claves = sorted({k[:3] for k in serie if len(serie[k]) > 1})
    print(f'  {"caso":>17} |' + ' '.join(f'{e:>10}' for e, _ in modos))
    total = {e: 0.0 for e, _ in modos}
    for clave in claves:
        fila = f'  {clave[0] + " " + clave[1][5:] + " " + clave[2]:>17} |'
        for etiqueta, _ in modos:
            b = serie.get(clave + (etiqueta,), [])
            mov = max(b) - min(b) if len(b) > 1 else 0.0
            total[etiqueta] += mov
            fila += f' {mov:9.1f} '
        print(fila)
    print(f'  {"MOVIMIENTO TOTAL":>17} |' + ' '.join(f'{total[e]:9.1f} ' for e, _ in modos))
    print('\n  La fila de abajo sube y baja sin orden al mover `f`. Un parametro con acantilados')
    print('  entre valores vecinos no se calibra con 12 casos: es el mismo motivo por el que se')
    print('  rechazo el anclaje a la grilla el 26.')


def seccion_7e_xvalle(carpeta):
    """EL DIAGNOSTICO. `xdisj` no mide lo que dice medir, y `xvalle` si."""
    print('\n' + '=' * 100)
    print(f'7e. EL DIAGNOSTICO -- xvalle: que hay ENTRE la banda y su competidor'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"xdisj":>7} {"hueco/W":>8} | {"xvalle":>7} | lectura')
    valles = sinvalle = 0
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado, FRAC_EM, excl=EXCL)
            if not m or m['disj_lo'] != m['disj_lo']:
                continue
            h = min(abs(m['disj_lo'] - m['hi']), abs(m['lo'] - m['disj_hi']))
            v = m['xvalle']
            if v is None:
                lect, txt = 'contiguo: UNA losa', '--'
            elif v < 0.25:
                lect, txt = 'VALLE: dos muros', f'{v:.2f}'
                valles += 1
            else:
                lect, txt = 'sin valle: UNA losa', f'{v:.2f}'
            sinvalle += 1 if v is None or v >= 0.25 else 0
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {m["xdisj"]:6.2f}x '
                  f'{h / (m["hi"] - m["lo"]):8.2f} | {txt:>7} | {lect}')
    print(f'\n  Valles de verdad: {valles} de {valles + sinvalle}. En los otros {sinvalle}, lo que')
    print('  hay del otro lado del "competidor" es la misma losa o un estante sin hueco -- el valle')
    print('  mas profundo de todo el dataset tiene el 28% de la densidad de su banda.')
    print('  O sea que `xdisj` NO TIENE UN SOLO POSITIVO VERDADERO en el dataset, y el 1.01x de')
    print('  TSLA 18-Sep CALL --el "no hay muro" de la 61.7-- es un falso negativo: entre sus dos')
    print('  "muros" hay un estante con el 64% de la densidad de la banda.')


def seccion_7f_restriccion(carpeta):
    """Lo que el parche B habria movido, para que quede dicho lo que se deja sobre la mesa."""
    print('\n' + '=' * 100)
    print(f'7f. LO QUE SE DEJA SOBRE LA MESA -- restriccion con la banda crecida (f = {CRECER:.2f})'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"borde":>7} {"delta":>6} {"ata":>6} | '
          f'{"borde":>7} {"delta":>6} {"ata":>6} |')
    cuenta = {'hoy': 0, 'fix': 0}
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            tabla = put if lado == 'PUT' else call
            fila, atas = f'  {sym + " " + exp[5:] + " " + lado:>17} |', []
            for modo, kw in (('hoy', dict()), ('fix', dict(crecer=CRECER))):
                m = medir(rows, spot, em, lado, FRAC_EM, excl=EXCL, **kw)
                if not m:
                    fila += f' {"--":>7} {"--":>6} {"--":>6} |'
                    atas.append(None)
                    continue
                d = delta_en(tabla, m['borde'])
                ata = d < DELTA_REF
                cuenta[modo] += 1 if ata else 0
                atas.append(ata)
                fila += f' {m["borde"]:7.1f} {d:6.3f} {"BANDA" if ata else "delta":>6} |'
            print(fila + ('  <-- cambia' if atas[0] != atas[1] else ''))
    print(f'\n  ata la BANDA:  sin crecer {cuenta["hoy"]} de 12   ->   crecida '
          f'{cuenta["fix"]} de 12')
    print('  Crecer haria que la estructura restrinja mas seguido, que es lo que la 99 le reclama')
    print('  a GOT. No alcanza: el parametro no es estable (7d), y un borde que se mueve $19 entre')
    print('  dos fotos es peor que un borde que restringe poco.')


# ---------------------------------------------------------------- 8. el borde y el ancho W

"""El defecto que quedo abierto el 27, y que resulto ser la punta de otro: si la concentracion
es mas ancha que `W`, la ventana la parte y el BORDE queda adentro del muro.

  8a  Crecer de a un strike en vez de por rebanadas -- arregla la inestabilidad que hundio al
      parche del 27, y por un margen grande.
  8b  Pero AMPLIFICA lo que el borde le debe a `W`.
  8c  La construccion DUAL --masa fija, ancho minimo--, que es la unica que no necesita `W`.
  8d  LA QUE DECIDE -- cuanto le debe a `W` el borde DE HOY, medido en delta, que es la unidad
      en la que se compara contra `delta_max`.
"""

CRECER_STRIKE = 0.60     # densidad minima al crecer de a un strike (8a)


def seccion_8a_por_strike():
    """El paso del crecimiento es todo: por rebanada la decision se da vuelta entre fotos."""
    print('\n' + '=' * 100)
    print('8a. CRECER DE A UN STRIKE -- el borde entre tandas, contra crecer por rebanadas')
    print('=' * 100)
    fs = (0.90, 0.80, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45)
    modos = [('sin crecer', dict())]
    modos += [(f'reb {f:.2f}', dict(crecer=f)) for f in (0.80, 0.70, 0.60, 0.55)]
    modos += [(f'str {f:.2f}', dict(crecer=f, crecer_modo='strike')) for f in fs]
    serie = {}
    for carpeta in capturas():
        for sym, exp, rows, spot, em, call, put in casos(carpeta):
            for lado in ('PUT', 'CALL'):
                for etiqueta, kw in modos:
                    m = medir(rows, spot, em, lado, FRAC_EM, excl=EXCL, **kw)
                    if m:
                        serie.setdefault((sym, exp, lado, etiqueta), []).append(m['borde'])
    claves = sorted({k[:3] for k in serie if len(serie[k]) > 1})
    total = {e: 0.0 for e, _ in modos}
    for clave in claves:
        for etiqueta, _ in modos:
            b = serie.get(clave + (etiqueta,), [])
            total[etiqueta] += (max(b) - min(b)) if len(b) > 1 else 0.0
    print(f'  {"construccion":>14} | movimiento total del borde entre tandas, 10 series')
    for etiqueta, _ in modos:
        barra = '#' * min(60, int(total[etiqueta] * 2))
        print(f'  {etiqueta:>14} | {total[etiqueta]:6.1f}  {barra}')
    print('\n  Por REBANADA el numero sube y baja sin orden al mover `f`; de a un STRIKE se va a')
    print('  0.3 en toda la franja 0.65-0.45, mejor que no crecer. El defecto del parche del 27 no')
    print('  era la idea: era el tamano del paso.')


def seccion_8b_borde_vs_w(carpeta):
    """Y sin embargo crecer no sirve, porque lo que el borde le debe a `W` empeora."""
    print('\n' + '=' * 100)
    print(f'8b. EL PRECIO DE CRECER -- cuanto se corre el borde al barrer W'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    fracs = (0.15, 0.20, 0.25, 0.30, 0.40)
    print(f'  {"caso":>17} | {"hoy":>7} | {"crecida":>8} | {"+ res propia":>12} |'
          f'  rango del borde barriendo W de 0.15 a 0.40 EM')
    a, b, d = [], [], []
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            bh = [medir(rows, spot, em, lado, fr, excl=EXCL)['borde'] for fr in fracs]
            bc = [medir(rows, spot, em, lado, fr, excl=EXCL, crecer=CRECER_STRIKE,
                        crecer_modo='strike')['borde'] for fr in fracs]
            br = [medir(rows, spot, em, lado, fr, excl=EXCL, crecer=0.35,
                        crecer_modo='strike', crecer_res=True)['borde'] for fr in fracs]
            a.append(max(bh) - min(bh))
            b.append(max(bc) - min(bc))
            d.append(max(br) - min(br))
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {a[-1]:7.1f} | {b[-1]:8.1f} | '
                  f'{d[-1]:12.1f} |')
    print(f'\n  hoy            medio {statistics.mean(a):5.1f}   maximo {max(a):5.1f}')
    print(f'  crecida        medio {statistics.mean(b):5.1f}   maximo {max(b):5.1f}')
    print(f'  + res propia   medio {statistics.mean(d):5.1f}   maximo {max(d):5.1f}')
    print('  Crecer no libera al borde de `W`: lo ata mas fuerte, porque `W` entra dos veces --')
    print('  la semilla es una ventana de ancho `W` y la referencia de densidad tambien.')
    print('  Desacoplar la resolucion (medir la densidad sobre el paso del gamma en vez de sobre')
    print('  `W`) saca una de las dos y deja el borde a la par de hoy, no mejor: lo que queda')
    print('  moviendose es la SEMILLA, que sigue siendo una ventana de ancho `W`.')


def seccion_8c_dual(carpeta):
    """La unica construccion sin `W`, y tambien se cae."""
    print('\n' + '=' * 100)
    print('8c. LA DUAL -- masa fija p, ancho minimo: la unica que no necesita W')
    print('=' * 100)
    ps = (0.30, 0.40, 0.50, 0.60)
    serie = {}
    for carp in capturas():
        for sym, exp, rows, spot, em, call, put in casos(carp):
            for lado in ('PUT', 'CALL'):
                c = gex_del_lado(rows, spot, lado)
                c = sorted(x for x in c if abs(x[0] - spot) >= EXCL * em)
                if len(c) < 6:
                    continue
                serie.setdefault((sym, exp, lado, 'hoy'), []).append(
                    medir(rows, spot, em, lado, FRAC_EM, excl=EXCL)['borde'])
                for p in ps:
                    d = banda_dual(c, p, lado)
                    if d:
                        serie.setdefault((sym, exp, lado, p), []).append(
                            d[1] if lado == 'CALL' else d[0])
    claves = sorted({k[:3] for k in serie if len(serie[k]) > 1})
    cols = ['hoy'] + list(ps)
    total = {x: 0.0 for x in cols}
    for clave in claves:
        for x in cols:
            v = serie.get(clave + (x,), [])
            total[x] += (max(v) - min(v)) if len(v) > 1 else 0.0
    print(f'  {"construccion":>14} | movimiento total del borde entre tandas, 10 series')
    for x in cols:
        etiqueta = 'hoy (W fijo)' if x == 'hoy' else f'dual p={x:.2f}'
        print(f'  {etiqueta:>14} | {total[x]:6.1f}  ' + '#' * min(60, int(total[x] * 2)))
    print('\n  Sacar `W` no sale gratis: la dual cambia el filo de lugar --de "que strike entra en')
    print('  la ventana" a "que strike completa la masa"-- y el segundo es mucho peor.')


def seccion_8d_w_manda(carpeta):
    """LA QUE DECIDE. El borde nunca fue solido, y `W` no esta calibrado."""
    print('\n' + '=' * 100)
    print(f'8d. LA QUE DECIDE -- cuanto le debe el borde DE HOY a un parametro sin calibrar'
          f'   [{os.path.basename(carpeta)}, EM real]')
    print('=' * 100)
    rangos = (('0.15-0.40 EM', (0.15, 0.20, 0.25, 0.30, 0.40)),
              ('0.20-0.30 EM', (0.20, 0.225, 0.25, 0.275, 0.30)),
              ('0.225-0.275', (0.225, 0.2375, 0.25, 0.2625, 0.275)))
    print(f'  {"caso":>17} |' + '|'.join(f'{n:^21}' for n, _ in rangos))
    print(f'  {"":>17} |' + '|'.join(f'{"rango $   en delta":^21}' for _ in rangos))
    acum = {n: [] for n, _ in rangos}
    for sym, exp, rows, spot, em, call, put in casos_em_real(carpeta):
        for lado in ('PUT', 'CALL'):
            tabla = put if lado == 'PUT' else call
            fila = f'  {sym + " " + exp[5:] + " " + lado:>17} |'
            for n, fracs in rangos:
                bs = [medir(rows, spot, em, lado, fr, excl=EXCL)['borde'] for fr in fracs]
                ds = [delta_en(tabla, x) for x in bs]
                acum[n].append((max(bs) - min(bs), max(ds) - min(ds)))
                fila += '{:^21}|'.format('{:6.1f}     {:.3f}'.format(
                    max(bs) - min(bs), max(ds) - min(ds)))
            print(fila.rstrip('|'))
    print()
    for n, _ in rangos:
        rs = [x[0] for x in acum[n]]
        ds = [x[1] for x in acum[n]]
        print(f'  {n:>14} -> borde: medio ${statistics.mean(rs):5.1f}  max ${max(rs):5.1f}'
              f'   |   delta: medio {statistics.mean(ds):.3f}  max {max(ds):.3f}')
    print('\n  El corte de riesgo es delta_max = 0.20. Mover `W` un +/-20% --dentro de lo que la')
    print('  61.4 declara como rango libre-- corre el delta del borde hasta 0.174: casi todo el')
    print('  presupuesto. `W` no es el ancho de una ventana: es quien decide si la banda ata.')
    print('  Y no esta calibrado, ni se puede calibrar antes de la 61.9.')


def main():
    global EXCL
    pedida = sys.argv[1] if len(sys.argv) > 1 else '2026-08-25'
    if len(sys.argv) > 2:
        EXCL = float(sys.argv[2])
    carpeta = os.path.join(ROOT, pedida)
    if not os.path.isdir(carpeta):
        print(f'no existe {carpeta}')
        return 1
    seccion_0_borde_por_em(carpeta)
    seccion_1_estabilidad()
    seccion_2_restriccion(carpeta)
    seccion_3_premio(carpeta)
    seccion_4_sensibilidad(carpeta)
    seccion_5_ejemplos()
    seccion_6a_holgura(carpeta)
    seccion_6b_anclaje(carpeta)
    seccion_6c_exclusion(carpeta)
    seccion_6d_estabilidad()
    seccion_6e_ejemplos()
    seccion_6f_restriccion(carpeta)
    seccion_7a_hueco(carpeta)
    seccion_7b_parche_a(carpeta)
    seccion_7c_parche_b(carpeta)
    seccion_7d_estabilidad()
    seccion_7e_xvalle(carpeta)
    seccion_7f_restriccion(carpeta)
    seccion_8a_por_strike()
    seccion_8b_borde_vs_w(carpeta)
    seccion_8c_dual(carpeta)
    seccion_8d_w_manda(carpeta)
    return 0


if __name__ == '__main__':
    sys.exit(main())
