# Prompt 10 — Mi reserva (cancelación)

**Cómo usarlo:** después del wizard. Adjuntá una captura del modal "Cancelar
reserva" actual.

**Qué esperás de vuelta:** `mi-reserva.html`, que absorbe el modal de cancelación
que hoy vive en la home.

---

## PROMPT (copiar desde acá)

Contexto: página de autogestión del sitio de reservas. Hoy la cancelación está en
un modal de la home, con un formulario de dos campos y un párrafo de política. Pasa
a ser una página propia.

Alcance real: el backend **solo permite cancelar**. No existe un endpoint para
consultar el estado de una reserva, así que la página no promete mostrar estado ni
historial. Solo cancela e informa el resultado.

Objetivo: una página de una sola tarea, clara y sin ambigüedad sobre las
consecuencias.

Contenido:

1. Título que diga exactamente qué se hace: "Cancelar una reserva".
2. Formulario: código de reserva (`R-000000`) y DNI del responsable.
3. Bloque de política de devolución, visible **antes** de enviar:
   - más de 48 h antes del ingreso: devolución del 100 %;
   - dentro de las 48 h previas: 50 %;
   - el día de ingreso o después: no se puede cancelar.
4. Botón `Cancelar reserva`, visualmente de peligro (no compite con nada más en la
   página).
5. Enlace secundario a `pago.html` para quien entró a subir un comprobante.

Estados:

- Inicial: formulario vacío.
- Validando: botón en carga, campos bloqueados.
- Cancelación exitosa: confirmación con el monto de devolución que corresponde y
  qué pasa después (el cupo se libera; la devolución la procesa el Ministerio).
- Pre-reserva sin pago: se cancela sin devolución y el mensaje lo dice.
- No cancelable (día de ingreso o después): explica el motivo y ofrece el teléfono
  de contacto. No es un error del sistema.
- Código o DNI incorrectos: mensaje único, sin revelar cuál de los dos falló.
- Error de conexión: mensaje con `Reintentar`.

Entregables:

1. `mi-reserva.html`.
2. `assets/css/mi-reserva.css`.
3. En `styleguide.html`: los cuatro resultados (éxito con devolución total, éxito
   con devolución parcial, no cancelable, datos incorrectos).

Requisitos:

- Conservar los IDs del contrato: `cancelForm`, `cancel-id`, `cancel-dni`,
  `btn-cancelar-enviar` (y los de apertura/cierre si se mantiene como diálogo).
- Confirmación previa al envío: la cancelación es irreversible. Un paso de
  "¿Seguro?" con el resumen de lo que se pierde.
- El DNI admite solo números y no muestra el teclado alfabético en móvil.

No hacer:

- No mostrar estado de la reserva ni historial (no hay endpoint).
- No prometer devolución inmediata: la procesa una persona.
- No usar rojo de error para el aviso de política: es información, no una falla.

Criterio de aceptación:

- Antes de tocar el botón, el usuario ya sabe cuánto le devuelven.
- Después de cancelar, no queda duda de si la reserva sigue activa.
- A 390 px el bloque de política no tapa el formulario.
