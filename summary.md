# Paper Learning — Summary

Aplicación de escritorio Linux (Electron.js) para ingestar, resumir y estudiar papers científicos de forma continua.

---

## Stack

| Capa | Tecnología |
|---|---|
| App | Electron 31 (Linux, frameless) |
| Backend | Node.js (main process) |
| DB | SQLite via `better-sqlite3` |
| IA | Anthropic SDK — `claude-opus-4-8` |
| HTTP | axios |
| PDF | `pdf-parse` |
| Feed papers | ArXiv Atom API |
| Afiliaciones | Semantic Scholar API |
| Scheduler | `node-cron` |
| Tests unitarios | Vitest |
| Tests E2E | Playwright |

---

## Arquitectura de archivos

```
learning/
├── main.js                  # Electron main: ventana, IPC, scheduler, notificaciones
├── preload.js               # contextBridge — expone window.api al renderer
├── src/
│   ├── arxiv.js             # Fetch + parse feed Atom ArXiv
│   ├── semanticscholar.js   # Enriquece papers con afiliaciones reales
│   ├── downloader.js        # Descarga PDFs via axios
│   ├── extractor.js         # Extrae texto de PDFs (pdf-parse, trunca a 30K chars)
│   ├── claude.js            # streamSummary() + generateQuiz() via Anthropic SDK
│   ├── chat.js              # chatWithPaper() — responde preguntas sobre el paper activo
│   ├── database.js          # CRUD: papers, quiz_results, settings (SQLite)
│   ├── scheduler.js         # Cron semanal configurable + calculateLastWeekWindow()
│   ├── ipcHandlers.js       # Registra todos los handlers IPC
│   └── vault.js             # Organiza PDFs/assets en disco: YYYY/week-NN/id/{raw,assets}/
├── renderer/
│   ├── index.html           # UI — layout 3 paneles (vault | content | chat)
│   ├── app.js               # Frontend vanilla JS (~1100 líneas)
│   └── styles.css           # Estilos Apple dark (~820 líneas)
└── tests/
    └── unit/                # 10 archivos de test (uno por módulo src/)
```

---

## Features implementadas

### 1. Ingesta automática de papers (ArXiv)

- Query ArXiv por categorías temáticas (cs.AI, cs.LG, etc.) + autores seleccionados
- Ventana temporal: lunes–domingo de la **semana anterior** (`submittedDate:[...]`)
- Post-filtro via **Semantic Scholar API**: solo papers de universidades top-20
- Si Semantic Scholar no tiene el paper (muy nuevo) → pasa igual
- Máximo configurable de papers por ejecución (default 3)
- Descarga PDF → extrae texto (~30K chars) → guarda en SQLite + vault en disco
- Si el PDF falla: `status = "pdf_error"`, paper aparece igual con badge `⚠ PDF no disp.`

### 2. Vault en disco

Estructura de carpetas:
```
~/Documents/PaperLearning/vault/
└── 2026/
    └── week-23/
        └── 2401.12345/
            ├── raw/        ← PDF original
            └── assets/     ← summary.md, quiz.json
```

- Usa **ISO week number** para los nombres de carpeta
- El vault se refleja en el panel izquierdo como árbol navegable
- Botón `↗` abre la carpeta del vault en el explorador de archivos del sistema

### 3. Scheduler semanal

- Cron job configurable (día + hora) vía onboarding o Settings
- En cada ejecución: fetch → filtro → descarga → extracción → guardado → notificación nativa
- Si `categoryList` y `authorList` están vacíos → no ejecuta, avisa al usuario

### 4. Resumen IA (streaming)

Genera 5 secciones via Claude con `thinking: { type: "adaptive" }`:
1. ¿Cuál es el problema?
2. ¿Cómo lo resolvieron?
3. ¿Qué mejoró respecto al estado del arte?
4. Implementa una versión simple
5. Compite contra el algoritmo

- Streaming en tiempo real al renderer via IPC (`summary-chunk`)
- Se persiste en SQLite y en `assets/summary.md`
- Se muestra como tarjetas colapsadas por sección

### 5. Quiz de comprensión

- 5 preguntas MCQ (4 opciones) generadas por Claude a partir del texto completo
- JSON persistido en SQLite y en `assets/quiz.json`
- Se puede repetir; guarda historial en `quiz_results`
- Muestra puntaje, respuestas correctas/incorrectas, explicaciones

### 6. Chat con el paper

- Panel derecho siempre visible
- Contexto: título del paper activo + últimos 12 turnos de conversación
- Responde preguntas usando el texto extraído del paper como contexto

### 7. Notas por paper (editor Markdown live)

Editor estilo **Obsidian live preview** — una sola caja, sin panel separado:
- Cada línea es un `<div>` independiente
- La línea activa muestra **raw Markdown** (ej. `## Título`)
- Al mover el cursor a otra línea → esa línea **renderiza en lugar** (heading, bold, blockquote, lista, hr)
- Enter: intercept manual para evitar que Chrome copie atributos → crea nuevo `<div>` limpio
- Backspace al inicio de línea: merge con la línea anterior
- Guardado automático con debounce 600ms → persiste en SQLite
- Indicador "Guardando… / Guardado" en la barra de notas

Elementos Markdown soportados:
| Sintaxis | Render |
|---|---|
| `# Título` | H1 grande |
| `## Subtítulo` | H2 |
| `### Sub` | H3 |
| `> cita` | Blockquote con borde azul |
| `- item` | Lista con bullet |
| `---` | Separador horizontal |
| `**bold**` | Negrita |
| `*italic*` | Cursiva |
| `` `code` `` | Código inline |

### 8. Onboarding wizard (4 pasos)

Se lanza en la primera apertura, bloquea la UI hasta completarse:
1. **Temas** — checkboxes por categoría ArXiv (CS, economía, biología, etc.)
2. **Universidades** — top-20 con checkboxes, todas activas por defecto
3. **Autores** — textarea libre (opcional), un apellido por línea
4. **Config** — API key Anthropic, día/hora del fetch, máx. papers

Al completar → guarda settings en SQLite + lanza primer fetch inmediatamente.

### 9. Settings panel

Drawer lateral (derecha) con todos los campos editables:
- API keys (Anthropic + Semantic Scholar opcional)
- Día, hora y máximo de papers
- Categorías ArXiv (checkboxes)
- Lista de universidades (textarea)
- Lista de autores (textarea)

---

## Modelo de datos (SQLite)

### `papers`
| Campo | Descripción |
|---|---|
| `id` | ArXiv ID (PK) |
| `title`, `authors`, `abstract` | Metadata |
| `pdf_url` | URL original en ArXiv |
| `published_date` | Fecha del paper |
| `affiliations` | JSON con afiliaciones (Semantic Scholar) |
| `pdf_text` | Texto extraído (~30K chars) |
| `summary` | Resumen IA (5 secciones) |
| `quiz` | JSON con 5 preguntas MCQ |
| `notes` | Notas del usuario (Markdown raw) |
| `pdf_error` | Mensaje si falló la descarga |
| `status` | `new / downloading / ready / pdf_error / error` |

### `quiz_results`
Historial de intentos: `paper_id`, `score`, `total`, `answers` (JSON), `taken_at`.

### `settings`
Key-value: `apiKey`, `categoryList`, `authorList`, `universityList`, `fetchDay`, `fetchHour`, `maxPapers`, `onboardingDone`, `semanticScholarApiKey`.

---

## UI — Layout 3 paneles

```
┌─────────────────────────────────────────────────────────────────────┐
│  ☰  Paper Learning          [status]          ↻ Fetch  ⚙  💬  □✕  │  ← Topbar
├──────────────┬──────────────────────────────────┬───────────────────┤
│  VAULT   0↗  │  [Hero: título, autores, fecha]  │  ASSISTANT      ⊘ │
│              │                                  │                   │
│  ▾ 2026      │  PDF │ Abstract │ Resumen │ ...  │  [contexto paper] │
│   ▾ W23      │                                  │                   │
│    ▾ paper   │  [Contenido del tab activo]      │  [burbujas chat]  │
│      › raw   │                                  │                   │
│      › assets│                                  │  [input mensaje]  │
└──────────────┴──────────────────────────────────┴───────────────────┘
```

- Panel vault y chat: `#1a1a1a`
- Panel central: `#1c1c1e` (Apple surface-1)
- Topbar: blur backdrop, `rgba(0,0,0,.8)`
- Accent: `#2997ff` (Apple sky-blue)
- Tipografía UI: SF Pro / Inter; código: JetBrains Mono

---

## IPC Channels

| Channel | Descripción |
|---|---|
| `get-papers` / `get-paper` | Lista / detalle |
| `fetch-papers` | Dispara ingesta completa |
| `start-summary` | Inicia resumen streaming |
| `summary-chunk / done / error` | main → renderer (streaming) |
| `generate-quiz` | Genera y retorna quiz JSON |
| `save-quiz-result` | Persiste resultado |
| `chat-message` | Responde pregunta con contexto paper |
| `save-notes` | Guarda notas en SQLite |
| `get-pdf-url` | Busca PDF en vault, fallback a pdfsDir legacy |
| `get-settings` / `save-settings` | CRUD configuración |
| `check-onboarding` / `complete-onboarding` | Wizard inicial |
| `open-vault-folder` | Abre carpeta vault en explorador |
| `new-papers` | main → renderer: notifica N papers nuevos |

---

## Tests

10 archivos Vitest en `tests/unit/`, uno por módulo:
- `arxiv.test.js` — query construction, date window, parse
- `semanticscholar.test.js` — affiliations, fallback si no existe
- `downloader.test.js` — descarga, error handling
- `extractor.test.js` — extracción texto, truncado 30K
- `database.test.js` — CRUD completo con `:memory:`
- `claude.test.js` — streamSummary, generateQuiz (API mockeada)
- `scheduler.test.js` — calculateLastWeekWindow, cron
- `vault.test.js` — isoWeek, paperSlot, ensureDirs, pdfPath, writeSummary
- `ipcHandlers.test.js` — handlers IPC integración
- `chat.test.js` — chatWithPaper

```bash
npm test              # todos los tests
npm run test:watch    # modo watch
npm run test:coverage # reporte de cobertura
npm start             # lanza la app
```

---

## Pendiente (v2)

- Quiz semanal con preguntas mezcladas de todos los papers
- Historial de puntajes y progreso
- RAG básico: chat contra toda la base de conocimiento
- Podcast/audio del resumen (TTS)