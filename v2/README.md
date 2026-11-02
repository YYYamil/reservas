# v2 — espacio de trabajo del rediseño

Acá vive la landing nueva (Propuesta 2). **No modifica nada de afuera**: la
landing actual (`index.html`, `styles.css`, `script.js`) sigue intacta hasta que
este directorio esté terminado y probado.

## Por qué una carpeta aparte

Kombai trabaja sobre el workspace abierto en VS Code. Si abrís el repo completo,
ve `api/`, `admin/` y un `styles.css` de 3.000 líneas con 33 `!important`, y va a
intentar "mejorarlos". Abrí **una ventana de VS Code con esta carpeta como raíz**:
el agente solo puede tocar lo que está acá.

## Estructura

```
v2/
  index.html            home de descubrimiento
  reservar.html         wizard: pasos 1 a 4 (cantidad, delegación, fechas y datos)
  confirmacion.html     salida del wizard: código, plazo de pago y qué sigue
  mi-reserva.html       consulta y cancelación
  pago.html             carga de comprobante
  styleguide.html       sistema visual (prompt 01) + nav y footer (prompt 02)
  assets/css/           tokens, base, components, hero (home), wizard (reserva),
                        confirmacion (éxito) y styleguide (documento)
  partials/             piezas canónicas: nav, footer, tarjeta, ficha, estado vacío,
                        stepper, delegación, calendario, datos y resumen de precio
```

## Reglas

- Nada de lógica de reservas acá: los `data-*` son el contrato, la conexión se
  hace en el paso de integración.
- Ningún archivo de `api/`, `admin/` ni el `styles.css` actual se referencia
  desde esta carpeta.
- Los datos de ejemplo salen de `docs/datos-mock.md`.
- Todo el texto en español rioplatense.

## Estado

| Pieza | Estado |
|---|---|
| `docs/BRIEF-KOMBAI.md` | listo |
| `docs/datos-mock.md` | completo (5 albergues + JSON real, 2026-10-30) |
| `docs/CONTRATO-INTEGRACION.md` | listo (IDs y clases hook) |
| Prompts 01-12 | listos |
| Sistema visual (prompt 01) | listo: `assets/css/tokens.css`, `base.css`, `components.css`, `styleguide.html` |
| Nav y footer (prompt 02) | listo: `partials/nav.html`, `partials/footer.html` + secciones en `components.css` |
| Home: hero + buscador (prompt 03) | listo: `index.html` + `assets/css/hero.css` |
| Tarjeta de albergue (prompt 04) | listo: `partials/venue-card.html` + estados en `styleguide.html` |
| Ficha del albergue | listo: `partials/venue-modal.html`, se abre con `:target` sin JS |
| Listado + estado vacío (prompt 05) | listo: grilla de 5 tarjetas en `index.html`, `partials/venues-empty.html` y sección *Estados vacíos* en `styleguide.html` |
| Confianza, cómo funciona y ayuda (prompt 06) | listo: franja de confianza, 3 pasos y condiciones + acordeón de 5 preguntas en `index.html`; documentado en *Franjas de la home* |
| Wizard: stepper + resumen (prompt 07) | listo: `reservar.html` (paso 1) + `assets/css/wizard.css`, `partials/stepper.html`, `partials/price-summary.html` |
| Calendario (prompt 08) | listo: `partials/calendar.html` con `calendario-alo-maestro` y sección *Calendario* en `styleguide.html` (mes, fuera de ventana, cargando y tabla de estados) |
| Camas libres en el calendario | listo: en alojamiento cada día lleva el badge verde con las camas que quedan (`.cal--camas` + `.cal__beds`, ámbar con pocas camas, sin badge si no hay cupo); visita va sin badges |
| Wizard: pasos 2 a 4 y éxito (prompt 09) | listo: `reservar.html` con los cuatro pasos (se revisan con `#step-2-maestro`, `#step-3-maestro` y `#step-4-maestro`), `partials/delegacion.html`, calendario montado en el paso 3 y `confirmacion.html` con `assets/css/confirmacion.css` |
| Delegación y avisos | listo: `.choice` (opción única) y `.notice` (validación) en `components.css` + secciones *Delegación y avisos*, *Validación de fechas* y *Confirmación* en `styleguide.html` |
| Paso 4 del wizard (datos) | listo: institución, responsable, DNI, celular (prefijo + número), correo y aceptación del reglamento en `reservar.html#step-4-maestro`; se documenta en *Datos del responsable* con el estado con errores |
| Mi reserva (prompt 10) | listo: `mi-reserva.html` con la consulta por código + DNI, los cuatro desenlaces (buscar, confirmar, cancelada, rechazada) y la política de devolución; `assets/css/mi-reserva.css` + sección *Mi reserva* en `styleguide.html` |
| Comprobante de pago (prompt 11) | listo: `pago.html` con la zona de carga y los cinco estados (sin archivo, subiendo, recibido, rechazado, error de red); `assets/css/pago.css` + componente `.upload` en `components.css` + sección *Comprobante* en `styleguide.html` |
| Páginas del brief | completas: `index`, `reservar`, `confirmacion`, `mi-reserva` y `pago` |
| Accesibilidad y responsive (prompt 12) | listo: `INFORME-ACCESIBILIDAD.md` con el método, el resultado y el recorrido final; arreglados el foco del campo de fecha nativo, el alto del skip link, los avisos del paso 3 a 1024, la tecla Enter del acordeón y el hover de la tarjeta. axe sin violaciones en las páginas auditadas |
