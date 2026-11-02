# Prompt 03 — Hero de reserva y buscador

**Cómo usarlo:** es la pieza que define el tono de todo el sitio. Adjuntá el
styleguide actualizado y las capturas del hero de hoy (para que vea qué reemplaza).

**Qué esperás de vuelta:** el hero en desktop, tablet y móvil, con el buscador en
todos sus estados y `index.html` armado solo con nav + hero + un bloque vacío
donde después irán los resultados.

---

## PROMPT (copiar desde acá)

Contexto: home del sitio de reservas de albergues. El usuario llega sabiendo que
quiere reservar; la página no tiene que convencerlo de nada, tiene que dejarlo
empezar en un paso.

Objetivo: diseñar el hero de reserva y el buscador. Es la única acción primaria de
la home.

Contenido:

- H1 orientado a la tarea, no al organismo. Ejemplo de tono: "Reservá el albergue
  para tu delegación". Una línea de apoyo que explique qué se puede reservar
  (visita de un día o estadía con camas).
- No usar "Bienvenido al sistema de reservas" ni el nombre completo del
  Ministerio en el titular.
- Buscador con cuatro campos: albergue (opción "Todos" + los 3), entrada, salida,
  personas. Más un selector de modalidad (Visita / Alojamiento).
- Botón primario: `Ver disponibilidad`.
- Línea de confianza debajo, con 3 datos concretos del mock: cancelación sin cargo
  hasta 48 h antes, confirmación con comprobante, cupo limitado por día.
- Fondo: imagen de uno de los albergues tratada como marco (proporción fija), sin
  oscurecerla tanto que no se reconozca el lugar. Alternativa válida: composición
  sin foto si el resultado es más limpio.

Comportamiento:

- En visita, la fecha de salida se oculta (es de un solo día).
- En alojamiento, se muestran entrada y salida y el máximo de noches según el tipo
  de delegación.
- Validación visible: salida anterior a entrada, fechas fuera de la ventana de 3
  meses, cantidad fuera de rango.
- Desktop: los campos en una fila. Tablet: dos filas. Móvil: un solo botón que
  abre un panel con los campos apilados y el CTA fijo abajo.

Entregables:

1. `index.html` con nav + hero + un bloque contenedor vacío para resultados.
2. `assets/css/hero.css`.
3. El héroe y el buscador (todos los estados) en `styleguide.html`.

Estados a mostrar:

- Vacío, completo, con error de validación, en modo visita y en modo alojamiento.
- Móvil con el panel abierto.
- Cargando (el botón pasa a "Buscando disponibilidad…" y se deshabilita).

Requisitos:

- Reutilizar los componentes del sistema; no crear botones ni inputs nuevos.
- Los campos de fecha son de solo lectura: la selección real ocurre en el
  calendario. Mostrarlos como disparadores, no como inputs libres.
- Accesible con teclado y con etiquetas asociadas.

No hacer:

- No implementar la búsqueda ni consultar la API.
- No agregar secciones debajo del hero (resultados, pasos, FAQ): van en pedidos
  separados.
- No usar un carrusel de imágenes de fondo.

Criterio de aceptación:

- A 390 px el hero no supera el alto de la pantalla y el CTA es alcanzable con el
  pulgar.
- Los cuatro campos se entienden sin explicación adicional.
- En modo visita no queda un campo de salida vacío y visible.
