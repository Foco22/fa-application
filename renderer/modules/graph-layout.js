// Layout de fuerzas 3D (Fruchterman–Reingold) para el grafo de papers, más la
// cámara (rotación + perspectiva). Sin dependencias ni DOM: recibe nodos y
// aristas, devuelve una posición {x,y,z} por nodo. Es determinista (posición
// inicial con semilla fija) para que el grafo no "baile" distinto en cada apertura.

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Devuelve las posiciones centradas en el origen y escaladas para que el nodo más
// lejano quede a `radius`: el grafo siempre ocupa una esfera compacta, sin importar
// cuántos nodos haya (nada queda pegado a un borde ni disperso).
export function layoutGraph(nodes, edges, { radius = 250, iterations = 300, seed = 7 } = {}) {
  const n = nodes.length
  if (n === 0) return []
  if (n === 1) return [{ x: 0, y: 0, z: 0 }]

  const rand = mulberry32(seed)
  // Esfera de Fibonacci: reparte los puntos iniciales de forma pareja en 3D.
  const pos = nodes.map((_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    const phi = i * Math.PI * (3 - Math.sqrt(5))
    const s = radius * 0.6
    return {
      x: s * r * Math.cos(phi) + (rand() - 0.5) * 4,
      y: s * y + (rand() - 0.5) * 4,
      z: s * r * Math.sin(phi) + (rand() - 0.5) * 4,
    }
  })

  const k = (radius * 1.1) / Math.cbrt(n)    // distancia natural entre nodos
  let temp = radius / 6

  for (let it = 0; it < iterations; it++) {
    const d = pos.map(() => ({ x: 0, y: 0, z: 0 }))

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = pos[i].x - pos[j].x, vy = pos[i].y - pos[j].y, vz = pos[i].z - pos[j].z
        let dist = Math.hypot(vx, vy, vz)
        if (dist < 0.01) { vx = rand() - 0.5; vy = rand() - 0.5; vz = rand() - 0.5; dist = Math.hypot(vx, vy, vz) || 0.01 }
        const f = (k * k) / dist
        const fx = (vx / dist) * f, fy = (vy / dist) * f, fz = (vz / dist) * f
        d[i].x += fx; d[i].y += fy; d[i].z += fz
        d[j].x -= fx; d[j].y -= fy; d[j].z -= fz
      }
    }

    // Atracción por arista: w · d² / k. Más peso (más parecidos) = más juntos.
    for (const { source, target, weight } of edges) {
      const w = Math.max(weight ?? 1, 0.05)
      const vx = pos[source].x - pos[target].x, vy = pos[source].y - pos[target].y, vz = pos[source].z - pos[target].z
      const dist = Math.hypot(vx, vy, vz) || 0.01
      const f = (w * dist * dist) / k
      const fx = (vx / dist) * f, fy = (vy / dist) * f, fz = (vz / dist) * f
      d[source].x -= fx; d[source].y -= fy; d[source].z -= fz
      d[target].x += fx; d[target].y += fy; d[target].z += fz
    }

    // Gravedad al origen: mantiene el conjunto compacto y junta las componentes sueltas.
    for (let i = 0; i < n; i++) {
      d[i].x -= pos[i].x * 0.08; d[i].y -= pos[i].y * 0.08; d[i].z -= pos[i].z * 0.08
    }

    for (let i = 0; i < n; i++) {
      const len = Math.hypot(d[i].x, d[i].y, d[i].z) || 0.01
      const step = Math.min(len, temp)
      pos[i].x += (d[i].x / len) * step
      pos[i].y += (d[i].y / len) * step
      pos[i].z += (d[i].z / len) * step
    }
    temp *= 0.98
  }

  const c = pos.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n, z: a.z + p.z / n }), { x: 0, y: 0, z: 0 })
  const centered = pos.map(p => ({ x: p.x - c.x, y: p.y - c.y, z: p.z - c.z }))
  // Se escala con el percentil 90 de las distancias, no con el máximo: unos pocos
  // nodos poco conectados que quedan lejos no deben encoger al resto. Esos atípicos
  // se recortan a `radius` para que sigan dentro de la esfera.
  const norms = centered.map(p => Math.hypot(p.x, p.y, p.z)).sort((a, b) => a - b)
  const ref = norms[Math.floor(0.9 * (n - 1))]
  const scale = ref > 0 ? (radius * 0.85) / ref : 1
  return centered.map(p => {
    const x = p.x * scale, y = p.y * scale, z = p.z * scale
    const len = Math.hypot(x, y, z)
    const clip = len > radius ? radius / len : 1
    return { x: x * clip, y: y * clip, z: z * clip }
  })
}

// Giro alrededor de Y (yaw) y luego de X (pitch). Conserva distancias.
export function rotatePoint({ x, y, z }, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const x1 = x * cy + z * sy
  const z1 = -x * sy + z * cy
  const cp = Math.cos(pitch), sp = Math.sin(pitch)
  return { x: x1, y: y * cp - z1 * sp, z: y * sp + z1 * cp }
}

// Proyección en perspectiva. `z` positivo = más cerca de la cámara; `factor` es el
// escalado por distancia (lo cercano se ve más grande) y sirve para tamaño/opacidad.
export function projectPoint({ x, y, z }, { distance = 800, zoom = 1, cx = 0, cy = 0 } = {}) {
  const denom = Math.max(distance - z, distance * 0.05)
  const factor = distance / denom
  return { sx: cx + x * factor * zoom, sy: cy + y * factor * zoom, z, factor }
}

// El tamaño refleja cuán conectado está el paper, con tope para que un hub no tape el resto.
export function nodeRadius(degree) {
  return 6 + Math.min(degree, 10) * 1.3
}

// Paleta apta para fondo oscuro; la comunidad i siempre recibe el mismo color.
const PALETTE = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#d55181', '#26a5b8', '#a3b836', '#e0704a', '#7d8fb3', '#c26ad6']
export function communityColor(id) {
  return PALETTE[((id % PALETTE.length) + PALETTE.length) % PALETTE.length]
}
