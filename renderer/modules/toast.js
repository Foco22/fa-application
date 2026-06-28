export function toast(msg, type = 'info') {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  document.getElementById('toast-container').appendChild(el)
  setTimeout(() => el.remove(), 3500)
}
