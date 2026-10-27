# 2026-08-28 · La corrida completa de `banda_de_gamma.py`, como línea de base

**Qué se probó.** El script entero, las 22 secciones en el orden de su `main()`, sobre los
datasets versionados. No es una medición nueva: es la **reproducción** de los cinco hallazgos que
lo fueron construyendo, corridos todos juntos por primera vez desde que la sección 8 lo cerró.

**Contra qué datos.** `research/got/data/`, con `2026-08-25` como carpeta por defecto para las
secciones que piden una tanda, y el recorrido de todas las capturas en las que miden estabilidad
entre tandas (1, 6d, 7d, 8a, 8c). El EM real sale de `ENCABEZADOS` en las secciones 6, 7 y 8; las
0 a 4 usan el proxy `EM*`, como está documentado en el encabezado del script.

**Qué dio.** Exit 0, sin excepciones, y **los números publicados se reproducen todos**:

| Sección | Número que ancla un hallazgo | Publicado | Esta corrida |
|---|---|---|---|
| 0 | ρ(distancia/EM, delta) en las 12 combinaciones | −1.0000 | −1.0000 |
| 3 | z medio del premio de crédito del borde | +0.56 ± 0.90 | +0.56 ± 0.90 |
| 6d | movimiento del borde entre tandas, antes → después | 16.1 → 1.3 | 16.1 → 1.3 |
| 7e | valles de verdad sobre 12 combinaciones | 0 | 0 |
| 8b | corrimiento medio del borde barriendo `W` | 9.6 / 16.6 / 8.0 | 9.6 / 16.6 / 8.0 |
| 8d | delta del borde con `W` ±20%, contra `delta_max` 0.20 | 0.174 | 0.174 |

No hay una sola discrepancia contra lo que la §61 y la §98 tienen escrito.

## Lo que se ve corriendo todo junto, y no en las secciones sueltas

**El caso que daba el 16.1 es uno solo.** La sección 1 muestra que de las 10 series con dos o más
tomas, nueve mueven el borde entre $0.0 y $0.2 —centavos de una ventana continua— y la décima,
**QQQ 18-Sep CALL, se mueve $14.9** (719.5 → 734.4). Todo el movimiento de la construcción anterior
era esa serie, la misma cuyo argmax saltaba de 710 a 750 con dominancia 1.01x. Es la que el 25 se
leyó como meseta y el 26 midió como la pila del dinero.

**En el lado donde la banda aporta, el borde cae donde ya vendía el delta.** La sección 3 imprime,
para SPY 16-Oct CALL, `mismo strike (805): el borde cae donde ya vendia delta 0.15`. Es uno de los
tres lados que atan la banda, y sin embargo el borde estructural y el corte de delta señalan el
mismo contrato. Suma al negativo del premio: los dos residuos más grandes van en direcciones
opuestas (TSLA 18-Sep PUT +7.62, QQQ 16-Oct CALL −4.36), así que el z medio indistinguible de cero
no es ruido chico alrededor de cero — es dispersión grande alrededor de cero.

**Lo que se deja sobre la mesa está cuantificado.** La 7f dice que crecer la banda llevaría la
restricción de **3 a 5 de 12**, con QQQ 18-Sep CALL y TSLA 18-Sep CALL pasando a atar la banda en
delta 0.110 y 0.122. Es exactamente lo que la §99 le reclama a GOT. Y se rechaza igual, porque el
borde de esa construcción se mueve $19 entre dos fotos del mismo día: un candidato que aparece y
desaparece entre capturas no es una restricción.

## Qué NO aporta este hallazgo

No mide nada nuevo y no mueve ningún veredicto. Su valor es de **línea de base**: deja el output
íntegro fechado, para que una corrida futura se pueda diferenciar contra este archivo y se vea qué
movió un cambio de construcción, de dataset o de parámetro. Ningún nodo de la definición se toca a
raíz de esto.

Sigue valiendo, sin cambios, lo que la §98 tiene como pendiente único: la hipótesis de la §61.9
bloquea la calibración de `W`, y `W` decide si la banda ata.

## Reproducción

```bash
PYTHONIOENCODING=utf-8 python research/got/scripts/banda_de_gamma.py
```

Python 3.10.10, sin dependencias externas. La corrida de abajo es de esa línea exacta, sin
argumentos, o sea con `2026-08-25` como carpeta y `EXCL = 0.15`.

## El output, completo

```text

====================================================================================================
0. EL BORDE POR EM -- rho(distancia/EM, |delta|)   [2026-08-25]
====================================================================================================
               caso |    n      rho
      QQQ 09-18 PUT |   61  -1.0000
     QQQ 09-18 CALL |   50  -1.0000
      QQQ 10-16 PUT |   63  -1.0000
     QQQ 10-16 CALL |   41  -1.0000
      SPY 09-18 PUT |   87  -1.0000
     SPY 09-18 CALL |   55  -1.0000
      SPY 10-16 PUT |   67  -1.0000
     SPY 10-16 CALL |   40  -1.0000
     TSLA 09-18 PUT |   23  -1.0000
    TSLA 09-18 CALL |   28  -1.0000
     TSLA 10-16 PUT |   25  -1.0000
    TSLA 10-16 CALL |   22  -1.0000

  rho = -1 exacto significa que las dos variables ordenan la cadena identico: el
  borde por `d_min x EM` de la 61.3 es un corte de delta escrito de otra manera.

====================================================================================================
1. ESTABILIDAD -- la banda contra el argmax, misma serie en tandas distintas
====================================================================================================

  QQQ 2026-09-18 CALL
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     710  1.50x |   710.0-719.5    24.3%   1.5x  1.32x |   719.5
        2026-08-25 |     750  1.01x |   725.0-734.4    24.3%   1.3x  1.24x |   734.4

  QQQ 2026-09-18 PUT
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     700  2.18x |   690.5-700.0    29.3%   3.7x  1.16x |   690.5
        2026-08-25 |     700  2.31x |   690.6-700.0    28.9%   4.0x  1.25x |   690.6

  QQQ 2026-10-16 CALL
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     750  1.56x |   736.0-750.4    31.7%   1.8x  1.35x |   750.4
        2026-08-25 |     750  1.50x |   736.0-750.4    32.1%   1.8x  1.41x |   750.4

  QQQ 2026-10-16 PUT
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     700  1.22x |   669.6-684.0    27.4%   3.0x  1.06x |   669.6
        2026-08-25 |     700  1.24x |   669.6-684.0    26.8%   3.0x  1.04x |   669.6

  SPY 2026-09-18 CALL
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     790  1.57x |   784.0-790.9    27.8%   3.4x  1.22x |   790.9
        2026-08-25 |     790  1.42x |   784.0-790.8    30.2%   3.3x  1.22x |   790.8
     2026-08-25-t2 |     790  1.40x |   784.0-790.7    30.3%   3.4x  1.20x |   790.7

  SPY 2026-09-18 PUT
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     760  1.50x |   753.1-760.0    23.9%  13.8x  1.49x |   753.1
        2026-08-25 |     760  1.45x |   753.2-760.0    22.5%  14.2x  1.54x |   753.2
     2026-08-25-t2 |     760  1.45x |   753.3-760.0    22.8%  14.8x  1.56x |   753.3

  SPY 2026-10-16 CALL
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     790  1.02x |   790.0-800.8    34.5%   2.0x  1.27x |   800.8
        2026-08-25 |     790  1.00x |   790.0-800.7    36.7%   2.1x  1.32x |   800.7
     2026-08-25-t2 |     790  1.02x |   790.0-800.5    34.6%   2.0x  1.31x |   800.5

  SPY 2026-10-16 PUT
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     730  1.44x |   729.2-740.0    23.6%   3.8x  1.26x |   729.2
        2026-08-25 |     730  1.42x |   729.3-740.0    23.0%   3.8x  1.25x |   729.3
     2026-08-25-t2 |     730  1.32x |   729.5-740.0    22.4%   3.8x  1.21x |   729.5

  TSLA 2026-10-16 CALL
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     400  1.83x |   385.0-400.2    27.1%   9.3x  1.14x |   400.2
        2026-08-25 |     400  1.82x |   385.0-400.1    25.3%  11.8x  1.10x |   400.1

  TSLA 2026-10-16 PUT
             tanda |  argmax    dom |           banda  %lado   xmed  xdisj |   borde
        2026-08-24 |     330  2.05x |   324.8-340.0    40.6%  13.7x  2.28x |   324.8
        2026-08-25 |     330  2.10x |   324.9-340.0    42.9%  15.8x  2.46x |   324.9

====================================================================================================
2. RESTRICCION -- borde de la banda contra un corte de delta 0.20   [2026-08-25]
====================================================================================================
               caso |   borde  delta   xmed  xdisj | ata?
      QQQ 09-18 PUT |   690.6  0.292   4.0x  1.25x | no
     QQQ 09-18 CALL |   734.4  0.258   1.3x  1.24x | no
      QQQ 10-16 PUT |   669.6  0.234   3.0x  1.04x | no
     QQQ 10-16 CALL |   750.4  0.240   1.8x  1.41x | no
      SPY 09-18 PUT |   753.2  0.322  14.2x  1.54x | no
     SPY 09-18 CALL |   790.8  0.126   3.3x  1.22x | SI
      SPY 10-16 PUT |   729.3  0.211   3.8x  1.25x | no
     SPY 10-16 CALL |   800.7  0.174   2.1x  1.32x | SI
     TSLA 09-18 PUT |   335.0  0.308   5.8x  1.93x | no
    TSLA 09-18 CALL |   377.5  0.276   8.6x  1.01x | no
     TSLA 10-16 PUT |   324.9  0.282  15.8x  2.46x | no
    TSLA 10-16 CALL |   400.1  0.246  11.8x  1.10x | no

====================================================================================================
3. PREMIO -- credito en el borde contra delta 0.15, y el control   [2026-08-25]
====================================================================================================
               caso |      K   dlt   cred |      K   dlt   cred |  x cred |  ef obs  ef fit      z
      QQQ 09-18 PUT |    690 0.284   0.99 |    668 0.151   0.46 |   2.15x |   0.697   0.724  -2.12
     QQQ 09-18 CALL |    735 0.248   1.16 |    746 0.151   0.64 |   1.81x |   0.936   0.949  -1.00
      QQQ 10-16 PUT |    669 0.229   0.76 |    645 0.145   0.44 |   1.73x |   0.663   0.654  +1.64
     QQQ 10-16 CALL |    755 0.210   0.89 |    765 0.157   0.67 |   1.33x |   0.848   0.914  -4.36
      SPY 09-18 PUT |    753 0.322   1.03 |    732 0.152   0.40 |   2.57x |   0.640   0.604  +2.86
     SPY 09-18 CALL |    791 0.126   0.55 |    789 0.148   0.66 |   0.83x |   0.873   0.821  +2.19
      SPY 10-16 PUT |    729 0.211   0.57 |    714 0.151   0.39 |   1.46x |   0.541   0.551  -1.22
     SPY 10-16 CALL | mismo strike (805): el borde cae donde ya vendia delta 0.15
     TSLA 09-18 PUT |    335 0.308   1.40 |    315 0.147   0.60 |   2.33x |   0.909   0.782  +7.62
    TSLA 09-18 CALL |    378 0.276   1.00 |    400 0.142   0.44 |   2.27x |   0.724   0.741  -0.62
     TSLA 10-16 PUT |    320 0.250   1.15 |    300 0.146   0.60 |   1.92x |   0.919   0.916  +0.12
    TSLA 10-16 CALL |    405 0.224   0.65 |    425 0.155   0.35 |   1.86x |   0.581   0.554  +1.07

  z medio +0.56 +/- 0.90 sobre 11 casos (6 positivos, 5 negativos)
  Un z medio indistinguible de cero = el borde de la banda NO paga por encima de lo
  que le corresponde por su delta: el premio de credito es delta, no estructura.

====================================================================================================
4. SENSIBILIDAD -- el borde segun el ancho de banda   [2026-08-25]
====================================================================================================
               caso |  0.15 EM*  0.20 EM*  0.25 EM*  0.30 EM*  0.40 EM* |   rango delta   xdisj
      QQQ 09-18 PUT |     694.4     692.5     690.6     688.7     685.0 | 0.247-0.318   1.25x
     QQQ 09-18 CALL |     730.6     730.5     734.4     730.3     740.0 | 0.200-0.299   1.24x
      QQQ 10-16 PUT |     698.4     669.5     669.6     687.8     679.0 | 0.234-0.391   1.04x
     QQQ 10-16 CALL |     750.6     750.5     750.4     755.2     751.0 | 0.210-0.240   1.41x
      SPY 09-18 PUT |     755.9     754.5     753.2     751.8     749.1 | 0.278-0.358   1.54x
     SPY 09-18 CALL |     793.1     790.5     790.8     790.2     790.9 | 0.106-0.136   1.22x
      SPY 10-16 PUT |     724.6     724.4     729.3     729.1     724.8 | 0.188-0.211   1.25x
     SPY 10-16 CALL |     800.4     798.6     800.7     800.9     800.2 | 0.174-0.182   1.32x
     TSLA 09-18 PUT |     339.0     337.0     335.0     338.0     334.1 | 0.308-0.359   1.93x
    TSLA 09-18 CALL |     406.0     375.5     377.5     382.0     380.9 | 0.122-0.296   1.01x
     TSLA 10-16 PUT |     320.9     327.9     324.9     321.9     315.8 | 0.221-0.316   2.46x
    TSLA 10-16 CALL |     404.1     402.1     400.1     403.1     404.2 | 0.224-0.246   1.10x

  El borde externo se corre con el ancho por construccion (la banda crece hacia afuera).
  Lo que importa es si la banda se MUDA de lugar: eso pasa en QQQ 10-16 PUT y TSLA 09-18
  CALL, y las dos estaban marcadas por xdisj ~ 1.0x.

====================================================================================================
5. EJEMPLOS TRABAJADOS -- el procedimiento de la 61.7, con el EM real
====================================================================================================

  SPY 2026-10-16 [2026-08-25-t2]  spot 765.45  atmIv 0.1351  DTE 52  ->  EM 39.0   W = 9.8
    paso 2 · spot - ZGL = +1.18 = +0.030 EM
    PUT  paso 4 · banda 724.2-734.0  19.5% del lado
         paso 5 · xmed 3.4x  xdisj 1.23x  contra 748-758
         paso 6 · borde 724.2  delta 0.184  1.06 EM
         paso 7 · delta_max 0.20  ->  K 727  delta 0.197  credito 0.54  c/w 0.108
         paso 8 · con muro ata la BANDA; sin muro ata el DELTA
    CALL paso 4 · banda 790.0-799.8  26.6% del lado
         paso 5 · xmed 1.6x  xdisj 1.01x  contra 766-776  [PEGADA AL SPOT: ver 61.4]
         paso 6 · borde 799.8  delta 0.172  0.88 EM
         paso 7 · delta_max 0.20  ->  K 800  delta 0.172  credito 0.82  c/w 0.164
         paso 8 · con muro ata la BANDA; sin muro ata el DELTA

  TSLA 2026-09-18 [2026-08-25]  spot 351.11  atmIv 0.4152  DTE 24  ->  EM 37.4   W = 9.3
    paso 2 · spot - ZGL = -1.31 = -0.035 EM
    PUT  paso 4 · banda 335.7-345.0  28.8% del lado
         paso 5 · xmed 6.1x  xdisj 1.93x  contra 321-330
         paso 6 · borde 335.7  delta 0.308  0.41 EM
         paso 7 · delta_max 0.20  ->  K 320  delta 0.180  credito 0.75  c/w 0.150
         paso 8 · con muro ata el DELTA; sin muro ata el DELTA
    CALL paso 4 · banda 367.5-376.8  16.9% del lado
         paso 5 · xmed 8.3x  xdisj 1.01x  contra 400-409
         paso 6 · borde 376.8  delta 0.276  0.69 EM
         paso 7 · delta_max 0.20  ->  K 390  delta 0.192  credito 0.60  c/w 0.120
         paso 8 · con muro ata el DELTA; sin muro ata el DELTA

  QQQ 2026-09-18 [2026-08-25]  spot 710.60  atmIv 0.1971  DTE 24  ->  EM 35.9   W = 9.0
    paso 2 · spot - ZGL = +1.60 = +0.044 EM
    PUT  paso 4 · banda 691.0-700.0  28.7% del lado
         paso 5 · xmed 5.6x  xdisj 1.24x  contra 681-690
         paso 6 · borde 691.0  delta 0.292  0.55 EM
         paso 7 · delta_max 0.20  ->  K 677  delta 0.196  credito 0.64  c/w 0.128
         paso 8 · con muro ata el DELTA; sin muro ata el DELTA
    CALL paso 4 · banda 725.0-734.0  23.6% del lado
         paso 5 · xmed 1.4x  xdisj 1.26x  contra 747-756
         paso 6 · borde 734.0  delta 0.258  0.65 EM
         paso 7 · delta_max 0.20  ->  K 741  delta 0.192  credito 0.85  c/w 0.170
         paso 8 · con muro ata el DELTA; sin muro ata el DELTA

  NO se imprime un veredicto de "hay muro": el umbral de xmed y xdisj todavia no esta
  declarado (61.4). Estos numeros son los de la construccion PUBLICADA, con la zona del
  dinero adentro; los mismos tres ejemplos con la zona del dinero afuera estan en 6e, y
  ahi el xdisj de SPY 10-16 CALL pasa de 1.01x a 1.49x sin que el borde se mueva.

====================================================================================================
6a. DEFECTO 1 (diagnostico) -- que tan por centavos queda afuera el primer strike   [2026-08-25, EM real]
====================================================================================================
               caso |    borde 1er fuera   holgura |   xdisj | xdisj anclada
      QQQ 09-18 PUT |    691.0     691.0     0.02p!|   1.24x |         1.25x
     QQQ 09-18 CALL |    734.0     734.0     0.02p!|   1.26x |         1.24x
      QQQ 10-16 PUT |    669.4     669.0     0.37p |   1.05x |         1.04x
     QQQ 10-16 CALL |    750.6     755.0     4.37p |   1.43x |         1.41x
      SPY 09-18 PUT |    753.6     753.0     0.59p |   1.54x |         1.54x
     SPY 09-18 CALL |    790.4     791.0     0.59p |   1.22x |         1.22x
      SPY 10-16 PUT |    724.1     724.0     0.13p!|   1.27x |         1.25x
     SPY 10-16 CALL |    799.9     800.0     0.13p!|   1.33x |         1.32x
     TSLA 09-18 PUT |    335.7     335.0     0.26p |   1.93x |         1.91x
    TSLA 09-18 CALL |    376.8     377.5     0.26p |   1.01x |         1.03x
     TSLA 10-16 PUT |    326.1     325.0     0.21p!|   2.51x |         2.46x
    TSLA 10-16 CALL |    403.9     405.0     0.21p!|   1.21x |         1.10x

  ! = el primer strike de afuera esta a menos de un cuarto de escalon del borde:
  entra o no entra por redondeo. Pasa en 6 de 12 casos.

====================================================================================================
6b. DEFECTO 1 (arreglo) -- el veredicto ante un cambio VACIO de W (+/-10%)   [2026-08-25, EM real]
====================================================================================================
               caso |       hoy       |     anclada     |     sin ATM     |     las dos     
                    | rango de xdisj  | rango de xdisj  | rango de xdisj  | rango de xdisj  
      QQQ 09-18 PUT |   1.24-1.25x    |   1.24-1.52x    |   1.24-1.25x    |   1.24-1.52x    
     QQQ 09-18 CALL |   1.24-1.26x    |   1.08-1.26x    |   1.24-1.26x    |   1.08-1.26x    
      QQQ 10-16 PUT |   1.04-1.05x    |   1.01-1.05x    |   1.04-1.05x    |   1.04-1.18x    
     QQQ 10-16 CALL |   1.41-1.45x    |   1.35-1.45x    |   1.41-1.45x    |   1.41-1.46x    
      SPY 09-18 PUT |   1.48-1.71x    |   1.48-1.54x    |   1.48-1.71x    |   1.48-1.54x    
     SPY 09-18 CALL |   1.18-1.22x    |   1.18-1.22x    |   1.18-1.22x    |   1.18-1.22x    
      SPY 10-16 PUT |   1.25-1.29x    |   1.24-1.27x    |   1.25-1.29x    |   1.24-1.27x    
     SPY 10-16 CALL |   1.32-1.37x    |   1.27-1.33x    |   1.50-1.68x    |   1.50-1.68x    
     TSLA 09-18 PUT |   1.91-1.93x    |   1.24-1.91x    |   1.93-2.35x    |   1.24-2.35x    
    TSLA 09-18 CALL |   1.01-1.03x    |   1.03-1.48x    |   1.01-1.03x    |   1.03-1.48x    
     TSLA 10-16 PUT |   2.46-2.51x    |   2.46-2.46x    |   2.46-2.51x    |   2.46-2.46x    
    TSLA 10-16 CALL |   1.10-1.21x    |   1.10-1.10x    |   1.10-1.21x    |   1.10-1.10x    

       hoy -> swing medio   3.8%   maximo  15.0%   casos con swing > 20%: 0/12
   anclada -> swing medio  13.5%   maximo  53.9%   casos con swing > 20%: 3/12
   sin ATM -> swing medio   6.3%   maximo  21.9%   casos con swing > 20%: 1/12
   las dos -> swing medio  17.4%   maximo  89.1%   casos con swing > 20%: 3/12

====================================================================================================
6c. DEFECTOS 2 y 3 -- barrido de la zona del dinero excluida   [2026-08-25, EM real]
====================================================================================================
               caso |        m=0.00                 m=0.10                 m=0.15                 m=0.25                 m=0.35        
                    | borde  xdisj  dcomp    borde  xdisj  dcomp    borde  xdisj  dcomp    borde  xdisj  dcomp    borde  xdisj  dcomp  
      QQQ 09-18 PUT |   691.0  1.24x  0.57    691.0  1.24x  0.57    691.0  1.24x  0.57    691.0  1.24x  0.57    681.0  2.49x  0.82 
     QQQ 09-18 CALL |   734.0  1.26x  1.01    734.0  1.26x  1.01    734.0  1.26x  1.01    734.0  1.26x  1.01    734.0  1.26x  1.01 
      QQQ 10-16 PUT |   669.4  1.05x  0.16    669.4  1.05x  0.16    669.4  1.05x  0.16    669.4  1.87x  0.87    669.4  1.87x  0.87 
     QQQ 10-16 CALL |   750.6  1.43x  0.14    750.6  1.43x  0.14    750.6  1.44x  0.15    750.6  1.75x  0.91    750.6  1.75x  0.91 
      SPY 09-18 PUT |   753.6  1.54x  1.14    753.6  1.54x  1.14    753.6  1.54x  1.14    749.6  1.14x  1.14    749.6  1.14x  1.14 
     SPY 09-18 CALL |   790.4  1.22x  0.34    790.4  1.22x  0.34    790.4  1.22x  0.34    790.4  1.22x  0.34    790.4  1.22x  0.38 
      SPY 10-16 PUT |   724.1  1.27x  0.18    724.1  1.27x  0.18    724.1  1.27x  0.18    724.1  1.29x  0.26    724.1  1.32x  0.51 
     SPY 10-16 CALL |   799.9  1.33x  0.12    799.9  1.33x  0.12    799.9  1.50x  0.17    799.9  1.70x  0.27    799.9  2.07x  0.37 
     TSLA 09-18 PUT |   335.7  1.93x  0.56    335.7  1.93x  0.56    335.7  1.93x  0.56    330.7  1.90x  0.56    320.7  1.38x  0.83 
    TSLA 09-18 CALL |   376.8  1.01x  1.31    376.8  1.01x  1.31    376.8  1.01x  1.31    376.8  1.01x  1.31    376.8  1.01x  1.31 
     TSLA 10-16 PUT |   326.1  2.51x  0.47    326.1  2.51x  0.47    326.1  2.51x  0.47    316.1  2.51x  0.92    316.1  2.51x  0.92 
    TSLA 10-16 CALL |   403.9  1.21x  0.34    403.9  1.21x  0.34    403.9  1.21x  0.34    403.9  1.21x  0.34    403.9  1.34x  0.43 

  dcomp chico = el competidor es la pila del dinero y el test no midio nada.
  Subir m de mas mueve bordes que estaban bien: eso es comerse la banda, no el dinero.

====================================================================================================
6d. LA QUE DECIDE -- cuanto se mueve el borde entre tandas, por construccion
====================================================================================================
               caso |      hoy   anclada    m=0.10    m=0.15    m=0.25    m=0.35 ancl+0.15
     QQQ 09-18 CALL |     14.9      14.0       0.1       0.1       0.1       0.1       6.0 
      QQQ 09-18 PUT |      0.1       1.0       0.1       0.1       9.1       0.1       1.0 
     QQQ 10-16 CALL |      0.0       0.0       0.0       0.0       0.0       0.0       0.0 
      QQQ 10-16 PUT |      0.0       0.0       0.0       0.0       0.0       0.0       0.0 
     SPY 09-18 CALL |      0.2       0.0       0.2       0.2       0.2       0.2       0.0 
      SPY 09-18 PUT |      0.2       0.0       0.2       0.2       0.2      20.2       0.0 
     SPY 10-16 CALL |      0.2       0.0       0.2       0.2       0.2       0.2       0.0 
      SPY 10-16 PUT |      0.2       0.0       0.2       0.2       0.2       0.2       0.0 
    TSLA 10-16 CALL |      0.1       0.0       0.1       0.1       0.1       0.1       0.0 
     TSLA 10-16 PUT |      0.1       0.0       0.1       0.1       0.1       9.9       0.0 
   MOVIMIENTO TOTAL |    16.1      15.0       1.3       1.3      10.3      31.2       7.0 

  Cada dolar de la ultima fila es una banda que cambio de lugar entre dos fotos de la
  misma cadena. El borde de la construccion de hoy no es un strike, asi que se mueve
  unos centavos siempre; los saltos de verdad son los enteros.

====================================================================================================
6e. LOS TRES EJEMPLOS DE LA 61.7 -- antes y despues (m = 0.15 EM)
====================================================================================================

  SPY 2026-10-16 [2026-08-25-t2]  spot 765.45  EM 39.0  W 9.8  zona del dinero: 759.6-771.3
    PUT  hoy     banda   724.2-734.0    19.5%  xmed   3.4x  xdisj  1.23x contra  748.2-758.0  (dcomp 0.19 EM)  borde   724.2 delta 0.184
    PUT  sin ATM banda   724.2-734.0    20.8%  xmed   3.5x  xdisj  1.23x contra  748.2-758.0  (dcomp 0.19 EM)  borde   724.2 delta 0.184
    CALL hoy     banda   790.0-799.8    26.6%  xmed   1.6x  xdisj  1.01x contra  766.0-775.8  (dcomp 0.01 EM)  borde   799.8 delta 0.172
    CALL sin ATM banda   790.0-799.8    33.1%  xmed   1.7x  xdisj  1.49x contra  772.0-781.8  (dcomp 0.17 EM)  borde   799.8 delta 0.172

  TSLA 2026-09-18 [2026-08-25]  spot 351.11  EM 37.4  W 9.3  zona del dinero: 345.5-356.7
    PUT  hoy     banda   335.7-345.0    28.8%  xmed   6.1x  xdisj  1.93x contra  320.7-330.0  (dcomp 0.56 EM)  borde   335.7 delta 0.308
    PUT  sin ATM banda   335.7-345.0    34.3%  xmed   8.7x  xdisj  1.93x contra  320.7-330.0  (dcomp 0.56 EM)  borde   335.7 delta 0.308
    CALL hoy     banda   367.5-376.8    16.9%  xmed   8.3x  xdisj  1.01x contra  400.0-409.3  (dcomp 1.31 EM)  borde   376.8 delta 0.276
    CALL sin ATM banda   367.5-376.8    17.6%  xmed   8.9x  xdisj  1.01x contra  400.0-409.3  (dcomp 1.31 EM)  borde   376.8 delta 0.276

  QQQ 2026-09-18 [2026-08-25]  spot 710.60  EM 35.9  W 9.0  zona del dinero: 705.2-716.0
    PUT  hoy     banda   691.0-700.0    28.7%  xmed   5.6x  xdisj  1.24x contra  681.0-690.0  (dcomp 0.57 EM)  borde   691.0 delta 0.292
    PUT  sin ATM banda   691.0-700.0    30.8%  xmed   5.6x  xdisj  1.24x contra  681.0-690.0  (dcomp 0.57 EM)  borde   691.0 delta 0.292
    CALL hoy     banda   725.0-734.0    23.6%  xmed   1.4x  xdisj  1.26x contra  747.0-756.0  (dcomp 1.01 EM)  borde   734.0 delta 0.258
    CALL sin ATM banda   725.0-734.0    25.4%  xmed   1.4x  xdisj  1.26x contra  747.0-756.0  (dcomp 1.01 EM)  borde   734.0 delta 0.258

====================================================================================================
6f. RESTRICCION -- ata la banda o el delta, antes y despues   [2026-08-25, EM real]
====================================================================================================
               caso |   borde  delta    ata |   borde  delta    ata |
      QQQ 09-18 PUT |   691.0  0.292  delta |   691.0  0.292  delta |
     QQQ 09-18 CALL |   734.0  0.258  delta |   734.0  0.258  delta |
      QQQ 10-16 PUT |   669.4  0.229  delta |   669.4  0.229  delta |
     QQQ 10-16 CALL |   750.6  0.240  delta |   750.6  0.240  delta |
      SPY 09-18 PUT |   753.6  0.333  delta |   753.6  0.333  delta |
     SPY 09-18 CALL |   790.4  0.136  BANDA |   790.4  0.136  BANDA |
      SPY 10-16 PUT |   724.1  0.188  BANDA |   724.1  0.188  BANDA |
     SPY 10-16 CALL |   799.9  0.174  BANDA |   799.9  0.174  BANDA |
     TSLA 09-18 PUT |   335.7  0.308  delta |   335.7  0.308  delta |
    TSLA 09-18 CALL |   376.8  0.276  delta |   376.8  0.276  delta |
     TSLA 10-16 PUT |   326.1  0.282  delta |   326.1  0.282  delta |
    TSLA 10-16 CALL |   403.9  0.224  delta |   403.9  0.224  delta |

  ata la BANDA:  hoy 3 de 12   ->   con el arreglo 3 de 12

====================================================================================================
7a. EL COMPETIDOR CONTIGUO -- a que distancia esta el que define xdisj   [2026-08-25, EM real]
====================================================================================================
               caso |           banda      competidor   hueco   en W |   xdisj
      QQQ 09-18 PUT |   691.0-700.0     681.0-690.0       1.0   0.11!|   1.24x
     QQQ 09-18 CALL |   725.0-734.0     747.0-756.0      13.0   1.45 |   1.26x
      QQQ 10-16 PUT |   669.4-683.0     688.4-702.0       5.4   0.39!|   1.05x
     QQQ 10-16 CALL |   737.0-750.6     719.0-732.6       4.4   0.32!|   1.44x
      SPY 09-18 PUT |   753.6-760.0     729.6-736.0      17.6   2.75 |   1.54x
     SPY 09-18 CALL |   784.0-790.4     774.0-780.4       3.6   0.56!|   1.22x
      SPY 10-16 PUT |   724.1-734.0     748.1-758.0      14.1   1.43 |   1.27x
     SPY 10-16 CALL |   790.0-799.9     772.0-781.9       8.1   0.82!|   1.50x
     TSLA 09-18 PUT |   335.7-345.0     320.7-330.0       5.7   0.61!|   1.93x
    TSLA 09-18 CALL |   367.5-376.8     400.0-409.3      23.2   2.48 |   1.01x
     TSLA 10-16 PUT |   326.1-340.0     311.1-325.0       1.1   0.08!|   2.51x
    TSLA 10-16 CALL |   390.0-403.9     370.0-383.9       6.1   0.44!|   1.21x

  ! = el competidor esta a menos de UN ancho de banda. Pasa en 8 de 12:
  el competidor tipico no es otro muro, es el borde de afuera del mismo.

====================================================================================================
7b. PARCHE A -- exigir un hueco de g anchos de banda   [2026-08-25, EM real]
====================================================================================================
               caso |   g=0.00    g=0.25    g=0.50    g=1.00    g=2.00
      QQQ 09-18 PUT |     1.24x     1.27x     1.28x     2.36x     3.15x
     QQQ 09-18 CALL |     1.26x     1.26x     1.26x     1.26x     1.90x
      QQQ 10-16 PUT |     1.05x     1.05x     1.89x     2.47x     3.64x
     QQQ 10-16 CALL |     1.44x     1.44x     1.75x     1.78x     3.24x
      SPY 09-18 PUT |     1.54x     1.54x     1.54x     1.54x     1.54x
     SPY 09-18 CALL |     1.22x     1.22x     1.22x     1.46x     9.99x
      SPY 10-16 PUT |     1.27x     1.27x     1.27x     1.27x     2.29x
     SPY 10-16 CALL |     1.50x     1.50x     1.50x     2.93x     5.68x
     TSLA 09-18 PUT |     1.93x     1.93x     1.93x     2.21x     2.79x
    TSLA 09-18 CALL |     1.01x     1.01x     1.01x     1.01x     1.01x
     TSLA 10-16 PUT |     2.51x     2.58x     2.58x     2.58x     2.59x
    TSLA 10-16 CALL |     1.21x     1.21x     1.57x     1.57x     2.78x

  TSLA 18-Sep CALL no se mueve con ningun hueco: su competidor esta a 2.5 anchos. Es el
  unico "no hay muro" que el dataset tiene -- y la 7e muestra que tampoco lo es.

====================================================================================================
7c. PARCHE B -- dejar crecer la banda sobre la masa contigua   [2026-08-25, EM real]
====================================================================================================
               caso |       sin crecer       |         f=0.75         |         f=0.60         |         f=0.50         |         f=0.35         
                    | banda    xW xmed xdisj | banda    xW xmed xdisj | banda    xW xmed xdisj | banda    xW xmed xdisj | banda    xW xmed xdisj 
      QQQ 09-18 PUT | 691-700 x1  5.6x 1.24x | 691-700 x1  5.6x 1.24x | 682-700 x2  3.9x 2.84x | 682-700 x2  3.9x 2.84x | 673-700 x3  4.3x 3.37x 
     QQQ 09-18 CALL | 725-734 x1  1.4x 1.26x | 725-734 x1  1.4x 1.26x | 725-752 x3  1.8x 3.27x | 725-761 x4  2.0x 8.49x | 725-761 x4  2.0x 8.49x 
      QQQ 10-16 PUT | 669-683 x1  3.2x 1.05x | 669-683 x1  3.2x 1.05x | 669-683 x1  3.2x 1.05x | 669-683 x1  3.2x 1.05x | 669-683 x1  3.2x 1.05x 
     QQQ 10-16 CALL | 737-751 x1  1.9x 1.44x | 737-751 x1  1.9x 1.44x | 737-751 x1  1.9x 1.44x | 737-751 x1  1.9x 1.44x | 737-751 x1  1.9x 1.44x 
      SPY 09-18 PUT | 754-760 x1 14.8x 1.54x | 754-760 x1 14.8x 1.54x | 754-760 x1 14.8x 1.54x | 754-760 x1 14.8x 1.54x | 747-760 x2 10.6x 1.27x 
     SPY 09-18 CALL | 784-790 x1  3.5x 1.22x | 784-790 x1  3.5x 1.22x | 784-790 x1  3.5x 1.22x | 784-790 x1  3.5x 1.22x | 784-790 x1  3.5x 1.22x 
      SPY 10-16 PUT | 724-734 x1  3.5x 1.27x | 724-734 x1  3.5x 1.27x | 724-734 x1  3.5x 1.27x | 724-734 x1  3.5x 1.27x | 724-734 x1  3.5x 1.27x 
     SPY 10-16 CALL | 790-800 x1  1.8x 1.50x | 790-800 x1  1.8x 1.50x | 790-800 x1  1.8x 1.50x | 790-800 x1  1.8x 1.50x | 790-800 x1  1.8x 1.50x 
     TSLA 09-18 PUT | 336-345 x1  8.7x 1.93x | 336-345 x1  8.7x 1.93x | 336-345 x1  8.7x 1.93x | 336-345 x1  8.7x 1.93x | 317-345 x3  9.9x 2.37x 
    TSLA 09-18 CALL | 368-377 x1  8.9x 1.01x | 368-377 x1  8.9x 1.01x | 368-405 x4 11.3x 2.56x | 368-405 x4 11.3x 2.56x | 368-405 x4 11.3x 2.56x 
     TSLA 10-16 PUT | 326-340 x1 22.8x 2.51x | 326-340 x1 22.8x 2.51x | 326-340 x1 22.8x 2.51x | 326-340 x1 22.8x 2.51x | 298-340 x3 24.0x 3.01x 
    TSLA 10-16 CALL | 390-404 x1 19.1x 1.21x | 390-404 x1 19.1x 1.21x | 390-404 x1 19.1x 1.21x | 390-404 x1 19.1x 1.21x | 390-404 x1 19.1x 1.21x 

  xW = cuantos anchos mide la banda crecida. Crecer mueve el BORDE, que es lo que
  ninguna otra correccion de la 61.4 movia: si la concentracion es mas ancha que W, la
  ventana la parte y el borde queda DENTRO del muro -- lo que la 17 dice que no se hace.
  Y crecer infla `xdisj` por construccion: la banda se come a su propio competidor.

====================================================================================================
7d. LA QUE DECIDE -- el borde entre tandas, barrido fino de f
====================================================================================================
               caso |sin crecer       0.90       0.80       0.70       0.65       0.60       0.55       0.50       0.45
     QQQ 09-18 CALL |       0.1        0.1       19.1       19.1        0.3        0.3        9.8        0.5        0.5 
      QQQ 09-18 PUT |       0.1        0.1        9.6        0.2        0.2        0.2        0.2        0.2        0.2 
     QQQ 10-16 CALL |       0.0        0.0        0.0        0.0        0.0        0.0        0.0        0.0        0.0 
      QQQ 10-16 PUT |       0.0        0.0        0.0        0.0        0.0        0.0        0.0        0.0        0.0 
     SPY 09-18 CALL |       0.2        0.2        0.2        0.2        0.2        0.2        0.2        0.2        0.2 
      SPY 09-18 PUT |       0.2        0.2        0.2        0.2        0.2        0.2        0.2        0.2        0.2 
     SPY 10-16 CALL |       0.2        0.2        0.2        0.2        0.2        0.2        0.2        0.2        0.2 
      SPY 10-16 PUT |       0.2        0.2        0.2        0.2        0.2        0.2        0.2        0.4        0.4 
    TSLA 10-16 CALL |       0.1        0.1        0.1        0.1        0.1        0.1        0.1        0.1        0.1 
     TSLA 10-16 PUT |       0.1        0.1        0.1        0.1        0.1        0.1        0.1        0.1        0.1 
   MOVIMIENTO TOTAL |      1.3        1.3       29.8       20.4        1.6        1.6       11.2        2.0        2.0 

  La fila de abajo sube y baja sin orden al mover `f`. Un parametro con acantilados
  entre valores vecinos no se calibra con 12 casos: es el mismo motivo por el que se
  rechazo el anclaje a la grilla el 26.

====================================================================================================
7e. EL DIAGNOSTICO -- xvalle: que hay ENTRE la banda y su competidor   [2026-08-25, EM real]
====================================================================================================
               caso |   xdisj  hueco/W |  xvalle | lectura
      QQQ 09-18 PUT |   1.24x     0.11 |      -- | contiguo: UNA losa
     QQQ 09-18 CALL |   1.26x     1.45 |    0.53 | sin valle: UNA losa
      QQQ 10-16 PUT |   1.05x     0.39 |      -- | contiguo: UNA losa
     QQQ 10-16 CALL |   1.44x     0.32 |      -- | contiguo: UNA losa
      SPY 09-18 PUT |   1.54x     2.75 |    0.28 | sin valle: UNA losa
     SPY 09-18 CALL |   1.22x     0.56 |      -- | contiguo: UNA losa
      SPY 10-16 PUT |   1.27x     1.43 |    0.74 | sin valle: UNA losa
     SPY 10-16 CALL |   1.50x     0.82 |      -- | contiguo: UNA losa
     TSLA 09-18 PUT |   1.93x     0.61 |      -- | contiguo: UNA losa
    TSLA 09-18 CALL |   1.01x     2.48 |    0.64 | sin valle: UNA losa
     TSLA 10-16 PUT |   2.51x     0.08 |      -- | contiguo: UNA losa
    TSLA 10-16 CALL |   1.21x     0.44 |      -- | contiguo: UNA losa

  Valles de verdad: 0 de 12. En los otros 12, lo que
  hay del otro lado del "competidor" es la misma losa o un estante sin hueco -- el valle
  mas profundo de todo el dataset tiene el 28% de la densidad de su banda.
  O sea que `xdisj` NO TIENE UN SOLO POSITIVO VERDADERO en el dataset, y el 1.01x de
  TSLA 18-Sep CALL --el "no hay muro" de la 61.7-- es un falso negativo: entre sus dos
  "muros" hay un estante con el 64% de la densidad de la banda.

====================================================================================================
7f. LO QUE SE DEJA SOBRE LA MESA -- restriccion con la banda crecida (f = 0.60)   [2026-08-25, EM real]
====================================================================================================
               caso |   borde  delta    ata |   borde  delta    ata |
      QQQ 09-18 PUT |   691.0  0.292  delta |   682.0  0.226  delta |
     QQQ 09-18 CALL |   734.0  0.258  delta |   751.9  0.110  BANDA |  <-- cambia
      QQQ 10-16 PUT |   669.4  0.229  delta |   669.4  0.229  delta |
     QQQ 10-16 CALL |   750.6  0.240  delta |   750.6  0.240  delta |
      SPY 09-18 PUT |   753.6  0.333  delta |   753.6  0.333  delta |
     SPY 09-18 CALL |   790.4  0.136  BANDA |   790.4  0.136  BANDA |
      SPY 10-16 PUT |   724.1  0.188  BANDA |   724.1  0.188  BANDA |
     SPY 10-16 CALL |   799.9  0.174  BANDA |   799.9  0.174  BANDA |
     TSLA 09-18 PUT |   335.7  0.308  delta |   335.7  0.308  delta |
    TSLA 09-18 CALL |   376.8  0.276  delta |   404.9  0.122  BANDA |  <-- cambia
     TSLA 10-16 PUT |   326.1  0.282  delta |   326.1  0.282  delta |
    TSLA 10-16 CALL |   403.9  0.224  delta |   403.9  0.224  delta |

  ata la BANDA:  sin crecer 3 de 12   ->   crecida 5 de 12
  Crecer haria que la estructura restrinja mas seguido, que es lo que la 99 le reclama
  a GOT. No alcanza: el parametro no es estable (7d), y un borde que se mueve $19 entre
  dos fotos es peor que un borde que restringe poco.

====================================================================================================
8a. CRECER DE A UN STRIKE -- el borde entre tandas, contra crecer por rebanadas
====================================================================================================
    construccion | movimiento total del borde entre tandas, 10 series
      sin crecer |    1.3  ##
        reb 0.80 |   29.8  ###########################################################
        reb 0.70 |   20.4  ########################################
        reb 0.60 |    1.6  ###
        reb 0.55 |   11.2  ######################
        str 0.90 |   18.2  ####################################
        str 0.80 |   20.6  #########################################
        str 0.70 |   16.3  ################################
        str 0.65 |    0.3  
        str 0.60 |    0.3  
        str 0.55 |    2.2  ####
        str 0.50 |    2.1  ####
        str 0.45 |    0.1  

  Por REBANADA el numero sube y baja sin orden al mover `f`; de a un STRIKE se va a
  0.3 en toda la franja 0.65-0.45, mejor que no crecer. El defecto del parche del 27 no
  era la idea: era el tamano del paso.

====================================================================================================
8b. EL PRECIO DE CRECER -- cuanto se corre el borde al barrer W   [2026-08-25, EM real]
====================================================================================================
               caso |     hoy |  crecida | + res propia |  rango del borde barriendo W de 0.15 a 0.40 EM
      QQQ 09-18 PUT |     9.0 |     23.6 |         16.6 |
     QQQ 09-18 CALL |     3.8 |     29.6 |          1.0 |
      QQQ 10-16 PUT |    24.7 |     33.0 |         28.8 |
     QQQ 10-16 CALL |     5.2 |     15.0 |          0.4 |
      SPY 09-18 PUT |     6.4 |     11.2 |          7.2 |
     SPY 09-18 CALL |     1.7 |      7.0 |          0.8 |
      SPY 10-16 PUT |     5.1 |      9.1 |          5.0 |
     SPY 10-16 CALL |     3.0 |     10.0 |          0.9 |
     TSLA 09-18 PUT |    11.8 |      7.5 |          0.0 |
    TSLA 09-18 CALL |    30.6 |     26.3 |         30.6 |
     TSLA 10-16 PUT |    11.1 |     11.6 |          5.0 |
    TSLA 10-16 CALL |     2.8 |     15.0 |          0.0 |

  hoy            medio   9.6   maximo  30.6
  crecida        medio  16.6   maximo  33.0
  + res propia   medio   8.0   maximo  30.6
  Crecer no libera al borde de `W`: lo ata mas fuerte, porque `W` entra dos veces --
  la semilla es una ventana de ancho `W` y la referencia de densidad tambien.
  Desacoplar la resolucion (medir la densidad sobre el paso del gamma en vez de sobre
  `W`) saca una de las dos y deja el borde a la par de hoy, no mejor: lo que queda
  moviendose es la SEMILLA, que sigue siendo una ventana de ancho `W`.

====================================================================================================
8c. LA DUAL -- masa fija p, ancho minimo: la unica que no necesita W
====================================================================================================
    construccion | movimiento total del borde entre tandas, 10 series
    hoy (W fijo) |    1.3  ##
     dual p=0.30 |   16.0  ################################
     dual p=0.40 |   27.0  ######################################################
     dual p=0.50 |   23.0  ##############################################
     dual p=0.60 |   43.0  ############################################################

  Sacar `W` no sale gratis: la dual cambia el filo de lugar --de "que strike entra en
  la ventana" a "que strike completa la masa"-- y el segundo es mucho peor.

====================================================================================================
8d. LA QUE DECIDE -- cuanto le debe el borde DE HOY a un parametro sin calibrar   [2026-08-25, EM real]
====================================================================================================
               caso |    0.15-0.40 EM     |    0.20-0.30 EM     |     0.225-0.275     
                    | rango $   en delta  | rango $   en delta  | rango $   en delta  
      QQQ 09-18 PUT |     9.0     0.073   |     3.6     0.033   |     1.8     0.016   
     QQQ 09-18 CALL |     3.8     0.041   |     4.7     0.052   |     1.8     0.021   
      QQQ 10-16 PUT |    24.7     0.135   |     0.7     0.004   |     0.7     0.004   
     QQQ 10-16 CALL |     5.2     0.030   |     5.1     0.030   |     0.7     0.000   
      SPY 09-18 PUT |     6.4     0.070   |     2.6     0.036   |     1.3     0.012   
     SPY 09-18 CALL |     1.7     0.020   |     0.7     0.010   |     0.7     0.010   
      SPY 10-16 PUT |     5.1     0.022   |     5.1     0.022   |     5.5     0.027   
     SPY 10-16 CALL |     3.0     0.016   |     3.0     0.016   |     2.0     0.008   
     TSLA 09-18 PUT |    11.8     0.098   |     8.7     0.072   |     6.9     0.072   
    TSLA 09-18 CALL |    30.6     0.154   |    31.6     0.174   |     4.4     0.038   
     TSLA 10-16 PUT |    11.1     0.065   |     5.6     0.034   |     2.8     0.000   
    TSLA 10-16 CALL |     2.8     0.022   |     3.6     0.022   |     4.3     0.022   

    0.15-0.40 EM -> borde: medio $  9.6  max $ 30.6   |   delta: medio 0.062  max 0.154
    0.20-0.30 EM -> borde: medio $  6.2  max $ 31.6   |   delta: medio 0.042  max 0.174
     0.225-0.275 -> borde: medio $  2.7  max $  6.9   |   delta: medio 0.019  max 0.072

  El corte de riesgo es delta_max = 0.20. Mover `W` un +/-20% --dentro de lo que la
  61.4 declara como rango libre-- corre el delta del borde hasta 0.174: casi todo el
  presupuesto. `W` no es el ancho de una ventana: es quien decide si la banda ata.
  Y no esta calibrado, ni se puede calibrar antes de la 61.9.
```
