import { t } from './language.js'

function greetingKeyFor(hour) {
  if (hour < 12) return 'saludo-buenos-dias'
  if (hour < 18) return 'saludo-buenas-tardes'
  return 'saludo-buenas-noches'
}

// Puramente cosmético: nunca se inyecta en prompts de IA (ver
// features/first-run-profile.md §2.3/§8.1).
export function renderGreeting(userName, now = new Date()) {
  const el = document.getElementById('user-greeting')
  if (!el) return
  el.textContent = userName ? `${t(greetingKeyFor(now.getHours()))}, ${userName}` : ''
}
