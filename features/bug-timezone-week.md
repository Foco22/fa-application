# BUG: la semana ISO se calculaba con la zona horaria del usuario

- Tipo: bug de correctitud (silencioso)
- Estado: **corregido** — PR #8 (`fix/timezone-week-calc`)
- Severidad: media (datos mal archivados, sin pérdida de información)
- Detectado: 2026-07-13

---

## 1. Síntoma

7 tests de `tests/unit/vault.test.js` y `tests/unit/ingestion/arxiv.test.js` fallaban de forma
permanente en la máquina del autor (Chile, UTC−4), mientras el CI de GitHub Actions daba **verde**.

Durante tres sesiones se los trató como "ruido heredado". No lo eran.

```
isoWeek(new Date('2024-01-01'))  →  52   (debería ser 1)
paperSlot({ published_date: '2024-06-10' })  →  week-23   (debería ser week-24)
```

## 2. Causa raíz

`isoWeek()` **parseaba** la fecha como UTC pero la **leía** con getters locales.

JavaScript interpreta una fecha sin hora (`'2025-06-16'`) como **medianoche UTC**. Después,
`getDay()` / `getDate()` la devuelven en la zona del usuario. En una zona negativa eso es el día
**anterior** a las 20:00:

```javascript
// En Chile (UTC−4):
const d = new Date('2025-06-16')  // lunes 16, 00:00 UTC
d.getDay()                        // 0 = DOMINGO 15  ← el día se corrió
```

`paperSlot()` arrastraba el mismo problema con `getFullYear()`.

## 3. Impacto real

**Un paper publicado un lunes retrocedía al domingo y se archivaba en la semana ISO anterior**, es
decir, en la carpeta equivocada del vault: `vault/2026/week-26/` en vez de `week-27/`.

Sólo mordía cuando el corrimiento de un día cruzaba el límite de semana (lunes → domingo), o sea
**aproximadamente 1 de cada 7 papers**. Los otros seis días de la semana el resultado era correcto,
lo que explica por qué el bug pasó desapercibido tanto tiempo: fallaba poco y no rompía nada
visiblemente — sólo dejaba el archivo en el lugar equivocado, en silencio.

Ningún dato se perdía. El paper seguía en la DB y en el vault; simplemente no estaba en la carpeta
donde correspondía buscarlo.

## 4. Por qué el CI no podía verlo

**GitHub Actions corre en UTC.** Ahí la fecha parseada y la fecha leída coinciden, y los dos
cálculos dan el mismo resultado. El bug es **invisible en UTC por construcción**.

Esto produjo la señal más útil del caso: *la suite verde en CI y roja en la máquina del autor es,
en sí misma, la firma de un bug de zona horaria*. Cualquier discrepancia CI/local en tests de fechas
debería levantar esa sospecha inmediatamente, no descartarse como "tests flakeados".

## 5. La corrección

El cálculo pasa a usar **getters UTC de punta a punta** (`getUTCDay`, `getUTCDate`, `Date.UTC`)
en vez de convertir la fecha a local.

Se eligió UTC —y no "parsear como local"— porque **las dos fuentes de fecha ya son UTC**:

| Fuente | Formato | Origen |
|---|---|---|
| `published_date` | `2025-06-16` (sin hora) | ArXiv |
| `created_at` | `2025-06-16 10:00:00` (UTC) | SQLite, `datetime('now')` |

Así, **un paper cae en la misma carpeta sin importar desde qué zona horaria se abra la app** — que
es la propiedad que se quiere: el vault es un artefacto en disco, no puede depender de dónde esté
sentado el usuario.

## 6. Migración de las carpetas ya mal ubicadas

`migratePaperFolders()` (que corre en cada arranque desde `main.js`) buscaba las carpetas
**sólo por `paper.id`**. Pero las carpetas existentes ya están nombradas **por título**, así que no
las encontraba: las mal ubicadas se habrían quedado en la semana equivocada **para siempre**, incluso
con el cálculo ya corregido.

Ahora la migración también matchea por el **nombre canónico de carpeta**, y las reubica sola al
arrancar.

## 7. El test de ArXiv era el caso espejo

`calculateDateWindow()` **no** tenía el bug: en producción recibe `new Date()`, que ya es local y
correcto. El que estaba mal era **el test**, que le pasaba `new Date('2025-06-16')` — un instante UTC
que en Chile cae **domingo** — mientras afirmaba en su nombre que era lunes.

Ahí se corrigió el test (fechas construidas con `new Date(2025, 5, 16)`, locales), no el código.
La distinción importa: no todo test rojo señala un bug en la fuente.

## 8. Verificación

616 tests pasando bajo **UTC, America/Santiago, Asia/Tokyo y Pacific/Kiritimati (UTC+14)**.

## 9. Lección para el futuro

- Nunca mezclar parseo UTC con getters locales. Si el dato es UTC, leerlo con `getUTC*`.
- `new Date('YYYY-MM-DD')` es **UTC**; `new Date(y, m, d)` es **local**. No son intercambiables.
- Un test de fechas que pasa en CI y falla localmente **es un bug de zona horaria hasta que se
  demuestre lo contrario**.
- Conviene correr la suite al menos en una zona no-UTC antes de confiar en el verde del CI.