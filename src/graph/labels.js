// Nombres para las comunidades del grafo, sin IA ni costo: los términos que más
// caracterizan los abstracts de cada grupo frente al resto (tipo TF-IDF).

const STOPWORDS = new Set((
  'the and for with that this from are was were been being have has had not but can could may might will would should ' +
  'our their its they them these those such than then into onto over under between among within without across about ' +
  'also both each other more most less least many much some any all one two three first second via per using used use ' +
  'based show shows shown showed propose proposed proposes present presents presented introduce introduces introduced ' +
  'paper papers work works study studies approach approaches method methods model models new novel result results ' +
  'however thus while which what when where how why because since over often well large small high low ' +
  'demonstrate demonstrates achieve achieves achieved improve improves improved performance existing state art ' +
  'framework task tasks problem problems data time different several various recent towards toward ' +
  'description describe describes described significant address addresses addressed enable enables enabled leverage ' +
  'leverages provide provides provided key including include includes insight insights'
).split(/\s+/))

// Minúsculas, sin puntuación, sin stopwords/números; el plural simple se pliega al
// singular para que "expert" y "experts" cuenten como el mismo término.
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !(w.length > 5 && w.endsWith('ly')))
}

function labelCommunities(nodes, membership, { terms: termCount = 3 } = {}) {
  const groups = new Map()
  nodes.forEach((node, i) => {
    const c = membership[i]
    if (!groups.has(c)) groups.set(c, [])
    // Un set por documento: importa en cuántos papers aparece un término, no cuántas veces.
    groups.get(c).push(new Set(tokenize(`${node.title || ''} ${node.abstract || ''}`)))
  })

  const total = nodes.length
  const docFreq = new Map()
  for (const docs of groups.values()) for (const doc of docs) for (const w of doc) docFreq.set(w, (docFreq.get(w) || 0) + 1)

  // Comunidades grandes primero: son las que más se ven y se quedan con los mejores términos.
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
  const used = new Set()
  const out = []

  for (const [id, docs] of ordered) {
    const inGroup = new Map()
    for (const doc of docs) for (const w of doc) inGroup.set(w, (inGroup.get(w) || 0) + 1)

    const scored = [...inGroup.entries()]
      .filter(([w]) => !used.has(w))
      .map(([w, n]) => [w, (n / docs.length) * Math.log(1 + total / docFreq.get(w))])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))

    const picked = scored.slice(0, termCount).map(([w]) => w)
    picked.forEach(w => used.add(w))
    out.push({ id, size: docs.length, terms: picked, label: picked.join(' · ') })
  }
  return out
}

module.exports = { tokenize, labelCommunities }
