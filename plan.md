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

### 1. Afiliación pasa de filtro a señal de ranking (sin bloquear nunca)

- Deja de rechazar candidatos. Se sigue calculando (LLM sobre la primera
  página del PDF, o regex de fallback — lógica existente, sin cambios ahí),
  pero en vez de `continue` cuando no matchea, suma un bonus al `rankScore`
  (mismo patrón que el bonus de `kwRef`/`kwInterest`, +0.1).
- **Se mueve más temprano en el pipeline**: hoy el PDF (y por lo tanto la
  afiliación) recién se descarga para los 3 finalistas. Para que la señal
  influya en *quiénes* llegan a ser finalistas, tiene que calcularse antes
  del corte a `maxPapers` — o al menos antes de armar el orden final, no
  después.
- **UI**: los papers con afiliación en `universityList`/`researchCenterList`
  llevan una marca (★ o similar — **sin emoji**) junto al título/universidad
  en el vault, para que el usuario sepa cuáles leer primero. No hay badge
  para los que no matchean — ausencia de estrella, no una marca negativa.
- **Consecuencia**: el fallback de emergencia ([papers.js:267-274](src/ipc/papers.js#L267))
  deja de tener motivo de existir — se elimina. `saved.length` debería llegar
  a `maxPapers` con candidatos que de verdad pasaron el filtro de interés.

### 2. Se saca (o se sube mucho) `PRERANK_CAP`

- El cross-encoder corre local (`@xenova/transformers`, gratis, sin costo de
  API) — lo único que cuesta es tiempo, y esto corre una vez por semana en
  background.
- Se elimina el corte a top-15 antes del rerank, o se reemplaza por un tope
  defensivo alto (a definir en implementación — ej. 60, mismo espíritu que
  `FETCH_POOL_CAP=300` en `arxiv.js`: salvavidas, no diseño) para cubrir el
  caso de categorías absurdamente amplias.
- Con esto, el cross-encoder ve a *todos* (o casi todos) los que pasaron el
  filtro de interés, no solo los que sobrevivieron a una métrica más ruidosa.

### Fuera de alcance por ahora

- Unificar la base de comparación del pre-orden con la del rerank (usar el
  mismo `rerankQuery` concatenado en ambos pasos) — con el punto 2 hecho, el
  pre-orden dejaría de filtrar nada (solo ordenaría), así que esta
  inconsistencia deja de importar en la práctica. Revisar si igual conviene
  más adelante.
- Engordar la colección de referencia (hoy 5 papers) — ayudaría a la calidad
  del ranking, pero es un cambio de contenido del usuario, no de código.

## Pendiente (TDD — tests antes de implementar)

- [ ] `src/ipc/papers.js` — mover el cálculo de afiliación antes del corte a
      `maxPapers`; sumar bonus a `rankScore` en vez de `continue`/reject;
      eliminar el bloque de fallback y `orgRejects`
- [ ] `src/ipc/papers.js` — sacar o subir `PRERANK_CAP`
- [ ] `src/database.js` / vault — persistir si un paper matcheó afiliación
      (para poder pintar la estrella sin volver a calcular nada)
- [ ] `renderer/` — estrella junto al paper en el vault cuando matchea
      afiliación
- [ ] Actualizar `INGESTA.md` con la sección v3 una vez implementado, igual
      que se hizo con v2
