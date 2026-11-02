# Prompt 09 — Pasos 2 a 4 y pantalla de éxito

**Cómo usarlo:** con el 07 y el 08 aprobados. Es el pedido que cierra el wizard.

**Qué esperás de vuelta:** el contenido de los pasos 2, 3 y 4, la validación
visible y la pantalla de confirmación con el código de reserva.

---

## PROMPT (copiar desde acá)

Contexto: wizard de reserva en 4 pasos. Ya existen el contenedor, el stepper y el
calendario (paso 3). Falta el contenido de los pasos 2 y 4, el resumen dentro del
paso 3 y la pantalla de éxito.

Objetivo: completar el flujo de punta a punta, sin cambiar su comportamiento.

### Paso 2 — Tipo de delegación (solo alojamiento)

- Dos opciones excluyentes: `Escuelas` (hasta 4 días) y `Otra institución` (hasta
  3 días).
- Hoy el control es un `<select>` y el JS escucha el evento `change`: si se
  reemplaza por radio buttons, la lógica deja de funcionar. Se puede estilizar el
  select o usar un control visual que mantenga el select real debajo.
- Cada opción muestra su límite de días: es información que hoy no se ve y evita
  un rechazo posterior.
- Una vez elegido, la opción queda bloqueada (igual que el paso 1).

### Paso 3 — Fechas

- El calendario del prompt 08.
- Debajo: el rango elegido en texto ("Entrada 15/11 · Salida 18/11 · 3 noches"),
  el aviso de horarios (ingreso 09:00, salida 18:00) y el total actualizado.
- Estado de error cuando el rango supera el máximo de días o incluye un día sin
  cupo: mensaje concreto, no genérico.

### Paso 4 — Datos de la reserva

Campos, en este orden:

1. Nombre de la institución o delegación.
2. Nombre completo del responsable.
3. DNI (solo números).
4. Celular: prefijo (código de área, sin 0) + número (sin 15). Se muestran como un
   solo grupo visual; el valor combinado va a un campo oculto.
5. Correo electrónico.
6. Checkbox de aceptación del `Uso y reglamento`, con enlace al documento.
7. Botón `Confirmar reserva` (se habilita solo cuando los datos son válidos).

Detalles que el diseño debe resolver:

- El botón está deshabilitado hasta que el paso 3 está completo: el estado
  deshabilitado tiene que explicar **por qué** (texto corto debajo), no solo verse
  gris.
- Errores por campo, en el campo, no un alert global.
- El checkbox de reglamento es obligatorio y su texto es legal: no acortar.
- El enlace "Limpiar todo" existe y reinicia el wizard completo: ubicarlo como
  acción secundaria, nunca junto al botón principal.

### Pantalla de éxito

Reemplaza al modal de confirmación actual.

- Código de reserva en grande (`R-000000`), con posibilidad de copiarlo.
- Resumen: albergue, fechas, cantidad, total.
- Próximos pasos: "Tenés 7 días para abonar y subir el comprobante".
- Botón primario `Cargar comprobante` (va a `pago.html` con el código cargado) y
  secundario `Volver al inicio`.
- Teléfono de contacto: (0381) 452-6408.

Entregables:

1. Los pasos 2 y 4 dentro de `reservar.html`.
2. La pantalla de éxito en `reservar.html` (o en su propio bloque, oculto hasta
   confirmar).
3. Estilos en `assets/css/wizard.css`.
4. En `styleguide.html`: campo con error, botón deshabilitado con motivo, tarjeta
   de éxito.

Requisitos:

- Respetar los `data-*` y los `id` del contrato para todos los campos.
- El resumen de precio se actualiza en el paso 3, no en el 4.
- La pantalla de éxito tiene que verse bien a 390 px sin scroll interno.

No hacer:

- No cambiar el select de delegación por radios sin resolver el evento `change`.
- No agregar campos nuevos (ni "observaciones", ni "cantidad de docentes").
- No prometer confirmación inmediata: la reserva queda pendiente hasta el
  comprobante.

Criterio de aceptación:

- Se puede recorrer el flujo completo con teclado, campo por campo.
- El botón deshabilitado dice qué falta.
- El código de reserva se lee sin zoom en un teléfono.
