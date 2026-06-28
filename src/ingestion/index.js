const { fetchPapers, calculateDateWindow, buildQuery, parseFeed } = require('./arxiv')
const { getAffiliations, matchesUniversityList } = require('./semanticscholar')
const { downloadPdf } = require('./downloader')
const { extractText, extractFirstPage, matchesUniversityInText } = require('./extractor')

module.exports = {
  fetchPapers, calculateDateWindow, buildQuery, parseFeed,
  getAffiliations, matchesUniversityList,
  downloadPdf,
  extractText, extractFirstPage, matchesUniversityInText,
}
