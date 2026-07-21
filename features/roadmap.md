# Orden de implementación sugerido

Los cuatro PRDs en `features/` (`learning-dashboard.md`, `settings-redesign.md`, `cost-tracking.md`, `i18n.md`) se recomiendan en este orden:

## 1. `learning-dashboard.md`

Cero dependencias, cero tablas nuevas, no toca nada de lo que tocan los otros tres. Es el de menor riesgo y el que más rápido entrega algo visible (3-5 días). Buen primer envío para no arrancar por lo más grande/riesgoso.

## 2. `settings-redesign.md`

Es la base estructural que los otros dos necesitan:

- `i18n.md` **depende directamente** de este PRD — necesita que exista el setting `language` en Settings antes de poder consumirlo.
- `cost-tracking.md` pide UI para "agregar/editar overrides manuales de precio" y un botón de refresh manual — si Settings ya tiene el layout nuevo por categorías, esa UI se construye una sola vez ahí adentro, en vez de meterla en el drawer viejo y migrarla después.
- La consolidación de Clase→LLM (parte de este PRD) le quita a `cost-tracking.md` un call site menos que instrumentar por separado.

## 3. `cost-tracking.md`

El más grande en instrumentación (toca los 4 proveedores + esquema nuevo). Se beneficia de que Settings ya tenga dónde vivir su UI de precios manuales, y de que Clase ya esté consolidada en un solo proveedor LLM.

## 4. `i18n.md`

Último a propósito, no por ser menos importante sino porque es transversal a *todo*: si se hace antes, cualquier UI nueva que salga después (dashboard de aprendizaje, dashboard de costos, categorías nuevas de Settings) nace sin traducir y hay que volver a pasar el peine. Haciéndolo último, barre en una sola pasada toda la superficie de UI que ya existe para ese momento — incluyendo lo que agregaron los tres anteriores.

**Orden corto**: learning-dashboard → settings-redesign → cost-tracking → i18n.