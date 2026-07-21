# PRD: Rediseño de Settings (layout tipo Obsidian + idioma + Embedding/STT)

## 1. Resumen del producto

### 1.1 Título del documento y versión

- PRD: Rediseño de Settings (layout tipo Obsidian + idioma + Embedding/STT)
- Versión: 1.0

### 1.2 Resumen del producto

Hoy Settings (`renderer/index.html:719-858`) es un único drawer de pantalla completa con todas las secciones apiladas verticalmente en orden arbitrario (Proveedor de IA, Programación, Categorías ArXiv, Universidades, Centros de investigación, Autores, Palabras clave, Transcripción de voz, Papers de referencia, Modelo para Class Mode), sin jerarquía ni forma de saltar directo a una sección. Tampoco existe hoy un setting de idioma, ni una UI dedicada para elegir proveedor/modelo de Embeddings (el código soporta `embeddingProvider`/`embeddingModel` según `CLAUDE.md`, pero no hay campos en el formulario para configurarlos).

Esta feature rediseña Settings con el layout de referencia (`imgs/setting.png`, inspirado en Obsidian): una ventana modal centrada con una lista de categorías a la izquierda y el panel de opciones de la categoría activa a la derecha. Todo el contenido que existe hoy se reorganiza en esas categorías (nada se elimina), y se agregan tres piezas nuevas: (1) **General**, con el control de idioma (selector Español/English que persiste la preferencia) y la versión de la app; (2) **Embedding**, con selector de proveedor, modelo y API key propios; (3) **Speech to Text**, ampliando la sección actual de transcripción con selector explícito de modelo por proveedor.

El *mecanismo* de traducción en sí — cómo se traduce toda la interfaz y el contenido generado por IA cuando se cambia el idioma — es un esfuerzo grande y transversal a casi todo el codebase, por lo que se documenta como un PRD separado: **`features/i18n.md`**. Este PRD solo agrega el control de idioma en Settings y persiste el valor; `i18n.md` es quien lo consume.

## 2. Objetivos

### 2.1 Objetivos de negocio

- Que Settings escale sin volverse una lista interminable a medida que se agreguen más categorías (ya hay dos PRDs en camino — `cost-tracking.md` y `learning-dashboard.md` — que no tocan Settings pero confirman que la app sigue creciendo).

### 2.2 Objetivos del usuario

- Encontrar cualquier configuración en segundos, navegando por categoría en vez de hacer scroll por un formulario largo.
- Elegir su idioma preferido desde un solo lugar (el efecto completo de esa elección lo cubre `features/i18n.md`).
- Configurar Embeddings y Speech-to-Text con el mismo nivel de control (proveedor + modelo + API key) que ya existe para el LLM principal.

### 2.3 No-objetivos (fuera de alcance v1)

- Agregar nuevos proveedores de embeddings o transcripción — se rediseña la UI de configuración, no se amplía la lista de proveedores soportados por `src/embeddings/index.js` o `src/transcription/index.js` más allá de lo que ya existe.
- Auto-guardado por campo (estilo Obsidian, donde cada toggle aplica al instante) — se mantiene el patrón actual de un botón "Guardar" explícito que persiste todos los campos modificados, para no reescribir el flujo de IPC `save-settings` existente.
- Sincronización de settings entre dispositivos o cuentas — sigue siendo 100% local en SQLite.
- Más idiomas que español e inglés en v1.

## 3. Personas de usuario

### 3.1 Tipos de usuario clave

- Usuario único de la app (uso personal de escritorio, sin multiusuario).

### 3.2 Detalle de persona

- **Investigador/estudiante independiente**: configura sus API keys una vez y después ajusta proveedores/modelos ocasionalmente al probar nuevas opciones; a veces prefiere trabajar en inglés porque lee papers en inglés todo el día.

### 3.3 Acceso por rol

- No aplica — la app no tiene roles ni multiusuario.

## 4. Requerimientos funcionales

- **Layout modal con sidebar de categorías** (Prioridad: Alta)

  - Settings se muestra como una ventana modal centrada (no fullscreen) con dos columnas: lista de categorías a la izquierda, panel de la categoría activa a la derecha, y un botón de cerrar (✕) en la esquina superior derecha del modal — igual que `imgs/setting.png`.
  - Las categorías del sidebar son: **General**, **LLM**, **Embedding**, **Speech to Text**, **Ingesta** (programación + filtros de ArXiv), **Papers de referencia**.
  - No hay categoría separada para Clase: los agentes del modo Clase (pistas, evaluaciones, Q&A) son el mismo LLM configurado en la categoría "LLM" — un solo proveedor/modelo/API key para toda la app, sin una segunda configuración paralela que mantener.
  - Todo el contenido que existe hoy en el drawer se reubica en una de esas categorías; ningún campo se pierde en la migración.
  - Al hacer clic en una categoría, el panel derecho cambia sin recargar el modal ni perder los valores ya editados en otras categorías (el estado del formulario completo se mantiene en memoria hasta guardar o cerrar).

- **General — idioma** (Prioridad: Alta)

  - Selector de idioma con dos opciones: Español / English, guardado como el setting `language` (default `"es"`).
  - Este PRD solo agrega el control y lo persiste al guardar — el efecto de ese valor sobre la interfaz y el contenido generado por IA se implementa en `features/i18n.md`, que consume este mismo setting.

- **General — versión** (Prioridad: Media)

  - Se muestra la versión actual de la app (tomada de `package.json` vía `app.getVersion()` en el proceso main, expuesta por IPC), como texto de solo lectura.

- **LLM** (Prioridad: Alta)

  - Selector de proveedor (OpenAI / Anthropic / DeepSeek), selector de modelo dependiente del proveedor elegido, campo de API key — mismo contenido que existe hoy en "Proveedor de IA", solo reubicado bajo la categoría "LLM".
  - Este proveedor/modelo sigue siendo el que usan `streamSummary`, `generateQuiz`, `chat`, `extractAffiliationsWithAI` y `extractPaperMetadata` vía `createLLM(settings)` — sin cambios de comportamiento, solo de ubicación en la UI.

- **Embedding** (Prioridad: Alta)

  - Nueva categoría con selector de proveedor (hoy solo OpenAI está implementado en `src/embeddings/index.js`, pero el selector se construye ya pensado para más opciones futuras), selector de modelo (ej. `text-embedding-3-small`, `text-embedding-3-large`) y campo de API key.
  - Si el usuario no configura una API key propia para Embeddings, se sigue usando `openaiApiKey` o `apiKey` como fallback, igual que hoy en `createEmbeddings(settings)`.
  - Este proveedor/modelo es el que usan `indexReferenceFolder()` y `scoreAbstractAgainst()` para el filtro de similitud semántica.

- **Speech to Text** (Prioridad: Alta)

  - La sección actual de "Transcripción de voz" se reubica bajo "Speech to Text" y se le agrega un selector de **modelo** dependiente del proveedor elegido (ej. Groq: `whisper-large-v3-turbo`; OpenAI: `gpt-4o-mini-transcribe`, `whisper-1`), en vez de un modelo fijo por proveedor como hoy.
  - Se mantiene el campo de API key por proveedor pagado (Groq, OpenAI) y la opción de proveedor local/gratis (`whisper.cpp`).
  - Se elimina la opción "Web Speech API": al ser transcripción nativa del navegador (Chromium) sin pasar por ninguna llamada medible de nuestro lado, queda fuera del set de proveedores conocidos/trackeables — los únicos proveedores de Speech to Text pasan a ser Groq, OpenAI y Whisper local, los mismos tres que reconoce `features/cost-tracking.md`.

- **Ingesta** (Prioridad: Media)

  - Agrupa Programación (día/hora/máx. papers), Categorías ArXiv, Universidades, Centros de investigación, Autores, Palabras clave y el campo de Semantic Scholar API key — todo lo que hoy está disperso en el drawer, sin cambios de comportamiento.

- **Papers de referencia** (Prioridad: Media)

  - Reubica sin cambios el contenido actual: carpeta, umbral de similitud, estadísticas de indexado, botón "Re-indexar".

- **Consolidación de Clase en LLM** (Prioridad: Media)

  - Se elimina la sección/categoría separada "Modelo para Class Mode". El modo Clase deja de tener su propio proveedor/modelo/API key y usa siempre lo configurado en la categoría "LLM".
  - `createClassLLM()` (`src/ipc/class.js:8-16`) deja de tener override de proveedor/modelo/API key propio de Clase — llama a `createLLM(settings)` directo, igual que el resto de la app.

- **Guardado** (Prioridad: Alta)

  - Un único botón "Guardar" (visible en todo momento, no solo en la categoría activa) persiste todos los cambios hechos en cualquier categoría del modal en una sola llamada a `save-settings`, igual que el comportamiento actual.

## 5. Experiencia de usuario

### 5.1 Entry points y primer uso

- El usuario abre Settings desde el botón `act-settings` de la barra de actividad, igual que hoy; lo que cambia es lo que ve adentro.
- La categoría "General" es la que se muestra por defecto al abrir el modal, mostrando primero el idioma (configuración más visible/impactante) y la versión.

### 5.2 Experiencia principal

- **Navegar por categoría**: el usuario hace clic en "Embedding" en el sidebar y ve solo los campos de esa categoría, sin tener que hacer scroll pasando por Categorías ArXiv o Autores para llegar ahí.

  - Reduce la carga cognitiva de un formulario largo a un formulario corto por categoría.

- **Configurar Speech to Text**: el usuario elige "Groq" como proveedor, ve aparecer el selector de modelo con las opciones válidas para Groq, y pega su API key.

  - El modelo disponible siempre corresponde al proveedor elegido — no se pueden combinar proveedor y modelo incompatibles.

### 5.3 Casos avanzados y edge cases

- Usuario cambia de categoría sin guardar → los valores editados en la categoría anterior no se pierden al volver a ella (se mantienen en el estado del formulario hasta "Guardar" o hasta cerrar el modal sin guardar, que sí descarta los cambios).
- Usuario cierra el modal (✕) con cambios sin guardar → se descartan, igual que el comportamiento esperado de un modal estándar (no se agrega confirmación de "¿salir sin guardar?" en v1).
- Cambia el idioma pero no hace clic en "Guardar" → el setting `language` no cambia hasta guardar, consistente con el resto de los campos del formulario (el efecto de aplicar ese idioma es responsabilidad de `features/i18n.md`).
- Provider de Embedding o STT sin modelos conocidos (por error de configuración) → el selector de modelo muestra un único valor por defecto documentado en el proveedor, nunca queda vacío.
- Ningún campo de API key nuevo (Embedding) se pre-rellena con la key del proveedor LLM principal aunque compartan el mismo proveedor (ej. ambos OpenAI) — son campos independientes, para permitir usar cuentas/API keys distintas por servicio.
- Usuario que tenía `transcriptionProvider: "webspeech"` guardado de antes → al abrir Settings después de la actualización, Speech to Text no puede mostrar esa opción (ya no existe); cae al primer proveedor disponible (Groq) sin API key precargada, y se le pide reconfigurar antes de volver a usar transcripción.

### 5.4 UI/UX destacados

- Modal centrado de ancho fijo (~960-1040px) y alto máximo con scroll interno solo en el panel derecho, igual que la referencia de `imgs/setting.png` — el sidebar de categorías no hace scroll independiente salvo que la lista de categorías crezca mucho más en el futuro.
- Ícono simple junto a cada nombre de categoría en el sidebar, consistente con el estilo de íconos ya usado en la barra de actividad.
- Categoría activa resaltada visualmente en el sidebar (mismo tratamiento que "Backlog" resaltado en la referencia).

## 6. Narrativa

El usuario abre Settings para revisar su configuración después de un tiempo sin tocarla. En vez del formulario largo de siempre, ve un sidebar limpio: General, LLM, Embedding, Speech to Text, Ingesta, Papers de referencia. Entra directo a "Speech to Text", cambia de Groq a OpenAI porque quiere probar `gpt-4o-mini-transcribe`, y el selector de modelo se actualiza solo con las opciones correctas. De paso, entra a General y cambia el idioma a inglés porque esa semana está leyendo todo en inglés — guarda, y el resto de la app (cubierto por `features/i18n.md`) responde a ese cambio.

## 7. Métricas de éxito

### 7.1 Métricas centradas en el usuario

- El usuario encuentra cualquier configuración específica en menos de 3 clics desde que abre Settings.

### 7.2 Métricas de negocio

- Ninguna configuración existente se pierde ni se rompe durante la migración al nuevo layout (paridad funcional 100% con el drawer actual).

### 7.3 Métricas técnicas

- Los settings existentes (`apiKey`, `llmProvider`, `llmModel`, `embeddingProvider`, `embeddingModel`, `categoryList`, `authorList`, `universityList`, `researchCenterList`, etc.) mantienen las mismas claves en la tabla `settings` — la migración es solo de UI, no de esquema de datos para lo que ya existía.
- Nuevas claves (`language`, `embeddingApiKey`, `sttModel`, etc.) siguen el mismo patrón key-value de la tabla `settings`.

## 8. Consideraciones técnicas

### 8.1 Puntos de integración

- Reestructuración de `renderer/index.html:719-858`: el `.settings-drawer` fullscreen se reemplaza por un modal centrado con `.settings-sidebar` (lista de categorías) y `.settings-content` (panel de la categoría activa); las secciones existentes se mueven de contenedor sin cambiar sus `id`s de input para no romper `renderer/app.js`.
- Nuevo handler IPC `get-app-version` (o exponer `app.getVersion()` vía `deps` a `src/ipc/settings.js`) para mostrar la versión en General sin que el renderer necesite acceso directo a Electron.
- El selector de idioma en General solo escribe/lee el setting `language` (`"es"` | `"en"`) igual que cualquier otro campo del formulario — no dispara ninguna lógica de traducción por sí mismo; eso lo consume `features/i18n.md`.
- `src/embeddings/index.js` ya soporta `embeddingProvider`/`embeddingModel`/`openaiApiKey` — la nueva categoría "Embedding" solo necesita exponer esos campos en la UI, sin tocar la lógica del proveedor.
- `src/transcription/index.js` ya soporta `options.model` — la nueva categoría "Speech to Text" agrega el selector de modelo que hoy no existe en la UI, mapeado a los modelos válidos por proveedor definidos en `PROVIDERS` de ese módulo.

### 8.2 Almacenamiento de datos y privacidad

- Nuevos settings: `language` (default `"es"`, consumido por `features/i18n.md`), `embeddingApiKey` (opcional, fallback a `openaiApiKey`/`apiKey`), `sttModel` (default según proveedor de transcripción elegido).
- Todo sigue guardado localmente en la tabla `settings` de SQLite, sin cambios de privacidad respecto al modelo actual.

### 8.3 Escalabilidad y desempeño

- El sidebar de categorías está pensado para crecer (futuras categorías de `cost-tracking.md` si algún día necesitaran su propio settings, por ejemplo) sin rediseñar el layout de nuevo.

### 8.4 Posibles desafíos

- Al consolidar Clase en LLM se pierde el comportamiento actual de usar DeepSeek por defecto para Clase específicamente por ser más rápido/barato en los intercambios frecuentes de pistas y Q&A (ver comentario original en `CLAUDE.md`, sección "Modelo para Class Mode"). Es un trade-off intencional de esta feature a cambio de una sola configuración de LLM más simple; si el costo de Clase con el modelo principal resulta un problema, se puede reintroducir como un override opcional dentro de la propia categoría LLM en una iteración futura, en vez de una categoría separada.
- Todo lo relacionado a cobertura de traducción, notificaciones del proceso main, parametrización de `src/llm/prompts.js` y el idioma del wizard de onboarding se documenta y resuelve en `features/i18n.md`, no en este PRD.

## 9. Hitos y secuenciación

### 9.1 Estimación del proyecto

- Chico-mediano: 5-7 días de desarrollo. El rediseño del layout y la migración de contenido existente son directos; el control de idioma en General es solo un campo más del formulario (el esfuerzo grande de la traducción en sí vive en `features/i18n.md`, con su propia estimación).

### 9.2 Tamaño y composición del equipo

- 1 desarrollador full-stack (Electron/Node + frontend vanilla JS), siguiendo TDD como el resto del proyecto.

### 9.3 Fases sugeridas

- **Fase 1**: Layout modal + migración de contenido existente sin cambios funcionales (3-4 días)

  - Sidebar de categorías, panel derecho, reubicación 1:1 de las secciones actuales (LLM, Ingesta, Papers de referencia), tests de que ningún setting existente se pierde.
  - Consolidación de Clase en LLM: `createClassLLM()` pasa a llamar `createLLM(settings)` sin override, tests de que el modo Clase sigue funcionando con el proveedor/modelo principal.

- **Fase 2**: Categorías nuevas — Embedding y Speech to Text con modelo, más el control de idioma y versión en General (2-3 días)

  - UI de Embedding (provider/modelo/API key), selector de modelo dependiente de proveedor en Speech to Text, selector de idioma (solo persiste `language`, sin lógica de traducción), IPC de versión, tests de guardado de las nuevas claves.

`features/i18n.md` tiene sus propias fases para el mecanismo de traducción, una vez que el setting `language` ya existe en Settings.

## 10. Historias de usuario

### 10.1. Navegar Settings por categorías

- **ID**: SET-001
- **Descripción**: Como usuario, quiero ver Settings organizado en categorías con un sidebar, para encontrar cualquier configuración sin hacer scroll por un formulario largo.
- **Criterios de aceptación**:

  - Settings se abre como modal centrado con sidebar de categorías a la izquierda y panel de opciones a la derecha.
  - Las categorías disponibles son General, LLM, Embedding, Speech to Text, Ingesta y Papers de referencia.
  - Hacer clic en una categoría muestra solo los campos de esa categoría en el panel derecho.

### 10.2. Elegir el idioma de la app

- **ID**: SET-002
- **Descripción**: Como usuario, quiero elegir entre Español e Inglés en General, para guardar mi preferencia de idioma.
- **Criterios de aceptación**:

  - General tiene un selector con las opciones Español / English.
  - Al guardar, el valor persiste en el setting `language` entre reinicios de la app.
  - El efecto de ese valor sobre la interfaz y el contenido generado por IA está fuera del alcance de este PRD — ver `features/i18n.md`.

### 10.3. Ver la versión de la app

- **ID**: SET-003
- **Descripción**: Como usuario, quiero ver qué versión de la app tengo instalada, para reportar problemas o confirmar que estoy en la última versión.
- **Criterios de aceptación**:

  - General muestra la versión actual como texto de solo lectura.
  - El valor coincide con el campo `version` de `package.json` empaquetado.

### 10.4. Configurar el proveedor y modelo de Embeddings

- **ID**: SET-004
- **Descripción**: Como usuario, quiero elegir proveedor, modelo y API key para Embeddings, para controlar qué motor de similitud semántica usa el filtro de referencia.
- **Criterios de aceptación**:

  - Embedding tiene selector de proveedor, selector de modelo dependiente del proveedor, y campo de API key.
  - Si el campo de API key queda vacío, se usa `openaiApiKey`/`apiKey` como fallback, igual que el comportamiento actual del código.
  - El proveedor/modelo elegido se usa en la siguiente indexación o scoring de similitud sin necesidad de reiniciar la app.

### 10.5. Configurar proveedor y modelo de Speech to Text

- **ID**: SET-005
- **Descripción**: Como usuario, quiero elegir proveedor y modelo específico de transcripción, para ajustar el balance de precisión/velocidad/costo de mis clases.
- **Criterios de aceptación**:

  - Speech to Text tiene selector de proveedor (Groq, OpenAI, Whisper local) y, para los proveedores que lo soportan, un selector de modelo dependiente del proveedor.
  - Cambiar de proveedor actualiza automáticamente las opciones de modelo disponibles, sin dejar seleccionado un modelo incompatible.
  - El campo de API key correspondiente solo se muestra para proveedores que lo requieren (no aplica a Whisper local).

### 10.6. Migrar toda la configuración existente sin pérdida

- **ID**: SET-006
- **Descripción**: Como usuario que ya configuró la app, quiero que todos mis settings actuales sigan funcionando igual después del rediseño (salvo la consolidación intencional de Clase en LLM), para no tener que reconfigurar nada.
- **Criterios de aceptación**:

  - Todos los campos que existen hoy en el drawer (LLM, Programación, Categorías ArXiv, Universidades, Centros de investigación, Autores, Palabras clave, Transcripción, Papers de referencia) siguen presentes en alguna categoría del nuevo sidebar.
  - Los valores guardados previamente en la tabla `settings` se muestran correctamente en sus nuevos campos al abrir Settings por primera vez después de la actualización.
  - Si un usuario tenía `classLlmProvider`/`classLlmModel`/`classApiKey` configurados (override de Clase a un proveedor distinto, ej. DeepSeek), esos valores quedan en la tabla `settings` sin usarse — el modo Clase pasa a usar `llmProvider`/`llmModel`/`apiKey` de la categoría LLM. No se requiere borrar esas claves huérfanas, solo dejar de leerlas.
  - Ningún handler IPC existente (`save-settings`, `get-settings`) cambia su contrato.
