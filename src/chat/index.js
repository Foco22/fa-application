const { buildSystemPrompt } = require('./prompts')

async function chatWithPaper(message, paper, history, llm, language = 'es') {
  const messages = [
    { role: 'system', content: buildSystemPrompt(paper, language) },
    ...history,
    { role: 'user', content: message }
  ]
  return llm.chat(messages)
}

module.exports = { chatWithPaper }
