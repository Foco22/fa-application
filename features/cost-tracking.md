# PRD: Tracking de costos de IA y dashboard de gasto

## 1. Resumen del producto

### 1.1 Título del documento y versión

- PRD: Tracking de costos de IA y dashboard de gasto
- Versión: 1.0

### 1.2 Resumen del producto
V
Paper Learning llama a proveedores de IA pagados en varios flujos: resúmenes y chat con LLM (`src/llm/providers/{anthropic,openai,deepseek}.js`), embeddings para el filtro de similitud (`src/embeddings/providers/openai.js`), transcripción de audio en las clases en vivo (`src/transcription/index.js`, proveedores OpenAI y Groq — el modo local con `whisper-stream.js` es gratis) y reranking (`src/rerank/index.js`). Hoy ninguno de estos gastos se registra: n
o hay forma de saber cuánto cuesta usar la app en un período dado, ni cómo se distribuye ese gasto entre proveedores.

Esta feature agrega un registro persistente de cada llamada pagada a IA (tokens de prompt/completion, segundos de audio transcrito, unidades de rerank), calcula su costo en USD usando el precio del modelo vigente en el momento de la llamada, y expone un nuevo panel "Costos" en la barra de actividad con gráficos de gasto por día/semana/mes, desglosados por proveedor y con el total.

La tabla de precios por modelo se mantiene actualizada automáticamente descargando el archivo JSON público que mantiene el proyecto LiteLLM (referencia de precios que cubre, entre muchos otros, a OpenAI, Anthropic y Groq — la cobertura exacta de DeepSeek y de cada modelo específico que usa esta app se debe **confirmar en Fase 1, no se asume**), con un mecanismo de override manual en Settings para modelos que falten o para corregir un precio, y validación del formato del JSON descargado antes de aceptarlo como fuente de verdad.

## 2. Objetivos

### 2.1 Objetivos de negocio

- Dar visibilidad total del gasto en IA de la app, sin depender de revisar el dashboard de cada proveedor por separado.
- Evitar sorpresas de facturación detectando a tiempo picos de gasto en algún proveedor o acción específica.

### 2.2 Objetivos del usuario

- Saber cuánto le cuesta usar la app por día, semana y mes, y poder cambiar de una vista a otra fácilmente.
- Ver el gasto separado por compañía (OpenAI, Anthropic, DeepSeek, Groq) además del total.
- Confiar en que el número que ve es el costo real que pagó, no una estimación con precios desactualizados.

### 2.3 No-objetivos (fuera de alcance v1)

- Alertas o límites de presupuesto configurables (queda para una versión futura).
- Facturación real o integración con métodos de pago — esto es solo tracking informativo local.
- Conversión a monedas distintas a USD (todos los proveedores facturan en USD).
- Tracking de costo de cómputo local (CPU/GPU) del modo de transcripción local con `whisper.cpp` — se registra como uso gratuito ($0), no se estima costo de electricidad ni hardware.

## 3. Personas de usuario

### 3.1 Tipos de usuario clave

- Usuario único de la app (uso personal de escritorio, sin multiusuario).

### 3.2 Detalle de persona

- **Investigador/estudiante independiente**: usa la app para ingerir papers semanalmente, generar resúmenes, quizzes y dar clases con transcripción en vivo; paga las API keys de su bolsillo y quiere controlar el gasto mensual.

### 3.3 Acceso por rol

- No aplica — la app no tiene roles ni multiusuario. Todos los settings y el dashboard de costos son accesibles desde la misma sesión local.

## 4. Requerimientos funcionales

- **Registro de uso de LLM** (Prioridad: Alta)

  - Cada llamada a `streamSummary`, `generateQuiz`, `chat`, `extractAffiliationsWithAI`, `extractPaperMetadata` **e `interpretImage`** (interpretación de diapositivas del modo Clase — también es una llamada al LLM con costo, de visión) en los tres proveedores LLM (`anthropic.js`, `openai.js`, `deepseek.js`) registra `prompt_tokens` y `completion_tokens` tomados de la respuesta real del proveedor (`usage.input_tokens`/`usage.output_tokens` en Anthropic, `usage.prompt_tokens`/`usage.completion_tokens` en OpenAI/DeepSeek; en llamadas de visión los tokens de la imagen vienen incluidos en ese mismo campo `usage`, no se calculan aparte).
  - Cada resumen generado en streaming acumula el uso real reportado al final del stream (no se estima por conteo de caracteres).
  - El registro de uso se hace **dentro de cada método del proveedor** (`chat()`, `generateQuiz()`, `streamSummary()`, `interpretImage()`, etc. en `anthropic.js`/`openai.js`/`deepseek.js`), no en cada IPC handler que los invoca — así cualquier consumidor de esos métodos (Clase, Chat, Papers, y cualquier IPC handler futuro) queda instrumentado automáticamente, sin depender de que cada call site se acuerde de llamar a `recordUsage()` por separado.

- **Registro de uso de embeddings** (Prioridad: Alta)

  - Cada llamada a `generateEmbedding()` registra `total_tokens` de la respuesta de OpenAI.

- **Registro de uso de transcripción (STT)** (Prioridad: Alta)

  - Las llamadas a `createTranscription().transcribe()` (OpenAI, Groq) piden `response_format: 'verbose_json'` para obtener la duración real del audio (`result.duration`) y registran esos segundos.
  - Las sesiones transcritas en modo local (`whisper-stream.js`) se registran con proveedor `local`, costo `$0`, sin necesitar tabla de precios.

- **Registro de uso de rerank** (Prioridad: Media)

  - Cada llamada a `src/rerank/index.js` registra las unidades facturables reportadas por el proveedor (documentos o tokens procesados, según cómo factura el proveedor configurado).

- **Cálculo de costo en el momento de la llamada** (Prioridad: Alta)

  - Al registrar un evento de uso, el sistema busca el precio vigente del modelo en la tabla de precios cacheada y calcula `cost_usd`.
  - Ese `cost_usd` (y los precios por unidad usados) se guardan congelados en el registro — un cambio posterior en la tabla de precios no modifica el costo histórico ya calculado.
  - Si el modelo no existe en la tabla de precios (proveedor nuevo, modelo recién lanzado), el evento se guarda igual con `cost_usd = null` y se marca como "precio no disponible" en el dashboard, en vez de fallar la operación principal (nunca bloquear un resumen/quiz/chat porque no se pudo calcular el costo).

- **Tabla de precios auto-actualizable** (Prioridad: Alta)

  - `src/pricing/index.js` descarga el JSON público de precios de LiteLLM (`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`) y extrae, por modelo, precio por token de input, output y (cuando aplica) por minuto de audio.
  - El fetch corre al iniciar la app si la caché tiene más de `pricingFetchIntervalDays` (default 7 días) y se puede disparar manualmente desde Settings ("Actualizar precios ahora").
  - Si el fetch falla (sin internet, GitHub caído), se usa la última tabla cacheada sin bloquear la app; se muestra la fecha de la última actualización exitosa en Settings.
  - Settings permite agregar/editar overrides manuales de precio por proveedor+modelo, que siempre tienen prioridad sobre el valor de LiteLLM.
  - El JSON descargado se valida contra la forma esperada (campos de precio numéricos presentes para los modelos que la app usa) antes de reemplazar la caché; si la validación falla (formato cambiado, campos faltantes, valores no numéricos), se trata igual que un fetch fallido — se descarta la descarga y se conserva la última tabla válida, nunca se deja pasar un precio corrupto silenciosamente.

- **Dashboard de costos** (Prioridad: Alta)

  - Nueva sección "Costos" en la barra de actividad (junto a Papers, Fetch, Chat, Clase, Settings), con su propio panel.
  - Un gráfico principal de gasto en el tiempo con un selector de granularidad Día / Semana / Mes que redibuja el mismo gráfico agrupando los eventos por el período elegido.
  - Desglose por compañía (serie o barra apilada por proveedor: OpenAI, Anthropic, DeepSeek, Groq, Local) dentro del mismo gráfico.
  - Total acumulado del período visible y total histórico, mostrados como cifras destacadas junto al gráfico.
  - Filtro de rango de fechas (además del selector de granularidad) para acotar el gráfico a un período específico.
  - Tabla/lista de detalle debajo del gráfico con el desglose por acción (resumen, quiz, chat, embedding, transcripción, rerank) dentro del período filtrado.

## 5. Experiencia de usuario

### 5.1 Entry points y primer uso

- El usuario abre la app normalmente; la primera vez que se agrega esta feature, la tabla de precios se descarga automáticamente en segundo plano al arrancar, sin pedir configuración adicional (usa `httpClient` ya inyectado, sin API key propia).
- El nuevo ícono "Costos" aparece en la barra de actividad desde el primer arranque después de la actualización, con el dashboard vacío ("Aún no hay uso registrado") hasta que ocurra la primera llamada a IA.

### 5.2 Experiencia principal

- **Ver gasto reciente**: el usuario hace clic en el ícono "Costos"; ve por defecto el gráfico agrupado por semana de las últimas 8 semanas, con el total del período arriba.

  - Da una vista inmediata y accionable sin necesidad de configurar nada.

- **Cambiar granularidad**: el usuario cambia el selector a "Día" o "Mes"; el mismo gráfico se re-agrupa sin recargar la página ni perder el rango de fechas seleccionado.

  - Mantiene la exploración fluida — es un solo gráfico con un control, no pantallas separadas.

- **Comparar proveedores**: el usuario identifica de un vistazo, por color, qué proveedor concentra el gasto (ej. Anthropic por los resúmenes vs. Groq por transcripción de clases).

  - Ayuda a decidir en qué proveedor vale la pena optimizar (cambiar de modelo, reducir frecuencia, etc.).

### 5.3 Casos avanzados y edge cases

- Sin ninguna llamada de IA registrada aún → estado vacío con mensaje explicativo, no un gráfico en blanco confuso.
- Modelo sin precio disponible en la tabla (nuevo o no cubierto por LiteLLM) → esos eventos se cuentan aparte como "costo desconocido" en la tabla de detalle, no se suman silenciosamente como $0 al total (evita subestimar el gasto).
- Fetch de la tabla de precios falla repetidamente → Settings muestra advertencia con la fecha de la última tabla válida usada; el dashboard sigue funcionando con los últimos precios conocidos.
- Cambio de proveedor LLM/embeddings/transcripción en Settings a mitad de mes → el gráfico agrupado por mes debe mostrar correctamente la mezcla de proveedores dentro del mismo período, sin duplicar ni perder eventos.
- Sesión de clase con transcripción local (`whisper.cpp`, gratis) mezclada con sesiones usando Groq/OpenAI → el desglose por proveedor debe incluir "Local — $0" como su propia serie, no omitirla.

### 5.4 UI/UX destacados

- Un solo control tipo segmented button (Día / Semana / Mes) sobre el gráfico, coherente con el resto de controles de la app.
- Colores consistentes y fijos por proveedor en todo el dashboard (mismo color para OpenAI en el gráfico de barras que en la tabla de detalle).
- Cifras de costo siempre con 2-4 decimales en USD (ej. `$0.0143`), calculadas dividiendo el `cost_micro_usd` entero por 1.000.000 solo al momento de mostrar — la suma que alimenta el gráfico siempre se hace sobre los enteros, nunca sobre valores ya redondeados a decimales.

## 6. Narrativa

El usuario termina su semana de estudio: generó tres resúmenes, corrió dos quizzes, dio una clase de 40 minutos transcrita con Groq y chateó un rato con el asistente. Abre la nueva sección "Costos", ve en el gráfico semanal que gastó $0.62 esa semana, con Anthropic representando la mayor parte por los resúmenes y Groq una porción menor por la transcripción. Cambia a vista mensual y confirma que va dentro de lo que esperaba gastar ese mes. No tuvo que revisar tres dashboards de facturación distintos ni hacer cuentas manuales — la app le dio el número real, calculado con el precio vigente el día de cada llamada.

## 7. Métricas de éxito

### 7.1 Métricas centradas en el usuario

- El usuario puede responder "¿cuánto gasté esta semana/mes?" en menos de 5 segundos desde que abre la app.
- Cero discrepancias reportadas entre el costo mostrado en el dashboard y el costo real facturado por los proveedores — se garantiza guardando y sumando los costos como enteros en micro-USD (`cost_micro_usd`), nunca como `REAL`, eliminando el drift de punto flotante al agregar miles de eventos.

### 7.2 Métricas de negocio

- Reducción del gasto mensual en IA gracias a decisiones informadas (ej. cambiar de modelo o proveedor cuando el dashboard expone un costo alto inesperado).

### 7.3 Métricas técnicas

- 100% de las llamadas pagadas a IA (LLM, embeddings, STT, rerank) generan un registro de uso — cero llamadas "silenciosas" sin trackear.
- La tabla de precios se refresca exitosamente al menos una vez cada `pricingFetchIntervalDays`, con manejo de fallo sin caída de la app.

## 8. Consideraciones técnicas

### 8.1 Puntos de integración

- Todos los métodos de los proveedores en `src/llm/providers/*.js` (incluido `interpretImage`, usado por el modo Clase), `src/embeddings/providers/openai.js`, `src/transcription/index.js` y `src/rerank/index.js` llaman a `recordUsage(db, event)` **internamente, como último paso antes de retornar el resultado** — la instrumentación vive en el proveedor, no en cada IPC handler que lo consume. Esto evita depender de que cada call site (hoy hay más de diez repartidos entre `learning.js`, `class.js`, `reference.js` y `runFetch()`) recuerde registrar el uso por su cuenta; un consumidor nuevo de un método ya instrumentado queda cubierto sin cambios adicionales.
- Nuevo módulo `src/pricing/index.js`: `fetchPricingTable(httpClient)`, `getPriceFor(provider, model)`, `refreshPricingIfStale(db, httpClient)`, `saveManualOverride(db, provider, model, prices)` — sigue el mismo patrón de cliente inyectable (`httpClient` viene de `deps`, nunca se llama a `axios` directo) usado por el resto del proyecto.
- Nuevo módulo `src/costs/index.js` (o `usage/index.js`): `recordUsage(db, event)` calcula y persiste el costo; `getCostSummary(db, { groupBy, from, to })` retorna los datos agregados que consume el dashboard.
- Nuevo dominio IPC `src/ipc/costs.js`, registrado en `src/ipc/index.js` junto a los demás dominios: `get-cost-summary`, `get-pricing-status`, `refresh-pricing`, `save-pricing-override`.
- Nueva sección en `renderer/index.html`/`app.js`/`styles.css`: botón `act-costs` en la barra de actividad y panel con el gráfico. Requiere elegir una librería de gráficos compatible con `contextIsolation: true` y sin acceso a Node en el renderer (cargada como script local empaquetado, no desde un CDN externo).

### 8.2 Almacenamiento de datos y privacidad

- Nueva tabla `usage_events`: `id, occurred_at, action_type, provider, model, prompt_tokens, completion_tokens, audio_seconds, units, prompt_price_micro_usd, completion_price_micro_usd, cost_micro_usd, paper_id (nullable FK), session_id (nullable FK a class_sessions), created_at`. Los montos se guardan como **enteros en micro-USD** (1 USD = 1.000.000 micro-USD; ej. $0.0143 se guarda como `14300`), no como `REAL`, para que sumar miles de eventos en las agregaciones del dashboard nunca acumule error de punto flotante. La UI divide por 1.000.000 solo al momento de mostrar el número, después de sumar los enteros.
- Nueva tabla `pricing_cache`: `provider, model, prompt_price_per_token, completion_price_per_token, audio_price_per_minute, unit, source ('litellm' | 'manual'), fetched_at` — clave primaria compuesta `(provider, model)`. Estos precios por unidad siguen guardados como `REAL`: no se acumulan entre sí, se usan una sola vez por evento para calcular `cost_micro_usd`, así que no están expuestos al mismo riesgo de drift.
- Nuevos settings: `pricingLastFetched`, `pricingFetchIntervalDays` (default `"7"`), `pricingSourceUrl` (default apuntando al JSON de LiteLLM), `pricingOverrides` (JSON).
- Todo el tracking es 100% local en el SQLite existente — no se envía ningún dato de uso a servicios externos; el único tráfico de red nuevo es la descarga pública y anónima del JSON de precios de LiteLLM.

### 8.3 Escalabilidad y desempeño

- Volumen esperado bajo (uso personal, decenas de eventos por semana) — no requiere particionado ni limpieza automática de `usage_events` en v1, pero conviene indexar por `occurred_at` y `provider` para que las agregaciones del dashboard sean rápidas incluso con miles de filas acumuladas en el tiempo.
- Las agregaciones por día/semana/mes se calculan con `GROUP BY` en SQLite directamente (usando `strftime` sobre `occurred_at`), no en JavaScript, para mantener el dashboard responsivo.

### 8.4 Posibles desafíos

- No todos los proveedores exponen `usage` de forma consistente: hay que confirmar caso por caso el shape exacto de la respuesta (Anthropic con streaming reporta el uso en el evento final del stream, no en cada chunk).
- Duración de audio para STT: la API de transcripción solo reporta duración si se pide `response_format: 'verbose_json'`; hay que verificar que Groq lo soporte igual que OpenAI, o calcular la duración localmente a partir del buffer de audio como fallback.
- El JSON de LiteLLM usa sus propios identificadores de modelo, que no siempre calzan 1:1 con el string de modelo que devuelve cada proveedor (ej. alias o sufijos de versión) — se necesita una tabla de mapeo/normalización de nombres de modelo al hacer el lookup de precio.
- El módulo de rerank no está documentado en `CLAUDE.md` — antes de instrumentarlo hay que confirmar qué proveedor usa hoy y cómo factura (por documento, por token o por request) para modelar correctamente sus `units`.

## 9. Hitos y secuenciación

### 9.1 Estimación del proyecto

- Mediano: 1-2 semanas de desarrollo (esquema de datos + instrumentación de 4 tipos de proveedor + módulo de pricing + dashboard nuevo).

### 9.2 Tamaño y composición del equipo

- 1 desarrollador full-stack (Electron/Node + SQLite + frontend vanilla JS), siguiendo TDD como el resto del proyecto.

### 9.3 Fases sugeridas

- **Fase 1**: Esquema de datos (`usage_events`, `pricing_cache`) + módulo `src/pricing/index.js` con tests, fetch de LiteLLM mockeado (3-4 días)

  - Migraciones de DB (montos en `cost_micro_usd` entero), fetch de pricing con fallback, validación de esquema del JSON (rechazar y mantener caché si el formato no es el esperado), overrides manuales, tests unitarios.
  - **Verificación manual de precios, no asumida**: antes de cerrar esta fase, confirmar contra la página oficial de pricing de cada proveedor (OpenAI, Anthropic, DeepSeek, Groq) que los modelos configurados hoy en la app tienen un precio correcto y real en la tabla resultante. Para lo que LiteLLM no cubra (ej. DeepSeek, a confirmar), cargar el precio real a mano como override inicial con `source='manual'` en vez de dejarlo sin precio.

- **Fase 2**: Instrumentación de los 4 tipos de proveedor + `src/costs/index.js` (`recordUsage`, `getCostSummary`) (3-4 días)

  - Ajustar `llm/providers/*` (incluido `interpretImage`), `embeddings/providers/openai.js`, `transcription/index.js`, `rerank/index.js` para llamar a `recordUsage()` internamente en cada método público, en vez de instrumentar cada IPC handler por separado — los call sites en `src/ipc/learning.js`, `src/ipc/class.js`, `src/ipc/reference.js` y `runFetch()` no necesitan ningún cambio, quedan cubiertos automáticamente.

- **Fase 3**: Dominio IPC `costs.js` + dashboard en el renderer (3-4 días)

  - Nuevo panel, gráfico con selector Día/Semana/Mes, desglose por proveedor, tabla de detalle, estado vacío.

## 10. Historias de usuario

### 10.1. Ver el gasto total agrupado por día, semana o mes

- **ID**: CT-001
- **Descripción**: Como usuario, quiero ver mi gasto en IA agrupado por día, semana o mes en un mismo gráfico, para entender mi patrón de consumo sin cambiar de pantalla.
- **Criterios de aceptación**:

  - Al abrir la sección "Costos" se muestra un gráfico con datos agregados (vista semanal por defecto).
  - Un control visible permite cambiar entre Día / Semana / Mes y el gráfico se actualiza sin recargar la app.
  - Los montos mostrados corresponden a la suma de `cost_usd` de los eventos en cada período agrupado.

### 10.2. Ver el gasto desglosado por proveedor

- **ID**: CT-002
- **Descripción**: Como usuario, quiero ver cuánto gasté en cada compañía (OpenAI, Anthropic, DeepSeek, Groq, Local) dentro del mismo gráfico, para identificar dónde se concentra mi costo.
- **Criterios de aceptación**:

  - El gráfico distingue cada proveedor con un color consistente en todo el dashboard.
  - Existe una vista o leyenda que permite ver el total por proveedor en el rango de fechas seleccionado.
  - El proveedor "Local" (transcripción con `whisper.cpp`) aparece con costo $0, no se omite de la leyenda.

### 10.3. Ver el total acumulado

- **ID**: CT-003
- **Descripción**: Como usuario, quiero ver el total gastado en el período visible y el total histórico, para tener una cifra de referencia rápida sin sumar manualmente.
- **Criterios de aceptación**:

  - Se muestra una cifra destacada con el total del rango/granularidad actualmente seleccionado.
  - Se muestra por separado el total histórico acumulado desde el primer evento registrado.

### 10.4. Registrar automáticamente el uso de cada llamada a IA

- **ID**: CT-004
- **Descripción**: Como usuario, quiero que cada llamada a un LLM, embedding, transcripción o rerank se registre automáticamente con su costo, sin tener que hacer nada manual.
- **Criterios de aceptación**:

  - Toda llamada exitosa a `streamSummary`, `generateQuiz`, `chat`, `extractAffiliationsWithAI`, `extractPaperMetadata`, `interpretImage`, `generateEmbedding`, `transcribe` y la función de rerank inserta una fila en `usage_events`.
  - El registro ocurre dentro del método del proveedor, no en el IPC handler que lo llama — un call site nuevo que use un método de proveedor ya existente queda instrumentado sin cambios adicionales.
  - El registro incluye tokens/segundos/unidades reales devueltos por el proveedor, no una estimación.
  - Si la llamada a IA falla, no se registra un evento de uso parcial ni se cobra costo por una llamada que no se completó.

### 10.5. Calcular el costo con el precio vigente y congelarlo

- **ID**: CT-005
- **Descripción**: Como usuario, quiero que el costo de cada llamada se calcule con el precio vigente ese día y quede congelado, para que mi historial de gasto no cambie retroactivamente si el proveedor sube o baja precios después.
- **Criterios de aceptación**:

  - Al registrar un evento de uso, se busca el precio actual del modelo en `pricing_cache` y se guarda tanto el precio usado como el `cost_micro_usd` resultante (entero, en millonésimas de dólar) en la fila del evento.
  - Un cambio posterior en `pricing_cache` no modifica `cost_micro_usd` de eventos ya guardados.
  - Si el modelo no tiene precio disponible, el evento se guarda con `cost_micro_usd = null` y se refleja como "costo desconocido" en el dashboard, sin bloquear la acción principal del usuario.

### 10.6. Mantener la tabla de precios actualizada automáticamente

- **ID**: CT-006
- **Descripción**: Como usuario, quiero que la tabla de precios por modelo se actualice sola periódicamente, para no tener que buscar manualmente cuánto cobra cada proveedor por token.
- **Criterios de aceptación**:

  - Al iniciar la app, si la última actualización de `pricing_cache` tiene más de `pricingFetchIntervalDays` días, se dispara un fetch en segundo plano al JSON público de LiteLLM.
  - Si el fetch falla, la app sigue funcionando con la última tabla cacheada y no muestra ningún error bloqueante al usuario.
  - Si el JSON descargado no tiene el formato esperado (esquema cambiado, campos de precio faltantes o no numéricos), se descarta igual que un fetch fallido — nunca se acepta una tabla de precios parcialmente corrupta.
  - Settings muestra la fecha de la última actualización exitosa y un botón para forzar el refresh manualmente.

### 10.7. Corregir o agregar un precio manualmente

- **ID**: CT-007
- **Descripción**: Como usuario, quiero poder definir manualmente el precio de un modelo desde Settings, para cubrir modelos nuevos que la tabla automática todavía no tiene o corregir un valor que considero incorrecto.
- **Criterios de aceptación**:

  - Settings permite agregar un override de precio (proveedor + modelo + precio prompt/completion/audio).
  - Un override manual siempre tiene prioridad sobre el valor descargado de LiteLLM para ese mismo proveedor+modelo.
  - Los overrides persisten entre reinicios de la app (guardados en `settings`/`pricing_cache` con `source = 'manual'`).

### 10.8. Filtrar el dashboard por rango de fechas

- **ID**: CT-008
- **Descripción**: Como usuario, quiero acotar el gráfico de costos a un rango de fechas específico, para revisar el gasto de un período puntual (ej. solo el mes pasado).
- **Criterios de aceptación**:

  - Existe un selector de rango de fechas independiente del selector de granularidad (Día/Semana/Mes).
  - El gráfico, el desglose por proveedor y los totales se recalculan según el rango elegido.
  - El rango por defecto al abrir la sección es razonable (ej. últimas 8 semanas) sin requerir que el usuario configure nada la primera vez.

### 10.9. Ver el detalle de gasto por tipo de acción

- **ID**: CT-009
- **Descripción**: Como usuario, quiero ver cuánto gasté en cada tipo de acción (resumen, quiz, chat, embedding, transcripción, rerank) dentro del período filtrado, para entender no solo cuánto gasté sino en qué.
- **Criterios de aceptación**:

  - Debajo del gráfico principal hay una tabla o lista con el desglose por `action_type` dentro del rango/granularidad actual.
  - Cada fila muestra el tipo de acción, proveedor, cantidad de eventos y costo total.
  - La tabla respeta el mismo filtro de fechas que el gráfico.
