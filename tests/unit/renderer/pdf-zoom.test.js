import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PDF_BASE_SCALE, PDF_ZOOM_MIN, PDF_ZOOM_MAX, PDF_ZOOM_STEP,
  clampPdfScale, stepPdfScale, formatPdfZoom, createZoomDebouncer,
  rectToStored, rectToScreen
} from '../../../renderer/modules/pdf-zoom.js'

describe('pdf-zoom — escala', () => {
  it('la escala base es 1.5 (la que usaba el lector antes de tener zoom)', () => {
    expect(PDF_BASE_SCALE).toBe(1.5)
  })

  it('clampPdfScale acota al rango [min, max]', () => {
    expect(clampPdfScale(0.1)).toBe(PDF_ZOOM_MIN)
    expect(clampPdfScale(99)).toBe(PDF_ZOOM_MAX)
    expect(clampPdfScale(1.5)).toBe(1.5)
  })

  it('clampPdfScale redondea a 2 decimales para evitar drift', () => {
    expect(clampPdfScale(1.5 + 0.1 + 0.2)).toBe(1.8)
  })

  it('stepPdfScale sube y baja un paso', () => {
    expect(stepPdfScale(1.5, +1)).toBeCloseTo(1.5 + PDF_ZOOM_STEP)
    expect(stepPdfScale(1.5, -1)).toBeCloseTo(1.5 - PDF_ZOOM_STEP)
  })

  it('stepPdfScale no pasa de los límites', () => {
    expect(stepPdfScale(PDF_ZOOM_MAX, +1)).toBe(PDF_ZOOM_MAX)
    expect(stepPdfScale(PDF_ZOOM_MIN, -1)).toBe(PDF_ZOOM_MIN)
  })

  it('formatPdfZoom muestra 100% en la escala base', () => {
    expect(formatPdfZoom(PDF_BASE_SCALE)).toBe('100%')
    expect(formatPdfZoom(PDF_BASE_SCALE * 2)).toBe('200%')
    expect(formatPdfZoom(PDF_BASE_SCALE / 2)).toBe('50%')
  })
})

describe('pdf-zoom — rectángulos de destacados', () => {
  // Los destacados persistidos están en píxeles a escala base (1.5).
  // Al cambiar el zoom, la pantalla escala pero lo guardado no debe cambiar.
  const stored = { x: 100, y: 200, w: 50, h: 10 }

  it('rectToScreen es identidad en la escala base', () => {
    expect(rectToScreen(stored, PDF_BASE_SCALE)).toEqual(stored)
  })

  it('rectToScreen escala proporcionalmente al zoom actual', () => {
    expect(rectToScreen(stored, PDF_BASE_SCALE * 2)).toEqual({ x: 200, y: 400, w: 100, h: 20 })
  })

  it('rectToStored deshace rectToScreen', () => {
    const screen = rectToScreen(stored, 2.25)
    const back   = rectToStored(screen, 2.25)
    expect(back.x).toBeCloseTo(stored.x)
    expect(back.y).toBeCloseTo(stored.y)
    expect(back.w).toBeCloseTo(stored.w)
    expect(back.h).toBeCloseTo(stored.h)
  })

  it('rectToStored redondea a entero (como se guardaba antes)', () => {
    const r = rectToStored({ x: 101, y: 201, w: 51, h: 11 }, 3)
    Object.values(r).forEach(v => expect(Number.isInteger(v)).toBe(true))
  })
})

describe('pdf-zoom — createZoomDebouncer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(initial = 1.5) {
    let current = initial
    const apply = vi.fn(async (s) => { current = s })
    const onPreview = vi.fn()
    const z = createZoomDebouncer({ getScale: () => current, apply, onPreview, delay: 120 })
    return { z, apply, onPreview }
  }

  it('una ráfaga de pasos dispara un solo render con la escala acumulada', () => {
    const { z, apply } = setup()
    z.step(+1); z.step(+1); z.step(+1)
    expect(apply).not.toHaveBeenCalled()
    vi.advanceTimersByTime(120)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(clampPdfScale(1.5 + 3 * PDF_ZOOM_STEP))
  })

  it('cada paso avisa la escala pendiente de inmediato (para la etiqueta)', () => {
    const { z, onPreview } = setup()
    z.step(+1); z.step(+1)
    expect(onPreview).toHaveBeenNthCalledWith(1, 1.75)
    expect(onPreview).toHaveBeenNthCalledWith(2, 2)
  })

  it('respeta los límites aunque la ráfaga sea larga', () => {
    const { z, apply } = setup(PDF_ZOOM_MAX)
    z.step(+1); z.step(+1)
    vi.advanceTimersByTime(120)
    expect(apply).not.toHaveBeenCalled() // ya estaba en el máximo
  })

  it('reset aplica la escala base tras el debounce', () => {
    const { z, apply } = setup(2.5)
    z.reset()
    vi.advanceTimersByTime(120)
    expect(apply).toHaveBeenCalledWith(PDF_BASE_SCALE)
  })

  it('tras aplicar, el siguiente paso parte de la escala vigente', () => {
    const { z, apply } = setup()
    z.step(+1)
    vi.advanceTimersByTime(120)
    z.step(+1)
    vi.advanceTimersByTime(120)
    expect(apply).toHaveBeenLastCalledWith(2)
  })
})
