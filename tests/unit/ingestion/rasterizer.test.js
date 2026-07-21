import { describe, it, expect, vi } from 'vitest'
import { createRasterizer } from '../../../src/ingestion/rasterizer.js'

// Fake hidden BrowserWindow: records lifecycle and returns canned pages from
// executeJavaScript. No Electron, no real PDF — the module under test must work
// purely through the injected window factory.
function makeFakeWindow(pages, { throwOnExec = false } = {}) {
  const win = {
    destroyed: false,
    loadFileCalledWith: null,
    execScript: null,
    loadFile: vi.fn(async (p) => { win.loadFileCalledWith = p }),
    webContents: {
      executeJavaScript: vi.fn(async (script) => {
        win.execScript = script
        if (throwOnExec) throw new Error('render failed')
        return pages
      }),
    },
    destroy: vi.fn(() => { win.destroyed = true }),
  }
  return win
}

const PAGES = [
  { base64: 'cGFnZTE=', mimeType: 'image/png' },
  { base64: 'cGFnZTI=', mimeType: 'image/png' },
]

describe('createRasterizer', () => {
  it('returns one image descriptor per page from the hidden window', async () => {
    const win = makeFakeWindow(PAGES)
    const rasterize = createRasterizer({ createWindow: () => win, rasterizerHtml: '/x/rasterizer.html' })
    const result = await rasterize(Buffer.from('%PDF-1.4 fake'))
    expect(result).toEqual(PAGES)
  })

  it('loads the injected rasterizer HTML into the hidden window', async () => {
    const win = makeFakeWindow(PAGES)
    const rasterize = createRasterizer({ createWindow: () => win, rasterizerHtml: '/x/rasterizer.html' })
    await rasterize(Buffer.from('pdf'))
    expect(win.loadFile).toHaveBeenCalledWith('/x/rasterizer.html')
  })

  it('passes the base64 of the PDF buffer into the page script', async () => {
    const win = makeFakeWindow(PAGES)
    const rasterize = createRasterizer({ createWindow: () => win, rasterizerHtml: '/x/rasterizer.html' })
    const buf = Buffer.from('hello pdf')
    await rasterize(buf)
    expect(win.execScript).toContain(buf.toString('base64'))
  })

  it('destroys the hidden window after a successful run (no leak)', async () => {
    const win = makeFakeWindow(PAGES)
    const rasterize = createRasterizer({ createWindow: () => win, rasterizerHtml: '/x/rasterizer.html' })
    await rasterize(Buffer.from('pdf'))
    expect(win.destroy).toHaveBeenCalledOnce()
    expect(win.destroyed).toBe(true)
  })

  it('destroys the hidden window even when rasterization throws', async () => {
    const win = makeFakeWindow(PAGES, { throwOnExec: true })
    const rasterize = createRasterizer({ createWindow: () => win, rasterizerHtml: '/x/rasterizer.html' })
    await expect(rasterize(Buffer.from('pdf'))).rejects.toThrow('render failed')
    expect(win.destroy).toHaveBeenCalledOnce()
  })
})
