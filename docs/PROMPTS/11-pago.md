# Prompt 11 — Pago y comprobante

**Cómo usarlo:** ya existe `pago.html` funcionando. Es un restyling, no una página
nueva: el markup cambia, la lógica embebida se conserva.

**Qué esperás de vuelta:** la página reestilizada con sus estados y una explicación
clara de qué pasa después de subir el archivo.

---

## PROMPT (copiar desde acá)

Contexto: página donde el usuario sube el comprobante de pago de una reserva ya
hecha. Hoy es un formulario mínimo con dos campos y un cartel de mensaje. La página
tiene su propio script embebido (no usa `script.js`), así que **los IDs se
conservan**: `pagoForm`, `pago-codigo`, `pago-archivo`, `pagoBtn`, `pagoMsg`.

Objetivo: que subir el comprobante sea evidente, que el estado del archivo se
entienda y que el usuario sepa qué pasa después.

Contenido:

1. Título: "Subir comprobante de pago".
2. Explicación breve: para qué sirve, qué formatos se aceptan (PDF, JPG, PNG) y el
   límite de tamaño (8 MB).
3. Campo: código de reserva (`R-000000`), con ayuda de dónde encontrarlo.
4. Selector de archivo: se puede mostrar como zona de arrastre, pero el input de
   archivo real tiene que seguir existiendo (el JS lo lee por ID).
5. Botón `Subir comprobante`.
6. Mensaje de resultado, en el lugar donde hoy está `pagoMsg`.
7. Bloque "qué pasa después": el comprobante queda en revisión y la reserva se
   confirma cuando se valida. Si no llega, la reserva vence.

Estados:

- Inicial.
- Archivo elegido: nombre, tipo y tamaño visibles, con opción de cambiarlo.
- Archivo inválido: formato no permitido o más de 8 MB, con el motivo.
- Subiendo: botón en carga, sin doble envío.
- Éxito: mensaje claro y qué sigue.
- Error del servidor: mensaje del backend tal cual.
- Error de conexión: `Reintentar`.

Entregables:

1. `pago.html` reestilizado.
2. `assets/css/pago.css`.
3. Los seis estados en `styleguide.html`.

Requisitos:

- Conservar los IDs y el comportamiento del script embebido.
- El input de archivo debe ser accesible: asociado a su etiqueta, alcanzable con
  teclado y sin ocultarlo con `display:none` si eso rompe el foco.
- A 390 px el nombre del archivo no rompe el layout: truncar con puntos suspensivos.

No hacer:

- No convertir la carga en un asistente de varios pasos.
- No agregar datos bancarios ni instrucciones de transferencia inventadas: si no
  están en el contenido real, dejar el bloque fuera.
- No cambiar el límite de 8 MB ni los formatos aceptados.

Criterio de aceptación:

- Se entiende qué archivo subir y qué pasa si no se sube.
- El estado de éxito no deja la duda de si la reserva ya está confirmada.
- Un archivo de 9 MB se rechaza con un mensaje que dice cuánto pesa el máximo.
