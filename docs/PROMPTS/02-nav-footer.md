# Prompt 02 — Nav y footer

**Cómo usarlo:** después de aprobar el prompt 01. Adjuntá el styleguide resultante
y una captura del nav y footer actuales (para que sepa qué reemplaza).

**Qué esperás de vuelta:** los dos fragmentos de markup, sus estilos, y la versión
móvil de cada uno.

---

## PROMPT (copiar desde acá)

Contexto: ya existe el sistema visual en `assets/css/` (tokens, base,
componentes) y el styleguide. Este pedido agrega las dos piezas que envuelven
todas las páginas del sitio de reservas.

Objetivo: diseñar el nav y el footer. Nada más.

Nav:

- Logo institucional a la izquierda, altura fija y discreta (hay un PNG, no
  asumas SVG). No debe dominar la pantalla.
- Links: `Albergues`, `Cómo funciona`, `Ayuda` (máximo 4, incluido el siguiente).
- Acción secundaria a la derecha: `Mi reserva` (es consultar una reserva
  existente, no reservar).
- En móvil: logo + botón de menú; al abrir, panel a pantalla completa con los
  links apilados y `Mi reserva` destacado. Cierre visible y con teclado.
- Comportamiento al scrollear: se vuelve compacto y opaco, sin saltar el layout.

Footer:

- Logo, una línea de contacto (teléfono y correo de ejemplo del mock), links a
  `Uso y reglamento`, `Preguntas frecuentes`, `Mi reserva`.
- Línea legal: copyright con el año y el nombre del Ministerio.
- Sin columnas decorativas vacías, sin redes sociales si no existen.

Entregables:

1. `partials/nav.html` y `partials/footer.html` — markup canónico.
2. Estilos en `assets/css/layout.css`.
3. Los dos estados del nav (normal y compacto) y el menú móvil abierto visibles en
   `styleguide.html`.

Requisitos:

- Usar los tokens existentes; no introducir colores ni tamaños nuevos.
- El logo PNG no debe deformarse ni pixelarse: altura controlada por CSS.
- El menú móvil atrapa el foco mientras está abierto y lo devuelve al cerrar.
- Contraste AA sobre el fondo del nav.

No hacer:

- No agregar buscador al nav.
- No agregar links de administración ni login.
- No crear páginas nuevas todavía.

Nota de implementación: el sitio es HTML estático sin includes. Los parciales son
la fuente canónica y se copian textualmente en cada página. Mantené el markup
corto para que esa copia no genere divergencias.

Criterio de aceptación:

- Nav y footer se ven correctos a 390, 768 y 1280.
- El nav no tapa contenido al hacer scroll.
- El menú móvil se puede abrir, recorrer y cerrar solo con teclado.
