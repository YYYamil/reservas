# Prompts — orden de trabajo

Un pedido por archivo. Se copia el bloque "PROMPT" completo, se adjuntan las
entradas que indica cada archivo y se le pide a Kombai que escriba **solo** dentro
de `v2/`.

Antes de empezar: abrí VS Code con `v2/` como raíz del workspace, en una ventana
aparte. Así el agente no ve `api/`, `admin/` ni el CSS viejo.

## Secuencia

| # | Archivo | Qué produce | Estado |
|---|---|---|---|
| 01 | `01-fundamentos.md` | tokens, base, componentes, styleguide | listo |
| 02 | `02-nav-footer.md` | nav y footer + estilos | listo |
| 03 | `03-hero-buscador.md` | hero de reserva y buscador en `index.html` | listo |
| 04 | `04-tarjeta.md` | tarjeta de albergue (default, hover, sin disponibilidad, skeleton) | listo |
| 05 | `05-listado.md` | listado + filtros + estado vacío | listo |
| 06 | `06-informacion.md` | cómo funciona + reglas/FAQ | listo |
| 07 | `07-wizard.md` | wizard: stepper y resumen de precio | listo |
| 08 | `08-calendario.md` | calendario con sus 10 estados | listo |
| 09 | `09-pasos-y-exito.md` | pasos 2 a 4 + pantalla de éxito | listo |
| 10 | `10-mi-reserva.md` | `mi-reserva.html` (solo cancelación) | listo |
| 11 | `11-pago.md` | `pago.html` reestilizado | listo |
| 12 | `12-qa-final.md` | pasada final responsive, coherencia y accesibilidad | listo |

El prompt 12 no diseña una sección nueva: recorre todo el sitio contra el
`CHECKLIST-SECCION.md` y corrige lo que falle. Se corre al final, con las cuatro
páginas ya construidas.

## Regla de avance

No se pasa al prompt siguiente hasta que la entrega anterior pase el
`docs/CHECKLIST-SECCION.md`. Si falla algo, se corrige en el mismo pedido.

## Qué adjuntar siempre

- El contenido de `docs/BRIEF-KOMBAI.md` (contrato).
- El contenido de `docs/datos-mock.md` (datos y escenarios).
- Captura de la sección actual que se reemplaza.
- Captura de referencia visual, si aplica a esa sección.
