# Cómo funciona la ingesta de papers

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
