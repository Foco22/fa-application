// Traduce las métricas del grafo a veredictos ok/warn para el panel "Calidad".
// Los umbrales son puntos de partida (ver la tabla de métricas del diseño) y
// conviene recalibrarlos con datos reales; con pocos nodos las métricas son ruidosas.
export const MIN_NODES = 8

export const THRESHOLDS = {
  minSpread: 0.03,       // desviación estándar de las similitudes: menos = saturadas
  maxHubRatio: 3,        // grado máximo / grado medio
  minModularity: 0.3,
  minKStability: 0.6,    // Jaccard de aristas entre k y k+1
  minPrecision: 0.6,
}

export function qualityChecks(m) {
  if (!m) return []
  if (m.nodeCount < MIN_NODES) {
    return [{ id: 'too-few', status: 'info', value: m.nodeCount }]
  }

  const status = ok => (ok ? 'ok' : 'warn')
  const checks = []

  if (m.similarity) {
    checks.push({ id: 'spread', status: status(m.similarity.std >= THRESHOLDS.minSpread), value: m.similarity.std })
  }
  checks.push({ id: 'isolated', status: status(m.structure.isolated === 0), value: m.structure.isolated })
  checks.push({ id: 'hubs', status: status(m.structure.hubRatio <= THRESHOLDS.maxHubRatio), value: m.structure.hubRatio })
  checks.push({ id: 'modularity', status: status(m.communities.modularity >= THRESHOLDS.minModularity), value: m.communities.modularity })
  checks.push({ id: 'stability', status: status(m.stability.kJaccard >= THRESHOLDS.minKStability), value: m.stability.kJaccard })
  if (m.validity?.precisionAtK != null) {
    checks.push({ id: 'precision', status: status(m.validity.precisionAtK >= THRESHOLDS.minPrecision), value: m.validity.precisionAtK })
  }
  return checks
}
