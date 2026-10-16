const path = require('path')
const { embedMany } = require('../embeddings')
const { buildGraph } = require('../graph/build')
const { evaluateGraph } = require('../graph/metrics')
const { labelCommunities } = require('../graph/labels')

const ABSTRACT_MAX = 600
const DEFAULT_K = 3

const isReferencePaper = (id) => String(id).startsWith('ref-')

// Los embeddings de los papers semanales se calculan la primera vez que se abre
// el grafo y se guardan sellados con el modelo; si cambia el proveedor se rehacen.
async function ensurePaperEmbeddings({ db, provider, papers }) {
  const stored = new Map(db.getPaperEmbeddings().map(r => [r.paper_id, r]))
  const byId = new Map()
  const toEmbed = []

  for (const p of papers) {
    const row = stored.get(p.id)
    if (row && row.model === provider.id) byId.set(p.id, row.embedding)
    else toEmbed.push(p)
  }

  // Uno por uno: si falla un paper (rate limit, texto inválido) los demás siguen.
  for (const p of toEmbed) {
    try {
      const [embedding] = await embedMany(provider, [p.abstract])
      db.savePaperEmbedding(p.id, embedding, provider.id)
      byId.set(p.id, embedding)
    } catch (err) {
      console.error(`[graph] No se pudo embeber ${p.id}: ${err.message}`)
    }
  }
  return byId
}

function referenceNodes({ db, refs }) {
  return refs.map(r => {
    const name  = path.basename(r.path, '.pdf')
    const paper = db.getPaper('ref-' + name.replace(/[^a-zA-Z0-9._-]/g, '-'))
    return {
      id: `ref:${r.path}`, kind: 'reference',
      title: paper?.title || name,
      abstract: (r.abstract_summary || paper?.abstract || '').slice(0, ABSTRACT_MAX),
      embedding: JSON.parse(r.embedding), model: r.embedding_model,
    }
  })
}

function registerGraphHandlers({ ipcMain, db, deps }) {
  ipcMain.handle('get-graph', async (_e, { k = DEFAULT_K, minSimilarity, center = true } = {}) => {
    const settings = db.getAllSettings()
    if (!deps.hasEmbeddingConfig(settings)) return { error: 'no-embeddings' }

    const provider = deps.createEmbeddings(settings)

    const papers = db.getPapers().filter(p => !isReferencePaper(p.id) && p.abstract)
    const vectors = await ensurePaperEmbeddings({ db, provider, papers })

    const paperNodes = papers.map(p => ({
      id: p.id, kind: 'paper', title: p.title,
      abstract: p.abstract.slice(0, ABSTRACT_MAX),
      createdAt: p.created_at, publishedDate: p.published_date,
      hasSummary: Boolean(p.summary),
      embedding: vectors.get(p.id) ?? null, model: provider.id,
    }))

    const nodes = [...referenceNodes({ db, refs: db.getReferencePapers() }), ...paperNodes]
    const graph = buildGraph(nodes, { k, minSimilarity, center, model: provider.id })
    const metrics = evaluateGraph(graph, { k })

    return {
      nodes: graph.nodes.map((n, i) => ({ ...n, community: metrics.communities.membership[i] })),
      edges: graph.edges,
      model: graph.model,
      stale: graph.stale,
      missing: graph.missing,
      communities: labelCommunities(graph.nodes, metrics.communities.membership),
      metrics: { ...metrics, communities: { count: metrics.communities.count, modularity: metrics.communities.modularity } },
    }
  })
}

module.exports = { registerGraphHandlers }
