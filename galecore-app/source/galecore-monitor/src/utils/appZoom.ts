// La plataforma se ve al 90 % con `zoom` en <html> (--app-zoom, index.css). Con ese zoom,
// getBoundingClientRect, clientX/Y e innerWidth/Height siguen en píxeles de pantalla, pero
// left/top/width/height se interpretan en píxeles CSS (multiplicados por el zoom). Estas funciones
// pasan de pantalla a CSS para posicionar menús y arrastres; sin la variable (tests) no cambian nada.
export function appZoom(): number {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom'));
  return z > 0 ? z : 1;
}

/** Píxeles de pantalla (clientX, innerWidth, rect.left…) a píxeles CSS. */
export const cssPx = (screenPx: number): number => screenPx / appZoom();

export function cssViewport(): { width: number; height: number } {
  return { width: cssPx(window.innerWidth), height: cssPx(window.innerHeight) };
}

/** Rectángulo de un elemento o rango en píxeles CSS. */
export function cssRect(target: { getBoundingClientRect(): DOMRect }) {
  const r = target.getBoundingClientRect(), z = appZoom();
  return { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
}
