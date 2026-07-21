import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { hasEmbeddingConfig } from '../../../src/embeddings/index.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeIpcMain() {
  const handlers = {}
  return {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn } },
    invoke:  (ch, ...args) => handlers[ch]({}, ...args),
    handlers,
  }
}

const SETTINGS = {
  apiKey:              'sk-test',
  referenceFolderPath: '/refs',
}

function makeDb(overrides = {}) {
  return {
    getAllSettings:        vi.fn().mockReturnValue(SETTINGS),
    getSetting:           vi.fn().mockReturnValue('/refs'),
    getReferenceCount:    vi.fn().mockReturnValue(3),
    getReferencePapersList: vi.fn().mockReturnValue([]),
    getReferencePaper:    vi.fn().mockReturnValue(null),
    getPaper:             vi.fn().mockReturnValue(null),
    savePaper:            vi.fn(),
    saveReferencePaper:   vi.fn(),
    deleteReferencePaper: vi.fn(),
    deletePaper:          vi.fn(),
    updatePaperTitle:     vi.fn(),
    ...overrides,
  }
}

function makeDeps(overrides = {}) {
  return {
    shell:  { openPath: vi.fn() },
    dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true }) },
    createLLM: vi.fn().mockReturnValue({
      extractPaperMetadata:     vi.fn().mockResolvedValue({ title: 'T', authors: 'A', abstract: 'Ab' }),
      extractAffiliationsWithAI: vi.fn().mockResolvedValue(null),
      summarizeAbstract:         vi.fn().mockResolvedValue('A short summary.'),
    }),
    createEmbeddings: vi.fn().mockReturnValue({
      id: 'openai:text-embedding-3-small',
      generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    }),
    hasEmbeddingConfig,
    indexReferenceFolder: vi.fn().mockResolvedValue({ indexed: 2, errors: 0 }),
    extractFirstPage: vi.fn().mockResolvedValue({ success: true, text: 'first page' }),
    extractText:      vi.fn().mockResolvedValue({ success: true, text: 'full text' }),
    pdfParse:         vi.fn(),
    vault: { dir: '/vault' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('fake pdf'))
  vi.spyOn(fs, 'existsSync').mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

import { registerReferenceHandlers } from '../../../src/ipc/reference.js'

function setup(dbOverrides = {}, depsOverrides = {}) {
  const { ipcMain, invoke, handlers } = makeIpcMain()
  const db   = makeDb(dbOverrides)
  const deps = makeDeps(depsOverrides)
  registerReferenceHandlers({ ipcMain, db, deps })
  return { invoke, handlers, db, deps }
}


// ─── get-reference-stats ──────────────────────────────────────────────────────

describe('get-reference-stats', () => {
  it('reports every reference as usable when they all match the active model', async () => {
    const { invoke } = setup({ getReferenceCount: vi.fn().mockReturnValue(7) })
    const result = await invoke('get-reference-stats')
    expect(result).toEqual({ total: 7, usable: 7, stale: 0 })
  })

  // Al cambiar de proveedor, el índice viejo sigue en la DB pero no sirve para
  // comparar: se reporta como stale para que la UI pida reindexar.
  it('reports references embedded with another model as stale', async () => {
    const { invoke } = setup({
      // total = 7, pero sólo 2 llevan el sello del modelo activo
      getReferenceCount: vi.fn().mockImplementation(model => (model ? 2 : 7)),
    })
    const result = await invoke('get-reference-stats')
    expect(result).toEqual({ total: 7, usable: 2, stale: 5 })
  })

  it('reports nothing as usable when no embedding provider is configured', async () => {
    const { invoke } = setup(
      { getReferenceCount: vi.fn().mockReturnValue(7), getAllSettings: vi.fn().mockReturnValue({}) },
    )
    const result = await invoke('get-reference-stats')
    expect(result).toEqual({ total: 7, usable: 0, stale: 7 })
  })
})

// ─── index-reference-folder ───────────────────────────────────────────────────

describe('index-reference-folder', () => {
  it('returns early with zero counts when apiKey is missing', async () => {
    const { invoke } = setup({
      getAllSettings: vi.fn().mockReturnValue({ apiKey: '', referenceFolderPath: '/refs' }),
    })
    const result = await invoke('index-reference-folder')
    expect(result).toEqual({ indexed: 0, errors: 0, total: expect.any(Number) })
  })

  it('returns early with zero counts when referenceFolderPath is missing', async () => {
    const { invoke } = setup({
      getAllSettings: vi.fn().mockReturnValue({ apiKey: 'sk-test', referenceFolderPath: '' }),
    })
    const result = await invoke('index-reference-folder')
    expect(result).toEqual({ indexed: 0, errors: 0, total: expect.any(Number) })
  })

  it('calls indexReferenceFolder with provider, pdfParse and the llm', async () => {
    const { invoke, deps } = setup()
    await invoke('index-reference-folder')
    expect(deps.indexReferenceFolder).toHaveBeenCalledOnce()
    expect(deps.indexReferenceFolder).toHaveBeenCalledWith(
      '/refs',
      expect.any(Object),
      expect.objectContaining({ generateEmbedding: expect.any(Function) }),
      deps.pdfParse,
      expect.objectContaining({ summarizeAbstract: expect.any(Function) })
    )
  })

  it('includes total reference count in the response', async () => {
    const { invoke, db } = setup({ getReferenceCount: vi.fn().mockReturnValue(5) })
    const result = await invoke('index-reference-folder')
    expect(result.total).toBe(5)
  })
})

// ─── index-files ──────────────────────────────────────────────────────────────

describe('index-files', () => {
  it('returns early when apiKey is missing', async () => {
    const { invoke } = setup({
      getAllSettings: vi.fn().mockReturnValue({ apiKey: '' }),
    })
    const result = await invoke('index-files', ['/docs/paper.pdf'])
    expect(result.errors).toBe(1)
    expect(result.indexed).toBe(0)
  })

  it('skips files that are not PDFs', async () => {
    const { invoke, db } = setup()
    await invoke('index-files', ['/docs/notes.txt', '/docs/image.png'])
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('saves the paper record for a new PDF', async () => {
    const { invoke, db } = setup()
    await invoke('index-files', ['/docs/paper.pdf'])
    expect(db.savePaper).toHaveBeenCalledOnce()
    expect(db.savePaper).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringMatching(/^ref-/) })
    )
  })

  it('does not re-save a paper that already exists', async () => {
    const { invoke, db } = setup({
      getPaper: vi.fn().mockReturnValue({ id: 'ref-paper', title: 'Existing' }),
    })
    await invoke('index-files', ['/docs/paper.pdf'])
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('saves the embedding for a new file', async () => {
    const { invoke, db } = setup()
    await invoke('index-files', ['/docs/paper.pdf'])
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/docs/paper.pdf', embedding: expect.any(String) })
    )
  })

  it('skips embedding when file is already indexed', async () => {
    const { invoke, db } = setup({
      getReferencePaper: vi.fn().mockReturnValue({ id: 1 }),
    })
    await invoke('index-files', ['/docs/paper.pdf'])
    expect(db.saveReferencePaper).not.toHaveBeenCalled()
  })

  it('generates and saves an abstract_summary via the llm', async () => {
    const { invoke, db, deps } = setup()
    await invoke('index-files', ['/docs/paper.pdf'])
    expect(deps.createLLM().summarizeAbstract).toHaveBeenCalled()
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ abstract_summary: 'A short summary.' })
    )
  })

  it('counts errors when a file throws during processing', async () => {
    const { invoke } = setup(
      {},
      { extractText: vi.fn().mockRejectedValue(new Error('corrupt PDF')) }
    )
    const result = await invoke('index-files', ['/docs/bad.pdf'])
    expect(result.errors).toBe(1)
    expect(result.indexed).toBe(0)
  })

  it('copies the source PDF into the vault raw/ folder', async () => {
    const vault = {
      dir: '/vault',
      pdfPath:      vi.fn().mockReturnValue('/vault/reference/T/raw/ref-paper.pdf'),
      ensureDirs:   vi.fn(),
      copyPdfToRaw: vi.fn(),
    }
    const paper = { id: 'ref-paper', title: 'T', pdf_url: '/docs/paper.pdf' }
    const { invoke } = setup(
      { getPaper: vi.fn().mockReturnValue(paper) },
      { vault }
    )
    await invoke('index-files', ['/docs/paper.pdf'])
    expect(vault.ensureDirs).toHaveBeenCalledWith(paper)
    expect(vault.copyPdfToRaw).toHaveBeenCalledWith(paper, '/docs/paper.pdf')
  })
})

// ─── get-reference-list ───────────────────────────────────────────────────────

describe('get-reference-list', () => {
  it('maps paths to { id, path, name, paperId }', async () => {
    const { invoke, db } = setup({
      getReferencePapersList: vi.fn().mockReturnValue([
        { id: 1, path: '/refs/my paper.pdf' }
      ]),
      getPaper: vi.fn().mockReturnValue({ title: 'My Paper Title' }),
    })
    const result = await invoke('get-reference-list')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 1, name: 'My Paper Title' })
  })

  it('falls back to filename when paper title is not found', async () => {
    const { invoke } = setup({
      getReferencePapersList: vi.fn().mockReturnValue([
        { id: 2, path: '/refs/my-paper.pdf' }
      ]),
      getPaper: vi.fn().mockReturnValue(null),
    })
    const result = await invoke('get-reference-list')
    expect(result[0].name).toBe('my-paper')
  })
})

// ─── delete-reference ─────────────────────────────────────────────────────────

describe('delete-reference', () => {
  it('deletes both the reference record and the paper', async () => {
    const { invoke, db } = setup()
    await invoke('delete-reference', { filePath: '/refs/p.pdf', paperId: 'ref-p' })
    expect(db.deleteReferencePaper).toHaveBeenCalledWith('/refs/p.pdf')
    expect(db.deletePaper).toHaveBeenCalledWith('ref-p')
  })

  it('returns { success: true }', async () => {
    const { invoke } = setup()
    const result = await invoke('delete-reference', { filePath: '/refs/p.pdf', paperId: 'ref-p' })
    expect(result).toEqual({ success: true })
  })
})

// ─── rename-reference ─────────────────────────────────────────────────────────

describe('rename-reference', () => {
  it('calls db.updatePaperTitle with the new title', async () => {
    const { invoke, db } = setup()
    await invoke('rename-reference', { paperId: 'ref-p', newTitle: 'New Name' })
    expect(db.updatePaperTitle).toHaveBeenCalledWith('ref-p', 'New Name')
  })

  it('returns { success: true }', async () => {
    const { invoke } = setup()
    const result = await invoke('rename-reference', { paperId: 'ref-p', newTitle: 'X' })
    expect(result).toEqual({ success: true })
  })
})
