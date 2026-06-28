const SS_API = 'https://api.semanticscholar.org/graph/v1/paper'

async function getAffiliations(arxivId, httpClient, apiKey = '') {
  const url = `${SS_API}/arXiv:${arxivId}?fields=authors.affiliations,authors.name`

  const headers = {}
  if (apiKey) headers['x-api-key'] = apiKey

  try {
    const response = await httpClient.get(url, { headers })
    return response.data.authors || []
  } catch {
    return null
  }
}

function matchesUniversityList(affiliations, universityList) {
  if (affiliations === null) return true
  if (universityList.length === 0) return true

  for (const author of affiliations) {
    for (const affil of (author.affiliations || [])) {
      for (const uni of universityList) {
        if (affil.toLowerCase().includes(uni.toLowerCase())) return true
      }
    }
  }
  return false
}

module.exports = { getAffiliations, matchesUniversityList }