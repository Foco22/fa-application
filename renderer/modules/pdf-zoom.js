// Zoom del lector de PDF principal.
//
// Los destacados persistidos en `papers.highlights` guardan sus rectángulos en
// píxeles a PDF_BASE_SCALE (la escala fija que usaba el lector antes de tener
// zoom). Para no invalidar lo ya guardado, la escala base sigue siendo el
// sistema de coordenadas "de disco": al dibujar se convierte a la escala
// actual (rectToScreen) y al capturar una selección se vuelve a la base
// (rectToStored).

export const PDF_BASE_SCALE = 1.5
export const PDF_ZOOM_MIN   = 0.75
export const PDF_ZOOM_MAX   = 3.0
export const PDF_ZOOM_STEP  = 0.25

export function clampPdfScale(scale) {
  const s = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, scale))
  return Math.round(s * 100) / 100
}

export function stepPdfScale(current, direction) {
  return clampPdfScale(current + Math.sign(direction) * PDF_ZOOM_STEP)
}

// 100% = escala base, que es lo que el usuario veía antes.
export function formatPdfZoom(scale) {
  return Math.round((scale / PDF_BASE_SCALE) * 100) + '%'
}

export function rectToScreen(rect, scale) {
  const f = scale / PDF_BASE_SCALE
  return { x: rect.x * f, y: rect.y * f, w: rect.w * f, h: rect.h * f }
}

export function rectToStored(rect, scale) {
  const f = PDF_BASE_SCALE / scale
  return {
    x: Math.round(rect.x * f),
    y: Math.round(rect.y * f),
    w: Math.round(rect.w * f),
    h: Math.round(rect.h * f)
  }
}
