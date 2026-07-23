// Fondo animado de la pantalla de bienvenida: puntos que se desplazan lentamente
// hacia atrás (parallax en el eje Z). La lógica de posición es pura y testeable
// sin canvas; start/stop es la única parte que toca el DOM real.

export function createParticles(count, width, height) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random() * width || 1,
  }))
}

// Cada partícula se acerca (z decrece); al llegar al frente, reaparece atrás
// en una posición nueva — el loop nunca reduce la cantidad de partículas.
export function stepParticles(particles, width, height, speed = 2) {
  return particles.map(p => {
    const z = p.z - speed
    if (z <= 1) {
      return { x: Math.random() * width, y: Math.random() * height, z: width }
    }
    return { x: p.x, y: p.y, z }
  })
}

// Proyección en perspectiva simple: z chico (cerca) => más grande y más lejos
// del centro; z grande (lejos) => punto pequeño y cerca del centro.
export function projectParticle(p, width, height) {
  const cx = width / 2
  const cy = height / 2
  const scale = width / p.z
  return {
    x: cx + (p.x - cx) * scale,
    y: cy + (p.y - cy) * scale,
    size: Math.max(0.5, Math.min(3, scale * 1.2)),
    opacity: Math.max(0, Math.min(1, scale)),
  }
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function drawFrame(ctx, canvas, particles) {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  particles.forEach(p => {
    const { x, y, size, opacity } = projectParticle(p, canvas.width, canvas.height)
    ctx.globalAlpha = opacity
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalAlpha = 1
}

const PARTICLE_COUNT = 140
const SPEED = 1.4

// Arranca el loop y devuelve la función para detenerlo. Sin canvas (jsdom en
// tests) no hace nada — llamar stop() sobre el resultado sigue siendo seguro.
export function startStarfield(canvas, { count = PARTICLE_COUNT, speed = SPEED } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return () => {}
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}

  const resize = () => {
    canvas.width  = canvas.clientWidth  || canvas.width  || 800
    canvas.height = canvas.clientHeight || canvas.height || 600
  }
  resize()
  window.addEventListener('resize', resize)

  let particles = createParticles(count, canvas.width, canvas.height)

  if (prefersReducedMotion()) {
    drawFrame(ctx, canvas, particles)
    return () => window.removeEventListener('resize', resize)
  }

  let rafId = requestAnimationFrame(function loop() {
    particles = stepParticles(particles, canvas.width, canvas.height, speed)
    drawFrame(ctx, canvas, particles)
    rafId = requestAnimationFrame(loop)
  })

  return () => {
    cancelAnimationFrame(rafId)
    window.removeEventListener('resize', resize)
  }
}
