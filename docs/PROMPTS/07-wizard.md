# Prompt 07 — Wizard: contenedor, stepper y resumen de precio

**Cómo usarlo:** es el pedido más grande después del hero. Conviene mandarlo cuando
el sistema visual y la tarjeta ya estén aprobados.

**Qué esperás de vuelta:** `reservar.html` con el esqueleto del wizard (sin
calendario ni formulario final), el stepper, el resumen de precio y sus estados.

---

## PROMPT (copiar desde acá)

Contexto: página de reserva del sitio de albergues. Reemplaza al modal actual, que
metía todo el flujo dentro de una ventana. El usuario llega desde la tarjeta de un
albergue, con el albergue ya elegido en la URL.

Objetivo: diseñar el contenedor del wizard: encabezado, barra de progreso,
navegación entre pasos y resumen de precio.

Estructura de la página:

1. Nav del sitio (versión compacta, sin el hero).
2. Encabezado de la reserva: nombre del albergue y modalidad (visita o
   alojamiento), con enlace para volver a la home.
3. Stepper de **4 pasos**: `Cantidad`, `Delegación`, `Fechas`, `Datos`.
4. Área de contenido del paso actual.
5. Resumen de precio: albergue, fechas, cantidad y total. Lateral en desktop,
   fijo al pie en móvil.

Cómo avanza el wizard (importante, no es un formulario común):

- No hay botón "Continuar". El paso se completa cuando el campo es válido (al
  salir del campo o al elegir la opción) y el JS desbloquea el siguiente.
- Al completarse, el campo pasa a deshabilitado y el paso se marca como hecho. Ese
  estado tiene que verse **intencional**, no roto: campo en reposo, con el valor
  legible y una marca de confirmación.
- El paso nuevo aparece debajo; el diseño debe hacerlo evidente (cambio de
  contraste, borde de acento, desplazamiento suave).
- La barra de progreso refleja cuántos pasos están completos sobre 4.
- No ofrecer "editar" un paso ya completado: la lógica actual no lo permite sin
  reiniciar el flujo. Si se necesita, es una decisión aparte.

Estados del resumen de precio:

- Vacío: "Elegí fechas para ver el total".
- Parcial: cantidad elegida, sin fechas.
- Completo: total calculado, con el detalle (camas × noches).
- Error: fechas inválidas o cupo insuficiente, con el motivo.

Entregables:

1. `reservar.html` con nav, encabezado, stepper y contenedores de los 4 pasos
   (vacíos; el contenido llega en los prompts 08 y 09).
2. `assets/css/wizard.css`.
3. En `styleguide.html`: stepper en sus 4 combinaciones (actual, completado,
   pendiente, con error) y resumen en sus 4 estados.

Requisitos:

- Conservar las clases hook `step-container`, `step-indicator` y `progress-fill`
  (el JS las cuenta por orden).
- Los 4 contenedores de paso van en orden 1 a 4 en el DOM.
- El resumen de precio en móvil no tapa el contenido: reservar espacio, no
  superponer.
- La página funciona a 390 px sin scroll horizontal.

No hacer:

- No inventar un botón "Continuar" ni un acordeón de pasos.
- No cambiar la cantidad de pasos.
- No implementar el calendario ni el formulario de datos todavía.
- No agregar un paso de pago: el pago va después, en su propia página.

Criterio de aceptación:

- Se entiende en qué paso está el usuario sin leer el número.
- El resumen se actualiza visualmente al cambiar de estado.
- A 390 px el stepper no se rompe en dos líneas.
