import { applyLanguage, t, getLanguage } from '../i18n.js'

// app.js registra acá cómo repintar la vista activa. Existe para romper el ciclo
// de imports (settings.js necesita repintar, pero app.js ya importa settings.js)
// y para que el cambio de idioma no tenga que saber qué vista está abierta.
let refreshActiveView = () => {}

export function onLanguageChange(fn) {
  refreshActiveView = fn
}

// Cambiar de idioma reescribe el texto estático Y repinta la vista abierta, para
// que los botones/estados que construye el JS también queden en el nuevo idioma
// sin navegar a otra sección y volver.
//
// Lo que la IA ya generó (un resumen, las preguntas de un quiz, mensajes de chat)
// NO se retraduce: solo cambia la interfaz alrededor de ese contenido.
export async function changeLanguage(lang) {
  applyLanguage(lang)
  await refreshActiveView()
}

export { t, getLanguage, applyLanguage }