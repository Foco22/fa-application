# Feature: Clase Simulada — Plan de Implementación

> Modo de estudio activo donde el usuario actúa como profesor frente a 3 agentes IA estudiantes.
> La app graba su explicación, cronometra la presentación y orquesta una ronda de preguntas Q&A.

---

## Visión general

```
┌─────────────────────────────────── CLASE ───────────────────────────────────┐
│                                                                              │
│  FASE 1 — PREPARACIÓN         FASE 2 — PRESENTACIÓN      FASE 3 — Q&A      │
│  Subir 2-3 fotos como         El profesor explica         3 estudiantes IA   │
│  diapositivas                 con cronómetro              preguntan uno      │
│  (Intro · Dev x3 · Concl.)    3–5 min visible             a uno en chat      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Flujo completo (secuencia)

```
Usuario abre un paper → "Iniciar Clase"
  │
  ▼
[FASE 1 — PREP]
Wizard de 2 pasos:
  1. Subir fotos (2-3 imágenes) → asignar sección (Intro / Desarrollo 1-3 / Conclusión)
  2. Elegir duración del timer (3, 4 o 5 min)
  │
  ▼
[FASE 2 — PRESENTACIÓN]
- Vista "videollamada":
    · Cámara profesor (webcam real)
    · 3 tiles de estudiantes IA (avatares estáticos animados)
    · Panel de diapositivas (las fotos subidas)
    · Chat lateral (estilo Teams) — vacío aún
- Timer visible cuenta regresiva (MM:SS, rojo al último minuto)
- SpeechRecognition transcribe la voz del profesor en tiempo real
  → transcripción acumulada guardada en memoria de sesión
- Al llegar a 0 → mic se desactiva → "Tiempo de preguntas"
  │
  ▼
[FASE 3 — Q&A]
Por cada estudiante (1 → 2 → 3):
  1. Estudiante genera pregunta → aparece en chat
  2. Profesor responde (voz transcripta o input de texto)
  3. evaluateAndReact():
       satisfied=true  → estudiante reacciona positivo → siguiente estudiante
       satisfied=false → estudiante señala qué faltó → profesor tiene UN reintento
                       → evaluateAndReact() de nuevo → avanza igual (con marca de ✗)
  │
  ▼
[FIN]
Pantalla de cierre con:
  · ✓/✗ por cada pregunta (satisfecha en 1° o 2° intento, o no satisfecha)
  · Puntuación: N/3 preguntas resueltas satisfactoriamente
  · Feedback del LLM sobre claridad general
  · Transcripción completa + Q&A
  · Botón "Guardar en vault"
```

---

## Arquitectura — archivos nuevos y modificados

### Nuevos archivos

```
learning/
├── src/
│   ├── class/
│   │   ├── index.js          # Re-exporta todo + canHaveClass(paper) para validar precondiciones
│   │   ├── students.js       # STUDENTS, generateTurn(), evaluateAndReact(), evaluateClarity()
│   │   └── prompts.js        # Helpers puros: buildSlidesBlock, buildTurnInstruction, etc.
│   │
│   └── ipc/
│       └── class.js          # Handlers IPC para todo el flujo de clase
│
├── renderer/
│   └── modules/
│       └── class.js          # Toda la lógica de UI de la clase (timer, webcam, slides, chat)
│
└── tests/
    └── unit/
        ├── class/
        │   ├── index.test.js
        │   ├── students.test.js
        │   └── prompts.test.js
        └── ipc/
            └── class.test.js
```

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/database.js` | Agregar tablas `class_sessions` y `class_slides` |
| `src/ipc/index.js` | Registrar `registerClassHandlers` |
| `renderer/index.html` | Agregar tab `clase` en `tab-bar` + `#tab-clase` panel + overlay `#class-session-overlay` |
| `renderer/modules/paper-view.js` | Agregar `renderClassSection(p)` junto a `renderSummarySection`, `renderQuizSection` |
| `renderer/app.js` | Conectar tab clase e inicializar module class |
| `preload.js` | Exponer nuevos canales IPC de clase |
| `main.js` | Inyectar módulo `class` en `deps` |

---

## Modelo de datos — tablas nuevas

### `class_sessions`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | Autoincrement |
| `paper_id` | TEXT | FK a `papers` |
| `duration_seconds` | INTEGER | Duración elegida (180, 240 o 300) |
| `transcript` | TEXT | Transcripción completa de la explicación del profesor |
| `qa_log` | TEXT | JSON: `[{student, question, answer, reaction}]` |
| `clarity_score` | TEXT | Evaluación del LLM al finalizar (1-10 + feedback) |
| `status` | TEXT | `prep` / `presenting` / `qa` / `done` |
| `created_at` | DATETIME | Fecha de la sesión |

### `class_slides`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK | Autoincrement |
| `paper_id` | TEXT | FK a `papers` |
| `session_id` | INTEGER | FK a `class_sessions` |
| `position` | INTEGER | Orden: 0-4 |
| `section` | TEXT | `intro` / `dev1` / `dev2` / `dev3` / `conclusion` |
| `file_path` | TEXT | Ruta absoluta a la imagen guardada localmente |
| `interpretation` | TEXT | Descripción textual generada por el LLM (visión) al inicio de la clase |

---

## IPC Channels — `src/ipc/class.js`

| Channel | Dirección | Descripción |
|---|---|---|
| `class-can-have-class` | renderer→main | Valida si el paper puede tener clase → `{ ok, reason?, warning? }` |
| `class-upload-slides` | renderer→main | Guarda imágenes (base64 array), retorna rutas |
| `class-interpret-slides` | renderer→main | Llama al LLM con visión por cada slide, guarda `interpretation` en DB |
| `class-start-session` | renderer→main | Crea sesión en DB, retorna `sessionId` |
| `class-get-slides` | renderer→main | Retorna slides de una sesión |
| `class-save-transcript` | renderer→main | Acumula transcripción parcial |
| `class-student-question` | renderer→main | Genera pregunta del estudiante N (1-3), retorna string |
| `class-student-evaluate` | renderer→main | Estudiante evalúa respuesta del profesor → `{satisfied, reaction, missing}` |
| `class-end-session` | renderer→main | Finaliza sesión, genera `clarity_score`, guarda todo |
| `class-get-sessions` | renderer→main | Lista sesiones previas de un paper |

---

## Módulo `src/class/students.js` — Agentes IA

### Cómo funciona cada agente

Cada estudiante es un **llamado real a `llm.chat(messages)`** usando la misma capa LLM existente (`createLLM(settings)`). El modelo recibe:

- **`role: system`** → persona del estudiante + contenido completo del paper (`paper.pdf_text`) + interpretaciones de las diapositivas
- **`role: user`** → transcripción de lo que explicó el profesor + Q&A previo

El mismo patrón que `chatWithPaper()` en `src/chat/index.js`. No se agrega ningún método nuevo a los proveedores — se reutiliza `llm.chat(messages)` tal cual.

#### Las diapositivas se interpretan UNA VEZ, antes de la clase

Cuando el usuario termina el prep y clickea "Iniciar Clase", se llama a `class-interpret-slides` que corre `llm.interpretImage()` por cada slide y guarda la interpretación en `class_slides.interpretation`. Ese texto queda en la DB y los tres agentes lo consumen al generar sus preguntas. Sin visión repetida por agente.

```
INICIO DE CLASE
  ↓
Por cada slide (2-3 imágenes):
  llm.interpretImage(base64) → "Esta diapositiva muestra..."
  → guardar en class_slides.interpretation
  ↓
Clase inicia (presentación del profesor)
  ↓
Q&A: cada agente recibe en su system prompt:
  - papel completo (pdf_text)
  - interpretaciones de las slides (texto)
  - transcripción del profesor (user message)
```

#### Nuevo método `interpretImage()` en los proveedores LLM

Es el único método nuevo que se agrega. Recibe un base64 de la imagen y devuelve una descripción textual concisa:

```javascript
// src/llm/providers/anthropic.js
async interpretImage(base64, mimeType = 'image/jpeg') {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        },
        {
          type: 'text',
          text: 'Describe esta diapositiva de forma concisa: idea principal, puntos clave, diagramas o fórmulas visibles. Máximo 4 oraciones.'
        }
      ]
    }]
  })
  return extractText(response.content)
}

// src/llm/providers/openai.js
async interpretImage(base64, mimeType = 'image/jpeg') {
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: 'text', text: 'Describe esta diapositiva de forma concisa: idea principal, puntos clave, diagramas o fórmulas visibles. Máximo 4 oraciones.' }
      ]
    }]
  })
  return response.choices[0].message.content
}

// src/llm/providers/deepseek.js
// DeepSeek no soporta visión — retorna null, el agente simplemente omite las slides
async interpretImage(_base64, _mimeType) {
  return null
}
```

La interfaz del proveedor LLM en `src/llm/index.js` documenta `interpretImage(base64, mimeType) → Promise<string|null>`.

### Tres personas — `systemPrompt` embebe PDF + interpretaciones de slides

El `systemPrompt` recibe `(paper, slides)` donde `slides` es el array de registros de `class_slides` ya con el campo `interpretation` poblado.

```javascript
// Helper compartido — construye el bloque de diapositivas
function buildSlidesBlock(slides) {
  const interpreted = slides.filter(s => s.interpretation)
  if (interpreted.length === 0) return ''
  return `\nDIAPOSITIVAS DEL PROFESOR (lo que mostró visualmente):\n${
    interpreted.map(s =>
      `[${s.section.toUpperCase()}]: ${s.interpretation}`
    ).join('\n')
  }`
}

const STUDENTS = [
  {
    id: 1,
    name: 'María García',
    emoji: '👩‍🎓',
    color: '#6366f1',
    systemPrompt: (paper, slides) => `
Eres María García, estudiante de doctorado, rigurosa y metódica.
Tu enfoque es la METODOLOGÍA: diseño experimental, cómo se validan
los resultados, si las métricas elegidas son suficientes y justas.

Tienes acceso completo al siguiente paper:

TÍTULO: ${paper.title}
AUTORES: ${paper.authors}

CONTENIDO DEL PAPER:
${paper.pdf_text || paper.abstract}
${buildSlidesBlock(slides)}`.trim()
  },

  {
    id: 2,
    name: 'Carlos Reyes',
    emoji: '🧑‍💻',
    color: '#10b981',
    systemPrompt: (paper, slides) => `
Eres Carlos Reyes, ingeniero curioso con foco en implementación.
Tu enfoque son las APLICACIONES PRÁCTICAS: cómo llevar esto a
producción, qué modificaciones necesita para escalar, en qué
sectores o problemas reales aplica directamente.

Tienes acceso completo al siguiente paper:

TÍTULO: ${paper.title}
AUTORES: ${paper.authors}

CONTENIDO DEL PAPER:
${paper.pdf_text || paper.abstract}
${buildSlidesBlock(slides)}`.trim()
  },

  {
    id: 3,
    name: 'Sofía Kim',
    emoji: '👩‍🔬',
    color: '#f59e0b',
    systemPrompt: (paper, slides) => `
Eres Sofía Kim, investigadora analítica y crítica constructiva.
Tu enfoque son las LIMITACIONES: qué asunciones hace el paper,
qué casos no resuelve, dónde falla el enfoque propuesto y qué
líneas de trabajo futuro serían necesarias.

Tienes acceso completo al siguiente paper:

TÍTULO: ${paper.title}
AUTORES: ${paper.authors}

CONTENIDO DEL PAPER:
${paper.pdf_text || paper.abstract}
${buildSlidesBlock(slides)}`.trim()
  }
]
```

### `generateTurn()` — unifica pregunta inicial y follow-ups

Una sola función para ambos casos. Si `context.history` está vacío es la pregunta inicial; si tiene exchanges previos genera un follow-up enfocado en lo que faltó.

```javascript
async function generateTurn(student, context, llm) {
  // context: {
  //   paper, slides,
  //   transcript,    ← transcripción del profesor
  //   previousQA,   ← turnos de OTROS estudiantes ya cerrados (para no solapar)
  //   history        ← exchanges de ESTE turno [{question, answer, reaction, missing}]
  // }

  const isFirstQuestion = context.history.length === 0

  const previousQAText = context.previousQA.length > 0
    ? `\nPreguntas ya hechas por otros estudiantes (no solapar):\n${
        context.previousQA.map(qa => `- ${qa.studentName}: ${qa.exchanges[0].question}`).join('\n')
      }`
    : ''

  const historyText = !isFirstQuestion
    ? `\nConversación previa en tu turno:\n${
        context.history.map((e, i) =>
          `[${i+1}] Tú: "${e.question}" / Profesor: "${e.answer}" / Faltó: "${e.missing}"`
        ).join('\n')
      }`
    : ''

  const instruction = isFirstQuestion
    ? 'Formula UNA pregunta desde tu perspectiva. Máximo 2 oraciones. Sin presentación, directo.'
    : `La respuesta anterior no fue suficiente — faltó aclarar: "${context.history.at(-1).missing}".
Pide una aclaración más simple: un ejemplo concreto, una analogía, o que lo explique de otra manera.
NO hagas la pregunta más difícil ni más técnica. Baja el nivel de abstracción para ayudar al profesor a articularlo.
Máximo 2 oraciones. Tono comprensivo, no interrogatorio.`

  const messages = [
    {
      role: 'system',
      content: student.systemPrompt(context.paper, context.slides)
    },
    {
      role: 'user',
      content: `El profesor explicó el paper. Transcripción:\n"${context.transcript}"${previousQAText}${historyText}\n\n${instruction}`
    }
  ]

  return llm.chat(messages)   // llm.chat() existente, sin cambios en proveedores
}
```

### `evaluateAndReact()` — el estudiante juzga y reacciona en una sola llamada

El mismo agente que preguntó evalúa. Recibe `exchangeCount` para volverse más comprensivo a medida que la conversación se extiende — si hay muchos exchanges, el umbral baja naturalmente.

```javascript
async function evaluateAndReact(student, context, llm) {
  // context: { paper, slides, question, professorAnswer, exchangeCount }
  // exchangeCount: cuántos exchanges van en este turno (0-indexed)

  const MAX_EXCHANGES = 4  // válvula oculta — el estudiante acepta después de esto

  // Si llegamos al límite, forzamos satisfied=true con una reacción natural
  if (context.exchangeCount >= MAX_EXCHANGES) {
    return {
      satisfied: true,
      reaction: 'Ok, creo que entiendo la idea general. Sigamos.',
      missing: null
    }
  }

  // El prompt se vuelve más comprensivo si ya hubo varios intercambios
  const leniencyNote = context.exchangeCount >= 2
    ? '\nSi el profesor dio alguna explicación parcial o aproximada, acéptala como suficiente.'
    : ''

  const messages = [
    {
      role: 'system',
      content: student.systemPrompt(context.paper, context.slides)
    },
    {
      role: 'user',
      content: `
Hiciste esta pregunta: "${context.question}"
El profesor respondió: "${context.professorAnswer}"
${leniencyNote}
Evalúa si la respuesta cubre el núcleo de tu pregunta.
Responde SOLO con JSON (sin markdown):
{
  "satisfied": true,
  "reaction": "1-2 oraciones, tono estudiante real",
  "missing": null
}

Si la respuesta fue vaga o no respondió tu punto:
{
  "satisfied": false,
  "reaction": "señalas comprensivamente qué te faltó entender (no acusatorio)",
  "missing": "el aspecto concreto que quedó sin aclarar"
}`.trim()
    }
  ]
  return parseJSONResponse(await llm.chat(messages))
}
```
```

### `evaluateClarity()` — evaluación final

```javascript
async function evaluateClarity(context, llm) {
  // context: { paper, transcript, qaLog: [{studentName, question, answer, reaction}] }
  const messages = [
    {
      role: 'system',
      content: `Eres un evaluador pedagógico experto. Tienes acceso al paper:
TÍTULO: ${context.paper.title}
CONTENIDO: ${context.paper.pdf_text || context.paper.abstract}`
    },
    {
      role: 'user',
      content: `
Evalúa la claridad de esta clase basándote en la explicación del profesor
y la calidad de sus respuestas al Q&A.

TRANSCRIPCIÓN DEL PROFESOR:
"${context.transcript}"

Q&A:
${context.qaLog.map(qa =>
  `[${qa.studentName}] ${qa.question}\n→ Profesor: ${qa.answer}`
).join('\n\n')}

Responde ÚNICAMENTE con JSON:
{"score": <número 1-10>, "feedback": "<2-3 oraciones de feedback constructivo>"}`.trim()
    }
  ]
  return parseJSONResponse(await llm.chat(messages))
}
```

### Sin cambios en los proveedores LLM

Los agentes usan directamente `llm.chat(messages)`, que ya existe en los tres proveedores (`anthropic.js`, `openai.js`, `deepseek.js`). No se agrega ningún método nuevo. La pregunta aparece de golpe en el chat cuando el LLM responde, igual que el quiz.

---

## Módulo `src/class/prompts.js` — Helpers de construcción de prompts

Solo contiene helpers puros de texto que `students.js` consume. No hay lógica de negocio aquí.

```javascript
// Bloque de slides para el system prompt — vacío si no hay interpretaciones
function buildSlidesBlock(slides) {
  const interpreted = (slides || []).filter(s => s.interpretation)
  if (interpreted.length === 0) return ''
  return `\nDIAPOSITIVAS DEL PROFESOR:\n${
    interpreted.map(s => `[${s.section.toUpperCase()}]: ${s.interpretation}`).join('\n')
  }`
}

// Instrucción para el user message según si es pregunta inicial o follow-up
function buildTurnInstruction(history) {
  if (history.length === 0) {
    return 'Formula UNA pregunta desde tu perspectiva. Máximo 2 oraciones. Sin presentación, directo.'
  }
  const missing = history.at(-1).missing
  return `La respuesta anterior no fue suficiente — faltó: "${missing}".
Pide una aclaración más simple: un ejemplo, una analogía, o una explicación más básica.
NO escales la dificultad. Tono comprensivo, no interrogatorio. Máximo 2 oraciones.`
}

// Historial del turno actual para el user message
function buildHistoryBlock(history) {
  if (history.length === 0) return ''
  return `\nConversación previa en tu turno:\n${
    history.map((e, i) =>
      `[${i+1}] Tú: "${e.question}" / Profesor: "${e.answer}" / Faltó: "${e.missing}"`
    ).join('\n')
  }`
}

// Preguntas de otros estudiantes para evitar solapamiento
function buildPreviousQABlock(previousQA) {
  if (previousQA.length === 0) return ''
  return `\nPreguntas ya hechas por otros estudiantes (no solapar):\n${
    previousQA.map(qa => `- ${qa.studentName}: ${qa.exchanges[0].question}`).join('\n')
  }`
}

module.exports = { buildSlidesBlock, buildTurnInstruction, buildHistoryBlock, buildPreviousQABlock }
```

---

## UI — Layout de la clase (renderer)

### Fase 1: Preparación (modal)

```
┌──────────────── Preparar Clase ─────────────────┐
│                                                  │
│  Paper: "Attention Is All You Need"             │
│                                                  │
│  Paso 1 — Sube tus diapositivas (2-3 fotos)    │
│                                                  │
│  ┌──────┐  ┌──────┐  ┌──────┐                  │
│  │ IMG  │  │ IMG  │  │  +   │                  │
│  │  1   │  │  2   │  │      │                  │
│  │[Intro│  │[Dev1]│  │Añadir│                  │
│  └──────┘  └──────┘  └──────┘                  │
│                                                  │
│  Secciones: [Intro▾] [Desarrollo 1▾] [+Agregar]│
│                                                  │
│  Paso 2 — Duración de presentación:             │
│  ○ 3 min   ● 4 min   ○ 5 min                   │
│                                                  │
│  [ Cancelar ]              [ Iniciar Clase → ]  │
└──────────────────────────────────────────────────┘
```

### Fase 2+3: Vista principal de clase

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLASE: "Attention Is All You Need"          ⏱ 03:42  [🔴 EN VIVO]    │
├──────────────────────────────────┬──────────────────────────────────────┤
│                                  │                                      │
│  ┌────────────────────────────┐  │  💬 Chat de la clase                │
│  │                            │  │  ─────────────────────────────────  │
│  │    📷 PROFESOR             │  │                                      │
│  │    (webcam en vivo)        │  │  [Fase Q&A — los mensajes           │
│  │                            │  │   van apareciendo aquí              │
│  └────────────────────────────┘  │   en tiempo real]                   │
│                                  │                                      │
│  ┌──────┐  ┌──────┐  ┌──────┐  │  👩‍🎓 María García                    │
│  │  👩‍🎓  │  │  🧑‍💻  │  │  👩‍🔬  │  │  ¿Cómo validan que el mecanismo    │
│  │María │  │Carlos│  │Sofía │  │  de atención generaliza más allá    │
│  │ ... │  │ ... │  │ ... │  │  de traducción?                      │
│  └──────┘  └──────┘  └──────┘  │                                      │
│  [🎙 Habla ahora]               │  📝 Yo (Profesor):                   │
│  "el mecanismo de atención..."  │  [ escribe o habla tu respuesta ]   │
│  (transcripción en vivo)        │  ──────────────────[ Enviar ↵ ]──   │
│                                  │                                      │
├──────────────────────────────────┴──────────────────────────────────────┤
│  🖼 DIAPOSITIVAS: [◀] [  Introducción — Slide 1/3  ] [▶]               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  [imagen subida por el usuario]                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Fase 3 FIN: Pantalla de cierre

```
┌─────────────────── Clase Completada ────────────────────┐
│                                                          │
│  ✓ Respondiste las 3 preguntas de tus estudiantes       │
│                                                          │
│  Puntuación de claridad:  8.2 / 10                      │
│  ████████░░                                             │
│                                                          │
│  Feedback del LLM:                                       │
│  "Tu explicación del mecanismo de self-attention fue    │
│  clara. Podrías haber profundizado más en por qué se    │
│  abandona la recurrencia..."                            │
│                                                          │
│  Q&A:                                                   │
│  👩‍🎓 María: ¿Cómo validan...?   → ✓ Respondida          │
│  🧑‍💻 Carlos: ¿Dónde aplica...?  → ✓ Respondida          │
│  👩‍🔬 Sofía:  ¿Qué limitaciones...? → ✓ Respondida       │
│                                                          │
│  [ Guardar en Vault ]    [ Ver Transcripción ]           │
└──────────────────────────────────────────────────────────┘
```

---

## Speech-to-Text — Implementación

Usar **Web Speech API** (nativa en Chromium/Electron), sin dependencia externa ni costo.

`SpeechTranscriber` opera en dos **modos distintos** con comportamientos diferentes al detectar silencio:

```javascript
// renderer/modules/class.js

// mode: 'presentation' | 'qa'
// - presentation: silencio → solo persiste el transcript, no dispara acción
// - qa:           silencio → el transcript se toma como respuesta lista para enviar
class SpeechTranscriber {
  constructor(lang = 'es-ES') {
    this.recognition = new webkitSpeechRecognition()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = lang
    this.fullTranscript = ''
    this.silenceTimer = null
    this.mode = 'presentation'
    this.onChunk = null
    this.onSilence = null
  }

  setMode(mode, { onChunk, onSilence } = {}) {
    this.mode = mode          // 'presentation' | 'qa'
    this.onChunk = onChunk    // (fullTranscript, interim) => void
    this.onSilence = onSilence  // () => void — solo relevante en modo 'qa'
    if (mode === 'presentation') this.fullTranscript = ''  // reset al iniciar clase
  }

  start() {
    this.recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript
        if (event.results[i].isFinal) this.fullTranscript += text + ' '
        else interim = text
      }
      this.onChunk?.(this.fullTranscript, interim)

      if (this.mode === 'qa') {
        clearTimeout(this.silenceTimer)
        // 5s de silencio en Q&A → profesor terminó de responder
        this.silenceTimer = setTimeout(() => this.onSilence?.(), 5000)
      }
    }
    this.recognition.start()
  }

  stop() {
    this.recognition.stop()
    clearTimeout(this.silenceTimer)
  }

  getTranscript() { return this.fullTranscript.trim() }
}
```

**Modo `presentation`** (timer corriendo):
- Acumula `fullTranscript` en memoria
- Cada 10s envía `class-save-transcript` al main para persistencia incremental
- El silence detection está desactivado — el profesor puede hacer pausas largas

**Modo `qa`** (timer en 0, turno de un estudiante):
- El mismo objeto, cambia de modo con `setMode('qa', { onChunk, onSilence })`
- 5s de silencio → `onSilence()` → el texto acumulado desde el último envío se toma como respuesta del profesor → se limpia el buffer parcial para la siguiente respuesta
- El input de texto del chat puede usarse en paralelo; si el profesor escribe manualmente, el STT se pausa

**Idioma:** se detecta del paper. Si `paper.pdf_text` contiene más texto en inglés que en español (heurística simple: presencia de "the", "is", "are" > 5%) → `lang = 'en-US'`, si no `'es-ES'`.

---

## Timer — Implementación

```javascript
// renderer/modules/class.js
class ClassTimer {
  constructor(durationSeconds, onTick, onExpire) {
    this.remaining = durationSeconds
    this.onTick = onTick
    this.onExpire = onExpire
    this.interval = null
  }

  start() {
    this.interval = setInterval(() => {
      this.remaining--
      this.onTick(this.remaining)
      if (this.remaining <= 0) {
        clearInterval(this.interval)
        this.onExpire()
      }
    }, 1000)
  }

  stop() { clearInterval(this.interval) }

  format() {
    const m = Math.floor(this.remaining / 60).toString().padStart(2, '0')
    const s = (this.remaining % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }
}
```

El timer se muestra en rojo cuando quedan ≤ 60 segundos. Al llegar a 0 se activa la transición a Q&A con animación.

---

## Orquestación del Q&A — máquina de estados

Cada turno de estudiante es un **loop de conversación** que termina cuando el estudiante queda satisfecho O el profesor elige pasar al siguiente. Sin número fijo de intentos.

```
PRESENTING ──timer=0──▶ QA_TURN_1
                             │
                    generateTurn(history=[])
                    pregunta aparece en chat
                             │
                        prof.answer
                             │
                    evaluateAndReact(exchangeCount=0)
                             │
          satisfied=true ────────────────────────────▶ QA_TURN_2 ──▶ ... ──▶ DONE
                             │
          satisfied=false
               reaction en chat ("me faltó entender X...")
                             │
                    generateTurn(history=[...])   ← aclaración más simple
                    ("¿podrías darme un ejemplo de...?")
                             │
                        prof.answer
                             │
                    evaluateAndReact(exchangeCount=1)
                    (umbral más comprensivo si exchangeCount≥2)
                             │
          satisfied=true ────────────────────────────▶ QA_TURN_2
                             │
          satisfied=false ──── (loop, máx 4 exchanges ocultos)
                             │
          exchangeCount≥4 → "Ok, entiendo la idea general. Sigamos." ──▶ QA_TURN_2
```

**El loop es natural:** cuando el estudiante no queda satisfecho, pide una aclaración más sencilla — un ejemplo, una analogía, una reformulación más básica. No escala la dificultad, baja el nivel de abstracción para ayudar al profesor a articular mejor. Es Socrático.

**No hay botón de escape:** el profesor tiene que seguir respondiendo. La única salida es que el estudiante quede satisfecho. Como válvula de seguridad oculta: si llegan a 4 exchanges sin satisfacción, el estudiante acepta con una frase como *"Ok, creo que entiendo la idea general, sigamos"* — natural, no un corte abrupto. Este límite no se muestra en la UI.

**Estados:** `PRESENTING | QA_TURN_{1,2,3} | DONE`  
No hay estados de retry — el follow-up es otra iteración del mismo estado `QA_TURN_N`. Sin botón "Siguiente →".

**`qa_log` por turno — historial completo de la conversación:**
```json
{
  "studentId": 1,
  "studentName": "María García",
  "satisfied": false,
  "forcedNext": true,
  "exchanges": [
    { "question": "¿Cómo validan...?",  "answer": "Usaron BLEU...", "reaction": "Eso cubre métricas pero...", "missing": "validación en datos fuera de distribución" },
    { "question": "¿Y en datos OOD...?", "answer": "No lo sé bien", "reaction": "Entiendo, es una limitación.", "missing": null }
  ]
}
```

Estado del loop guardado en `renderer/modules/class.js`. Cada llamado IPC recibe el historial acumulado del turno actual.

---

## Fases de implementación

### Fase A — Base de datos y prep (1-2 días)

1. Agregar tablas `class_sessions` y `class_slides` a `src/database.js`
2. Implementar `class-can-have-class` IPC: valida precondiciones del paper
3. Implementar `class-upload-slides` IPC: recibe array de base64, guarda en `PDFS_DIR/classes/{paperId}/slides/`, retorna rutas
4. Implementar `class-start-session` IPC: crea registro en `class_sessions`
5. Implementar `class-interpret-slides` IPC: llama `llm.interpretImage()` por slide, actualiza `class_slides.interpretation`; el renderer actualiza `#class-loading-status` slide a slide
6. UI prep: upload de fotos (habilita `btn-prep-start` al subir ≥1 foto) + selector de duración
7. UI loading: spinner + texto "Interpretando diapositiva N de M" mientras corren los llamados de visión
8. Tests: `tests/unit/ipc/class.test.js` (slides upload, session creation, interpret slides)

### Fase B — Vista de clase y timer (1-2 días)

1. Implementar layout de videollamada en `renderer/modules/class.js`
2. Integrar `getUserMedia` para webcam del profesor
3. Implementar `ClassTimer` con cronómetro visible
4. Mostrar diapositivas con navegación anterior/siguiente
5. Mostrar tiles de los 3 estudiantes (avatares estáticos con nombre y color)
6. Tests: `tests/unit/class/index.test.js` (timer logic, state machine)

### Fase C — Speech-to-Text (1 día)

1. Implementar `SpeechTranscriber` en el renderer
2. Mostrar transcripción en tiempo real debajo del tile del profesor
3. IPC `class-save-transcript`: envía chunks al main para persistencia incremental
4. Silencedetection con 3s timeout → dispara `onSilence` callback

### Fase D — Agentes estudiantes (2 días)

1. Implementar `src/class/prompts.js`: los 4 helpers puros (`buildSlidesBlock`, `buildTurnInstruction`, `buildHistoryBlock`, `buildPreviousQABlock`)
2. Implementar `src/class/students.js`: personas (`STUDENTS`), `generateTurn()`, `evaluateAndReact()`, `evaluateClarity()`
3. Implementar `src/class/index.js`: re-exporta todo + valida precondiciones de sesión
4. IPC `class-student-question`: genera turno (inicial o follow-up según historial); si el LLM falla → retorna `{ error: true, fallback: "No pude formular una pregunta. Continúa con el siguiente." }` y el renderer salta al siguiente estudiante
5. IPC `class-student-evaluate`: evalúa respuesta → `{satisfied, reaction, missing}`; si el LLM falla → retorna `{ satisfied: true, reaction: "Entendido.", missing: null }` para no bloquear el flujo
6. Tests: `tests/unit/class/students.test.js` (con LLM mockeado, incluyendo casos de error)

### Fase E — Q&A flow y cierre (1-2 días)

1. Implementar loop de conversación por turno en `renderer/modules/class.js`
2. Panel de chat estilo Teams: burbujas con avatar, nombre y color del estudiante
3. Input del profesor (texto libre + silence detection) — sin botón de escape
4. IPC `class-end-session`: genera `clarity_score` via LLM, guarda todo en DB
5. Pantalla de cierre con ✓/✗ por pregunta, score y feedback
6. Guardar transcripción + Q&A en vault (`src/vault.js`)
7. Tests: `tests/unit/ipc/class.test.js` (end session, clarity score)

### Fase F — Pulido UX (1 día)

1. Animaciones de typing indicator para los estudiantes (3 puntos parpadeando)
2. Highlight del estudiante activo (glow en su tile)
3. Indicador visual "🔴 EN VIVO" durante presentación / "💬 PREGUNTAS" durante Q&A
4. Manejo de errores: mic no disponible, cámara no disponible, LLM falla
5. Test E2E: `tests/e2e/class.spec.js`

---

## Integración con código existente

### `src/class/index.js` — qué contiene

Re-exporta todo lo de `students.js` y expone `canHaveClass(paper)`, la única función de negocio propia de este archivo. Los handlers IPC la llaman antes de crear una sesión.

```javascript
const { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity } = require('./students')

// Valida si un paper puede tener una clase
// Retorna { ok: true } o { ok: false, reason: string }
function canHaveClass(paper) {
  if (!paper) return { ok: false, reason: 'No hay paper seleccionado.' }
  if (paper.status !== 'ready') return { ok: false, reason: 'El paper aún no está listo (falta descargar o procesar).' }
  if (!paper.pdf_text && !paper.abstract) return { ok: false, reason: 'El paper no tiene contenido extraído.' }
  if (!paper.pdf_text && paper.abstract) {
    // Advertencia, no bloqueo: la clase puede continuar pero la calidad será menor
    return { ok: true, warning: 'Solo hay abstract disponible. Las preguntas serán más generales.' }
  }
  return { ok: true }
}

module.exports = { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, canHaveClass }
```

El renderer llama `canHaveClass` via IPC al clickear "Clase". Si `ok: false` muestra un toast con el `reason` en lugar de abrir `#class-fullscreen`. Si hay `warning` lo muestra como aviso no bloqueante en la pantalla de prep.

### `main.js` — agregar al objeto `deps`

```javascript
const { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, canHaveClass } = require('./src/class/index')

registerHandlers({
  // ...deps existentes...
  deps: {
    // ...
    classStudents: STUDENTS,
    generateTurn, evaluateAndReact, evaluateClarity, canHaveClass,
    classesDir: path.join(app.getPath('userData'), 'classes')
  }
})
```

### `preload.js` — nuevos canales

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ...existentes...
  classCanHaveClass:     (paperId)  => ipcRenderer.invoke('class-can-have-class', paperId),
  classUploadSlides:     (data)     => ipcRenderer.invoke('class-upload-slides', data),
  classInterpretSlides:  (data)     => ipcRenderer.invoke('class-interpret-slides', data),
  classStartSession:     (data)     => ipcRenderer.invoke('class-start-session', data),
  classGetSlides:        (sessionId)=> ipcRenderer.invoke('class-get-slides', sessionId),
  classSaveTranscript:   (data)     => ipcRenderer.invoke('class-save-transcript', data),
  classStudentQuestion:  (data)     => ipcRenderer.invoke('class-student-question', data),
  classStudentEvaluate:  (data)     => ipcRenderer.invoke('class-student-evaluate', data),
  classEndSession:       (data)     => ipcRenderer.invoke('class-end-session', data),
  classGetSessions:      (paperId)  => ipcRenderer.invoke('class-get-sessions', paperId),
})
```

### Patrón de pantalla completa — igual que `#onboarding`

El layout de la app tiene dos divs hermanos a nivel de `body`, ambos con clase `fullscreen`:

```
body
├── #onboarding.fullscreen          ← wizard inicial
├── #app.fullscreen.hidden          ← app principal (3 paneles)
└── #class-fullscreen.fullscreen.hidden   ← NUEVO: experiencia clase completa
```

Cuando el usuario clickea el tab "Clase":
- `#app` recibe `.hidden` → desaparece todo (sidebar, vault, tabs, content)
- `#class-fullscreen` pierde `.hidden` → ocupa toda la ventana con su propio layout

Al cerrar/terminar la clase:
- `#class-fullscreen` recibe `.hidden`
- `#app` pierde `.hidden` → vuelve al estado exacto donde estaba

**Transición prep → activa** (con loading intermedio):
```
"Iniciar clase →"
  → showView('loading')
  → class-start-session  (crea registro en DB)
  → por cada slide:
      class-interpret-slides  (llamado LLM visión)
      actualiza #class-loading-status: "Interpretando diapositiva N de M"
  → showView('active')  (timer empieza, webcam activa)
```

### `renderer/modules/constants.js` — `'clase'` NO va en TABS

`TABS` controla los tab-panels del `#content-panel`. Clase no es un panel — es una vista separada. No se agrega a `TABS`.

```javascript
// constants.js línea 79 — sin cambios
export const TABS = ['pdf', 'abstract', 'resumen', 'notas', 'quiz']
```

### `renderer/index.html` — tab button + `#class-fullscreen` como hermano de `#app`

```html
<!-- En tab-bar dentro de #app — agregar al final (el botón sí va aquí) -->
<button class="tab-btn" data-tab="clase">Clase</button>

<!-- ── #class-fullscreen: hermano de #app, mismo nivel que #onboarding ── -->
<!-- Va DESPUÉS del cierre de </div><!-- /#app --> en el HTML -->
<div id="class-fullscreen" class="fullscreen hidden">

  <!-- FASE 1: Preparación -->
  <div id="class-view-prep" class="class-view">
    <header class="class-topbar">
      <span class="class-back-btn" id="btn-class-back">← Volver</span>
      <h2 id="class-prep-paper-title" class="class-topbar-title"></h2>
    </header>
    <div class="class-prep-body">
      <p class="hint">Sube 2–3 fotos como diapositivas (Intro · Desarrollo · Conclusión)</p>
      <div id="prep-slides-grid" class="prep-slides-grid"></div>
      <label class="prep-add-btn">
        <input type="file" id="prep-slide-input" accept="image/*" multiple hidden>
        + Añadir foto
      </label>
      <div class="prep-duration-row">
        <span>Duración:</span>
        <label><input type="radio" name="duration" value="180"> 3 min</label>
        <label><input type="radio" name="duration" value="240" checked> 4 min</label>
        <label><input type="radio" name="duration" value="300"> 5 min</label>
      </div>
      <button id="btn-prep-start" class="btn-primary" disabled>Iniciar clase →</button>
    </div>
  </div>

  <!-- FASE 1.5: Cargando (interpretando slides con visión) -->
  <div id="class-view-loading" class="class-view hidden">
    <div class="class-loading-body">
      <div class="class-loading-spinner"></div>
      <p class="class-loading-title">Preparando tu clase…</p>
      <p id="class-loading-status" class="class-loading-status">Interpretando diapositiva 1 de 3</p>
    </div>
  </div>

  <!-- FASE 2+3: Clase activa -->
  <div id="class-view-active" class="class-view hidden">
    <div class="class-header">
      <span id="class-paper-label" class="class-paper-label"></span>
      <span id="class-timer" class="class-timer">04:00</span>
      <span id="class-phase-badge" class="class-phase-badge">EN VIVO</span>
    </div>
    <div class="class-body">
      <div class="class-left">
        <div class="class-video-grid">
          <div class="class-tile tile-professor">
            <video id="class-webcam" autoplay muted playsinline></video>
            <div id="class-transcript-live" class="class-transcript-live"></div>
            <span class="tile-name">Tú</span>
          </div>
          <div id="class-student-tiles"></div>
        </div>
        <div class="class-slides-area">
          <button id="btn-slide-prev" class="slide-nav">◀</button>
          <div id="class-slide-img" class="class-slide-img"></div>
          <button id="btn-slide-next" class="slide-nav">▶</button>
        </div>
      </div>
      <div class="class-right">
        <div class="class-chat-label">Chat</div>
        <div id="class-chat" class="class-chat"></div>
        <div id="class-answer-area" class="class-answer-area hidden">
          <input id="class-answer-input" type="text" placeholder="Escribe tu respuesta…">
          <button id="btn-answer-send">↵</button>
        </div>
      </div>
    </div>
  </div>

  <!-- FASE FIN: Resultados -->
  <div id="class-view-done" class="class-view hidden">
    <h2>Clase completada</h2>
    <div id="class-results-score"></div>
    <div id="class-results-feedback"></div>
    <div id="class-results-qa"></div>
    <button id="btn-class-save-vault" class="btn-primary">Guardar en vault</button>
    <button id="btn-class-close" class="btn-ghost">Cerrar</button>
  </div>

</div>
```

### `renderer/app.js` — manejar click en tab "Clase"

El tab "Clase" no pasa por `switchTab` — tiene su propio listener que llama a `enterClassMode`.

```javascript
import { enterClassMode, exitClassMode } from './modules/class.js'

// En el bloque de listeners de tab-bar:
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'clase') {
      enterClassMode(state.activePaper)   // oculta #app, muestra #class-fullscreen
    } else {
      switchTab(btn.dataset.tab)
    }
  })
})
```

### `renderer/modules/class.js` — `enterClassMode` y `exitClassMode`

```javascript
export function enterClassMode(paper) {
  document.getElementById('app').classList.add('hidden')
  document.getElementById('class-fullscreen').classList.remove('hidden')
  document.getElementById('class-prep-paper-title').textContent = paper.title
  showView('prep')
}

export function exitClassMode() {
  document.getElementById('class-fullscreen').classList.add('hidden')
  document.getElementById('app').classList.remove('hidden')
}

function showView(name) {  // 'prep' | 'loading' | 'active' | 'done'
  ['prep', 'loading', 'active', 'done'].forEach(v =>
    document.getElementById(`class-view-${v}`).classList.toggle('hidden', v !== name)
  )
}
```

`btn-class-back` y `btn-class-close` llaman a `exitClassMode()`. El botón "← Volver" solo aparece en la fase de prep — durante la clase activa no hay forma de salir (el profesor debe completar el Q&A).

### `src/ipc/index.js`

```javascript
const { registerClassHandlers } = require('./class')

function registerHandlers({ ipcMain, db, mainWindow, deps }) {
  // ...existentes...
  registerClassHandlers({ ipcMain, db, mainWindow, deps })
}
```

---

## Tests — plan TDD

### `tests/unit/class/students.test.js`

```
✓ generateTurn() con history=[] produce prompt de pregunta inicial
✓ generateTurn() con history=[...] produce prompt de aclaración más simple (no más difícil)
✓ generateTurn() incluye instrucción de bajar abstracción y pedir ejemplo/analogía
✓ generateTurn() incluye preguntas de otros estudiantes para no solapar
✓ generateTurn() incluye interpretaciones de slides si existen
✓ generateTurn() llama a llm.chat() (no a ningún método nuevo)
✓ evaluateAndReact() retorna { satisfied: true, reaction, missing: null } cuando OK
✓ evaluateAndReact() retorna { satisfied: false, reaction, missing: string } cuando incompleto
✓ evaluateAndReact() con exchangeCount≥4 retorna satisfied=true sin llamar al LLM
✓ evaluateAndReact() con exchangeCount≥2 incluye nota de leniency en el prompt
✓ evaluateAndReact() maneja JSON en markdown fences
✓ evaluateClarity() retorna { score, feedback } parseando JSON del LLM
✓ cada estudiante tiene systemPrompt distinto (foco diferente)
```

### `tests/unit/class/prompts.test.js`

```
✓ buildSlidesBlock() retorna string vacío si no hay interpretaciones
✓ buildSlidesBlock() formatea secciones con label de sección en mayúsculas
✓ systemPrompt de cada estudiante incluye pdf_text + slides block
✓ systemPrompt incluye instrucción de foco específica del estudiante
```

### `tests/unit/ipc/class.test.js`

```
✓ class-upload-slides guarda imágenes en disco y retorna rutas
✓ class-upload-slides rechaza archivos no-imagen
✓ class-interpret-slides llama a llm.interpretImage() por cada slide y guarda interpretation en DB
✓ class-interpret-slides omite slides ya interpretadas
✓ class-start-session crea registro en DB con status 'prep'
✓ class-start-session retorna el sessionId
✓ class-save-transcript actualiza transcript en DB
✓ class-can-have-class retorna ok=false si paper.status !== 'ready'
✓ class-can-have-class retorna ok=false si no hay pdf_text ni abstract
✓ class-can-have-class retorna ok=true con warning si solo hay abstract
✓ class-can-have-class retorna ok=true si hay pdf_text
✓ class-student-question llama a generateTurn() con el historial correcto y retorna string
✓ class-student-question retorna { error: true, fallback } si el LLM lanza excepción
✓ class-student-evaluate llama a evaluateAndReact() y retorna {satisfied, reaction, missing}
✓ class-student-evaluate retorna satisfied=true con reacción neutral si el LLM falla
✓ class-student-evaluate guarda el exchange en qa_log de la sesión
✓ class-end-session genera clarity_score y actualiza status a 'done'
✓ class-get-sessions retorna sesiones ordenadas por created_at
```

### `tests/e2e/class.spec.js`

```
✓ Botón "Iniciar Clase" visible en paper con status 'ready'
✓ Modal de preparación permite subir imagen y asignar sección
✓ Timer cuenta regresiva visible y llega a 0
✓ Transición a Q&A muestra chat con typing indicator
✓ Pregunta del estudiante aparece en el chat
✓ Input del profesor envía respuesta al presionar Enter
✓ Pantalla de cierre muestra score y Q&A summary
```

---

## Decisiones técnicas

| Decisión | Elección | Alternativa descartada | Por qué |
|---|---|---|---|
| Speech-to-text | Web Speech API (Chromium built-in) | Whisper vía backend | Sin costo, sin latencia de red, suficientemente preciso para uso interactivo |
| Cámara profesor | `getUserMedia` + `<video>` | Electron `desktopCapturer` | Más simple, suficiente para mostrar webcam |
| Avatares estudiantes | Emoji + nombre + color CSS | Imágenes generadas | Sin dependencias externas, funciona offline |
| Preguntas de estudiantes | `llm.chat()` sin streaming, aparecen de golpe | Streaming chunk a chunk | Más simple, sin método nuevo en proveedores; latencia aceptable para 1-2 oraciones |
| Persistencia transcripción | Incremental cada 10s vía IPC | Solo al final | Evita pérdida si la app crashea durante la clase |
| Evaluación final | Un solo llamado LLM al cerrar sesión | Evaluación por respuesta | Más eficiente, tiene contexto completo de la sesión |

---

## Estructura final de archivos

```
learning/
├── src/
│   ├── class/
│   │   ├── index.js           ← nuevo
│   │   ├── students.js        ← nuevo
│   │   └── prompts.js         ← nuevo
│   ├── database.js            ← modificado (tablas class_sessions, class_slides)
│   └── ipc/
│       ├── class.js           ← nuevo
│       └── index.js           ← modificado (registra class handlers)
├── renderer/
│   ├── index.html             ← modificado (sección #class-view)
│   ├── app.js                 ← modificado (botón Iniciar Clase)
│   └── modules/
│       └── class.js           ← nuevo (timer, webcam, slides, chat UI)
├── preload.js                 ← modificado (expone canales de clase)
├── main.js                    ← modificado (inyecta deps de clase)
└── tests/
    ├── unit/
    │   ├── class/
    │   │   ├── index.test.js  ← nuevo
    │   │   ├── students.test.js ← nuevo
    │   │   └── prompts.test.js  ← nuevo
    │   └── ipc/
    │       └── class.test.js  ← nuevo
    └── e2e/
        └── class.spec.js      ← nuevo
```

---

## Estimación total

| Fase | Días |
|---|---|
| A — Base de datos + prep UI | 1-2 |
| B — Layout + timer + webcam | 1-2 |
| C — Speech-to-text | 1 |
| D — Agentes estudiantes | 2 |
| E — Q&A flow + cierre | 1-2 |
| F — Pulido UX + E2E | 1 |
| **Total** | **7–10 días** |
