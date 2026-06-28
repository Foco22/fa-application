const fs = require('fs')
const path = require('path')

async function downloadPdf(arxivId, pdfUrl, httpClient, destDir) {
  const destPath = path.join(destDir, `${arxivId}.pdf`)

  try {
    const response = await httpClient.get(pdfUrl, { responseType: 'arraybuffer' })
    fs.writeFileSync(destPath, response.data)
    return { success: true, path: destPath }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = { downloadPdf }