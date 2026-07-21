// Rasterización de un PDF a imágenes por página.
//
// pdfjs-dist necesita un <canvas>/DOM que el proceso main de Electron no tiene,
// así que la rasterización real corre en una ventana oculta (show: false) que
// carga renderer/rasterizer.html (reutiliza pdfjs-dist como la pestaña "File").
// Este módulo NO importa Electron: recibe una fábrica de ventanas inyectada
// (`createWindow`), lo que lo hace testeable sin Electron ni PDFs reales, igual
// que el resto de src/ recibe sus dependencias por inyección.
//
// `createWindow()` debe devolver un objeto tipo BrowserWindow con:
//   - loadFile(path) → Promise
//   - webContents.executeJavaScript(script) → Promise
//   - destroy()
//
// La página expone `window.__rasterizePdf(base64Pdf, scale)` que devuelve
// [{ base64, mimeType }] — una entrada por página, en orden.
function createRasterizer({ createWindow, rasterizerHtml, scale = 2 }) {
  return async function rasterizePdf(buffer) {
    const win = createWindow()
    try {
      await win.loadFile(rasterizerHtml)
      const base64Pdf = buffer.toString('base64')
      const pages = await win.webContents.executeJavaScript(
        `window.__rasterizePdf(${JSON.stringify(base64Pdf)}, ${JSON.stringify(scale)})`
      )
      return pages
    } finally {
      // Siempre destruir la ventana: correr OCR sobre varios papers en la misma
      // sesión no debe filtrar ventanas ocultas (§8.1 del PRD).
      try { win.destroy() } catch (_) {}
    }
  }
}

module.exports = { createRasterizer }
