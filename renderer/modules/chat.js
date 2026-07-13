import { state } from './state.js'
import { toast } from './toast.js'
import { renderMarkdown } from '../summary-utils.js'
import { t } from './language.js'

export function updateChatContext() {
  const ctx   = document.getElementById('chat-context')
  const label = document.getElementById('chat-context-label')
  if (state.activePaper) {
    ctx.classList.remove('hidden')
    label.textContent = state.activePaper.title || state.activePaper.id
  } else {
    ctx.classList.add('hidden')
  }
}

export function appendChatBubble(role, text) {
  const msgs = document.getElementById('chat-messages')
  const el   = document.createElement('div')
  el.className = `chat-bubble ${role}`
  if (role === 'assistant') {
    el.innerHTML = renderMarkdown(text)
  } else {
    el.textContent = text
  }
  msgs.appendChild(el)
  msgs.scrollTop = msgs.scrollHeight
  return el
}

export function clearChatWelcome() {
  document.querySelector('#chat-messages .chat-welcome')?.remove()
}

export async function sendChat() {
  const input   = document.getElementById('chat-input')
  const message = input.value.trim()
  if (!message) return
  input.value = ''
  await dispatchChat(message)
  input.focus()
}

export async function dispatchChat(message) {
  const sendBtn = document.getElementById('btn-chat-send')
  sendBtn.disabled = true
  clearChatWelcome()

  appendChatBubble('user', message)
  state.chatHistory.push({ role: 'user', content: message })

  const thinking = appendChatBubble('assistant thinking', 'Pensando')
  try {
    const reply = await window.api.chatMessage({
      message, paperId: state.activePaper?.id || null, history: state.chatHistory.slice(-12),
    })
    thinking.remove()
    appendChatBubble('assistant', reply)
    state.chatHistory.push({ role: 'assistant', content: reply })
  } catch (err) {
    thinking.remove()
    appendChatBubble('assistant', t('error-prefijo-largo') + err.message)
    toast(t('error-en-chat') + err.message, 'error')
  }
  sendBtn.disabled = false
}

export function clearChat() {
  state.chatHistory = []
  document.getElementById('chat-messages').innerHTML =
    '<div class="chat-welcome"><p>Pregúntame sobre el paper activo, o sobre investigación en general.</p></div>'
}
