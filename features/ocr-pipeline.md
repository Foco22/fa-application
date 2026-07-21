# PRD: Transcripción OCR fiel del PDF a Markdown (fuente única de texto para todo el resto de la app)

## 1. Resumen del producto

### 1.1 Título del documento y versión

- PRD: Transcripción OCR fiel del PDF a Markdown
- Versión: 1.1 — separa explícitamente el OCR del pipeline de ingesta (ver Narrativa/§4/§8 para el motivo del cambio de v1.0)

### 1.2 Resumen del producto

Hoy el texto de un paper viene de `extractText()` (`src/ingestion/extractor.js:4-16`), que es una extracción cruda con `pdf-parse`: sin estructura, sin fórmulas, con el orden de columnas roto en papers a dos columnas, y truncada arbitrariamente a `MAX_CHARS = 30000` caracteres (`src/ingestion/extractor.js:2`) — en un paper largo, todo lo que queda después del corte simplemente no existe para el resto de la app. Ese único campo, `papers.pdf_text`, es la fuente de contexto de **todo** lo que el usuario consume después de la ingesta:

- Resumen y quiz — `src/llm/prompts.js:20,67`
- Chat con el paper — `src/chat/prompts.js:19`
- Modo Clase: elegibilidad de sesión, pistas y evaluación — `src/class/index.js:7-8`, `src/class/hints.js:111`, `src/class/prompts.js:36`

Si `pdf-parse` extrae mal una tabla, una fórmula o corta el paper a la mitad, ese error se propaga silenciosamente a todo lo anterior sin que el usuario tenga forma de saberlo. Esta feature agrega una **transcripción página por página vía el LLM con capacidad de visión que la app ya integra** (`llm.interpretImage()` en `src/llm/providers/anthropic.js:96` y `openai.js:121`), guardada como un Markdown legible y completo en una carpeta nueva `ocr/` del vault (junto a `raw/`, `assets/`, `slides/` — ver `src/vault.js:78-81`), que reemplaza a `pdf-parse` como fuente de `pdf_text` para ese paper cuando el usuario decide generarla.

**Punto central de diseño: el OCR nunca es parte de la ingesta.** `runFetch()` (fetch semanal desde ArXiv) e `index-files`/`indexReferenceFolder` (indexado de la colección de referencia) siguen funcionando exactamente igual que hoy — deciden qué PDFs descargar y guardar usando el abstract y una extracción de texto liviana, sin ningún llamado de visión de por medio. El OCR es una acción **explícita y posterior** que el usuario dispara sobre un paper que **ya existe** — ya se descargó, ya pasó los filtros, y ya tiene su fila en `papers` y su carpeta en el vault (semana de ingesta o `reference/`). Nunca corre sobre un candidato que todavía se está evaluando para decidir si se guarda o se descarta.

La premisa del usuario es explícita: **no confía en el pipeline de extracción actual** y prefiere pagar el costo (en tiempo y en llamadas a la API) de una transcripción fiel, exhaustiva y sin inventar contenido — pero solo para los papers que le importan lo suficiente como para pedirla, no como un costo oculto de correr el fetch semanal.

## 2. Objetivos

### 2.1 Objetivos de negocio

- Eliminar la principal fuente de desconfianza reportada sobre la calidad del contenido generado por IA: que esté basado en texto mal extraído, no en el paper real.
- Que el costo de este paso quede visible en el dashboard de costos existente (`usage_events`, `action_type`), y que además sea **previsible**: solo aparece cuando el usuario pide OCR para un paper puntual, nunca como parte del costo fijo de un fetch semanal — ver `features/cost-tracking.md`.

### 2.2 Objetivos del usuario

- Confiar en que el resumen, el quiz, el chat y las sesiones de Clase reflejan el paper completo — tablas, fórmulas y figuras incluidas — no solo lo que `pdf-parse` pudo extraer en los primeros 30.000 caracteres, **para los papers que elige transcribir**.
- Poder revisar (y, si hace falta, corregir a mano) el texto que la app usa como contexto, en vez de que sea una caja negra.
- Que un PDF escaneado (imagen pura, sin capa de texto) deje de producir un paper vacío o inutilizable — hoy `pdf-parse` no tiene nada que extraer ahí; una transcripción por visión sí puede leerlo.
- Que el fetch semanal y el indexado de referencia **no se vuelvan más lentos ni más caros** por esta feature — siguen corriendo igual de rápido que hoy.

### 2.3 No-objetivos (fuera de alcance v1)

- **El OCR no toca el pipeline de selección/filtrado de candidatos.** `selectCandidates()` (`src/ipc/papers.js:27-114`) sigue decidiendo qué papers sobreviven usando solo el abstract (embeddings + keywords + rerank), exactamente igual que hoy. Un candidato descartado por similitud, por `orgFilter`, o por quedar fuera del cupo de `maxPapers` **nunca** llega a tener una imagen rasterizada ni un llamado de visión — el OCR ni se plantea para algo que todavía no se decidió guardar.
- **El fetch (`runFetch`) y el indexado de referencia (`index-files`, `indexReferenceFolder`) no cambian de comportamiento.** Siguen usando `extractText()` (`pdf-parse`) para `pdf_text` en el momento de guardar el paper, tal cual hoy. El OCR se ejecuta **después**, como una acción separada, nunca dentro de esas funciones.
- **La *señal de embedding* para el filtro de similitud sigue viniendo del snippet/abstract, no del OCR** — `scoreAbstractAgainst`/`indexReferenceFolder`/`indexFiles` (`src/embeddings/index.js:35-96`) generan el vector a partir de la primera página o el abstract, igual que hoy; no tiene sentido esperar a un OCR completo (que ni siquiera corre en ese momento) para calcular un embedding barato.
- **No reemplaza el visor de PDF** (pestaña "File", `renderer/modules/pdf.js`) — el usuario sigue viendo el PDF original ahí; el Markdown de `ocr/` es solo la fuente de contexto para IA, no un reemplazo del documento.
- **No es OCR de documentos escritos a mano ni de fotos** — el universo son PDFs de ArXiv, que son texto digital o, en el peor caso, imágenes de páginas de un paper (no manuscritos).
- **No hay ejecución automática de OCR en ningún momento** — ni para papers nuevos recién ingeridos, ni para papers viejos, ni como reintento automático. Siempre es una acción explícita del usuario, botón por botón, paper por paper.

## 3. Personas de usuario

### 3.1 Tipos de usuario clave

- Usuario único de la app (uso personal de escritorio, sin multiusuario).

### 3.2 Detalle de persona

- **Investigador/estudiante independiente**: ya desconfía de lo que devuelve `pdf-parse` en papers con tablas, ecuaciones o layout a dos columnas. No quiere pagar por transcribir los 3 papers de cada fetch semanal automáticamente — solo los pocos que realmente va a leer a fondo — así que prefiere decidir caso por caso cuándo vale la pena el costo/tiempo de una transcripción fiel.

### 3.3 Acceso por rol

- No aplica — la app no tiene roles ni multiusuario.

## 4. Requerimientos funcionales

- **Carpeta `ocr/` en el vault** (Prioridad: Alta)

  - `vault.ensureDirs()` (`src/vault.js:76-82`) crea también `ocr/` junto a `raw/`, `assets/`, `slides/` — vacía hasta que el usuario pida OCR para ese paper, igual que `assets/` puede existir sin `summary.md` hasta que se genera el resumen.
  - Nueva función `vault.ocrPath(paper)` → `<paperDir>/ocr/<id>.md`, y `vault.writeOcr(paper, markdown)`, siguiendo el mismo patrón que `writeSummary`/`writeQuiz` (`src/vault.js:88-98`).
  - El archivo es Markdown plano, legible y editable por el usuario en cualquier editor — el vault ya vive en disco (`~/Documents/PaperLearning/vault`), no hay nada propietario en el formato.
  - **Aplica también a los papers de la colección de referencia** (carpeta `reference/` del vault — `vault.paperDir()` los distingue por el prefijo `ref-` en `src/vault.js:67-74`, pero usan el mismo `ensureDirs()`). Un paper de referencia es, ante todo, un paper: el usuario puede abrirlo, chatear con él o pedirle un resumen igual que a uno ingerido por fetch, así que puede pedirle la misma transcripción fiel — no es un PDF de segunda clase solo porque entró por la puerta de indexado de similitud.

- **Rasterización del PDF a imágenes por página** (Prioridad: Alta)

  - Nuevo módulo (`src/ingestion/rasterizer.js` o similar) que, dado el buffer del PDF, devuelve una imagen (base64 + mime type) por página.
  - `pdfjs-dist` ya es dependencia del proyecto (`package.json:26`) pero hoy solo se usa en el renderer (`renderer/modules/pdf.js`) porque necesita un `<canvas>`/DOM que el proceso main de Electron no tiene. Ver §8.1 para las dos alternativas de implementación consideradas.
  - Se inyecta como `deps.rasterizePdf` siguiendo el patrón de inyección de dependencias del proyecto (`main.js` construye `deps`, `src/` nunca importa Electron directo) — permite mockearlo en tests sin PDFs reales ni Electron.

- **Nuevo método de proveedor: `transcribePageToMarkdown`** (Prioridad: Alta)

  - Implementado en `src/llm/providers/anthropic.js` y `openai.js` (los dos que ya soportan `interpretImage`), con el mismo patrón de cliente inyectable y registro de costos (`record('ocr', usage)`).
  - **DeepSeek no lo implementa** — no soporta visión, igual que hoy no implementa `interpretImage`. Cualquier caller debe chequear `if (!llm.transcribePageToMarkdown)` antes de usarlo, replicando el guard que ya existe en `src/ipc/class.js:54`.
  - A diferencia de `interpretImage` (que pide una descripción de 4 oraciones, `max_tokens: 400`, pensado para diapositivas de Clase), este método pide **transcripción exhaustiva**, con un `max_tokens` sustancialmente mayor (una página densa de dos columnas puede superar los 1500-2000 tokens de salida).
  - Prompt — requisitos no negociables:

    - Transcribir **todo** el texto visible de la página, sin resumir, sin omitir secciones, sin parafrasear.
    - Preservar estructura: títulos, subtítulos, listas, notas al pie.
    - Tablas → Markdown table syntax.
    - Fórmulas/ecuaciones → LaTeX (`$...$` / `$$...$$`).
    - Figuras/diagramas/gráficos → no se transcriben pixel a pixel, pero se anota su presencia y contenido relevante de forma explícita y marcada como tal (ej. `> [Figura 2: diagrama de arquitectura, describe brevemente lo que muestra]`), nunca mezclado con el texto real de la página como si fuera prosa del paper.
    - Contenido ilegible o cortado → marcarlo explícitamente (ej. `[ilegible]`), **nunca** rellenarlo por inferencia. Esta es la regla central de la feature: ante la duda, marcar el hueco, no inventar.
    - Sin comentario editorial del modelo fuera de esas anotaciones marcadas — la salida es la transcripción, no una opinión sobre el paper.

- **Orquestador de OCR del documento completo** (Prioridad: Alta)

  - Nueva función, ej. `transcribePdfToMarkdown(buffer, { rasterizePdf, llm, extractText, pdfParse, onProgress })` en un módulo nuevo `src/ingestion/ocr.js`.
  - Recorre las páginas rasterizadas en orden, llama a `llm.transcribePageToMarkdown()` por cada una, y concatena el resultado con un separador que identifica la página y su fuente, ej.:
    ```
    <!-- page 7 · source: ocr -->
    ...contenido transcripto...

    <!-- page 8 · source: pdf-parse fallback (vision error: rate_limit) -->
    ...texto de esa página vía pdf-parse, como degradación explícita...
    ```
  - **Fallo por página no aborta la corrida**: si la transcripción de una página específica falla (rate limit, error de red, respuesta vacía), esa página cae a su texto de `pdf-parse` individual como fallback local, marcado como tal en el propio Markdown — nunca se deja un hueco silencioso ni se inventa contenido de relleno.
  - **Fallo total** (sin proveedor con visión configurado, o `rasterizePdf` no disponible) → el botón de generar OCR informa el error sin tocar el `pdf_text` existente; el paper sigue con lo que ya tenía (`pdf-parse`, de la ingesta).
  - Progreso reportable vía callback (`onProgress(pageIndex, pageCount)`) para que la UI pueda mostrar "Transcribiendo página 4/12" mientras corre.
  - Esta función **no la llama ni `runFetch` ni `index-files` ni `indexReferenceFolder`** — se invoca únicamente desde la acción explícita descrita en el siguiente punto.

- **Generar OCR — acción explícita del usuario** (Prioridad: Alta)

  - Nuevo IPC `generate-ocr` (paper-scoped, en `src/ipc/learning.js` junto a `start-summary`/`generate-quiz`, mismo dominio): dispara el orquestador para un paper que **ya existe** en la DB (`db.getPaper(id)` no es null) y ya tiene su PDF en `raw/`.
  - Es el único punto de entrada al OCR — no hay una versión "automática" y otra "manual"; siempre es este mismo botón, tanto la primera vez que se corre sobre un paper como cualquier corrida posterior (ej. para reintentar tras un fallo parcial, o después de cambiar de proveedor LLM).
  - Disponible tanto para papers ingeridos por fetch (carpeta de semana) como para papers de la colección de referencia (carpeta `reference/`) — mismo botón, mismo IPC, mismo comportamiento.
  - Guardado: el Markdown va a `ocr/<id>.md` en el vault y a `papers.pdf_text` en SQLite (copia denormalizada para que los queries no dependan del filesystem). **Se reutiliza la columna `pdf_text` existente a propósito**: todo lo que hoy lee `paper.pdf_text` (resumen, quiz, chat, Clase) sigue funcionando sin ningún cambio de código en esos consumidores.
  - Dos columnas nuevas en `papers` (migradas con `ALTER TABLE ... ADD COLUMN`, siguiendo el patrón ya usado para `notes`/`highlights` en `src/database.js:140-141`):
    - `pdf_text_source` TEXT — `'ocr'` | `'pdf-parse'` (default para todo paper recién ingerido, hasta que se le corra OCR) | `null` (papers preexistentes antes de esta feature).
    - `ocr_error` TEXT — detalle si la corrida de OCR falló completamente (análogo a `pdf_error`, que ya existe para fallos de extracción/descarga).
  - El truncado fijo de 30.000 caracteres (`MAX_CHARS`) deja de aplicarse cuando la fuente es `'ocr'` — el propósito explícito de la feature es no perder contenido. Se mantiene un techo mucho más alto solo como salvaguarda de tamaño de fila en SQLite (ver §8.3), no como comportamiento esperado en el caso normal.

- **Recarga desde archivo editado a mano** (Prioridad: Media)

  - Nuevo IPC `reload-ocr-from-file`: si el usuario abre `ocr/<id>.md` (vía `open-file`, ya existe el IPC — `src/ipc/reference.js`) y corrige algo a mano, este botón resincroniza `papers.pdf_text` desde el archivo en disco sin volver a pagar ninguna llamada al LLM.
  - Es la respuesta directa a "no confío en el proceso": el usuario tiene la última palabra sobre el texto que va a alimentar resumen/quiz/chat/Clase, sin tener que re-correr el pipeline pagado.

- **Indicador de calidad en la UI** (Prioridad: Media)

  - Extiende el badge de estado que ya existe para el paper (`renderer/modules/paper-view.js:42`, `badge-${p.status}`, ver commit `8fd5e93` que ya lo traduce) con un segundo indicador para `pdf_text_source`: "Texto: OCR" vs "Texto: extracción básica" (el estado por defecto de todo paper hasta que se le pide OCR), para que el usuario sepa de un vistazo en qué papers puede confiar más y cuáles todavía no transcribió.

## 5. Experiencia de usuario

### 5.1 Entry points y primer uso

- El fetch semanal y el indexado de referencia terminan exactamente como hoy: el paper queda guardado con `pdf_text` de `pdf-parse` y `pdf_text_source: 'pdf-parse'`. Ningún llamado de visión ocurre en este paso, para ningún candidato, se guarde o no.
- El único entry point al OCR es un botón "Generar OCR" en la vista de detalle de un paper — visible tanto para papers de una semana de ingesta como para papers de `reference/` — disponible recién cuando ese paper ya tiene fila en la DB y PDF en `raw/`.
- Si no hay un proveedor LLM con visión configurado (DeepSeek, o sin `apiKey`), el botón se muestra deshabilitado con una explicación breve, en vez de fallar al hacer clic.

### 5.2 Experiencia principal

- **Generar OCR bajo demanda**: el usuario abre un paper que ya fue ingerido (o que ya indexó como referencia), decide que le importa lo suficiente, y hace clic en "Generar OCR". Ve el progreso "Transcribiendo página X/N" mientras corre; al terminar, el paper queda con badge "Texto: OCR" y el resumen/quiz/chat que genere después usan ese texto completo.
- **Corrección manual**: el usuario nota que una tabla salió mal transcripta, abre `ocr/<id>.md` con su editor, la corrige, vuelve a la app y usa "Recargar desde archivo" — el chat de esa sesión en adelante ya ve el texto corregido.
- **Re-correr OCR**: el usuario cambió de proveedor LLM, o quiere reintentar un paper que quedó con páginas en fallback — vuelve a hacer clic en el mismo botón "Generar OCR", que sobreescribe la corrida anterior.

### 5.3 Casos avanzados y edge cases

- PDF escaneado (imagen pura, sin texto seleccionable) → `pdf-parse` devolvería texto vacío o basura; la transcripción por visión funciona igual, porque lee la imagen de la página, no una capa de texto. Este es el caso donde la feature aporta más valor, no un edge case a evitar.
- Página con fórmulas matemáticas densas → se transcriben a LaTeX; si el modelo no puede resolver un símbolo específico, se marca `[ilegible]` en ese punto exacto en vez de aproximar.
- Rate limit del proveedor a mitad de una corrida de OCR → las páginas ya procesadas se conservan, las restantes caen a `pdf-parse` por página (no se descarta todo el progreso ya pagado).
- Un candidato rechazado durante `runFetch` (por similitud, por `orgFilter`, o por quedar fuera del cupo de `maxPapers`) **nunca tiene la opción de generar OCR** — no llegó a guardarse, no tiene fila en `papers`, no existe el botón para él. El OCR solo puede pedirse sobre lo que ya está en el vault.
- Usuario cambia de proveedor LLM en Settings después de tener papers con `pdf_text_source: 'ocr'` de otro proveedor → esos papers **no** se reprocesan automáticamente; el texto ya guardado se sigue usando tal cual hasta que el usuario vuelva a hacer clic en "Generar OCR".

### 5.4 UI/UX destacados

- El indicador "Texto: OCR / extracción básica" usa el mismo lenguaje visual que el badge de estado existente (`status-badge`), no un componente nuevo.
- El progreso de transcripción reutiliza el patrón de feedback en tiempo real que ya existe para el streaming del resumen, en vez de introducir un mecanismo de progreso distinto.

## 6. Narrativa

El usuario recibe su fetch semanal de 3 papers, como siempre — rápido, sin cambios, sin ningún costo nuevo. De esos 3, uno le llama la atención por una tabla de resultados que quiere estudiar en detalle. Antes de pedirle el resumen, abre el paper y hace clic en "Generar OCR": ve el progreso página por página, y al terminar el paper queda marcado como transcripto con fidelidad — tablas y fórmulas incluidas, no solo lo que `pdf-parse` pudo rescatar. El resumen, el quiz y la sesión de Clase que arme después sobre ese paper ahora parten de ese texto completo, que además puede abrir y leer él mismo en `ocr/<id>.md` si quiere verificarlo. Los otros dos papers del fetch se quedan con la extracción básica de siempre — no le interesan lo suficiente como para pagar por transcribirlos, y la app nunca lo obligó a hacerlo.

## 7. Métricas de éxito

### 7.1 Métricas centradas en el usuario

- Cero reportes de "el resumen/quiz no menciona algo que sí está en el paper" atribuibles a texto faltante, para cualquier paper donde el usuario haya pedido OCR.
- Cero quejas de que el fetch semanal se volvió más lento o más caro.

### 7.2 Métricas de negocio

- El costo de la transcripción OCR es visible y explicable en el dashboard de costos existente (`action_type: 'ocr'`), y aparece **solo** cuando el usuario lo pide — nunca como parte del costo recurrente del fetch semanal ni del indexado de referencia.

### 7.3 Métricas técnicas

- 0 llamadas a `transcribePageToMarkdown` originadas desde `runFetch`, `index-files` o `indexReferenceFolder` — verificable cruzando `usage_events` (`action_type: 'ocr'`) contra los timestamps de esos procesos; deberían ser disjuntos.
- Todo paper con `pdf_text_source = 'ocr'` corresponde a una invocación explícita de `generate-ocr`, nunca a un efecto secundario del fetch.
- 0% de contenido inventado: cualquier segmento no transcripto fielmente queda marcado explícitamente (`[ilegible]` o `fallback`) en el Markdown, nunca relleno silencioso.
- El campo `pdf_text` deja de estar truncado a 30.000 caracteres para papers con `pdf_text_source = 'ocr'`.

## 8. Consideraciones técnicas

### 8.1 Puntos de integración

- `src/vault.js`: `ensureDirs()` agrega `ocr/`; nuevas `ocrPath()` y `writeOcr()` siguiendo el patrón de `writeSummary`/`writeQuiz`.
- `src/database.js`: dos columnas nuevas en `papers` (`pdf_text_source`, `ocr_error`) vía `ALTER TABLE`, siguiendo el patrón de migración ya usado en la línea 140-141; `savePaper()` las incorpora al `INSERT`/`ON CONFLICT`.
- **`src/ipc/papers.js` (`runFetch`/`finalizeSave`) e `src/ipc/reference.js` (`index-files`) / `src/embeddings/index.js` (`indexReferenceFolder`) no se modifican para nada relacionado a OCR.** Siguen llamando a `extractText()` exactamente igual que hoy. Esto es intencional y es la corrección clave de esta versión del PRD respecto a la v1.0: el OCR se sacó por completo del camino de ingesta.
- Nuevo IPC `generate-ocr` en `src/ipc/learning.js` (mismo archivo que `start-summary`/`generate-quiz`/`chat-message`): recibe un `paperId`, valida que el paper ya exista (`db.getPaper(paperId)`), corre el orquestador, y persiste el resultado. Es el único call site de `transcribePdfToMarkdown`.
- **Rasterización — el punto más delicado de la implementación**: `pdfjs-dist` (`package.json:26`) ya está integrado, pero solo en el renderer (`renderer/modules/pdf.js`), porque necesita un `<canvas>`. El proceso main de Electron no tiene DOM. Dos caminos evaluados:

  1. **Reutilizar el renderer vía una ventana oculta** (`show: false`) que cargue el mismo código de `renderer/modules/pdf.js`, rasterice cada página a un canvas, y devuelva las imágenes al proceso main por IPC. Cero dependencias nuevas — reutiliza lo que ya funciona hoy para la pestaña "File". Riesgo: gestionar el ciclo de vida de esa ventana (crearla, esperar a que rasterice, destruirla) sin dejarla filtrando memoria si el usuario corre OCR sobre varios papers en la misma sesión.
  2. **Rasterizar directo en Node** con `pdfjs-dist` + un canvas nativo (`@napi-rs/canvas` u equivalente). Evita la ventana oculta, pero agrega una dependencia con binarios nativos que hay que compilar/distribuir junto con `better-sqlite3` (que ya se rebuildea para Electron vía `npm install`).

  **Recomendación**: empezar por (1) — cero dependencias nuevas y reutiliza código que ya está probado en producción (la pestaña "File"); revisar (2) solo si el manejo de ventanas ocultas resulta inestable o demasiado lento en la práctica.

- `src/llm/providers/anthropic.js` y `openai.js`: nuevo método `transcribePageToMarkdown`, instrumentado con `record('ocr', usage)` igual que el resto de los métodos (ver "Instrumentación de costos" en `CLAUDE.md`).
- `src/ipc/class.js:54` ya tiene el guard `if (!llm.interpretImage) return { slides: [] }` para proveedores sin visión — el handler de `generate-ocr` replica el mismo patrón para `transcribePageToMarkdown`.
- Nuevo `action_type: 'ocr'` en `usage_events`, consumido por el dashboard de `features/cost-tracking.md` sin cambios de esquema.

### 8.2 Almacenamiento de datos y privacidad

- `ocr/<id>.md` es la fuente "legible por humanos", pensada para que el usuario la abra y la audite o edite directamente en disco.
- `papers.pdf_text` sigue siendo la copia denormalizada que consumen los queries — si el usuario edita el `.md` a mano, debe usar "Recargar desde archivo" para que la DB refleje el cambio; no hay sincronización automática en cada lectura.
- Sin cambios de privacidad respecto al modelo actual: todo sigue local, salvo las llamadas a la API del proveedor LLM elegido, y solo para los papers donde el usuario explícitamente pidió OCR.

### 8.3 Escalabilidad y desempeño

- El costo real sigue siendo **una transcripción por página**, no una llamada por paper — un paper de 15 páginas son 15 llamadas de visión. La diferencia respecto a la v1.0 de este PRD es *cuándo* se paga ese costo: nunca como efecto colateral de un fetch de 3 papers (que sería 30-60 llamadas sin que el usuario lo pidiera explícitamente para cada uno), sino una corrida a la vez, cada una disparada a mano. El fetch semanal y el indexado de referencia mantienen el costo/latencia de hoy sin cambios.
- Se mantiene un techo de tamaño para `pdf_text` (ej. ~200.000 caracteres) como salvaguarda de fila de SQLite, no como comportamiento esperado — muy por encima del `MAX_CHARS` actual de 30.000, y pensado para no cortar en el caso normal.

### 8.4 Posibles desafíos

- La ventana oculta para rasterizar (opción 1 de §8.1) es la pieza más nueva de la arquitectura — no hay precedente hoy de una segunda `BrowserWindow` en el proceso main. Vale la pena prototiparla temprano en la Fase 1 antes de comprometerse al resto del pipeline.
- Un paper muy largo (40+ páginas) sigue implicando muchas llamadas en una sola corrida de "Generar OCR" — vale la pena mostrar una estimación de páginas/costo antes de confirmar la acción, para que la decisión de "vale la pena para este paper" la tome el usuario con esa información a mano.
- El fallback por página a `pdf-parse` (§4, "Orquestador") requiere poder extraer el texto de **una página específica**, no del PDF completo — `pdf-parse` soporta esto vía su opción `pagerender`, pero `src/ingestion/extractor.js` no la usa hoy; hay que extenderla o agregar una función paralela para extracción por página.
- DeepSeek queda sin OCR de forma permanente (sin soporte de visión conocido) — un usuario que solo configuró DeepSeek ve el botón "Generar OCR" deshabilitado en todos sus papers, salvo que configure un segundo proveedor con visión solo para este paso (fuera de alcance v1: no se contempla mezclar proveedores por método).

## 9. Hitos y secuenciación

### 9.1 Estimación del proyecto

- Mediana: 7-10 días de desarrollo. La pieza de mayor incertidumbre sigue siendo la rasterización en el proceso main (§8.1); al sacar el OCR del camino de ingesta se simplifica la integración (un solo call site nuevo — `generate-ocr` — en vez de tocar `runFetch` e `index-files`).

### 9.2 Tamaño y composición del equipo

- 1 desarrollador full-stack (Electron/Node + frontend vanilla JS), siguiendo TDD como el resto del proyecto — mockeando el proveedor LLM y el rasterizador en los tests, nunca llamando a la API real ni rasterizando un PDF de verdad en `tests/unit/`.

### 9.3 Fases sugeridas

- **Fase 1**: Rasterización + método de proveedor (3-4 días)

  - Prototipo de la ventana oculta que rasteriza un PDF a imágenes por página.
  - `transcribePageToMarkdown` en Anthropic y OpenAI, con tests mockeando el cliente.
  - Guard para DeepSeek (`if (!llm.transcribePageToMarkdown)`).

- **Fase 2**: Orquestador + persistencia + IPC on-demand (2-3 días)

  - `src/ingestion/ocr.js`: recorrido de páginas, fallback por página a `pdf-parse`, fallback total si no hay visión disponible.
  - `vault.ensureDirs()`/`writeOcr()`, columnas nuevas `pdf_text_source`/`ocr_error`.
  - Nuevo IPC `generate-ocr` en `src/ipc/learning.js`. **`runFetch`, `index-files` e `indexReferenceFolder` quedan sin tocar** — tests que lo confirman explícitamente (cero llamadas a `transcribePageToMarkdown` al correr `runFetch` en el test suite).
  - `action_type: 'ocr'` instrumentado en `usage_events`.

- **Fase 3**: UI — botón, progreso, badge y recarga desde archivo editado (2-3 días)

  - Botón "Generar OCR" en la vista de un paper (ingerido o de referencia), indicador de progreso, badge "Texto: OCR/extracción básica" en `paper-view.js`, IPC `reload-ocr-from-file`.

## 10. Historias de usuario

### 10.1. Generar OCR bajo demanda para un paper puntual

- **ID**: OCR-001
- **Descripción**: Como usuario, quiero poder pedir explícitamente que un paper se transcriba página por página con el LLM de visión, para confiar en que el resumen/quiz/chat/Clase de ese paper en particular están basados en el texto completo.
- **Criterios de aceptación**:

  - En la vista de un paper que ya existe en la DB, un botón "Generar OCR" dispara el IPC `generate-ocr` y genera `ocr/<id>.md` con la transcripción completa del PDF, guardando ese texto en `papers.pdf_text` con `pdf_text_source = 'ocr'`.
  - Ninguna sección del paper queda fuera por el corte de 30.000 caracteres que existe hoy para `pdf-parse`.
  - El texto generado no contiene contenido inventado: cualquier parte no transcripta fielmente queda marcada explícitamente.

### 10.2. El fetch y el indexado de referencia nunca disparan OCR

- **ID**: OCR-002
- **Descripción**: Como usuario, quiero que mi fetch semanal y mi indexado de referencia sigan corriendo exactamente igual de rápido y barato que hoy, para que esta feature no me imponga un costo que no pedí.
- **Criterios de aceptación**:

  - `runFetch()` guarda todo paper nuevo con `extractText()`/`pdf-parse` y `pdf_text_source = 'pdf-parse'`, sin ningún llamado a `transcribePageToMarkdown`.
  - `index-files`/`indexReferenceFolder` hacen lo mismo para papers de referencia.
  - Un test verifica que, al correr `runFetch` con un `llm` mockeado, `transcribePageToMarkdown` (o el orquestador de OCR) nunca se invoca.
  - Un candidato rechazado durante la selección de `runFetch` no tiene, en ningún momento, una fila en `papers` sobre la que se pueda pedir OCR.

### 10.3. Degradar sin bloquear cuando no hay visión disponible

- **ID**: OCR-003
- **Descripción**: Como usuario con DeepSeek configurado (o sin API key), quiero que la app me indique claramente que no puedo generar OCR en vez de fallar de forma confusa, para entender qué necesito cambiar si quiero esta feature.
- **Criterios de aceptación**:

  - Sin un proveedor LLM con visión configurado, el botón "Generar OCR" aparece deshabilitado con un texto explicativo breve.
  - El paper sigue totalmente utilizable con su `pdf_text` de `pdf-parse` — nada se degrada por no tener OCR disponible.

### 10.4. Recuperarse de un fallo parcial sin perder el progreso pagado

- **ID**: OCR-004
- **Descripción**: Como usuario, quiero que si falla la transcripción de una página puntual durante una corrida de OCR (rate limit, error de red), el resto del documento no se pierda, para no tener que pagar de nuevo por páginas que ya se procesaron bien.
- **Criterios de aceptación**:

  - Una página cuya transcripción falla cae a su texto de `pdf-parse` individual, marcado explícitamente como fallback en el Markdown.
  - El resto de las páginas conserva su transcripción por visión sin reprocesarse.
  - `ocr_error` queda registrado si hubo al menos una página en fallback dentro de un documento con `pdf_text_source = 'ocr'`.

### 10.5. Corregir el texto a mano y resincronizar sin costo

- **ID**: OCR-005
- **Descripción**: Como usuario que no confía ciegamente en el OCR, quiero poder abrir `ocr/<id>.md`, corregirlo, y que la app use mi corrección, para tener la última palabra sobre el contexto que alimenta el resumen/quiz/chat/Clase.
- **Criterios de aceptación**:

  - El usuario puede abrir `ocr/<id>.md` desde la app con el editor por defecto del sistema.
  - Un botón "Recargar desde archivo" actualiza `papers.pdf_text` con el contenido actual del archivo en disco, sin llamar al LLM.
  - Los siguientes usos de chat/Clase para ese paper ven el texto corregido de inmediato.

### 10.6. Volver a correr OCR sobre un paper ya transcripto

- **ID**: OCR-006
- **Descripción**: Como usuario que cambió de proveedor LLM o tuvo un fallback parcial, quiero poder volver a pedir OCR sobre un paper que ya lo tenía, para mejorar la calidad del contexto sin esperar nada especial ni distinguir entre "primera vez" y "reintento".
- **Criterios de aceptación**:

  - El mismo botón "Generar OCR" funciona tanto si el paper nunca tuvo OCR como si ya lo tenía — sobreescribe `ocr/<id>.md` y `papers.pdf_text` con la nueva corrida.
  - Nunca se dispara automáticamente — siempre requiere el clic explícito del usuario.

### 10.7. Papers de referencia con la misma opción de OCR

- **ID**: OCR-007
- **Descripción**: Como usuario, quiero poder pedir OCR también para los PDFs que indexé como colección de referencia, para poder abrirlos, chatear con ellos o pedirles un resumen con la misma confianza que un paper ingerido por fetch.
- **Criterios de aceptación**:

  - El botón "Generar OCR" está disponible en la vista de un paper `ref-…`, igual que en un paper ingerido.
  - `index-files`/`indexReferenceFolder` no cambian: el `snippet` para el embedding de similitud sigue viniendo de la extracción liviana de la primera página, sin depender de si el paper tiene OCR o no.
  - Al pedir OCR sobre un paper de referencia, se comporta idéntico a uno ingerido: `ocr/<id>.md`, `pdf_text_source`, badge y recarga desde archivo funcionan igual.
