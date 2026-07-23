import { describe, it, expect } from 'vitest'
import { createParticles, stepParticles, projectParticle, prefersReducedMotion } from '../../../renderer/modules/starfield.js'

describe('createParticles', () => {
  it('crea la cantidad pedida de partículas dentro de los límites del canvas', () => {
    const particles = createParticles(50, 800, 600)
    expect(particles).toHaveLength(50)
    particles.forEach(p => {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(800)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(600)
      expect(p.z).toBeGreaterThan(0)
    })
  })
})

describe('stepParticles', () => {
  it('acerca cada partícula (decrece z) sin cambiar la cantidad', () => {
    const particles = [{ x: 10, y: 20, z: 100 }]
    const next = stepParticles(particles, 800, 600, 5)
    expect(next).toHaveLength(1)
    expect(next[0].z).toBe(95)
    expect(next[0].x).toBe(10)
    expect(next[0].y).toBe(20)
  })

  it('cuando una partícula llega al frente, reaparece atrás con z = width', () => {
    const particles = [{ x: 10, y: 20, z: 3 }]
    const next = stepParticles(particles, 800, 600, 5)
    expect(next[0].z).toBe(800)
    expect(next[0].x).toBeGreaterThanOrEqual(0)
    expect(next[0].x).toBeLessThanOrEqual(800)
  })
})

describe('projectParticle', () => {
  it('una partícula al fondo (z = width) se proyecta sin desplazamiento', () => {
    const p = { x: 400, y: 300, z: 800 }
    const proj = projectParticle(p, 800, 600)
    expect(proj.x).toBeCloseTo(400)
    expect(proj.y).toBeCloseTo(300)
    expect(proj.opacity).toBeCloseTo(1)
  })

  it('una partícula más cerca (z chico) se ve más grande', () => {
    const far  = projectParticle({ x: 400, y: 300, z: 800 }, 800, 600)
    const near = projectParticle({ x: 400, y: 300, z: 200 }, 800, 600)
    expect(near.size).toBeGreaterThan(far.size)
  })

  it('el tamaño y la opacidad quedan siempre acotados', () => {
    const proj = projectParticle({ x: 400, y: 300, z: 1 }, 800, 600)
    expect(proj.size).toBeLessThanOrEqual(3)
    expect(proj.opacity).toBeLessThanOrEqual(1)
  })
})

describe('prefersReducedMotion', () => {
  it('devuelve false si window.matchMedia no está disponible (entorno sin DOM)', () => {
    expect(prefersReducedMotion()).toBe(false)
  })
})
