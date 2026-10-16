// Las notificaciones corren en el proceso main, fuera del renderer: no pueden
// usar el i18n.js del frontend, así que leen el idioma directo de la DB. Se lee
// el valor PERSISTIDO, nunca uno pendiente en el formulario abierto de Settings.
const MESSAGES = {
  es: (n) => `${n} paper${n > 1 ? 's' : ''} nuevo${n > 1 ? 's' : ''} listo${n > 1 ? 's' : ''}`,
  en: (n) => `${n} new paper${n > 1 ? 's' : ''} ready`,
}

function newPapersMessage(count, language = 'es') {
  const build = MESSAGES[language] || MESSAGES.es
  return build(count)
}

// Texto del motivo cuando un fetch no guarda nada. Lo arma el proceso main (con el
// idioma persistido) para que el toast del renderer y la notificación del
// scheduler digan exactamente lo mismo.
const EMPTY_MESSAGES = {
  es: {
    no_candidates: () => 'ArXiv no devolvió papers para la semana pasada con tus categorías y autores. Revisa Configuración o espera a la próxima semana.',
    none_passed: ({ candidates, bestSimilarity, threshold }) =>
      `Ninguno de los ${candidates} papers pasó el filtro de interés` +
      (bestSimilarity == null ? '.' : ` (mejor similitud ${bestSimilarity.toFixed(3)}, umbral ${threshold.toFixed(2)}).`) +
      ' Amplía tus keywords o referencias, o baja el umbral.',
    downloads_failed: ({ survivors, firstError }) =>
      `${survivors} paper${survivors > 1 ? 's' : ''} pasó el filtro pero no se pudo descargar ningún PDF` +
      (firstError ? ` (${firstError}).` : '.') + ' Inténtalo de nuevo en unos minutos.',
  },
  en: {
    no_candidates: () => 'ArXiv returned no papers for last week with your categories and authors. Check Settings or wait until next week.',
    none_passed: ({ candidates, bestSimilarity, threshold }) =>
      `None of the ${candidates} papers passed the interest filter` +
      (bestSimilarity == null ? '.' : ` (best similarity ${bestSimilarity.toFixed(3)}, threshold ${threshold.toFixed(2)}).`) +
      ' Broaden your keywords or references, or lower the threshold.',
    downloads_failed: ({ survivors, firstError }) =>
      `${survivors} paper${survivors > 1 ? 's' : ''} passed the filter but no PDF could be downloaded` +
      (firstError ? ` (${firstError}).` : '.') + ' Try again in a few minutes.',
  },
}

function emptyFetchMessage(outcome, language = 'es') {
  const table = EMPTY_MESSAGES[language] || EMPTY_MESSAGES.es
  return table[outcome.code](outcome)
}

module.exports = { newPapersMessage, emptyFetchMessage }
