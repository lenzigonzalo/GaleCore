/**
 * El color de cada lado de la cadena: CALL verde, PUT rojo. En un solo lugar, a propósito.
 *
 * Estaba repartido en literales sueltos y las dos mitades habían quedado al revés entre sí: el
 * panel de barras pintaba las calls de verde y las puts de rojo, mientras las líneas de muro del
 * mismo panel —y las de GexChart— pintaban el Call Wall de rojo y el Put Wall de verde. O sea que
 * en el MISMO gráfico el rojo significaba "put" en las barras y "call" en las líneas. Con el valor
 * escrito en cada componente, la convención no vivía en ningún lado y no había dónde arreglarla.
 *
 * Van como hex literal y no como `var(--green)` porque lightweight-charts recibe los colores por
 * API de JS, no por CSS, y ahí una variable no resuelve. Son los mismos valores que `--green` y
 * `--red-gc` del tema.
 *
 * OJO: esto NO es el verde/rojo de "bien/mal". Es la identidad de un lado de la cadena, y por eso
 * un Call Wall verde no significa que algo esté bien — significa que ese muro es de calls.
 */

/** Calls: el lado de arriba de la cadena. Mismo valor que `--green`. */
export const CALL_COLOR = '#22c55e';

/** Puts: el lado de abajo. Mismo valor que `--red-gc`. */
export const PUT_COLOR = '#f43f5e';

/**
 * El mismo color con opacidad, para las barras y los rellenos.
 *
 * Devuelve `rgba(...)` en vez de un hex con alpha (`#22c55e8c`) porque los SVG del panel ya venían
 * escritos así y porque lightweight-charts no acepta hex de 8 dígitos en todas sus props.
 */
/**
 * Opacidad del sombreado de la banda de gamma, **compartida por los dos gráficos**.
 *
 * El gráfico de velas y el panel de barras pintan la misma zona sobre el mismo eje de precio: si
 * cada uno usara su propia opacidad, se leerían como dos objetos distintos. Vive acá y no en cada
 * componente por la misma razón que los colores de lado.
 *
 * Tiene que quedar tenue: la banda es contexto, no un nivel. Lo que se lee como nivel es el muro,
 * que va como línea con etiqueta.
 */
export const BAND_FILL_ALPHA = 0.10;

export function sideColorAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
