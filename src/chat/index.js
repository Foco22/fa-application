const { buildSystemPrompt } = require('./prompts')

async function chatWithPaper(message, paper, history, llm) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(paper) },
    ...history,
    { role: 'user', content: message }
  ]
  return llm.chat(messages)
}

module.exports = { chatWithPaper }
