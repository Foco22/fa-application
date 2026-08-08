# Plan — Ajustes a la ingesta (v3)

> Continúa sobre INGESTA.md (v2, ya implementado). Este documento identifica
> por qué la ingesta semanal casi nunca trae papers que le interesan al
> usuario, y qué se va a ajustar. Sigue TDD: tests antes de tocar `runFetch()`.

## Diagnóstico (confirmado con código + 8 fetch-logs reales)

`maxPapers` está configurado en 3, pero la ingesta **nunca entregó más de 1
paper por semana** en 9 corridas históricas (revisar `vault/fetch-logs/`).
Dos causas independientes, confirmadas leyendo `src/ipc/papers.js`:

### Causa 1 — el filtro de universidad/centro es un muro tardío sobre un pool que no se repone

El filtro de `universityList`/`researchCenterList` ([papers.js:228-246](src/ipc/papers.js#L228))
corre **después** del rerank, solo sobre los `maxPapers` (3) ya elegidos. Si
los 3 fallan afiliación —lo normal para temas de práctica/ingeniería como
"context engineering" o "harness engineering", que se investigan fuera de
universidades top-20— no hay plan B: el candidato #4 nunca se prueba. Solo
existe un fallback de emergencia ([papers.js:267](src/ipc/papers.js#L267))
que guarda el #1 igual, sin filtro, para no terminar la semana en cero. En
8 de 9 corridas históricas, **ese fue el único camino por el que se guardó
algo** — el filtro real casi nunca "aprueba", solo rechaza.

### Causa 2 — el pre-orden y el rerank comparan contra bases distintas, y el corte pasa antes del paso preciso

- El pre-orden (`rankScore`, [papers.js:82](src/ipc/papers.js#L82)) compara
  el embedding del candidato contra **13 anchors sueltos** (5 papers de
  referencia + 8 keywords de `keywordList`) y toma el mejor match individual.
- El rerank real (cross-encoder, [src/rerank/index.js](src/rerank/index.js))
  compara contra **un solo párrafo concatenado** (`abstract_summary` de cada
  referencia + `keywordList`, todo junto — [papers.js:96](src/ipc/papers.js#L96)).
- `PRERANK_CAP = 15` corta al top 15 **usando el score grosero** antes de que
  el modelo preciso vea el resto ([papers.js:4](src/ipc/papers.js#L4)). Un
  candidato puede perder en el corte por una métrica más ruidosa, sin que el
  cross-encoder tenga oportunidad de corregirlo.

## Ajustes acordados

### 1. Afiliación deja de bloquear — pasa a ser una marca, no un filtro

- **Mismo alcance y costo que hoy**: se sigue revisando (descarga de PDF +
  IA sobre la primera página) solo para los `maxPapers` finalistas que ya
  eligió el rerank — no se expande a más candidatos. Decisión tomada a
  propósito para no multiplicar descargas/llamadas a IA por semana.
  Consecuencia aceptada: con este alcance, la afiliación **no reordena
  nada** (para cuando se calcula, ya no hay otro candidato con el que
  compararla) — es una marca informativa, no un bonus de ranking. Si más
  adelante se quiere que además influya en quién entra al cupo, hay que
  revisar afiliación para un pool más grande que `maxPapers` (fuera de
  alcance por ahora, ver nota de costo más abajo).
- En vez de rechazar/`continue` cuando no matchea, **el paper se guarda
  siempre**. Se agrega un flag (ej. `matched_affiliation`) que indica si la
  afiliación estaba en `universityList`/`researchCenterList`.
- **UI**: estrella (★ — **sin emoji**) junto al título/universidad en el
  vault cuando `matched_affiliation` es true. Ausencia de estrella para el
  resto — no es una marca negativa, solo no tiene el dato.
- **Consecuencia**: el fallback de emergencia ([papers.js:267-274](src/ipc/papers.js#L267))
  y todo el tracking de `orgRejects` dejan de tener motivo de existir — se
  eliminan. `saved.length` llega a `maxPapers` siempre que haya esa
  cantidad de candidatos que pasaron el filtro de interés + rerank.

### 2. Se elimina `PRERANK_CAP` — un solo rerank

- Se saca por completo el corte a top-15 antes del rerank. No queda un
  "pre-orden" que decida quién llega al rerank — **un solo paso de ranking**,
  no dos.
- Todos los candidatos que pasan el filtro de interés (el OR de las 4
  señales) van directo al rerank, sin importar cuántos sean.
- El rerank sigue siendo el **mismo modelo local que ya está integrado**
  ([src/rerank/index.js](src/rerank/index.js), cross-encoder
  `mxbai-rerank-xsmall-v1` vía `@xenova/transformers`) — no se agrega
  ninguna dependencia ni proveedor nuevo. Corre local y gratis; lo único que
  cuesta es tiempo, y esto corre una vez por semana en background.
- `rankScore` (el score grosero de embeddings) deja de usarse para ordenar o
  cortar candidatos — como mucho queda para el caso borde sin `rerankQuery`
  (ver abajo).

### Fuera de alcance por ahora

- La inconsistencia entre bases de comparación (13 anchors sueltos vs. query
  concatenado) deja de importar: con el punto 2, el score de embeddings ya
  no ordena ni corta nada — el único orden real lo pone el rerank.
- Engordar la colección de referencia (hoy 5 papers) — ayudaría a la calidad
  del ranking, pero es un cambio de contenido del usuario, no de código.
- Revisar afiliación para un pool más grande que `maxPapers` (para que
  además influya en quién entra al cupo, no solo en la estrella) — se
  decidió a propósito mantener el mismo costo de hoy (~`maxPapers` descargas
  + llamadas a IA por semana); revisar si vale la pena más adelante.

## Pendiente (TDD — tests antes de implementar)

- [x] `src/ipc/papers.js` — dejar de rechazar/`continue` cuando la afiliación
      no matchea; guardar siempre con un flag `matched_affiliation`;
      eliminar el bloque de fallback y `orgRejects`
- [x] `src/ipc/papers.js` — eliminar `PRERANK_CAP` y el corte a top-15; todos
      los que pasan el filtro de interés van al rerank
- [x] `src/database.js` / vault — persistir si un paper matcheó afiliación
      (para poder pintar la estrella sin volver a calcular nada)
- [x] `renderer/` — estrella junto al paper en el vault cuando matchea
      afiliación
- [x] Actualizar `INGESTA.md` con la sección v3 una vez implementado, igual
      que se hizo con v2
