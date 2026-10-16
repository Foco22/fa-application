// Núcleo puro del grafo de papers: centrado de embeddings, matriz de similitud y
// aristas top-k. Sin I/O ni Electron — recibe vectores, devuelve estructuras.
const { cosineSimilarity } = require('../embeddings')

// Los abstracts de un mismo campo son casi paralelos: el coseno crudo queda
// saturado cerca de 1 y no discrimina. Restar el vector medio de la colección
// elimina esa componente común y devuelve contraste a las similitudes.
function centerVectors(vectors) {
  if (vectors.length === 0) return []
  const dim  = vectors[0].length
  const mean = new Array(dim).fill(0)
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i]
  for (let i = 0; i < dim; i++) mean[i] /= vectors.length
  return vectors.map(v => v.map((x, i) => x - mean[i]))
}

function similarityMatrix(vectors) {
  const n = vectors.length
  const m = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    m[i][i] = cosineSimilarity(vectors[i], vectors[i])
    for (let j = i + 1; j < n; j++) {
      const s = cosineSimilarity(vectors[i], vectors[j])
      m[i][j] = s
      m[j][i] = s
    }
  }
  return m
}

// Cada nodo elige sus k vecinos más parecidos (así nadie queda aislado); la
// unión de esas elecciones, sin duplicar pares, son las aristas. `mutual` marca
// las que ambos extremos eligieron — las más fiables. `minSimilarity` poda las débiles.
function topKEdges(sim, { k = 3, minSimilarity = -Infinity } = {}) {
  const n = sim.length
  const chosen = Array.from({ length: n }, () => new Set())

  for (let i = 0; i < n; i++) {
    const ranked = []
    for (let j = 0; j < n; j++) if (j !== i) ranked.push(j)
    ranked.sort((a, b) => sim[i][b] - sim[i][a] || a - b)
    for (const j of ranked.slice(0, k)) chosen[i].add(j)
  }

  const edges = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const iPicksJ = chosen[i].has(j)
      const jPicksI = chosen[j].has(i)
      if (!iPicksJ && !jPicksI) continue
      if (sim[i][j] < minSimilarity) continue
      edges.push({ source: i, target: j, weight: sim[i][j], mutual: iPicksJ && jPicksI })
    }
  }
  return edges
}

function mostCommonModel(items) {
  const counts = new Map()
  for (const it of items) counts.set(it.model, (counts.get(it.model) || 0) + 1)
  let best = null, bestN = 0
  for (const [model, n] of counts) if (n > bestN) { best = model; bestN = n }
  return best
}

// nodes: [{ id, embedding, model, ...metadatos }]. Vectores de modelos distintos
// no son comparables (distinta dimensión y espacio), así que sólo entran los del
// modelo activo; el resto se reporta en `stale` para que la UI pida reindexar.
function buildGraph(nodes, { k = 3, minSimilarity = -Infinity, center = true, model = null } = {}) {
  const missing = nodes.filter(n => !Array.isArray(n.embedding) || n.embedding.length === 0).map(n => n.id)
  const withEmb = nodes.filter(n => Array.isArray(n.embedding) && n.embedding.length > 0)

  const activeModel = model ?? (withEmb.length ? mostCommonModel(withEmb) : null)
  const usable = withEmb.filter(n => n.model === activeModel)
  const stale  = withEmb.filter(n => n.model !== activeModel).map(n => n.id)

  const raw        = usable.map(n => n.embedding)
  const vectors    = center ? centerVectors(raw) : raw
  const similarity = similarityMatrix(vectors)
  // El peso (centrado) ordena y dibuja; el coseno crudo es lo que se le muestra
  // al usuario, porque las similitudes centradas pueden salir negativas.
  const rawSim = center ? similarityMatrix(raw) : similarity
  const edges  = topKEdges(similarity, { k, minSimilarity })
    .map(e => ({ ...e, cosine: rawSim[e.source][e.target] }))

  return {
    nodes: usable.map(({ embedding, ...rest }) => rest),
    edges, similarity, model: activeModel, stale, missing,
  }
}

module.exports = { centerVectors, similarityMatrix, topKEdges, buildGraph }
