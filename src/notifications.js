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

module.exports = { newPapersMessage }
