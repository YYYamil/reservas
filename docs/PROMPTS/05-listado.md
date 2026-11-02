# Prompt 05 — Listado de albergues y filtros

**Cómo usarlo:** necesita la tarjeta del prompt 04 ya aprobada. Adjuntá el
styleguide actualizado.

**Qué esperás de vuelta:** la sección completa de resultados con sus cuatro
estados y los filtros en desktop y móvil.

---

## PROMPT (copiar desde acá)

Contexto: home del sitio de reservas. Debajo del hero va la sección de resultados:
los albergues habilitados (hoy 5) con filtros. Es la única sección de la home que
el usuario recorre después de buscar (o antes, si no usó el buscador).

Objetivo: diseñar la sección de listado, los filtros y sus estados.

Contenido:

- Encabezado de sección breve, con el contexto de la búsqueda cuando existe
  ("5 albergues para el 15 al 18 de noviembre, 12 personas"). El número es
  dinámico: nunca fijar 3.
- Filtros como chips: modalidad (Todas / Visita / Alojamiento) y capacidad
  (Hasta 50 / Hasta 100 / Más de 100). Máximo dos grupos; no agregar más.
- Grilla de tarjetas: 3 columnas a 1280, 2 a 768, 1 a 390.
- Bloque de "cómo sigue" al pie de la sección, en una línea: qué pasa después de
  tocar Reservar.

Estados:

- Con resultados y sin filtros aplicados.
- Con filtros aplicados (chips activos, se puede limpiar).
- Sin resultados: mensaje que explique por qué y ofrezca limpiar filtros o cambiar
  fechas. Nunca un espacio vacío.
- Cargando: tres skeletons con la altura de la tarjeta real.
- Error de conexión: mensaje con `Reintentar`, sin culpar al usuario.

Comportamiento móvil:

- Los chips van en una fila con scroll horizontal, sin cortar el texto.
- El encabezado con el resumen de búsqueda se mantiene en una sola línea o se
  trunca; no empuja la grilla fuera de pantalla.

Entregables:

1. La sección dentro de `index.html`, donde el prompt 03 dejó el contenedor vacío.
2. Estilos en `assets/css/cards.css` o `listado.css`.
3. Las cuatro variantes en `styleguide.html` con datos reales del mock.

Requisitos:

- Reutilizar la tarjeta tal cual quedó: no crear variantes nuevas de tarjeta.
- Los chips deben tener estado de foco y poder activarse con teclado.
- El conteo de resultados ("5 albergues", dinámico) debe existir como texto propio,
  no dentro del encabezado decorativo.

No hacer:

- No implementar el filtrado (es lógica; la hacemos después).
- No agregar ordenamiento, paginación ni mapa lateral.
- No agregar una barra de búsqueda nueva: la del hero es la única.

Criterio de aceptación:

- El estado vacío no deja la página "rota" ni un hueco grande.
- A 390 px los chips no generan scroll de página, solo del propio contenedor.
- Los skeletons no cambian la altura del layout al reemplazarse por tarjetas.
