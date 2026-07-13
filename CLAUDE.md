# Paper Learning — Sistema de Aprendizaje Continuo

Aplicación de escritorio Linux construida con **Electron.js** para ingestar, resumir y estudiar papers científicos de forma continua y estructurada.

---

## Visión general

El objetivo es construir un hábito de aprendizaje técnico sostenible. El sistema automatiza la parte aburrida (buscar, descargar, leer) y amplifica la parte valiosa (entender, recordar, competir).

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| App de escritorio | Electron.js (Linux) |
| Backend/lógica | Node.js (proceso main de Electron) |
| Base de datos local | SQLite via `better-sqlite3` |
| Fuente de papers | ArXiv API (`http://export.arxiv.org/api/query`) |
| Extracción de PDF | `pdf-parse` |
| IA — LLM (resúmenes + quiz + chat) | Multi-proveedor: Anthropic (`claude-opus-4-8`), OpenAI (`gpt-4o`), DeepSeek |
| IA — Embeddings (similitud semántica) | OpenAI (`text-embedding-3-small`) o local (Transformers.js, `Xenova/all-MiniLM-L6-v2`) |
| HTTP | `axios` |
| Scheduling | `node-cron` |
| Notificaciones | Electron Notification API |

---

## Features — v1 (a construir ahora)

### 1. Ingesta automática de papers (ArXiv)

- Fuente: ArXiv API (`http://export.arxiv.org/api/query`)
- Máximo **3 papers por ejecución**
- Frecuencia: **semanal** (el usuario elige el día y hora en el onboarding)
- Flujo: fetch ArXiv → enriquecer con Semantic Scholar → **filtrar** → descargar PDF → extraer texto → guardar en SQLite

#### Estrategia de filtrado (dos capas)

**Capa 1 — Temas + Autores seleccionados:**
El usuario configura **qué le interesa aprender**, sin restricción de disciplina. ArXiv cubre CS, economía, biología cuantitativa, física, estadística, finanzas y más. La query combina categorías temáticas elegidas por el usuario con autores específicos que quiere seguir.

**Categorías ArXiv disponibles** (el usuario elige las que quiera en Settings):
```
Computación / IA:     cs.AI, cs.LG, cs.CL, cs.CV, cs.RO, cs.NE, stat.ML
Economía:             econ.GN, econ.EM, econ.TH
Finanzas cuant.:      q-fin.PM, q-fin.TR, q-fin.MF, q-fin.ST
Biología cuantit.:    q-bio.NC, q-bio.PE, q-bio.QM, q-bio.BM
Física:               physics.data-an, cond-mat.stat-mech, quant-ph
Estadística:          stat.TH, stat.AP, stat.ME
Matemáticas:          math.ST, math.OC, math.PR
```

**Autores seleccionados** (whitelist, opcional): el usuario agrega investigadores de cualquier campo que quiera seguir. La query usa `au:Apellido`. Lista vacía = sólo filtrar por categorías.

Sin autores por defecto — el usuario llena esto según **sus propios intereses** al configurar la app por primera vez.

**Capa 2 — Universidades Top 20 (via Semantic Scholar API):**
ArXiv frecuentemente omite el campo `<arxiv:affiliation>`, por eso **no** se usa el XML de ArXiv para esto. En cambio, tras el fetch se hace una llamada a **Semantic Scholar API** con el ArXiv ID, que sí tiene datos de afiliación confiables y es gratuita.

```
GET https://api.semanticscholar.org/graph/v1/paper/arXiv:{id}
    ?fields=authors.affiliations,authors.name
```

Respuesta ejemplo:
```json
{
  "authors": [
    { "name": "Yann LeCun", "affiliations": ["New York University", "Meta AI"] },
    { "name": "John Smith",  "affiliations": ["MIT"] }
  ]
}
```

**Lógica del filtro:**
- Si Semantic Scholar tiene el paper → filtrar por universityList sobre las afiliaciones
- Si Semantic Scholar no lo tiene aún (paper muy nuevo) → el paper **pasa igual** (no bloquearlo)
- Las afiliaciones se guardan en la tabla `papers` campo `affiliations` (JSON)
- En la UI se muestra siempre la universidad del primer autor (o "Afiliación no disponible")

**Límites de la API:** 100 req/5min sin key, 1 req/s con API key gratuita. Agregar campo `semanticScholarApiKey` en settings (opcional).

**Módulo:** `src/ingestion/semanticscholar.js` — encapsula la llamada y retorna afiliaciones normalizadas.

Lista de universidades permitidas (editables en Settings):
```
MIT, Stanford, Carnegie Mellon, Oxford, Cambridge, ETH Zurich,
UC Berkeley, Harvard, Princeton, Caltech, Columbia, Yale,
University of Toronto, Université de Montréal, NYU, EPFL,
University of Washington, Georgia Tech, University of Michigan,
Imperial College London
```

#### Settings relacionados (tabla `settings`)
| Clave | Valor por defecto | Descripción |
|---|---|---|
| `categoryList` | `""` (vacío — usuario elige) | Categorías ArXiv separadas por coma |
| `authorList` | `""` (vacío — usuario elige) | Autores a seguir, uno por línea |
| `universityList` | *(20 instituciones, una por línea)* | Instituciones para post-filtro |
| `maxPapers` | `"3"` | Máximo papers por fetch |
| `fetchDay` | `"monday"` | Día de la semana para el fetch |
| `fetchHour` | `"09:00"` | Hora del fetch semanal |

#### Ventana de tiempo de los papers

Los papers que se ingresan deben haber sido **publicados en la semana anterior** (lunes a domingo de la semana previa). No se ingestan papers de hoy ni de semanas anteriores. Esto asegura que siempre se trabaja sobre producción científica reciente pero ya visible en ArXiv.

ArXiv API soporta filtro por fecha con el campo `submittedDate`:
```
submittedDate:[YYYYMMDD0000 TO YYYYMMDD2359]
```

Ejemplo — si hoy es lunes 16 de junio 2025, la ventana es del lunes 9 al domingo 15:
```
submittedDate:[202506090000 TO 202506152359]
```

**Cálculo de la ventana** (se computa en runtime cada fetch):
```javascript
const today = new Date();
const dayOfWeek = today.getDay(); // 0=dom, 1=lun ... 6=sab
const lastMonday = new Date(today);
// ((dayOfWeek + 6) % 7) = días desde el lunes de ESTA semana (lun=0, dom=6)
// + 7 = retroceder una semana más → siempre cae en el lunes de la semana ANTERIOR
const daysBack = ((dayOfWeek + 6) % 7) + 7;
lastMonday.setDate(today.getDate() - daysBack);
const lastSunday = new Date(lastMonday);
lastSunday.setDate(lastMonday.getDate() + 6); // domingo semana anterior

// Formatear como YYYYMMDD0000 / YYYYMMDD2359
```

El scheduler corre **una vez por semana** el día y hora que el usuario eligió en el onboarding. Siempre busca en la semana anterior completa (lunes–domingo).

#### Lógica de query a ArXiv (completa)
```
ventana = [lunes_semana_anterior TO domingo_semana_anterior]

partes = []
partes += submittedDate:[ventana]

Si categoryList no está vacío:
  partes += (cat:X OR cat:Y OR ...)

Si authorList no está vacío:
  partes += (au:Apellido1 OR au:Apellido2 OR ...)

Si categoryList y authorList están ambos vacíos:
  → NO ejecutar el fetch
  → Mostrar aviso al usuario: "Configura al menos un tema o autor en Settings"
  → Retornar error al renderer via IPC

query = AND de todas las partes
sortBy=submittedDate, sortOrder=descending, max_results=maxPapers

Luego post-filtrar por universityList sobre afiliaciones de Semantic Scholar
Si quedan menos de maxPapers → está bien, mejor pocos buenos que muchos mediocres
```

#### Onboarding wizard (primera apertura)

Si no hay settings configurados, la app abre directamente en un wizard de 4 pasos antes de mostrar la UI principal. No se puede saltar.

**Paso 1 — Temas de interés**
Muestra checkboxes agrupados por disciplina (ver tabla de categorías ArXiv arriba). El usuario marca las áreas que le interesan. Mínimo 1 requerido.

```
┌─────────────────────────────────────────────────────┐
│  ¿Qué temas te interesan?                           │
│                                                     │
│  Computación / IA          Economía                 │
│  ☑ cs.AI  ☑ cs.LG          ☐ econ.GN  ☐ econ.EM   │
│  ☑ cs.CL  ☐ cs.CV          ☐ econ.TH               │
│  ☐ cs.RO  ☐ stat.ML                                │
│                             Biología cuantitativa  │
│  Finanzas cuant.            ☐ q-bio.NC ☐ q-bio.PE  │
│  ☐ q-fin.PM ☐ q-fin.TR     ☐ q-bio.QM ☐ q-bio.BM  │
│                                                     │
│                              [ Siguiente → ]        │
└─────────────────────────────────────────────────────┘
```

**Paso 2 — Universidades**
Lista de 20 instituciones con checkboxes. Todas marcadas por defecto. El usuario desmarca las que no le interesan.

```
┌─────────────────────────────────────────────────────┐
│  ¿De qué universidades quieres ver papers?          │
│  (todas activadas por defecto)                      │
│                                                     │
│  ☑ MIT              ☑ Stanford                     │
│  ☑ Carnegie Mellon  ☑ Oxford                       │
│  ☑ Cambridge        ☑ ETH Zurich                   │
│  ☑ UC Berkeley      ☑ Harvard  ...                 │
│                                                     │
│  [ ← Atrás ]                    [ Siguiente → ]    │
└─────────────────────────────────────────────────────┘
```

**Paso 3 — Autores a seguir (opcional)**
Textarea libre, un autor por línea. Puede quedar vacío.

```
┌─────────────────────────────────────────────────────┐
│  ¿Hay autores específicos que quieres seguir?       │
│  (opcional — uno por línea, usa el apellido)        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ LeCun                                         │  │
│  │ Bengio                                        │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [ ← Atrás ]                    [ Siguiente → ]    │
└─────────────────────────────────────────────────────┘
```

**Paso 4 — Configuración de ingesta**
Día de la semana + hora + API key de Anthropic.

```
┌─────────────────────────────────────────────────────┐
│  ¿Cuándo quieres recibir los papers?                │
│                                                     │
│  Día:   [ Lunes ▾ ]    Hora: [ 09:00 ▾ ]           │
│  Máximo papers por semana: [ 3 ▾ ]                  │
│                                                     │
│  Anthropic API Key:                                 │
│  [ sk-ant-..._________________________ ]            │
│                                                     │
│  [ ← Atrás ]                    [ ✓ Comenzar ]     │
└─────────────────────────────────────────────────────┘
```

Al completar el wizard se guardan todos los settings en SQLite y se lanza el primer fetch inmediatamente.

### 2. Notificaciones de escritorio

- Notificación nativa Linux cuando llegan papers nuevos
- Mensaje: cuántos papers nuevos están listos para revisar
- Implementado con `Notification` de Electron

### 3. Resumen automático con IA (Claude)

Genera un resumen estructurado por paper respondiendo exactamente estas 5 preguntas:

1. **¿Cuál es el problema?** — contexto, importancia, por qué existe
2. **¿Cómo lo resolvieron?** — metodología, técnica, componentes clave
3. **¿Qué mejoró respecto al estado del arte?** — avances específicos, métricas si las hay
4. **Implementa una versión simple** — pasos concretos, pseudocódigo si aplica
5. **Compite contra el algoritmo** — limitaciones del paper, cómo superarlo, qué atacar

El resumen se genera con streaming (Claude `claude-opus-4-8`, `thinking: {type: "adaptive"}`) y se persiste en SQLite para no regenerar.

### 4. Quiz de comprensión por paper

- **5 preguntas de opción múltiple** (4 alternativas cada una) por paper
- Generadas por Claude a partir del texto del paper
- El quiz evalúa comprensión profunda, no trivia
- Se persiste el resultado (puntaje, respuestas) en SQLite
- Se puede repetir el quiz

---

## Features — v2 (futuro)

### 5. Tracking de aprendizaje

- Quiz semanal con **10 preguntas** mezcladas de todos los papers estudiados
- Historial de puntajes y progreso a lo largo del tiempo
- Notas personales por paper

### 6. Chat con la base de conocimiento

- Chat en la UI que responde preguntas basándose en los papers descargados
- Contexto: texto extraído de los papers más relevantes (RAG básico)

### 7. Contenido generado (a explorar)

- Podcast/audio del resumen (text-to-speech)
- Formato de juego/trivia para el quiz

---

## Arquitectura de la app

```
learning/
├── CLAUDE.md
├── package.json
├── main.js              # Electron main process: ventana, IPC, scheduler, notificaciones
├── preload.js           # Context bridge: expone API segura al renderer
├── .env.example
├── src/
│   ├── database.js      # SQLite: papers, quiz_results, settings, reference_papers
│   ├── scheduler.js     # node-cron: fetch semanal configurable
│   ├── vault.js         # Gestión de carpetas y archivos markdown por paper
│   │
│   ├── ingestion/       # Pipeline de ingesta de papers (4 pasos)
│   │   ├── index.js          # Re-exporta todo el módulo como punto de entrada
│   │   ├── arxiv.js          # Fetch y parse del feed Atom de ArXiv
│   │   ├── semanticscholar.js # Enriquece papers con afiliaciones (Semantic Scholar API)
│   │   ├── downloader.js     # Descarga de PDFs via axios
│   │   └── extractor.js      # Extracción de texto de PDFs (pdf-parse)
│   │
│   ├── llm/             # Capa de abstracción de modelos de lenguaje
│   │   ├── index.js          # createLLM(settings) → proveedor concreto
│   │   ├── prompts.js        # Templates de prompts compartidos entre proveedores
│   │   └── providers/
│   │       ├── anthropic.js  # Claude (claude-opus-4-8) — streaming + thinking adaptativo
│   │       ├── openai.js     # GPT-4o — streaming + JSON mode
│   │       └── deepseek.js   # DeepSeek — compatible con API de OpenAI
│   │
│   ├── embeddings/      # Capa de abstracción de embeddings
│   │   ├── index.js          # createEmbeddings(settings), hasEmbeddingConfig(), indexReferenceFolder(), scoreAbstractAgainst()
│   │   └── providers/
│   │       ├── openai.js     # text-embedding-3-small (API — requiere key)
│   │       └── local.js      # Transformers.js (MiniLM) — corre offline, sin API key
│   │
│   ├── pricing/         # Tabla de precios por modelo (para el tracking de costos)
│   │   └── index.js          # fetchPricingTable(), refreshPricingIfStale(), getPriceFor(), saveManualOverride()
│   │
│   ├── costs/           # Registro de uso y costo de cada llamada pagada
│   │   └── index.js          # recordUsage(db, event), makeUsageRecorder(db), computeCostMicroUsd()
│   │
│   ├── chat/            # Lógica de chat con papers
│   │   ├── index.js          # chatWithPaper(message, paper, history, llm)
│   │   └── prompts.js        # buildSystemPrompt(paper)
│   │
│   └── ipc/             # Handlers IPC — divididos por dominio
│       ├── index.js          # registerHandlers() — registra todos los dominios
│       ├── papers.js         # get-papers, fetch-papers, delete-paper, get-pdf-url, save-notes; runFetch()
│       ├── settings.js       # get-settings, save-settings, check-onboarding, complete-onboarding
│       ├── learning.js       # start-summary, generate-quiz, save-quiz-result, chat-message
│       └── reference.js      # index-reference-folder, index-files, get-reference-list, delete-reference, rename-reference
│
└── renderer/
    ├── index.html       # UI principal
    ├── app.js           # Lógica del frontend (vanilla JS)
    └── styles.css       # Estilos
```

---

## Patrones de arquitectura

### Patrón Proveedor (LLM y Embeddings)

Ambas capas de IA usan el mismo patrón: una **factory function** que lee `settings` y retorna un objeto con una interfaz consistente.

```javascript
// src/llm/index.js
function createLLM(settings) {
  switch (settings.llmProvider || 'openai') {
    case 'anthropic': return createAnthropicProvider(settings.apiKey, settings.llmModel)
    case 'deepseek':  return createDeepSeekProvider(settings.apiKey, settings.llmModel)
    default:          return createOpenAIProvider(settings.apiKey, settings.llmModel)
  }
}

// Interfaz que todos los proveedores LLM implementan:
{
  streamSummary(paper, onChunk) → Promise<string>   // streaming con callback por chunk
  generateQuiz(paper)           → Promise<{questions}>
  chat(messages)                → Promise<string>    // messages: [{role, content}]
  extractPaperMetadata(text)    → Promise<{title, authors, abstract}>
  extractAffiliationsWithAI(text) → Promise<string[] | null>
}
```

**Nota Anthropic — `chat(messages)`:** La API de Anthropic requiere que el mensaje `system` se pase como parámetro separado, no dentro del array `messages`. El proveedor Anthropic extrae automáticamente el rol `system` antes de llamar a la API.

```javascript
// src/embeddings/index.js
function createEmbeddings(settings) {
  switch (settings.embeddingProvider || 'openai') {
    case 'local': return createLocalEmbeddingProvider(...)   // Transformers.js — offline
    default:      return createOpenAIEmbeddingProvider(...)  // API
  }
}

// Interfaz de embeddings:
{
  id                     → string            // "openai:text-embedding-3-small" | "local:Xenova/all-MiniLM-L6-v2"
  generateEmbedding(text) → Promise<number[]>
}
```

**`hasEmbeddingConfig(settings)`** — el proveedor local no necesita API key, así que los callers
(`runFetch`, `index-reference-folder`, auto-index de arranque) **nunca** deben gatear por
`settings.apiKey` para decidir si construir el proveedor de embeddings; usan esta función.

#### Embeddings de distintos modelos no son comparables

Cada vector queda sellado en `reference_papers.embedding_model` con el `id` del proveedor que lo
generó. Vectores de dos modelos distintos no comparten ni dimensión (1536 vs 384) ni espacio
semántico: mezclarlos produce similitudes basura. Por eso `selectCandidates()` **ignora** las
referencias cuyo `embedding_model` no coincide con el proveedor activo, y `get-reference-stats`
reporta cuántas quedaron `stale` para que la UI pida reindexar.

**El umbral tampoco se traslada entre motores.** MiniLM da ~0.40 de similitud coseno entre dos
abstracts claramente relacionados, donde OpenAI da ~0.6–0.7. Con el umbral de OpenAI (`0.6`), el
motor local rechazaría todos los papers. Sugerido: `~0.6` para OpenAI, `~0.4` para local.

Todos los proveedores aceptan un **cliente inyectable** como último parámetro (`_client = null`), lo que permite mockearlos en tests sin necesidad de `vi.mock`:

```javascript
const provider = createAnthropicProvider('sk-test', null, mockClient)
const emb      = createOpenAIEmbeddingProvider('sk-test', {}, mockEmbClient)
```

---

### Inyección de dependencias (`deps`)

`main.js` construye un objeto `deps` con todo lo que los handlers IPC necesitan: dependencias externas, módulos de Electron y el cliente HTTP. Los handlers **nunca** importan `electron` directamente — lo reciben de `deps`. Esto hace que todos los archivos en `src/` sean testables sin Electron.

```javascript
// main.js
const { shell, dialog } = require('electron')

registerHandlers({
  ipcMain, db, mainWindow,
  deps: {
    createLLM, chatWithPaper,
    fetchPapers, getAffiliations, matchesUniversityList,
    downloadPdf, extractText, extractFirstPage, matchesUniversityInText,
    createEmbeddings, scoreAbstractAgainst, indexReferenceFolder, indexFiles,
    shell, dialog,                // Electron — inyectados, nunca importados en src/ipc/
    httpClient: axios, pdfParse,
    pdfsDir: PDFS_DIR, vault
  }
})
```

### `runFetch` — pipeline standalone

`runFetch({ db, deps, mainWindow })` en `src/ipc/papers.js` es una función exportada independiente (no un closure dentro de `registerHandlers`). Esto permite:
- Que el scheduler la llame directamente desde `main.js`
- Que los tests la importen y llamen sin pasar por IPC

---

## Modelo de datos (SQLite)

### Tabla `papers`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | TEXT PK | ArXiv ID (ej. `2401.12345`) |
| `title` | TEXT | Título del paper |
| `authors` | TEXT | Autores (CSV) |
| `abstract` | TEXT | Abstract original |
| `pdf_url` | TEXT | URL del PDF en ArXiv |
| `published_date` | TEXT | Fecha de publicación |
| `affiliations` | TEXT | JSON con afiliaciones por autor (de Semantic Scholar) |
| `pdf_text` | TEXT | Texto extraído del PDF (truncado a ~30K chars) |
| `summary` | TEXT | Resumen generado por Claude (las 5 preguntas) |
| `quiz` | TEXT | JSON con las 5 preguntas MCQ |
| `pdf_error` | TEXT | Mensaje de error si falló la descarga del PDF (null si OK) |
| `status` | TEXT | `new` / `downloading` / `ready` / `pdf_error` / `error` |
| `created_at` | DATETIME | Fecha de ingesta |

### Tabla `quiz_results`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | Autoincrement |
| `paper_id` | TEXT | FK a papers |
| `score` | INTEGER | Respuestas correctas |
| `total` | INTEGER | Total preguntas |
| `answers` | TEXT | JSON con respuestas del usuario |
| `taken_at` | DATETIME | Fecha del intento |

### Instrumentación de costos — dónde vive

`main.js` construye **un solo** `onUsage = makeUsageRecorder(db)` y lo inyecta en las factories
(`createLLM`, `createEmbeddings`, `createTranscription`) antes de pasarlas a `deps`. El registro
ocurre **dentro de cada método del proveedor**, no en los IPC handlers: cualquier call site nuevo
queda instrumentado sin tocarlo. Solo se registra en el camino feliz — una llamada fallida no se cobra.

Métodos instrumentados: `streamSummary`, `generateQuiz`, `chat`, `extractAffiliationsWithAI`,
`extractPaperMetadata`, `summarizeAbstract`, `interpretImage`, `generateEmbedding`, `transcribe`.

Detalles que no son obvios y que rompen el tracking si se pierden:

- **OpenAI en streaming no devuelve `usage` salvo que se pida `stream_options: { include_usage: true }`.**
  Sin eso, los resúmenes —el flujo más caro— quedarían todos sin costo. El uso llega en un chunk final sin `choices`.
- **Anthropic reporta el uso en `stream.finalMessage()`**, no en los chunks.
- **La transcripción no tiene un único modelo de cobro:** Whisper (Groq, `whisper-1`) factura por
  audio y necesita `response_format: 'verbose_json'` para que la API devuelva `duration`; los
  `gpt-4o-*-transcribe` facturan por **tokens** y ni siquiera soportan `verbose_json`.
- **`rerank` NO se instrumenta: es gratis.** Corre local con Transformers.js, no hay nada que cobrar.
- Los proveedores locales (embeddings) se registran con costo **0**, no se omiten: el dashboard
  debe mostrar "Local — $0" como su propia serie.

### Tabla `usage_events` (tracking de costos)
Un evento por cada llamada pagada a IA.

| Campo | Tipo | Descripción |
|---|---|---|
| `occurred_at` | DATETIME | Cuándo ocurrió la llamada |
| `action_type` | TEXT | `summary` / `quiz` / `chat` / `embedding` / `transcription` / … |
| `provider` / `model` | TEXT | Proveedor y modelo usados |
| `prompt_tokens` / `completion_tokens` | INTEGER | Uso real reportado por el proveedor |
| `audio_seconds` | REAL | Segundos de audio (transcripción) |
| `cost_micro_usd` | INTEGER | Costo en **micro-USD** — `NULL` = precio desconocido |

**Los montos son enteros en micro-USD (1 USD = 1.000.000), nunca `REAL`.** Sumar miles de eventos en punto flotante acumula drift y el total no cerraría con la factura real. La UI divide por 1e6 solo al mostrar, después de sumar los enteros.

`cost_micro_usd = NULL` (modelo sin tarifa conocida) **no es lo mismo que 0**: se reporta aparte como "costo desconocido" en vez de sumarse como gratis y subestimar el gasto. Nunca se bloquea la acción del usuario por no poder calcular un costo.

### Tabla `pricing_cache`
Clave primaria `(provider, model)`. Los precios por unidad sí van como `REAL`: se usan una sola vez por evento, no se acumulan entre sí.

- **La tabla se descarga de LiteLLM** y se refresca si tiene más de `pricingFetchIntervalDays`. Si el fetch falla o el JSON está corrupto, se conserva la última tabla válida — nunca se acepta un precio corrupto.
- **`source = 'manual'` gana siempre.** El `ON CONFLICT` del upsert deja intacta una fila manual cuando la pisa un refresh de LiteLLM.
- **Normalización de nombres:** LiteLLM indexa los modelos de Groq como `groq/<model>` pero el proveedor devuelve el id pelado — `normalizeModelKey()` traduce, si no todo el gasto de Groq quedaría como "costo desconocido".
- **Precios verificados a mano (2026-07):** LiteLLM cotiza `deepseek-chat`/`deepseek-reasoner` con la tarifa vieja ($0.28/$0.42 por MTok); el precio oficial vigente es $0.14/$0.28. Van como `SEED_OVERRIDES` manuales — sin eso el gasto de DeepSeek saldría al doble.

### Tabla `settings`
| Clave | Valor por defecto | Descripción |
|---|---|---|
| `apiKey` | `""` | API key del proveedor LLM principal |
| `openaiApiKey` | `""` | API key de OpenAI (para embeddings si es distinta) |
| `semanticScholarApiKey` | `""` | Semantic Scholar API key (opcional) |
| `llmProvider` | `"openai"` | Proveedor LLM activo: `openai`, `anthropic`, `deepseek` |
| `llmModel` | `""` | Override del modelo (vacío = default del proveedor) |
| `embeddingProvider` | `"openai"` | Proveedor de embeddings activo: `openai`, `local` |
| `embeddingModel` | `""` | Override del modelo de embeddings |
| `embeddingApiKey` | `""` | API key de embeddings (fallback: `openaiApiKey` → `apiKey`; el proveedor `local` no la usa) |
| `categoryList` | `""` | Categorías ArXiv elegidas (separadas por coma) |
| `authorList` | `""` | Autores a seguir, uno por línea (apellidos) |
| `universityList` | *(20 instituciones, una por línea)* | Instituciones para post-filtro |
| `researchCenterList` | `""` | Centros de investigación adicionales (uno por línea) |
| `referenceFolderPath` | `""` | Carpeta con PDFs de referencia para filtro de similitud |
| `similarityThreshold` | `"0.72"` | Umbral de similitud semántica (0–1) para aceptar un paper |
| `maxPapers` | `"3"` | Máximo papers por fetch |
| `fetchDay` | `"monday"` | Día del fetch semanal |
| `fetchHour` | `"09:00"` | Hora del fetch semanal |
| `onboardingDone` | `"false"` | Si completó el wizard inicial |

---

## Flujos clave

### Fetch de papers
```
Scheduler / botón "Fetch"
  → src/ipc/papers.js:runFetch()
      → src/ingestion/arxiv.js       (fetch metadata por autores/categorías + ventana de fechas)
      → scoreAbstractAgainst()       (filtro de similitud semántica vs colección de referencia)
      → src/ingestion/downloader.js  (descargar PDF)
      → src/ingestion/extractor.js   (extractFirstPage — para filtro de afiliaciones)
      → llm.extractAffiliationsWithAI() (extrae afiliaciones del texto de la primera página)
      → filtrar por universityList / researchCenterList
      → src/ingestion/semanticscholar.js (enriquecer afiliaciones via API)
      → src/ingestion/extractor.js   (extractText ~30K chars)
      → src/database.js              (guardar paper + afiliaciones)
      → mainWindow.send('new-papers') (notifica al renderer)
  → Electron Notification            (N papers nuevos)
```

### Generación de resumen
```
Click "Generar Resumen"
  → IPC: start-summary → src/ipc/learning.js
  → createLLM(settings).streamSummary(paper, onChunk)
  → chunks via IPC 'summary-chunk' → renderer muestra en tiempo real
  → IPC 'summary-done' → guardar en DB + vault
```

### Quiz
```
Click "Generar Quiz"
  → IPC: generate-quiz → src/ipc/learning.js
  → createLLM(settings).generateQuiz(paper) → JSON
  → guardar en DB + vault → renderer muestra preguntas
  → IPC: save-quiz-result → guardar resultado
```

### Chat con paper
```
Usuario envía mensaje en el chat
  → IPC: chat-message → src/ipc/learning.js
  → src/chat/index.js:chatWithPaper(message, paper, history, llm)
  → llm.chat(messages) → respuesta
  → renderer muestra respuesta en hilo de conversación
```

---

## IA — patrones de uso

Toda la IA pasa por `createLLM(settings)` — no se llama a ningún cliente externo directamente desde `main.js` o los handlers IPC.

### Resumen (streaming)
```javascript
// src/ipc/learning.js
const llm = createLLM(settings)
const fullText = await llm.streamSummary(paper, (chunk) => {
  mainWindow.webContents.send('summary-chunk', chunk)
})
mainWindow.webContents.send('summary-done')
```
- **Anthropic**: usa `messages.stream()` con `thinking: { type: 'adaptive' }`
- **OpenAI / DeepSeek**: usa `chat.completions.create({ stream: true })`

### Quiz (JSON)
```javascript
const quiz = await llm.generateQuiz(paper)
// quiz: { questions: [{question, options, correct, explanation}] }
```

### Chat (turno por turno)
```javascript
// src/chat/index.js
async function chatWithPaper(message, paper, history, llm) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(paper) },
    ...history,
    { role: 'user', content: message }
  ]
  return llm.chat(messages)
}
```
- **Anthropic**: extrae el rol `system` al parámetro `system` de la API antes de enviar
- **OpenAI / DeepSeek**: pasa `messages` directamente (OpenAI soporta rol `system` dentro del array)

---

## Seguridad Electron

- `nodeIntegration: false` en el BrowserWindow
- `contextIsolation: true` + `preload.js` con `contextBridge`
- API key guardada en SQLite local (no en archivos planos)
- El renderer nunca accede a Node.js directamente

---

## IPC channels

Los handlers están organizados en 4 archivos de dominio bajo `src/ipc/`. Todos registran con `ipcMain.handle` (invoke desde el renderer).

### Papers (`src/ipc/papers.js`)
| Channel | Descripción |
|---|---|
| `get-papers` | Lista todos los papers ordenados por `created_at` |
| `get-paper` | Detalle de un paper por ID |
| `fetch-papers` | Dispara `runFetch()` — pipeline completo desde ArXiv |
| `save-notes` | Guarda notas del usuario para un paper |
| `delete-paper` | Elimina paper de DB y su carpeta en vault |
| `get-pdf-url` | Retorna `file://` URL del PDF local (vault o legacy) |
| `new-papers` *(main→renderer)* | Notifica cuántos papers nuevos llegaron |

### Learning (`src/ipc/learning.js`)
| Channel | Descripción |
|---|---|
| `start-summary` | Inicia generación de resumen (streaming via `summary-chunk`) |
| `summary-chunk` *(main→renderer)* | Chunk de texto del resumen en tiempo real |
| `summary-done` *(main→renderer)* | Resumen completado y guardado |
| `summary-error` *(main→renderer)* | Error durante la generación |
| `generate-quiz` | Genera quiz JSON con 5 preguntas y lo guarda |
| `save-quiz-result` | Guarda resultado del intento de quiz |
| `chat-message` | Turno de chat con el paper; retorna respuesta del LLM |

### Settings (`src/ipc/settings.js`)
| Channel | Descripción |
|---|---|
| `get-settings` | Lee todos los settings como objeto |
| `save-settings` | Guarda un objeto de settings (key-value) |
| `check-onboarding` | Retorna `true` si `onboardingDone === "true"` |
| `complete-onboarding` | Guarda settings del wizard y marca onboarding como completado |

### Reference (`src/ipc/reference.js`)
| Channel | Descripción |
|---|---|
| `select-folder` | Abre diálogo de selección de carpeta (via `dialog`) |
| `open-vault-folder` | Abre la carpeta vault en el explorador de archivos |
| `open-reference-folder` | Abre la carpeta de referencia configurada |
| `open-file` | Abre un archivo en la aplicación por defecto del sistema |
| `get-reference-stats` | Retorna `{ total }` de papers en la colección de referencia |
| `index-reference-folder` | Indexa (o re-indexa) todos los PDFs de la carpeta de referencia |
| `index-files` | Indexa PDFs específicos (drag & drop) |
| `get-reference-list` | Lista los papers de referencia con `{ id, path, name, paperId }` |
| `delete-reference` | Elimina un paper de referencia del índice y la DB |
| `rename-reference` | Cambia el título de un paper de referencia |

---

## Prompts para Claude

### Resumen (en español) — template completo
```
Título: {title}
Autores: {authors}

Abstract:
{abstract}

Texto del paper:
{text}

---

Analiza este paper científico y responde las siguientes 5 preguntas de forma
clara y detallada en español. Usa el texto completo, no solo el abstract.

**1. ¿Cuál es el problema?**
Describe el problema principal, su contexto e importancia.

**2. ¿Cómo lo resolvieron?**
Explica la metodología, técnica o algoritmo propuesto y sus componentes clave.

**3. ¿Qué mejoró respecto al estado del arte?**
¿Qué avances concretos logran? Menciona métricas específicas si las hay.

**4. Implementa una versión simple**
Pasos concretos para replicar el enfoque principal, con pseudocódigo si aplica.

**5. Compite contra el algoritmo**
¿Cuáles son sus limitaciones? ¿Qué estrategias podrían superarlo?
```

### Quiz (en español, JSON estructurado)
> Genera exactamente 5 preguntas de opción múltiple en español sobre este paper. Cada pregunta tiene 4 alternativas (A, B, C, D). Una sola respuesta correcta. Las preguntas deben evaluar comprensión profunda, no trivia. Responde ÚNICAMENTE con un JSON con esta estructura: `{"questions": [{"question": "...", "options": ["A...", "B...", "C...", "D..."], "correct": 0, "explanation": "..."}]}`

---

## Setup

```bash
npm install          # instala deps + rebuild better-sqlite3 para Electron
npm start            # abre la app
```

Crear `.env` (o configurar desde Settings en la UI):
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Test-Driven Development (TDD)

**Regla absoluta: ninguna feature, proceso o módulo se implementa sin tests escritos primero.**

El ciclo es siempre: **Red → Green → Refactor**.
1. Escribir el test que falla (describe el comportamiento esperado).
2. Implementar el mínimo código para que pase.
3. Refactorizar sin romper los tests.

---

### Stack de testing

| Herramienta | Uso |
|---|---|
| **Vitest** | Tests unitarios de todos los módulos `src/` |
| **Playwright** | Tests E2E del flujo completo en la app Electron |

```bash
npm test              # corre todos los tests unitarios (Vitest)
npm run test:e2e      # corre tests E2E en Electron (Playwright)
npm run test:watch    # modo watch durante desarrollo
```

---

### Estructura de tests

La estructura de `tests/unit/` **espeja exactamente** la estructura de `src/`. Cada subcarpeta en `src/` tiene su contraparte en `tests/unit/`.

```
learning/
├── tests/
│   ├── unit/
│   │   ├── database.test.js            # CRUD papers, quiz_results, settings, reference_papers
│   │   ├── scheduler.test.js           # cálculo de ventana de fechas, cron expression
│   │   ├── vault.test.js               # rutas, escritura de summary/quiz en markdown
│   │   │
│   │   ├── ingestion/
│   │   │   ├── arxiv.test.js           # fetch, parse, construcción de query, ventana de fechas
│   │   │   ├── semanticscholar.test.js # enriquecimiento de afiliaciones, fallback a null
│   │   │   ├── downloader.test.js      # descarga de PDFs, manejo de errores sin excepción
│   │   │   └── extractor.test.js       # extractText, extractFirstPage, truncado a 30K
│   │   │
│   │   ├── llm/
│   │   │   ├── anthropic.test.js       # streamSummary, generateQuiz, chat, extractAffiliationsWithAI
│   │   │   ├── openai.test.js          # ídem para proveedor OpenAI
│   │   │   └── deepseek.test.js        # ídem para proveedor DeepSeek
│   │   │
│   │   ├── embeddings/
│   │   │   ├── index.test.js           # createEmbeddings, hasEmbeddingConfig, indexReferenceFolder, scoreAbstractAgainst
│   │   │   └── local.test.js           # proveedor local: lazy load, number[], cacheDir fuera de node_modules
│   │   │
│   │   ├── chat/
│   │   │   └── index.test.js           # chatWithPaper, buildSystemPrompt, historial
│   │   │
│   │   ├── ipc/
│   │   │   ├── handlers.test.js        # registerHandlers — integración de los 4 dominios
│   │   │   ├── papers.test.js          # runFetch, get-papers, delete-paper, get-pdf-url
│   │   │   ├── learning.test.js        # start-summary, generate-quiz, chat-message
│   │   │   └── reference.test.js       # index-reference-folder, index-files, delete-reference
│   │   │
│   │   └── renderer/
│   │       └── summary-utils.test.js   # utilidades de parseo de texto del renderer
│   │
│   └── e2e/
│       ├── onboarding.spec.js          # wizard completo, validaciones
│       ├── fetch.spec.js               # fetch de papers, filtros, notificación
│       ├── summary.spec.js             # generación de resumen con streaming
│       └── quiz.spec.js                # flujo de quiz, guardar resultado
```

---

### Qué testear por módulo

#### `src/ingestion/arxiv.js`
- Construye la query correcta para categorías + autores + ventana de fechas
- Retorna error si `categoryList` y `authorList` están ambos vacíos
- Parsea correctamente el feed Atom de ArXiv
- Respeta el límite `maxPapers`
- Calcula correctamente la ventana lunes–domingo de la semana anterior

#### `src/ingestion/semanticscholar.js`
- Retorna afiliaciones normalizadas dado un ArXiv ID válido
- Si el paper no existe en Semantic Scholar → retorna `null` (paper pasa igual)
- Maneja rate limit (100 req/5min) sin crashear

#### `src/ingestion/downloader.js`
- Descarga el PDF y lo guarda en la ruta correcta
- Si la descarga falla → retorna `{ success: false, error: "mensaje" }` (nunca lanza excepción)

#### `src/ingestion/extractor.js`
- `extractText()` extrae texto de un PDF válido y lo trunca a ~30.000 chars
- `extractFirstPage()` retorna solo el texto de la primera página
- Si el PDF está corrupto → retorna `{ success: false, error: "..." }`

#### `src/llm/providers/anthropic.js`, `openai.js`, `deepseek.js`
- `streamSummary()` llama al método correcto (stream vs create) y reenvía chunks via callback
- `generateQuiz()` retorna JSON con exactamente 5 preguntas, 4 opciones cada una
- Maneja JSON envuelto en markdown fences (` ```json ... ``` `)
- `chat()` retorna la respuesta como string; Anthropic extrae el rol `system` al parámetro correcto
- `extractAffiliationsWithAI()` retorna array de strings o `null` si falla
- `extractPaperMetadata()` retorna `{ title, authors, abstract }` o campos vacíos si falla
- Los clientes se inyectan vía el tercer parámetro — nunca se llama a la API real en tests

#### `src/embeddings/index.js`
- `createEmbeddings()` retorna proveedor con `generateEmbedding()`
- `indexReferenceFolder()` indexa PDFs nuevos y omite los ya indexados
- `scoreAbstractAgainst()` calcula similitud coseno y retorna el máximo

#### `src/chat/index.js`
- `chatWithPaper()` construye el array de mensajes con system prompt + history + nuevo mensaje
- Delega la llamada a `llm.chat(messages)` (no construye cliente propio)
- Funciona con `paper = null` (chat sin paper específico)

#### `src/database.js`
- `savePaper()` inserta o actualiza correctamente (upsert)
- `getPapers()` retorna todos los papers ordenados por `created_at`
- `getSetting(key)` / `saveSetting(key, value)` funcionan correctamente
- `saveQuizResult()` guarda score, total y respuestas en JSON
- `saveReferencePaper()` / `getReferencePaper()` / `getReferencePapers()` para el índice de referencia
- El campo `status` sigue los estados válidos: `new | downloading | ready | pdf_error | error`

#### `src/ipc/papers.js` — `runFetch()`
- Descarta papers por similitud semántica cuando hay colección de referencia
- Descarta papers si no pasan el filtro de universidades/centros
- Guarda papers que pasan todos los filtros en DB
- Si PDF download falla → paper no se guarda (no hay fallback al abstract)
- Notifica al renderer via `new-papers` al terminar

#### `src/ipc/settings.js`
- `check-onboarding` retorna `false` si `onboardingDone !== "true"`
- `complete-onboarding` guarda todos los settings recibidos

#### `src/ipc/learning.js`
- `start-summary` llama a `llm.streamSummary()` y emite chunks; en error emite `summary-error`
- `generate-quiz` guarda el quiz en DB y en vault
- `chat-message` pasa el historial completo y retorna la respuesta

#### `src/ipc/reference.js`
- `index-reference-folder` retorna early si falta `apiKey` o `referenceFolderPath`
- `index-files` omite archivos no-PDF y papers ya indexados
- `delete-reference` elimina tanto la referencia como el paper de la DB
- `shell` y `dialog` provienen de `deps` — no se importan de `electron` directamente

#### `src/scheduler.js`
- Registra el cron job con el día y hora correctos desde settings
- El cron no se ejecuta si `categoryList` y `authorList` están ambos vacíos

---

### Reglas de TDD en este proyecto

1. **Antes de implementar cualquier función** → escribir el test primero en el archivo correspondiente de `tests/unit/`, respetando la estructura de carpetas que espeja `src/`.
2. **Antes de abrir un IPC channel nuevo** → agregar su test en el archivo de dominio correcto (`tests/unit/ipc/`).
3. **Antes de agregar una pantalla o flujo E2E** → agregar el spec en `tests/e2e/`.
4. **Todos los proveedores de IA se mockean** — nunca se llama a la API real en tests. Se inyecta el cliente via el tercer parámetro del constructor del proveedor.
5. **Semantic Scholar y ArXiv se mockean** con fixtures JSON reales capturados una sola vez.
6. **`better-sqlite3` usa base de datos en memoria** (`:memory:`) en todos los tests unitarios.
7. **Los tests deben correr sin Electron** — ningún archivo en `src/` importa `electron` a nivel de módulo. `shell` y `dialog` siempre vienen de `deps`.
8. **Un test roto bloquea el merge** — no se avanza a la siguiente feature con tests en rojo.

---

### Cobertura mínima esperada

| Módulo | Cobertura líneas |
|---|---|
| `src/ingestion/arxiv.js` | 90% |
| `src/ingestion/semanticscholar.js` | 85% |
| `src/ingestion/downloader.js` | 85% |
| `src/ingestion/extractor.js` | 80% |
| `src/database.js` | 95% |
| `src/llm/providers/*.js` | 80% |
| `src/embeddings/index.js` | 80% |
| `src/chat/index.js` | 85% |
| `src/ipc/papers.js` (runFetch) | 85% |
| `src/scheduler.js` (lógica de fechas) | 95% |

```bash
npm run test:coverage   # genera reporte de cobertura
```
