import { t } from './language.js'

// Puramente cosmético: nunca se inyecta en prompts de IA (ver
// features/first-run-profile.md §2.3/§8.1).
export function renderGreeting(userName) {
  const el = document.getElementById('user-greeting')
  if (!el) return
  el.textContent = userName ? `${t('hola-saludo')}, ${userName}` : ''
}
