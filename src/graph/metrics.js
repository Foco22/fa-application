// Métricas de calidad y estabilidad del grafo de papers. Todo es puro: recibe la
// matriz de similitud, las aristas y (opcional) etiquetas, y devuelve números.
const { topKEdges } = require('./build')

// ── Validez: ¿las aristas significan algo? ─────────────────────────────────────

function offDiagonal(sim) {
  const out = []
  for (let i = 0; i < sim.length; i++) for (let j = i + 1; j < sim.length; j++) out.push(sim[i][j])
  return out
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Un std muy bajo = similitudes saturadas (el embedding no discrimina).
function similarityStats(sim) {
  const values = offDiagonal(sim)
  if (values.length === 0) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  const sorted = [...values].sort((a, b) => a - b)
  return {
    mean, std: Math.sqrt(variance),
    min: sorted[0], max: sorted[sorted.length - 1],
    p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9),
  }
}

// De los k vecinos más parecidos de cada nodo, qué fracción comparte etiqueta
// (p. ej. categoría ArXiv). Los nodos sin etiqueta ni consultan ni cuentan como vecino.
function precisionAtK(sim, labels, k) {
  const labeled = labels.map((l, i) => (l == null ? -1 : i)).filter(i => i >= 0)
  let total = 0, queries = 0
  for (const i of labeled) {
    const cands = labeled.filter(j => j !== i).sort((a, b) => sim[i][b] - sim[i][a] || a - b)
    if (cands.length === 0) continue
    const top = cands.slice(0, k)
    total += top.filter(j => labels[j] === labels[i]).length / top.length
    queries++
  }
  return queries === 0 ? null : total / queries
}

// Similitud media entre pares de la misma etiqueta vs. de etiquetas distintas, y
// AUC = P(un par intra puntúe más que uno inter). 0.5 = el embedding no sabe nada.
function separation(sim, labels) {
  const intra = [], inter = []
  for (let i = 0; i < sim.length; i++) {
    if (labels[i] == null) continue
    for (let j = i + 1; j < sim.length; j++) {
      if (labels[j] == null) continue
      ;(labels[i] === labels[j] ? intra : inter).push(sim[i][j])
    }
  }
  if (intra.length === 0 || inter.length === 0) return null
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length
  let wins = 0
  for (const a of intra) for (const b of inter) wins += a > b ? 1 : a === b ? 0.5 : 0
  return { intra: mean(intra), inter: mean(inter), gap: mean(intra) - mean(inter), auc: wins / (intra.length * inter.length) }
}

// ── Estructura ─────────────────────────────────────────────────────────────────

function structureMetrics(n, edges) {
  const degree = new Array(n).fill(0)
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }

  for (const { source, target } of edges) {
    degree[source]++; degree[target]++
    parent[find(source)] = find(target)
  }

  const sizes = new Map()
  for (let i = 0; i < n; i++) sizes.set(find(i), (sizes.get(find(i)) || 0) + 1)
  const giant = Math.max(0, ...sizes.values())

  const meanDegree = n === 0 ? 0 : (2 * edges.length) / n
  const maxDegree  = Math.max(0, ...degree)
  const mutual     = edges.filter(e => e.mutual).length

  return {
    nodeCount: n, edgeCount: edges.length,
    isolated: degree.filter(d => d === 0).length,
    components: sizes.size,
    giantFraction: n === 0 ? 0 : giant / n,
    meanDegree, maxDegree,
    // Un hub desproporcionado en kNN suele ser un artefacto del embedding, no un paper clave.
    hubRatio: meanDegree === 0 ? 0 : maxDegree / meanDegree,
    reciprocity: edges.length === 0 ? 0 : mutual / edges.length,
  }
}

// Adyacencia ponderada simétrica; los pesos negativos (coseno centrado) no cuentan.
function buildAdjacency(n, edges) {
  const adj = Array.from({ length: n }, () => new Map())
  for (const { source: a, target: b, weight } of edges) {
    const w = Math.max(weight ?? 1, 0)
    if (a === b || w === 0) continue
    adj[a].set(b, (adj[a].get(b) || 0) + w)
    adj[b].set(a, (adj[b].get(a) || 0) + w)
  }
  return adj
}

// Fase de movimiento local de Louvain, en orden fijo → determinista.
function localMove(adj) {
  const n = adj.length
  const k = adj.map(m => [...m.values()].reduce((a, b) => a + b, 0))
  const m2 = k.reduce((a, b) => a + b, 0)
  const comm = Array.from({ length: n }, (_, i) => i)
  if (m2 === 0) return { comm, moved: false }

  const tot = [...k]
  let movedAny = false
  for (let pass = 0; pass < 50; pass++) {
    let movedPass = false
    for (let i = 0; i < n; i++) {
      const ci = comm[i]
      const toComm = new Map()
      for (const [j, w] of adj[i]) if (j !== i) toComm.set(comm[j], (toComm.get(comm[j]) || 0) + w)

      tot[ci] -= k[i]
      const gain = c => (toComm.get(c) || 0) - (tot[c] * k[i]) / m2
      let best = ci, bestGain = gain(ci)
      for (const c of [...toComm.keys()].sort((a, b) => a - b)) {
        const g = gain(c)
        if (g > bestGain + 1e-12) { best = c; bestGain = g }
      }
      tot[best] += k[i]
      if (best !== ci) { comm[i] = best; movedPass = true }
    }
    if (!movedPass) break
    movedAny = true
  }
  return { comm, moved: movedAny }
}

function renumber(labels) {
  const ids = new Map()
  return labels.map(l => { if (!ids.has(l)) ids.set(l, ids.size); return ids.get(l) })
}

// Louvain (movimiento local + agregación). Devuelve un id de comunidad por nodo.
function detectCommunities(n, edges) {
  let adj = buildAdjacency(n, edges)
  let membership = Array.from({ length: n }, (_, i) => i)

  for (;;) {
    const { comm, moved } = localMove(adj)
    if (!moved) break
    const renum = renumber(comm)
    membership = membership.map(m => renum[m])

    const size = Math.max(...renum) + 1
    const next = Array.from({ length: size }, () => new Map())
    for (let u = 0; u < adj.length; u++) {
      for (const [v, w] of adj[u]) {
        const cu = renum[u], cv = renum[v]
        next[cu].set(cv, (next[cu].get(cv) || 0) + w)
      }
    }
    adj = next
  }
  return renumber(membership)
}

function modularity(n, edges, communities) {
  let m2 = 0
  const inside = new Map(), degree = new Map()
  for (const { source: a, target: b, weight } of edges) {
    const w = Math.max(weight ?? 1, 0)
    if (a === b || w === 0) continue
    m2 += 2 * w
    degree.set(communities[a], (degree.get(communities[a]) || 0) + w)
    degree.set(communities[b], (degree.get(communities[b]) || 0) + w)
    if (communities[a] === communities[b]) inside.set(communities[a], (inside.get(communities[a]) || 0) + 2 * w)
  }
  if (m2 === 0) return 0
  let q = 0
  for (const [c, d] of degree) q += (inside.get(c) || 0) / m2 - (d / m2) ** 2
  return q
}

// ── Estabilidad ────────────────────────────────────────────────────────────────

const edgeKey = e => (e.source < e.target ? `${e.source}-${e.target}` : `${e.target}-${e.source}`)

// 1 = mismas aristas; dos conjuntos vacíos cuentan como "nada cambió".
function edgeJaccard(a, b) {
  const sa = new Set(a.map(edgeKey)), sb = new Set(b.map(edgeKey))
  if (sa.size === 0 && sb.size === 0) return 1
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

// Acuerdo entre dos particiones, ajustado por azar: 1 = iguales (aun renombradas), ~0 = azar.
function adjustedRandIndex(a, b) {
  const n = a.length
  const comb2 = x => (x * (x - 1)) / 2
  const cells = new Map(), rows = new Map(), cols = new Map()
  for (let i = 0; i < n; i++) {
    const key = `${a[i]}|${b[i]}`
    cells.set(key, (cells.get(key) || 0) + 1)
    rows.set(a[i], (rows.get(a[i]) || 0) + 1)
    cols.set(b[i], (cols.get(b[i]) || 0) + 1)
  }
  const sumCells = [...cells.values()].reduce((s, x) => s + comb2(x), 0)
  const sumRows  = [...rows.values()].reduce((s, x) => s + comb2(x), 0)
  const sumCols  = [...cols.values()].reduce((s, x) => s + comb2(x), 0)
  const expected = (sumRows * sumCols) / comb2(n)
  const max = (sumRows + sumCols) / 2
  return max === expected ? 1 : (sumCells - expected) / (max - expected)
}

function topNeighbors(sim, i, k) {
  const idx = []
  for (let j = 0; j < sim.length; j++) if (j !== i) idx.push(j)
  return new Set(idx.sort((x, y) => sim[i][y] - sim[i][x] || x - y).slice(0, k))
}

// Solape medio de los vecinos top-k entre dos matrices de similitud (p. ej. OpenAI vs. local).
function neighborOverlap(simA, simB, k) {
  const n = simA.length
  if (n < 2) return 1
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = topNeighbors(simA, i, k), b = topNeighbors(simB, i, k)
    let inter = 0
    for (const x of a) if (b.has(x)) inter++
    total += inter / (a.size + b.size - inter)
  }
  return total / n
}

// ¿Cuánto se mueve el grafo al pasar de k a k+1? Jaccard de aristas.
function kStability(sim, k) {
  return edgeJaccard(topKEdges(sim, { k }), topKEdges(sim, { k: k + 1 }))
}

// ── Todo junto ─────────────────────────────────────────────────────────────────

function evaluateGraph({ nodes, edges, similarity }, { labels = null, k = 3 } = {}) {
  const n = nodes.length
  const communities = detectCommunities(n, edges)
  return {
    nodeCount: n,
    similarity: similarityStats(similarity),
    validity: {
      precisionAtK: labels ? precisionAtK(similarity, labels, k) : null,
      separation:   labels ? separation(similarity, labels) : null,
    },
    structure: structureMetrics(n, edges),
    communities: { count: new Set(communities).size, modularity: modularity(n, edges, communities), membership: communities },
    stability: { kJaccard: n < 3 ? 1 : kStability(similarity, k) },
  }
}

module.exports = {
  similarityStats, precisionAtK, separation, structureMetrics,
  detectCommunities, modularity, edgeJaccard, adjustedRandIndex, neighborOverlap,
  kStability, evaluateGraph,
}
