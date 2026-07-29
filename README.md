# Ra

Desktop app (Electron, Linux) that automatically fetches scientific papers from ArXiv, summarizes them with an LLM, and generates quizzes to reinforce what you read.

## What's here

- Weekly paper ingestion from ArXiv filtered by topic, author, and university affiliation
- AI-generated summaries (streaming) and 5-question multiple choice quizzes
- Chat with individual papers
- Local SQLite storage — nothing leaves your machine except API calls

## Run

```bash
npm install
npm start
```

Requires an Anthropic or OpenAI API key (configured on first launch via the onboarding wizard).

## Test

```bash
npm test              # unit tests
npm run test:e2e      # end-to-end (Electron + Playwright)
npm run test:coverage # coverage report
```
