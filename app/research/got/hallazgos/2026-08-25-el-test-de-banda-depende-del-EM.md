# 2026-08-25 (noche) — El test de banda depende del EM que se le pase, y `xdisj` tiene dos defectos

**Verifica:** el ejemplo de la [§61.7](../galecore-estrategia-got.md) recalculado con el Expected
Move de la §15 —`spot × atmIv × sqrt(dte/365)`— en vez del proxy `EM*` que usa
`banda_de_gamma.py` para poder recorrer capturas sin encabezado. Salió al agregar el segundo
ejemplo trabajado (TSLA 18-Sep) y comparar los dos.
**Datos:** los seis CSV de [`data/2026-08-25/`](../data/2026-08-25/) y los dos de
[`data/2026-08-25-t2/`](../data/2026-08-25-t2/), con `spot`, `atmIv` y `dte` transcritos de los logs
de captura.
**Reproduce:** [`scripts/banda_de_gamma.py`](../scripts/banda_de_gamma.py), sección 5 — que es la
única del script que sigue el procedimiento de la §61.7 tal como está definido.
**Veredicto:** el `EM*` del script y el `EM` de la §15 difieren entre 5% y 8%, y **eso alcanza para
mover un veredicto**. La conclusión del [hallazgo de la mañana](2026-08-25-el-muro-como-banda.md)
**se sostiene** —el borde de la banda casi nunca restringe— pero el conteo pasa de **2 de 12 a 3 de
12**, y aparecen **dos defectos de construcción del test `xdisj`** que hasta ahora no se veían.

---

## 1. Qué se recalculó, y qué se movió

El script mide la banda con `EM*` = distancia al strike de delta 0.1587, promediada entre lados.
No es el Expected Move de la §15: absorbe el smile y la brecha d1/d2, y da entre 5% y 8% más.

| caso | EM* | EM §15 | borde con EM* | δ | borde con EM | δ | |
|---|---|---|---|---|---|---|---|
| SPY 09-18 CALL | 27.4 | 25.6 | 790.8 | 0.126 | 790.4 | 0.136 | ata |
| SPY 10-16 CALL | 42.9 | 39.5 | 800.7 | 0.174 | 799.9 | 0.174 | ata |
| **SPY 10-16 PUT** | 42.9 | 39.5 | 729.3 | 0.211 | **724.1** | **0.188** | **cambia a ata** |
| SPY 09-18 PUT | 27.4 | 25.6 | 753.2 | 0.322 | 753.6 | 0.333 | no |
| QQQ 09-18 PUT | 37.6 | 35.9 | 690.6 | 0.292 | 691.0 | 0.292 | no |
| QQQ 09-18 CALL | 37.6 | 35.9 | 734.4 | 0.258 | 734.0 | 0.258 | no |
| QQQ 10-16 PUT | 57.5 | 54.5 | 669.6 | 0.234 | 669.4 | 0.229 | no |
| QQQ 10-16 CALL | 57.5 | 54.5 | 750.4 | 0.240 | 750.6 | 0.240 | no |
| TSLA 09-18 PUT | 39.8 | 37.4 | 335.0 | 0.308 | 335.7 | 0.308 | no |
| TSLA 09-18 CALL | 39.8 | 37.4 | 377.5 | 0.276 | 376.8 | 0.276 | no |
| TSLA 10-16 PUT | 60.4 | 55.7 | 324.9 | 0.282 | 326.1 | 0.282 | no |
| TSLA 10-16 CALL | 60.4 | 55.7 | 400.1 | 0.246 | 403.9 | 0.224 | no |

**Once de doce no se mueven.** El único que cambia es SPY 16-Oct PUT, cuya banda salta de 729–740 a
724–734 — y es uno de los casos que el §4 del hallazgo de la mañana ya había marcado como oscilante
con el ancho (el borde va 724.6 / 724.4 / 729.3 / 729.1 / 724.8 al barrer `W`).

**El conteo correcto de la §61.6 es 3 de 12**, no 2 de 12. La lectura no cambia: sigue siendo "casi
nunca restringe", y los tres siguen siendo SPY.

## 2. `xdisj` se decide por un strike redondo

En SPY 16-Oct CALL, con `W = 9.8` la banda llega a **799.8** y deja afuera el strike 800; con
`W = 10.6` llega a **800.5** y lo incluye. Ese strike vale 6.5% del lado:

```text
W =  9.75   banda 790.0-799.8  26.6%   disjunta 766.0-775.8  26.3%   xdisj 1.01x
W = 10.55   banda 790.0-800.5  33.1%   disjunta 766.0-776.5  27.0%   xdisj 1.22x
```

Un 8% de cambio en `W` mueve el veredicto de "no hay muro" a "hay muro". **La ventana es continua y
la grilla de strikes no**, y la banda debería anclarse a strikes.

El borde, en cambio, **no** se mueve: barrido de 0.15 a 0.40 EM queda entre 798.6 y 800.9. El
defecto es del test, no de la referencia.

## 3. `xdisj` puede estar compitiendo contra la pila del dinero

El 1.01x de ese mismo caso sale de comparar la banda 790–800 contra **766–776**, que está pegada al
spot (765.45). Los strikes cercanos al dinero siempre concentran gamma: medir un muro contra eso no
contesta si el muro es único.

El contraste está en el otro ejemplo. TSLA 18-Sep CALL también da `xdisj` 1.01x, pero ahí el
competidor es **400–409 contra 367–377**, a $30 de distancia y con el spot (351) lejos de las dos.
Ese empate es real y "no hay muro" es la respuesta correcta — y se mantiene idéntico con `W` de 9.3
o de 9.95.

**Los dos 1.01x significan cosas distintas**, y el test tal como está no los distingue.

## 4. Qué NO invalida

* **El hallazgo de la mañana se sostiene en sus cuatro mediciones.** ρ = −1.0000 no depende del EM
  (es el orden de la cadena); la estabilidad de la banda entre tandas se midió con el mismo `EM*` en
  las dos puntas, así que la comparación es válida; y el control del premio de crédito se ajusta
  contra el delta, no contra el EM.
* **El conteo de restricción cambia de 2 a 3 sobre 12**, que es la única cifra afectada.
* **No cambia nada de la 61.9.** La hipótesis única y su costo de muestra son independientes de esto.

## 5. Qué hacer

* **Aplicado ya:** la §61.4 lleva los dos defectos anotados; la §61.7 recalculó su ejemplo de SPY y
  ganó el de TSLA; y el script **dejó de imprimir un veredicto de "hay muro"** — imprime `xmed`,
  `xdisj`, contra qué banda compite, y avisa cuando el competidor está pegado al spot.
* **Anclar la banda a strikes** en vez de a un ancho continuo. Es un cambio de definición: hay que
  medirlo antes de escribirlo.
* **Excluir del competidor disjunto la zona pegada al spot.** Cuál es el radio de exclusión es otro
  parámetro libre, y sumarlo sin medir es lo que este research ya hizo cuatro veces.
* **Unificar el EM.** Que el script mida con un proxy y el procedimiento con otro número es la clase
  de discrepancia que produjo este error. Mientras las capturas no traigan `atmIv` y `dte` en el CSV,
  la transcripción de encabezados de la sección 5 es el puente — y `gex-strikes.ps1` debería
  escribirlos.
