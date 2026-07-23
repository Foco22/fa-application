# PRD: Pantalla de bienvenida ("sin cuenta") + nudge de configuración pendiente

## 1. Resumen del producto

### 1.1 Título del documento y versión

- PRD: Pantalla de bienvenida ("sin cuenta") + nudge de configuración pendiente
- Versión: 1.0

### 1.2 Resumen del producto

Hoy, la primera vez que se abre la app, `renderer/app.js:383-385` llama a `checkOnboarding()` y, si `onboardingDone !== "true"`, fuerza un wizard de 4 pasos (`renderer/index.html:16-96`, `renderer/modules/onboarding.js`) que bloquea el acceso al layout principal hasta elegir categorías, universidades, autores, día/hora de fetch y cargar una API key. Es un gate **duro**: no hay forma de ver la app sin completar los 4 pasos.

Esta feature reemplaza ese primer gate por una pantalla mínima de "sin cuenta": el logo de la app centrado arriba, un campo para que el usuario escriba su nombre (ej. "Francisco") y un botón "Aceptar" al centro. Al aceptar, se guarda el nombre y se entra **directo** al layout principal de 3 paneles — sin pasar por categorías, universidades, autores ni API key todavía. La app es local y mono-usuario (no hay login, password ni sincronización); esto no es autenticación, es solo un nombre para personalizar la interfaz.

Como la app ahora se puede abrir sin ninguna categoría, autor o API key configurados, el botón de Settings en la barra de actividad (`#act-settings`, `renderer/index.html:158-164`) gana un indicador visual (punto/badge) cuando falta configuración mínima para que el fetch funcione, guiando al usuario a terminarla cuando él quiera — no antes de dejarlo entrar.

El nombre guardado se usa también para un saludo "Hola, {nombre}" que aparece en el topbar, junto al logo (`.app-logo-wrap`, `renderer/index.html:104-106`), lado izquierdo.

## 2. Objetivos

### 2.1 Objetivos de negocio

- Bajar la fricción de la primera apertura: hoy el usuario debe tomar 4 decisiones de configuración antes de ver una sola pantalla de la app; con este cambio ve la app en dos clics (nombre + Aceptar).
- Mantener la app usable y honesta sobre su estado: si falta configuración para que el fetch funcione, debe ser visible en todo momento (no un error sorpresivo al apretar "Fetch"), no bloqueante.

### 2.2 Objetivos del usuario

- Entrar a la app rápido la primera vez, sin sentir que hay que "llenar un formulario largo" antes de poder mirar algo.
- Ver su nombre reflejado en la interfaz ("Hola, Francisco"), como señal de que la app es suya.
- Saber, de un vistazo y en todo momento, si todavía falta configurar algo para que la ingesta semanal de papers funcione — sin tener que entrar a Settings a revisar manualmente.

### 2.3 No-objetivos (fuera de alcance v1)

- **No es autenticación real.** No hay password, no hay validación de identidad, no hay backend de cuentas. El nombre es un string cosmético guardado localmente.
- **No hay multi-perfil ni multi-usuario.** Un solo nombre por instalación, igual que hoy es un solo set de settings por instalación. No hay selector de perfil ni "cerrar sesión".
- **El nombre no se inyecta en los prompts de IA.** No cambia `src/llm/prompts.js` ni `src/chat/prompts.js`. Es puramente de interfaz (ver §8.1).
- **No hay foto de perfil / avatar.** Solo texto.
- **No reemplaza la validación de `runFetch()`.** El aviso "Configura al menos un tema o autor en Settings" que ya dispara `src/ingestion/arxiv.js` cuando `categoryList` y `authorList` están ambos vacíos (ver `CLAUDE.md`) se mantiene intacto; esta feature solo agrega la señal *proactiva* (antes de que el usuario intente el fetch y falle).
- **No decide el layout final de Settings.** La categoría/sección exacta donde vive cada campo (temas, universidades, autores, API key) es la que ya existe hoy o la que defina `features/settings-redesign.md` — este PRD no reordena Settings, solo agrega el indicador de "falta algo" sobre el botón que ya existe.

## 3. Personas de usuario

### 3.1 Tipos de usuario clave

Un solo tipo: la persona que instala la app localmente para su propio uso (mono-usuario, sin roles).

### 3.2 Detalle de persona

Usuario técnico que quiere empezar a ver la app funcionar cuanto antes, y prefiere configurar los detalles (qué categorías de ArXiv, qué universidades, qué autores seguir) con calma después, en vez de que se lo exijan todo de entrada.

### 3.3 Acceso por rol

No aplica — no hay roles ni permisos diferenciados.

## 4. Requerimientos funcionales

- **Pantalla de bienvenida** (Prioridad: Alta)
  - Reemplaza el `#onboarding` actual como pantalla de primer arranque.
  - Logo de la app (`../icon.png`, el mismo asset que hoy usa `.app-logo`) centrado en la parte superior.
  - Campo de texto para el nombre, con placeholder tipo "Francisco".
  - Botón "Aceptar" centrado debajo del campo.
  - Validación mínima: el nombre no puede quedar vacío ni ser solo espacios; se hace `trim()`. Sin límite de caracteres artificial más allá de un máximo razonable (ej. 40) para que no rompa el layout del saludo.
  - Al aceptar: guarda `userName` (trimmed) y `onboardingDone = "true"` en settings, oculta esta pantalla y muestra el layout principal (`showApp()`).
  - Fondo animado: un campo de puntos/estrellas que se desplazan lentamente hacia atrás (efecto parallax tipo "starfield"), puramente decorativo, detrás del logo/input/botón. Ver detalle visual en §5.4 y notas técnicas en §8.1.

- **Saludo en el topbar** (Prioridad: Alta)
  - Junto al logo en `.topbar-left`, agrega el texto "Hola, {userName}" (i18n: "Hello, {userName}" en inglés).
  - Se lee una sola vez al montar la app (`showApp()`) y no cambia hasta reiniciar o hasta que el nombre se edite desde Settings.

- **Edición del nombre después del primer arranque** (Prioridad: Media)
  - El nombre pasa a ser un campo editable en Settings (categoría General si ya existe, o el drawer actual si `settings-redesign.md` no se implementó todavía), para que un typo en el primer arranque no quede pegado para siempre sin reinstalar.

- **Indicador de configuración pendiente en Settings** (Prioridad: Alta)
  - El botón `#act-settings` de la barra de actividad muestra un punto/badge visible cuando la configuración mínima para que el fetch funcione está incompleta.
  - Condición de "incompleto": `categoryList` **y** `authorList` ambos vacíos, **o** no hay API key cargada para el proveedor LLM activo (`apiKey` vacío, según `settings.llmProvider`).
  - El indicador desaparece automáticamente en cuanto la condición deja de cumplirse (no requiere reiniciar la app — se reevalúa cada vez que se guardan settings).
  - Al pasar el mouse (`title`) o abrir Settings con el indicador activo, se muestra un mensaje explicando qué falta (ej. "Configura al menos un tema o autor, y tu API key, para poder buscar papers").

- **Migración de usuarios existentes** (Prioridad: Alta)
  - Instalaciones que ya tienen `onboardingDone === "true"` (completaron el wizard viejo) pero no tienen `userName` guardado: al abrir la app después de esta actualización, ven la pantalla de bienvenida **una sola vez** para capturar el nombre (sus settings existentes — categorías, universidades, autores, API key — no se tocan ni se piden de nuevo).
  - Regla operativa: la pantalla de bienvenida se muestra si `userName` está vacío, sin importar el valor de `onboardingDone`. `onboardingDone` deja de ser el gate; `userName` lo reemplaza.

## 5. Experiencia de usuario

### 5.1 Entry points y primer uso

Único entry point: abrir la app por primera vez (o por primera vez después de esta actualización, para instalaciones migradas). No hay forma de llegar a esta pantalla desde el layout principal — una vez que el nombre está guardado, no se vuelve a mostrar salvo que se borre `userName` manualmente (no expuesto en la UI).

### 5.2 Experiencia principal

1. Se abre la app. Aparece la pantalla de bienvenida: logo arriba al centro, campo de nombre, botón "Aceptar".
2. El usuario escribe su nombre y hace click en "Aceptar" (o Enter).
3. Entra directo al layout principal de 3 paneles, con "Hola, {nombre}" visible junto al logo en el topbar.
4. Como no configuró nada más todavía, el botón de Settings en la barra de actividad muestra el indicador de "falta configuración".
5. El usuario explora la app (vault vacío, sin papers) a su ritmo. Si intenta usar "Fetch" sin configurar categorías/autores, ve el aviso existente de `runFetch()` (sin cambios).
6. Cuando el usuario entra a Settings (por curiosidad o porque vio el indicador) y completa categorías/autores + API key, el indicador desaparece la próxima vez que la barra de actividad se re-renderiza.

### 5.3 Casos avanzados y edge cases

- **Nombre vacío al hacer click en "Aceptar":** se muestra un error inline (mismo patrón visual que `#step1-error` / `#step4-error` del wizard viejo), sin avanzar.
- **Usuario cierra la app antes de aceptar:** al reabrir, vuelve a ver la pantalla de bienvenida (no se guarda nada hasta el click en "Aceptar").
- **Instalación migrada sin `userName`:** ver §4, se le pide el nombre una sola vez sin re-pedir el resto de la configuración.
- **Usuario configura todo perfecto y luego borra su API key en Settings:** el indicador de Settings debe reaparecer (la condición se reevalúa, no queda "apagado para siempre" tras la primera vez que se cumplió).
- **Nombre con caracteres especiales / emojis:** se guarda y se muestra tal cual, sin sanitizar más allá de trim — es texto local, no se inyecta en HTML sin escapar (ver §8.4).

### 5.4 UI/UX destacados

- Layout centrado verticalmente, consistente visualmente con el wizard viejo que reemplaza (misma clase `.fullscreen`) pero con un fondo nuevo: un campo de puntos/estrellas pequeños que se desplazan lentamente hacia atrás (eje Z, tipo "starfield"/parallax), dando sensación de profundidad y movimiento sutil sin distraer del logo/input/botón que quedan al frente, estáticos.
  - El movimiento es continuo y lento (no un one-shot al cargar) mientras la pantalla de bienvenida está visible, y se detiene (se limpia el `requestAnimationFrame`/intervalo) apenas se hace `showApp()`, para no dejar un loop de animación corriendo en segundo plano sin que se vea.
  - Densidad y velocidad bajas — es ambientación, no un "salvapantallas": no debe competir visualmente con el campo de nombre ni el botón "Aceptar".
  - Respeta `prefers-reduced-motion`: si el sistema operativo tiene reducción de movimiento activada, el fondo se muestra estático (sin animar) en vez de forzar el efecto.
- El indicador de Settings es sutil (punto de color, no un badge numérico) — esto no es una bandeja de notificaciones, es una señal de estado.

## 6. Narrativa

Francisco instala Paper Learning por primera vez. Abre la app esperando poder mirar cómo se ve antes de comprometerse a llenar categorías de ArXiv, universidades y una API key. Ve el logo, escribe "Francisco", aprieta Aceptar, y ya está adentro — ve el layout vacío pero funcional, con "Hola, Francisco" saludándolo junto al logo. Nota un puntito en el ícono de Settings; lo abre cuando tiene un minuto, configura sus temas de interés y su API key de Anthropic, y el puntito desaparece. Nunca sintió que la app le exigiera nada antes de dejarlo entrar.

## 7. Métricas de éxito

### 7.1 Métricas centradas en el usuario

- Tiempo entre "abrir la app por primera vez" y "ver el layout principal" (hoy: tiempo de completar 4 pasos; con esta feature: tiempo de escribir un nombre).
- Proporción de instalaciones que llegan a completar configuración mínima (categorías/autores + API key) en algún momento después de entrar directo, vs. las que hoy completaban el wizard forzado (para confirmar que soltar el gate duro no significa que la gente nunca configura nada).

### 7.2 Métricas de negocio

No aplica — app local de un solo usuario, sin telemetría remota.

### 7.3 Métricas técnicas

- Ningún error de consola al abrir la app con `userName` vacío o ausente (instalación limpia).
- El indicador de Settings refleja el estado real de `categoryList`/`authorList`/`apiKey` sin falsos negativos (no debe quedar "apagado" si en realidad falta algo).

## 8. Consideraciones técnicas

### 8.1 Puntos de integración

- **`renderer/index.html`**: el bloque `#onboarding` (líneas 16-96) se reemplaza por un bloque más simple con logo + input + botón. Los 4 `wizard-step` y sus preguntas de categorías/universidades/autores/API key **no desaparecen del producto** — se mueven a Settings (si no viven ya ahí) como formularios editables en cualquier momento, no como wizard secuencial.
- **`renderer/modules/onboarding.js`**: se simplifica drásticamente; ya no maneja 4 pasos ni grids de categorías/universidades — solo captura el nombre y llama a `showApp()`. `finishOnboarding()` pasa de mandar `{apiKey, categoryList, universityList, ...}` a mandar solo `{userName}`.
- **`src/ipc/settings.js`**: `check-onboarding` cambia su condición de `onboardingDone === 'true'` a `!!db.getSetting('userName')` (ver §4, migración). `complete-onboarding` recibe y guarda `{userName}` únicamente; ya no es responsable de categorías/universidades/autores/API key (esos se guardan vía `save-settings`, como cualquier otro cambio en Settings).
- **`src/database.js` / tabla `settings`**: nueva clave `userName`, default `""`.
- **`renderer/app.js:383-385`**: sin cambios en la forma (`checkOnboarding()` → `showOnboarding()` o `showApp()`), pero el significado de "done" cambia de "wizard completo" a "tiene nombre".
- **Barra de actividad / `#act-settings`**: necesita leer el estado de settings (categoryList, authorList, apiKey del proveedor activo) cada vez que se abre el layout principal y cada vez que se guardan settings (`save-settings` ya existente), para decidir si mostrar el indicador. No requiere un IPC nuevo — puede calcularse en el renderer a partir de lo que ya devuelve `get-settings`.
- **Saludo en topbar**: se agrega un `<span>` dentro de `.topbar-left`, junto a `.app-logo-wrap`, poblado en `showApp()` con el `userName` ya cargado. Usa `t('hola-nombre', { name: userName })` en `renderer/i18n/es.js` / `en.js` para respetar el patrón de i18n existente (ver `CLAUDE.md` sección de internacionalización).
- **No toca `src/llm/prompts.js` ni `src/chat/prompts.js`** — confirmado explícitamente como no-objetivo (§2.3), a pedido directo del usuario.
- **Fondo animado ("starfield")**: se implementa con un `<canvas>` dentro del bloque de bienvenida, dibujado desde un módulo nuevo del renderer (ej. `renderer/modules/welcome-background.js`), consistente con el patrón de módulos ES ya usado (`onboarding.js`, `settings.js`). La CSP actual (`renderer/index.html:5`) tiene `script-src 'self'` — no se puede cargar ninguna librería externa de partículas vía CDN; el efecto se dibuja a mano con Canvas 2D (puntos con posición/velocidad simples, sin dependencias). Alternativa más liviana si se prefiere evitar canvas: puntos como `<div>`/`box-shadow` animados por CSS (`@keyframes` con `transform: translateZ`/`translateY`), sin JS de por medio — más barato en CPU pero menos flexible en densidad/profundidad. Cualquiera de las dos respeta la CSP sin cambios.

### 8.2 Almacenamiento de datos y privacidad

- `userName` es un string libre guardado en SQLite local, igual que el resto de la tabla `settings` — no sale de la máquina del usuario, no se envía a ningún proveedor de IA.
- Al renderizar el saludo, insertar el nombre como texto (`textContent`, no `innerHTML`) para evitar XSS si el usuario escribe algo con `<script>` o similar.

### 8.3 Escalabilidad y desempeño

Sin impacto en el resto de la app — un campo de texto adicional en una tabla key-value que ya existe. El único costo nuevo es el fondo animado, acotado a mientras la pantalla de bienvenida está visible (segundos, una sola vez en la vida útil normal de la instalación): cantidad de puntos y framerate deben mantenerse bajos (ej. `requestAnimationFrame` con un puñado de partículas, no cientos) para que no genere carga de CPU/GPU perceptible incluso en hardware modesto.

### 8.4 Posibles desafíos

- **Retrocompatibilidad del significado de `onboardingDone`**: hay que asegurarse de que ningún otro lugar del código dependa de `onboardingDone === "true"` significando "configuración completa" en vez de "wizard visto". Buscar todos los usos antes de cambiar la condición en `check-onboarding`.
- **Momento exacto de reevaluar el indicador de Settings**: si se calcula solo al abrir la app, un usuario que borra su API key en Settings y vuelve a la barra de actividad sin recargar no vería el punto reaparecer. Debe recalcularse tras cada `save-settings` exitoso, no solo al boot.
- **Longitud del nombre rompiendo el layout del topbar**: nombres muy largos podrían empujar otros elementos del topbar; conviene truncar visualmente con `text-overflow: ellipsis` en el saludo, no truncar el dato guardado.
- **Loop de animación del fondo sin limpiar**: si `showApp()` oculta la pantalla de bienvenida pero no cancela explícitamente el `requestAnimationFrame` (o `clearInterval`) del starfield, el loop sigue corriendo invisible en segundo plano indefinidamente. `welcome-background.js` debe exponer una función `stop()` que `showApp()` llame antes de ocultar `#onboarding`.

## 9. Hitos y secuenciación

### 9.1 Estimación del proyecto

Pequeño — 1-2 días. La mayor parte del trabajo es mover los formularios de categorías/universidades/autores/API key del wizard a Settings (si `features/settings-redesign.md` no se implementó antes, ver dependencia abajo) y simplificar `onboarding.js`.

### 9.2 Tamaño y composición del equipo

Una persona (frontend Electron + un cambio menor de schema/IPC).

### 9.3 Fases sugeridas

1. Agregar `userName` a `src/database.js` y ajustar `check-onboarding`/`complete-onboarding` en `src/ipc/settings.js`.
2. Reemplazar el HTML/JS del wizard por la pantalla de bienvenida (logo + input + botón).
3. Confirmar que los 4 formularios que salen del wizard (categorías, universidades, autores, API key+horario) ya son accesibles y editables desde Settings sin pasar por el wizard — si no lo son todavía, moverlos ahí como parte de esta fase.
4. Agregar el saludo "Hola, {nombre}" en el topbar.
5. Agregar el indicador de configuración pendiente sobre `#act-settings`, recalculado tras cada `save-settings`.
6. Actualizar `tests/e2e/onboarding.spec.js` y los tests unitarios de `src/ipc/settings.js` para la nueva condición de gate.

**Nota de dependencia:** si esta feature se implementa antes que `features/settings-redesign.md`, los campos de categorías/universidades/autores/API key deben poder editarse desde el drawer de Settings **actual** (el de pantalla completa descrito en `CLAUDE.md`), aunque ese drawer todavía no tenga el layout tipo Obsidian. No hay que esperar al rediseño de Settings para poder soltar el wizard.

## 10. Historias de usuario

### 10.1. Entrar a la app por primera vez sin configurar nada

- **Título:** Ver el layout principal con solo mi nombre
- **Historia:** Como usuario nuevo, quiero escribir mi nombre y entrar directo a la app, sin tener que elegir categorías, universidades o cargar una API key todavía.
- **Criterios de aceptación:**
  - Al abrir la app sin `userName` guardado, se ve la pantalla de bienvenida (logo + campo + botón).
  - Al escribir un nombre válido y aceptar, se guarda `userName` y se muestra el layout principal.
  - No se pide ninguna otra configuración en este flujo.

### 10.2. Ver mi nombre reflejado en la interfaz

- **Título:** Saludo personalizado en el topbar
- **Historia:** Como usuario que ya configuró su nombre, quiero ver "Hola, {nombre}" junto al logo, para sentir que la app reconoce quién soy.
- **Criterios de aceptación:**
  - El saludo aparece en `.topbar-left`, junto al logo, apenas se carga el layout principal.
  - El texto usa el `userName` guardado, sin necesidad de reiniciar la app tras el primer arranque.
  - Si el nombre se edita luego en Settings, el saludo se actualiza sin tener que reinstalar.

### 10.3. Saber que me falta configurar algo, sin que me bloqueen

- **Título:** Indicador de configuración pendiente en Settings
- **Historia:** Como usuario que entró directo sin configurar categorías/autores/API key, quiero ver una señal clara en el ícono de Settings de que algo falta, para completar la configuración cuando yo decida.
- **Criterios de aceptación:**
  - El botón de Settings muestra un indicador visual mientras `categoryList` y `authorList` están ambos vacíos, o falta la API key del proveedor activo.
  - El indicador desaparece automáticamente al completar la configuración mínima, sin recargar la app.
  - El indicador reaparece si el usuario vuelve a dejar la configuración incompleta (ej. borra su API key).

### 10.4. Corregir un typo en mi nombre

- **Título:** Editar el nombre después del primer arranque
- **Historia:** Como usuario que escribió mal su nombre en el primer arranque, quiero poder corregirlo desde Settings sin tener que reinstalar la app.
- **Criterios de aceptación:**
  - Settings tiene un campo editable para `userName`.
  - Al guardar, el saludo del topbar se actualiza con el nuevo valor.

### 10.5. Migrar sin perder mi configuración existente

- **Título:** Actualizar la app sin repetir el wizard viejo
- **Historia:** Como usuario que ya completó el wizard de 4 pasos en una versión anterior, quiero que al actualizar solo me pidan el nombre, sin tener que reconfigurar categorías, universidades, autores o mi API key.
- **Criterios de aceptación:**
  - Si `onboardingDone === "true"` pero `userName` está vacío, se muestra la pantalla de bienvenida (solo el campo de nombre).
  - Ninguno de los settings existentes (`categoryList`, `authorList`, `universityList`, `apiKey`, etc.) se borra ni se vuelve a pedir.
