# Prompt 04 — Tarjeta de albergue

**Cómo usarlo:** después de aprobar el hero. Adjuntá el styleguide y una captura
de la tarjeta actual (la que hoy tiene dos botones y un mapa embebido).

**Qué esperás de vuelta:** la tarjeta en todos sus estados, sin mapa embebido y con
una sola acción primaria.

---

## PROMPT (copiar desde acá)

Contexto: home del sitio de reservas. La tarjeta es la pieza que aparece en la
sección de resultados, una por albergue. Hoy tiene dos botones del mismo peso
("Reservar Visita" y "Reservar Alojamiento") y un mapa de Google embebido; las dos
cosas se eliminan.

Objetivo: diseñar la tarjeta de albergue con una sola acción primaria.

Contenido, en este orden:

1. Foto en proporción 3:2, recortada, con marca de posición si hay varias.
2. Nombre del albergue.
3. Capacidad, en formato breve ("92 camas", "150 personas por día").
4. Precio de referencia: "Desde $5.000 por cama / noche" y "Visita: $2.000 por
   persona". Si falta el dato, la tarjeta debe seguir viéndose bien.
5. Dos o tres características con ícono (no más: las siete actuales saturan).
6. Acción primaria: `Reservar`.
7. Enlace secundario, textual y discreto: `Ver detalle` y `Ver mapa`. El mapa es
   un enlace que abre Google Maps, no un iframe.

Datos exactos: usá los de la hoja de datos adjunta. Nada de Lorem ipsum.

Estados a diseñar:

- Default.
- Hover / foco (elevación o borde, sin saltos de layout).
- Sin disponibilidad para las fechas buscadas: la tarjeta se atenúa, el CTA pasa a
  `Ver próximas fechas` y no queda deshabilitado sin explicación.
- Pocas camas (2 o menos): aviso visible, sin alarmismo.
- Cargando: skeleton con la misma altura que la tarjeta real.
- Sin foto: marco de proporción fija con el nombre del albergue.

Entregables:

1. `partials/venue-card.html` — markup canónico con datos de ejemplo.
2. `assets/css/cards.css`.
3. Las variantes en `styleguide.html`.

Requisitos:

- Los `data-*` del brief deben estar en el markup (al menos `data-albergue` y
  `data-accion`).
- La tarjeta entera no es clickeable: el click va al CTA y al enlace de detalle.
- La foto no debe usar `object-fit` que recorte caras o edificios de forma
  arbitraria: recorte centrado y proporción fija.
- Accesible con teclado; el nombre accesible del CTA incluye el albergue
  ("Reservar en Albergue Maestro José Fierro"), visible solo para lectores de
  pantalla.

No hacer:

- No poner dos CTA de reserva.
- No incrustar el mapa.
- No mostrar el listado completo de características.
- No usar el borde de color como identificador del albergue: eso lo hace la foto.

Criterio de aceptación:

- A 390 px la tarjeta ocupa el ancho completo y el CTA es alcanzable con el pulgar.
- Tres tarjetas alineadas a 1280 px sin alturas desparejas.
- El estado sin disponibilidad se entiende sin leer el texto de ayuda.
