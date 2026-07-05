

# Cómo funciona la ingesta de papers

> Este documento describe el pipeline **actual** (v1, ya implementado) y, al final,
> el **rediseño acordado** (v2, hybrid search + rerank) que todavía no está
> implementado — sirve como spec para cuando se implemente siguiendo TDD.

## Números clave

| Variable | Valor | Dónde se configura |
|---|---|---|
| Candidatos traídos de ArXiv | **50** | Hardcodeado en `src/ingestion/arxiv.js` (`FETCH_POOL`) |
| Papers guardados en DB | **3** (default) | Settings → `maxPapers` |
| Ventana de fechas | Lunes–domingo semana anterior | Calculado automáticamente |

---

## Flujo completo

```
ArXiv API
  → 50 candidatos de la semana anterior
        ↓
  [Filtro 1] Similitud semántica       ← se salta si no hay colección de referencia
        ↓
  Descarga PDF                         ← si falla → paper descartado
        ↓
  Extrae primera página del PDF
        ↓
  [Filtro 2] Universidades/Centros     ← se salta si orgFilter está vacío
        ↓
  Semantic Scholar API                 ← solo enriquece afiliaciones, NO filtra
        ↓
  Extrae texto completo (~30k chars)
        ↓
  Guarda en SQLite (status: ready)
        ↓
  Notifica al renderer → "N papers nuevos"

  Se detiene cuando saved.length === maxPapers
```

---

## Paso a paso real (`src/ipc/papers.js`)

### 1. Lee configuración
```
maxPapers            = settings.maxPapers      (default 3)
similarityThreshold  = settings.similarityThreshold (default 0.72)
orgFilter            = universityList + researchCenterList (combinados)
```

### 2. Carga embeddings de referencia desde DB
Si no hay ninguno indexado → el filtro de similitud se salta completamente.

### 3. `fetchPapers()` → ArXiv API
Construye la query combinando:
- **Ventana de fechas**: siempre la semana anterior completa (lunes 00:00 → domingo 23:59)
- **Categorías**: `cat:cs.AI OR cat:cs.LG OR ...`
- **Autores**: `au:LeCun OR au:Bengio OR ...`
- Si ambos están vacíos → aborta con error (no ejecuta el fetch)

Trae **50 papers** ordenados por fecha descendente.

### 4. Por cada paper (hasta guardar `maxPapers`)

**Filtro similitud semántica** (opcional)
- Genera embedding del abstract con OpenAI `text-embedding-3-small`
- Calcula similitud coseno contra cada paper de la colección de referencia
- Toma el score máximo
- Si score < 0.72 → `REJECTED`
- Si la API de OpenAI falla → **aborta todo el fetch** (no sigue con otros papers)

**Descarga PDF**
- Descarga de ArXiv via axios
- Si falla → paper descartado, continúa con el siguiente

**Extrae primera página**
- Usa `pdf-parse` sobre el buffer descargado
- Si falla Y hay `orgFilter` → elimina el PDF, paper descartado
- Si falla Y no hay `orgFilter` → continúa igual

**Filtro de universidades/centros** (opcional)
- Si `orgFilter` está vacío → se salta completamente
- Si hay `orgFilter`:
  - Primero intenta con el LLM (`extractAffiliationsWithAI`) sobre el texto de la primera página
  - Si el LLM no retorna nada → hace regex sobre el texto directamente
  - Si ninguna afiliación coincide → elimina el PDF, paper descartado
  - **Fallback**: si al terminar de procesar todos los candidatos seleccionados **ninguno** pasó este filtro (0 guardados), se guarda igual el mejor rankeado de los rechazados por universidad (el primero en orden de selección/rerank), en vez de dejar la semana sin ningún paper nuevo. Su PDF no se borra; el resto de los rechazados por este filtro sí. Queda marcado en `status`/log como guardado "como fallback"

**Semantic Scholar API**
- Llama con el ArXiv ID para obtener afiliaciones estructuradas
- Solo sirve para mostrar la universidad en la UI
- **No filtra** — si el paper ya pasó los filtros anteriores, Semantic Scholar no lo rechaza

**Extrae texto completo**
- Extrae hasta ~30.000 chars del PDF completo
- Este texto es el que usa Claude para generar el resumen y el quiz

**Guarda en DB**
- `status: ready` si el texto se extrajo bien
- `status: pdf_error` si el texto falló (pero el paper igual se guarda)

---

## Qué filtros están realmente activos

| Filtro | ¿Cuándo activo? |
|---|---|
| Similitud semántica | Solo si hay colección de referencia indexada Y hay API key de OpenAI |
| Universidades/Centros | Solo si `universityList` o `researchCenterList` no están vacíos en Settings |
| Ventana de fechas | Siempre (semana anterior, calculada en runtime) |
| `maxPapers` | Siempre |

---

## Debug: log de cada fetch

Cada corrida de `runFetch()` escribe un reporte de diagnóstico en
`<vault>/fetch-logs/<timestamp>.md` (legible) y `.json` (para inspección
programática). Sirve para entender por qué un paper puntual entró o no —
por ejemplo, si trajo un paper que no interesaba y hay que ajustar
`keywordList` o la colección de referencia.

Contiene, por cada candidato traído de ArXiv (título, autores, universidad
cuando se pudo determinar):

| Etapa (`stage`) | Significa que… |
|---|---|
| `saved` | Pasó todos los filtros y quedó guardado |
| `selection` | Rechazado en el filtro de interés (embedding/keyword vs. referencia o `keywordList`) — incluye los scores exactos |
| `rerank_cap` | Pasó el filtro de interés pero quedó fuera del top 15 antes del rerank |
| `maxpapers_cutoff` | Sobrevivió selección + rerank pero no entró en el cupo de `maxPapers` |
| `download` | Falló la descarga del PDF |
| `first_page` | Falló `extractFirstPage` y había filtro de universidad activo |
| `org_filter` | Se descargó el PDF pero la afiliación no coincide con `universityList`/`researchCenterList` — salvo que sea el fallback (ver abajo), en cuyo caso queda como `saved` con motivo "Guardado como fallback…" |
| `pending` (sin más etapa) | No hay `keywordList` ni colección de referencia configurada — pasan todos sin evaluar |

**Limitación conocida**: la universidad solo se conoce para candidatos que
llegan a descargarse (después de superar selección + rerank). Los
rechazados en `selection` o `rerank_cap` no tienen universidad en el log,
porque nunca se descarga su PDF — hacerlo solo para loguear encarecería
cada fetch sin necesidad.

Implementado en `src/ingestion/fetchLog.js` (`renderMarkdown`,
`writeFetchLog`) y conectado en `runFetch()` (`src/ipc/papers.js`) vía
`deps.writeFetchLog`.

## Archivos involucrados

| Archivo | Qué hace |
|---|---|
| `src/ipc/papers.js` | Orquesta todo el pipeline (`runFetch`) |
| `src/ingestion/arxiv.js` | Query a ArXiv, parsea el feed Atom, calcula ventana de fechas |
| `src/ingestion/downloader.js` | Descarga PDFs via axios |
| `src/ingestion/extractor.js` | `extractFirstPage()` y `extractText()` via pdf-parse |
| `src/ingestion/semanticscholar.js` | Enriquece afiliaciones (no filtra) |
| `src/embeddings/index.js` | Genera embeddings y calcula similitud coseno |
| `src/database.js` | `savePaper()`, `getReferencePapers()` |

---

# v2 — Rediseño: Hybrid Search + Rerank (pendiente de implementar)

## Problema que resuelve

El filtro v1 solo compara contra la colección de referencia (papers que el
usuario ya indexó). Esto genera una burbuja: nunca entra un paper de un tema
nuevo que el usuario no haya leído todavía, aunque le interese explícitamente.

## Pool de candidatos: paginación en vez de límite fijo de 50

v1 pide `max_results=50` ordenado por `submittedDate` descendente. Con
categorías amplias (ej. `cs.AI OR cs.LG OR cs.CL OR stat.ML`) una semana
puede tener 300–800 papers — el corte en 50 no es una muestra representativa,
es sesgada hacia **el final de la semana** (viernes–domingo), porque el orden
descendente por fecha deja afuera todo lo publicado lunes–miércoles.

**v2 pagina** en vez de cortar en un número fijo:
- Pide resultados en tandas (`start` offset de la API de ArXiv), respetando
  el rate limit recomendado (~1 request cada 3s)
- Sigue paginando hasta agotar los resultados de la ventana de esa semana
  (la ventana ya está acotada a 7 días, así que el total nunca es infinito)
- Tope defensivo: **300** candidatos — no es el diseño, es un salvavidas por
  si alguien selecciona una combinación de categorías absurdamente amplia
- El costo extra es despreciable: embeder 300–800 abstracts con
  `text-embedding-3-small` cuesta centavos, no es el cuello de botella

Así el filtro + rerank de dos etapas (que son los que realmente deciden) ven
el universo completo de esa semana, no un recorte sesgado por fecha.

## Idea central

Dos fuentes de interés, evaluadas cada una con **hybrid search** (embedding +
keyword) sobre el abstract del candidato:

1. **Conocido** — similitud contra la colección de referencia
2. **Interés declarado** — similitud contra `keywordList` (setting nuevo, uno
   por línea, igual formato que `authorList`)

## Señales por candidato (4 en total)

| # | Señal | Tipo | Umbral |
|---|---|---|---|
| 1 | `embSimRef` — coseno(embedding abstract, embedding referencia) | continuo 0–1 | ≥ **0.6** (antes 0.72, se relaja) |
| 2 | `kwOverlapRef` — ¿alguna keyword extraída de la referencia aparece literal en el abstract? | booleano | al menos 1 match exacto |
| 3 | `embSimInterest` — coseno(embedding abstract, embedding de cada keyword de `keywordList`) | continuo 0–1 | ≥ **0.6** |
| 4 | `kwOverlapInterest` — ¿alguna keyword de `keywordList` aparece literal en el abstract? | booleano | al menos 1 match exacto |

**Filtro (pasa/no pasa) = OR de las 4 señales.** Ninguna se promedia ni se
suma — basta con que una sola señal se cumpla para que el candidato avance.
Esto reemplaza el único filtro de similitud de v1.

## Resumen corto por paper de referencia (nuevo)

Al indexar un paper de referencia (`indexReferenceFolder` / `index-files`):
- Se calcula el embedding del abstract (igual que hoy)
- **Nuevo**: se genera un resumen corto (1–2 líneas) del abstract vía LLM y
  se guarda en `reference_papers.abstract_summary`
- Se resume **una sola vez** por paper, al indexarlo — no se recalcula toda
  la colección cuando se agrega un paper nuevo

## Pre-orden heurístico (antes del rerank)

Los candidatos que pasan el filtro pueden ser muchos (ej. 20). Para no pasarle
una lista larga al rerank de una:

```
rankScore = max(embSimRef, embSimInterest) + bonus
bonus     = +0.1 si kwOverlapRef o kwOverlapInterest fue true, si no 0
```

Se ordena por `rankScore` y se toma un tope fijo (**top 15**) antes de pasar
al rerank real.

## Rerank con cross-encoder local

- **Documentos** = abstracts de los candidatos (hasta 15) que pasaron el pre-orden
- **Query** = `concat(abstract_summary de cada paper de referencia, keywordList)`
  — se arma cada vez que corre el fetch, a partir de resúmenes ya calculados
  (no se regeneran)
- **Modelo**: cross-encoder local vía `@xenova/transformers` (ONNX, corre en
  Node sin Python) — `mixedbread-ai/mxbai-rerank-xsmall-v1` (alternativa:
  `Xenova/bge-reranker-base`). Se descarga la primera vez que se usa y se
  cachea localmente (no se bundlea en el instalador — la app ya depende de
  internet para todo lo demás, así que no tiene sentido inflar los 3
  instaladores de electron-builder con ~100–300MB para un caso sin uso offline real)
- Se descarta el rerank vía LLM: un cross-encoder está entrenado para
  comparar (query, documento) directamente, mientras que pedirle a un LLM que
  ordene una lista larga sufre degradación de precisión con listas grandes
  ("lost in the middle")
- Se toma el score de cada documento contra el query, se ordena, y se guardan
  los `maxPapers` (3) mejores

## Diagrama v2 completo

```
ArXiv API (paginado, tope defensivo 300)
  → todos los candidatos de la semana anterior que matchean categorías/autores
        ↓
  Por cada candidato: embedding(abstract) + keywords(abstract)
        ↓
  ┌────────────────────────────┬────────────────────────────┐
  │      Score "conocido"      │   Score "interés declarado" │
  │  (vs. colección referencia)│      (vs. keywordList)      │
  │                             │                              │
  │  embSimRef  (≥0.6)          │  embSimInterest  (≥0.6)      │
  │  kwOverlapRef (exact match)  │  kwOverlapInterest (exact)   │
  └──────────────┬──────────────┴───────────────┬──────────────┘
                 │                               │
                 └───────────────┬───────────────┘
                                 ↓
                  [Filtro] OR de las 4 señales
                                 ↓
                  Candidatos que sobreviven (ej. 20)
                                 ↓
                  [Pre-orden] rankScore = max(emb) + bonus keyword
                                 ↓
                  Top 15
                                 ↓
                  [Rerank] cross-encoder local (mxbai-rerank-xsmall-v1)
                    query = resúmenes de referencia + keywordList
                    documentos = abstracts de los 15
                                 ↓
                  Top maxPapers (3) por score de rerank
                                 ↓
        ──────────────  pipeline v1 sin cambios desde acá  ──────────────
                                 ↓
                  Descarga PDF          ← si falla, descartado
                                 ↓
                  Extrae primera página
                                 ↓
                  [Filtro] Universidades/Centros   ← opcional
                                 ↓
                  Semantic Scholar API   (solo enriquece, no filtra)
                                 ↓
                  Extrae texto completo (~30k chars)
                                 ↓
                  Guarda en SQLite (status: ready)
                                 ↓
                  Notifica al renderer → "N papers nuevos"
```

## Cambios de datos y settings requeridos

| Cambio | Dónde |
|---|---|
| Nuevo setting `keywordList` | tabla `settings`, uno por línea igual que `authorList` |
| Nuevo campo `abstract_summary` | tabla `reference_papers` |
| Bajar `similarityThreshold` default de 0.72 a 0.6 | tabla `settings` |
| Nueva dependencia `@xenova/transformers` | `package.json` |
| Nuevo módulo `src/rerank/` | cross-encoder local, descarga/cachea el modelo |
| `FETCH_POOL = 50` → paginación con tope defensivo 300 | `src/ingestion/arxiv.js` |

## Pendiente (seguir TDD — tests antes de implementar)

- [ ] `src/ingestion/arxiv.js` — reemplazar `FETCH_POOL=50` fijo por paginación (`start` offset) hasta agotar la ventana semanal, tope defensivo 300
- [ ] `src/ingestion/keywords.js` — extracción de keywords del abstract (referencia y candidatos), matching literal
- [ ] `src/embeddings/index.js` — extender para embeder keywords de `keywordList`
- [ ] `src/llm/*` — método nuevo para generar `abstract_summary` al indexar referencia
- [ ] `src/rerank/index.js` — wrapper del cross-encoder (`@xenova/transformers`), interfaz `rerank(query, documents) → scores`
- [ ] `src/ipc/papers.js` — integrar las 4 señales del filtro, el pre-orden y la llamada a rerank en `runFetch()`
- [ ] `src/ipc/reference.js` — generar y guardar `abstract_summary` en `index-reference-folder` / `index-files`
- [ ] `src/ipc/settings.js` — soportar `keywordList` en `save-settings` / `get-settings`
