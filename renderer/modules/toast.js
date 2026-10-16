export function toast(msg, type = 'info', ms) {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  document.getElementById('toast-container').appendChild(el)
  // Los errores suelen ser mensajes largos que el usuario necesita leer con
  // calma, así que se muestran más tiempo que un aviso normal.
  setTimeout(() => el.remove(), ms ?? (type === 'error' ? 8000 : 3500))
}
