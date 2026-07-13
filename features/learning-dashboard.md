# PRD: Dashboard de evolución de aprendizaje

## 1. Resumen del producto

### 1.1 Título del documento y versión

- PRD: Dashboard de evolución de aprendizaje
- Versión: 1.0

### 1.2 Resumen del producto

Paper Learning ya registra dos señales de aprendizaje que hoy solo se ven paper por paper: las clases que el usuario da presentándole un paper a un estudiante virtual (`class_sessions`, con `duration`, `clarity_score` 0-100 y un `feedback` JSON que desglosa `presentationScore` y `qaScore`) y los quizzes de comprensión (`quiz_results`, con `score`/`total` por intento). No existe ninguna vista agregada de esas dos señales a lo largo del tiempo — para saber "¿di clase esta semana?" o "¿estoy mejorando en los quizzes?" el usuario tendría que revisar paper por paper manualmente.

Esta feature agrega un nuevo dashboard "Aprendizaje" con dos partes: (1) cuántas clases se dieron por semana, comparadas contra una meta mínima fija de 1 clase por semana, con un indicador de racha (semanas consecutivas cumpliendo la meta) y (2) la evolución del rendimiento — tanto de las clases (desglosado en exposición oral vs. respuesta a preguntas) como de los quizzes — para ver si el usuario está mejorando con el tiempo, no solo si está siendo constante.

El dashboard vive en una nueva sección de la barra de actividad lateral, al mismo nivel que Papers, Fetch, Chat y Settings.

## 2. Objetivos

### 2.1 Objetivos de negocio

- Reforzar el hábito de estudio semanal que es el objetivo central del proyecto (ver visión general en `CLAUDE.md`), haciendo visible cuándo se cumple o se rompe la constancia.

### 2.2 Objetivos del usuario

- Saber de un vistazo si ya cumplió su meta mínima de dar al menos una clase esta semana.
- Ver si su rendimiento en las clases y en los quizzes mejora, empeora o se estanca a lo largo del tiempo.
- Identificar si lo que falla es explicar con claridad (exposición) o resolver preguntas de los estudiantes (Q&A), en vez de solo ver un número combinado.
- Sentir el refuerzo de una racha de semanas consecutivas cumpliendo la meta, como motivación a mantenerla.

### 2.3 No-objetivos (fuera de alcance v1)

- Meta semanal configurable — v1 usa una meta fija de 1 clase/semana, sin opción de ajuste en Settings.
- Recomendaciones automáticas o coaching generado por IA sobre cómo mejorar (ej. "deberías repasar X tema") — el dashboard es de visualización, no de sugerencias.
- Notificaciones/recordatorios proactivos si la semana está por terminar sin clase dada (posible v2).
- Comparación entre papers específicos o ranking de qué paper generó mejor score — el dashboard agrega en el tiempo, no compara entidades.

## 3. Personas de usuario

### 3.1 Tipos de usuario clave

- Usuario único de la app (uso personal de escritorio, sin multiusuario).

### 3.2 Detalle de persona

- **Investigador/estudiante independiente**: da clases simuladas y responde quizzes para consolidar lo que lee; quiere confirmar que mantiene el hábito semanal y ver si de verdad está mejorando, no solo acumulando actividad.

### 3.3 Acceso por rol

- No aplica — la app no tiene roles ni multiusuario.

## 4. Requerimientos funcionales

- **Conteo de clases por semana** (Prioridad: Alta)

  - Se agrupan las filas de `class_sessions` por semana (lunes–domingo, mismo criterio de ventana usado en `src/scheduler.js` para el fetch de ArXiv) y se cuenta cuántas clases (`COUNT(*)`) hubo en cada semana.
  - Un gráfico de barras muestra el conteo semanal en el rango visible, con una línea de referencia horizontal en el valor de la meta (1 clase/semana).
  - Cada semana se marca visualmente como "cumplida" o "no cumplida" según si el conteo es ≥ 1.

- **Indicador de racha** (Prioridad: Alta)

  - Racha actual: número de semanas consecutivas (contando hacia atrás desde la semana actual o la última semana con datos) con ≥ 1 clase.
  - Mejor racha histórica: la racha más larga registrada desde que existen datos.
  - Si la semana en curso todavía no tiene clase pero no ha terminado, no cuenta como racha rota todavía (se evalúa solo con semanas ya completas, más la semana actual como "en progreso" si ya cumplió). El corte de racha ocurre exactamente al pasar la medianoche del domingo al lunes (00:00): en ese momento la semana recién terminada se evalúa como completa, y si no cumplió la meta la racha se reinicia a 0.

- **Rendimiento en clases, desglosado** (Prioridad: Alta)

  - Gráfico de tendencia con el promedio semanal de `clarity_score` a lo largo del tiempo — misma granularidad semanal que el gráfico de conteo de clases, para que ambos se lean de forma consistente en el mismo panel.
  - Dos series adicionales (togglables o superpuestas) con el promedio semanal de `presentationScore` y `qaScore`, extraídos del campo `feedback` (JSON) de cada `class_session` que caiga en esa semana.
  - Promedio de cada una de las tres métricas (general, exposición, Q&A) en el rango visible, mostrado como cifra destacada.

- **Rendimiento en quizzes** (Prioridad: Alta)

  - Gráfico de tendencia con el promedio semanal del porcentaje de acierto (`score / total * 100`) de los intentos de `quiz_results`, con la misma granularidad semanal que los demás gráficos del dashboard.
  - Promedio de acierto en el rango visible, mostrado como cifra destacada.
  - Si hay varios intentos de quiz (del mismo paper o de distintos) dentro de la misma semana, se promedian juntos en el punto de esa semana — no se grafican como eventos individuales, para mantener consistencia visual con el resto del dashboard.

- **Filtro de rango de fechas** (Prioridad: Media)

  - Selector de rango (ej. últimas 8 semanas, últimos 3 meses, todo el historial) que afecta el gráfico de clases por semana y los dos gráficos de rendimiento por igual.

- **Estado vacío** (Prioridad: Media)

  - Si no hay clases ni quizzes registrados aún, el dashboard muestra un mensaje explicativo en vez de gráficos vacíos, invitando a dar la primera clase o resolver el primer quiz.

## 5. Experiencia de usuario

### 5.1 Entry points y primer uso

- El usuario hace clic en el nuevo ícono "Aprendizaje" en la barra de actividad; si nunca dio una clase ni resolvió un quiz, ve el estado vacío explicando qué va a llenar el dashboard.
- No requiere configuración adicional — usa datos que ya existen en `class_sessions` y `quiz_results`.

### 5.2 Experiencia principal

- **Confirmar la meta semanal**: el usuario abre el dashboard un domingo por la noche y ve de inmediato, en la primera fila de la sección, si la semana actual ya está marcada como cumplida o si todavía necesita dar una clase.

  - Da la respuesta a la pregunta más urgente ("¿ya cumplí esta semana?") sin tener que interpretar un gráfico.

- **Ver la racha**: junto al conteo semanal, el usuario ve su racha actual (ej. "3 semanas seguidas") y su mejor racha histórica.

  - Refuerza el hábito con una métrica de constancia, no solo de volumen.

- **Revisar si está mejorando**: el usuario baja a la sección de rendimiento y compara sus últimas clases con las primeras — ve si el score de exposición subió con la práctica, o si el score de Q&A sigue bajo porque le cuesta responder preguntas improvisadas.

  - Aísla la causa del problema (explicar vs. responder) en vez de un número combinado que esconde cuál de las dos habilidades falla.

- **Revisar el quiz**: el usuario ve su tendencia de aciertos en quizzes junto a la de clases, en el mismo dashboard, para relacionar ambas señales de comprensión.

### 5.3 Casos avanzados y edge cases

- Semana con más de una clase → cuenta igual como "cumplida", el conteo semanal simplemente muestra el número real (ej. 3), no se topa en 1.
- Clase sin `clarity_score` (sesión abandonada antes de `class-end-session`, o transcripción vacía que solo generó `presentationScore: 0`) → se excluye del promedio de rendimiento pero sí cuenta para el conteo semanal de "clases dadas", ya que la sesión existe.
- `feedback` con JSON malformado o ausente (sesiones antiguas antes de este desglose, si las hubiera) → esa fila no aporta al promedio semanal de `presentationScore`/`qaScore` (via `json_extract` devolviendo `NULL`), pero sí sigue contando en el promedio de `clarity_score` y en el conteo semanal de clases dadas.
- Primera semana de uso con datos parciales (ej. jueves) → no se marca como "racha rota" prematuramente; se evalúa igual que cualquier semana en curso, y el corte solo ocurre al llegar el lunes 00:00 siguiente.
- Varios intentos de un mismo quiz en la misma semana → se promedian en el punto de esa semana, no se grafican como eventos individuales (ver "Rendimiento en quizzes" en la sección 4).

### 5.4 UI/UX destacados

- Fila superior con dos cifras destacadas: "Semana actual: cumplida ✓ / pendiente" y "Racha: N semanas".
- Gráfico de barras semanal con línea de meta, seguido de los dos gráficos de tendencia de rendimiento (clases y quiz) en el mismo panel, sin necesidad de cambiar de sección.
- Colores consistentes: un color para `presentationScore`, otro para `qaScore`, un tercero para el score de quiz — reutilizando la misma paleta que el resto de la app.

## 6. Narrativa

El usuario abre la app un domingo para planear su semana de estudio. Entra a la nueva sección "Aprendizaje" y ve que lleva 3 semanas seguidas cumpliendo su meta de dar al menos una clase — una pequeña victoria que refuerza el hábito. Baja al gráfico de rendimiento y nota que su `presentationScore` viene subiendo constantemente, pero su `qaScore` se ha estancado: le sigue costando responder preguntas improvisadas de los estudiantes virtuales. Revisa también su tendencia de aciertos en quizzes, que confirma que entiende bien el contenido pero le falta soltura para explicarlo en vivo bajo preguntas. Con esa información, decide que esta semana va a enfocarse en practicar más rondas de Q&A en vez de solo pulir la exposición.

## 7. Métricas de éxito

### 7.1 Métricas centradas en el usuario

- El usuario puede confirmar si cumplió la meta semanal y ver su racha en menos de 5 segundos desde que abre el dashboard.
- El usuario puede identificar, sin ambigüedad, si su punto débil es la exposición o el Q&A con solo mirar el gráfico de rendimiento de clases.

### 7.2 Métricas de negocio

- Aumento en la frecuencia de clases dadas por semana a lo largo del tiempo, atribuible a la visibilidad de la racha y la meta.

### 7.3 Métricas técnicas

- El cálculo de semana, racha y promedios corre sobre los datos existentes de `class_sessions`/`quiz_results` sin requerir nuevas tablas ni migraciones de datos históricos.
- Los gráficos cargan y se recalculan en menos de 300ms con el volumen de datos esperado (uso personal, cientos de filas como máximo).

## 8. Consideraciones técnicas

### 8.1 Puntos de integración

- Nuevas funciones de agregación en `src/database.js` (o un módulo nuevo `src/learning-stats/index.js` para no sobrecargar `database.js`): `getClassSessionsByWeek(from, to)`, `getQuizResultsByRange(from, to)`, `getWeeklyStreak()` — todas son una **única query SQL con `GROUP BY`** sobre las tablas existentes, no requieren nuevas columnas ni agregación en JavaScript.
- El "lunes de la semana" de cada fila se calcula dentro del propio SQL con una expresión de fecha, para no duplicar la lógica de `src/scheduler.js` en dos lenguajes distintos:

  ```sql
  SELECT date(created_at, '-' || ((CAST(strftime('%w', created_at) AS INTEGER) + 6) % 7) || ' days') AS week_start,
         COUNT(*) AS count
  FROM class_sessions
  GROUP BY week_start
  ORDER BY week_start
  ```

  `strftime('%w', created_at)` da 0=domingo..6=sábado; `(%w + 6) % 7` da los días transcurridos desde el lunes de esa semana, y restarlos de la fecha da el lunes correspondiente — la misma aritmética modular que usa `src/scheduler.js` (`(dayOfWeek + 6) % 7`) para calcular la ventana semanal del fetch de ArXiv, solo que expresada en SQL en vez de JavaScript. `getQuizResultsByRange` y `getWeeklyStreak` reusan la misma expresión `week_start` para agrupar `quiz_results` y para detectar semanas consecutivas.
  - Se recomienda un test que compare, para un rango de fechas de varios años, que esta expresión SQL y la función de `src/scheduler.js` calculan el mismo lunes para las mismas fechas — son dos implementaciones del mismo criterio (una en SQL, otra en JS) y deben mantenerse sincronizadas.
- Nuevo dominio IPC `src/ipc/learning-stats.js` (o extender `src/ipc/learning.js`), registrado en `src/ipc/index.js`: `get-weekly-class-counts`, `get-class-performance-trend`, `get-quiz-performance-trend`, `get-weekly-streak`.
- Nueva sección en `renderer/index.html`/`app.js`/`styles.css`: botón `act-learning` (o `act-dashboard`) en la barra de actividad, junto a `act-papers`/`act-fetch`/`act-chat`/`act-settings`, y su panel con los gráficos. Usa **Chart.js** (`node_modules/chart.js/dist/chart.umd.js`), cargado con un `<script>` local igual que `pdfjs-dist` (`renderer/index.html:899`) — misma librería que `features/cost-tracking.md`, evitando introducir dos dependencias de charting distintas. El gráfico de barras semanal usa un dataset `line` plano en y=1 como referencia visual de la meta; los gráficos de rendimiento usan datasets `line` para `clarity_score`, `presentationScore`, `qaScore` y % de acierto de quiz.

### 8.2 Almacenamiento de datos y privacidad

- No se requieren tablas nuevas — toda la data ya existe en `class_sessions` (`duration`, `clarity_score`, `feedback`, `created_at`) y `quiz_results` (`score`, `total`, `taken_at`).
- El campo `feedback` de `class_sessions` debe parsearse como JSON al leer para extraer `presentationScore`/`qaScore`; hay que manejar el caso de JSON inválido o ausente sin lanzar excepción (ver edge case en 5.3).
- Todo el cálculo es local, sin llamadas a servicios externos ni a proveedores de IA — es agregación pura sobre SQLite.

### 8.3 Escalabilidad y desempeño

- Volumen esperado bajo (uso personal, unas pocas clases y quizzes por semana) — las agregaciones por semana se resuelven con la expresión `week_start` de 8.1 en una sola query `GROUP BY`, sin necesidad de precalcular ni cachear resultados.
- El cálculo de racha se resuelve leyendo las semanas (`week_start`) con al menos una clase, ordenadas, y contando la secuencia consecutiva desde la más reciente — no requiere una tabla de rachas separada ni jobs en segundo plano: el corte de racha ocurre naturalmente en el momento en que la query incluye una semana más que ya terminó sin clases (ver 8.4).

### 8.4 Posibles desafíos

- El desglose `presentationScore`/`qaScore` vive dentro de un campo `TEXT` (`feedback`) serializado como JSON, no en columnas propias. Para agregarlo por semana dentro de la misma query SQL (en vez de traer filas y parsear en JS) se usa la extensión JSON1 de SQLite, ya disponible en `better-sqlite3`: `AVG(json_extract(feedback, '$.presentationScore'))` / `AVG(json_extract(feedback, '$.qaScore'))` agrupado por `week_start`. `json_extract` sobre un JSON malformado o un campo `NULL` devuelve `NULL` en vez de lanzar error, así que esas filas simplemente no aportan al promedio de la semana sin romper la query (parseo defensivo "gratis" del lado de SQLite).
- **Racha — corte exacto**: la racha se recalcula cada vez que se abre el dashboard, contando hacia atrás las semanas completas (lunes–domingo) consecutivas que cumplieron la meta. La semana en curso solo se suma a la racha si ya tiene ≥ 1 clase; si todavía no tiene ninguna, no rompe la racha (queda "en progreso") hasta que esa semana termine. El corte ocurre exactamente **al pasar la medianoche del domingo al lunes (00:00)**: en ese instante la semana recién terminada entra al cálculo como una semana completa más, y si no cumplió la meta la racha se reinicia a 0 — es un efecto natural de la query (no hace falta ningún job en segundo plano ni acción del usuario), pero depende de que `occurred_at`/`created_at` y el reloj usado para "hoy" estén en la misma zona horaria; conviene fijar explícitamente si esas comparaciones se hacen en UTC o en hora local del sistema, ya que `datetime('now')` de SQLite es UTC por defecto.
- Sesiones de clase abandonadas a mitad de camino (nunca llegan a `class-end-session`) tienen `clarity_score: null` — hay que decidir explícitamente si cuentan para el conteo semanal de "clases dadas" (sí, según el edge case en 5.3) aunque no aporten dato de rendimiento.

## 9. Hitos y secuenciación

### 9.1 Estimación del proyecto

- Chico-mediano: 3-5 días de desarrollo (es agregación sobre datos existentes, sin nuevo esquema de datos ni nuevos proveedores de IA que instrumentar).

### 9.2 Tamaño y composición del equipo

- 1 desarrollador full-stack (Electron/Node + SQLite + frontend vanilla JS), siguiendo TDD como el resto del proyecto.

### 9.3 Fases sugeridas

- **Fase 1**: Funciones de agregación con tests (`getClassSessionsByWeek`, `getQuizResultsByRange`, `getWeeklyStreak`) (1-2 días)

  - Lógica de semana consistente con `src/scheduler.js`, cálculo de racha, parseo defensivo de `feedback` JSON.

- **Fase 2**: Dominio IPC + panel del dashboard en el renderer (2-3 días)

  - Nuevo botón `act-learning` en la barra de actividad, panel con las cifras destacadas (meta semanal, racha), gráfico de barras semanal y los dos gráficos de tendencia de rendimiento, filtro de rango de fechas, estado vacío.

## 10. Historias de usuario

### 10.1. Ver si cumplí la meta semanal de clases

- **ID**: LD-001
- **Descripción**: Como usuario, quiero ver de inmediato si ya di al menos una clase esta semana, para saber si cumplí mi meta mínima antes de que termine la semana.
- **Criterios de aceptación**:

  - El dashboard muestra, en un lugar destacado, si la semana actual (lunes-domingo) tiene ≥ 1 clase registrada en `class_sessions`.
  - El estado se marca visualmente distinto para "cumplida" vs. "pendiente".
  - El criterio de "semana" coincide con el usado en el fetch semanal de ArXiv (lunes a domingo).

### 10.2. Ver el conteo de clases por semana en el tiempo

- **ID**: LD-002
- **Descripción**: Como usuario, quiero ver cuántas clases di cada semana en un gráfico, para entender mi patrón de constancia a lo largo del tiempo.
- **Criterios de aceptación**:

  - Un gráfico de barras muestra el conteo de `class_sessions` agrupado por semana en el rango seleccionado.
  - Se muestra una línea o marca de referencia en el valor de la meta (1 clase/semana).
  - Cada barra se distingue visualmente si cumple o no la meta de esa semana.

### 10.3. Ver mi racha de semanas cumpliendo la meta

- **ID**: LD-003
- **Descripción**: Como usuario, quiero ver mi racha actual y mi mejor racha histórica de semanas cumpliendo la meta mínima, para sentirme motivado a mantener el hábito.
- **Criterios de aceptación**:

  - Se muestra la racha actual (semanas consecutivas más recientes con ≥ 1 clase).
  - Se muestra la mejor racha histórica registrada.
  - La semana en curso, si aún no ha terminado, no rompe una racha existente solo por no tener clase todavía (se evalúa como "en progreso").
  - El corte de racha ocurre exactamente al pasar la medianoche del domingo al lunes (00:00): si la semana recién terminada no cumplió la meta, la racha se reinicia a 0 en ese momento, sin esperar ninguna otra acción.

### 10.4. Ver la evolución de mi rendimiento en clases, desglosado

- **ID**: LD-004
- **Descripción**: Como usuario, quiero ver cómo evoluciona mi score de clase en el tiempo, separado en exposición oral y respuesta a preguntas, para saber cuál de las dos habilidades necesito practicar más.
- **Criterios de aceptación**:

  - Un gráfico de tendencia muestra el promedio semanal de `clarity_score`, con la misma granularidad semanal que el gráfico de conteo de clases.
  - Se muestran también las series de promedio semanal de `presentationScore` y `qaScore`, extraídas del campo `feedback` de cada sesión de esa semana.
  - Se muestra el promedio de cada una de las tres métricas en el rango visible.
  - Sesiones con `feedback` inválido o ausente no rompen el gráfico; simplemente no aportan al promedio semanal de las series desglosadas (sí siguen aportando a `clarity_score`).

### 10.5. Ver la evolución de mi rendimiento en quizzes

- **ID**: LD-005
- **Descripción**: Como usuario, quiero ver mi porcentaje de acierto en los quizzes a lo largo del tiempo, para saber si estoy comprendiendo mejor los papers que leo.
- **Criterios de aceptación**:

  - Un gráfico de tendencia muestra el promedio semanal del porcentaje de acierto (`score/total`) de los intentos de `quiz_results`, con la misma granularidad semanal que el resto del dashboard.
  - Se muestra el promedio de acierto en el rango visible.
  - Múltiples intentos (del mismo o de distintos papers) dentro de la misma semana se promedian en el punto de esa semana, no se grafican como eventos independientes.

### 10.6. Filtrar el dashboard por rango de fechas

- **ID**: LD-006
- **Descripción**: Como usuario, quiero acotar el dashboard a un rango de fechas específico, para revisar mi evolución en un período puntual.
- **Criterios de aceptación**:

  - Un selector de rango (ej. últimas 8 semanas / últimos 3 meses / todo el historial) afecta el gráfico semanal de clases y ambos gráficos de rendimiento a la vez.
  - El rango por defecto al abrir la sección es razonable (ej. últimas 8 semanas) sin requerir configuración previa.

### 10.7. Ver un estado vacío claro si aún no hay datos

- **ID**: LD-007
- **Descripción**: Como usuario nuevo, quiero un mensaje claro si todavía no tengo clases ni quizzes registrados, para entender qué necesito hacer para que el dashboard tenga datos.
- **Criterios de aceptación**:

  - Si no hay filas en `class_sessions` ni en `quiz_results`, el dashboard muestra un mensaje explicativo en vez de gráficos vacíos o rotos.
  - El mensaje invita a dar la primera clase o resolver el primer quiz desde la vista de un paper.
