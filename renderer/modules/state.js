export const state = {
  papers:           [],
  activePaper:      null,
  activeTab:        'resumen',
  chatHistory:      [],
  quizAnswers:      {},
  quizSubmitted:    false,
  notesSaveTimer:   null,
  pdfExpanded:      false,
  currentNotesLine: null,
  pdfDoc:           null,
  pdfLoadId:        0,
  pdfScale:         1.5,   // escala actual del lector (ver pdf-zoom.js)
  annotationText:   '',
  annotationRects:  null,
  highlightsPanelOpen: false,
  refPapers:        [],
  expandedNodes:    new Set(),
}
