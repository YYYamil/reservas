# Accesibilidad y responsive — pasada final (prompt 12)

Cierre del brief. Revisión de las cinco páginas del sitio con auditoría automática
y chequeos propios a 360, 390, 768, 1024 y 1280.

## Método

| Qué | Cómo |
|---|---|
| Reglas automáticas | axe-core 4.11 sobre `index.html`, `reservar.html` (paso 3), `mi-reserva.html` (confirmación) y `pago.html` (subiendo): **0 violaciones** en las cuatro |
| Foco por teclado | Tabulación completa de cada página leyendo el `outline` computado de cada elemento enfocado |
| Contraste | Cálculo de las 16 combinaciones de texto y fondo que usa el sistema, incluidas las nuevas (badges del calendario, avisos, sellos, botones y foco) |
| Estructura | `alt` en imágenes, un solo `h1` por página, sin saltos en el orden de encabezados, sin `aria-describedby` roto, ids únicos, anclas válidas |
| Responsive | Scroll horizontal en los cinco anchos del brief; alto de los controles táctiles |

## Resultado

- **Contraste**: todas las combinaciones dan AA (4.5:1) o más. La más baja es el
  texto deshabilitado (4.57:1 sobre arena) y el botón primario (5.36:1).
- **Foco**: todos los controles muestran indicador. Los grupos que recortan su
  contorno (stepper, cantidad) lo dibujan por dentro; la tarjeta de opción y la
  zona de carga dibujan el anillo en el contenedor para no duplicarlo.
- **Teclado**: el calendario expone los 30 días del mes como botones alcanzables
  y activables con Enter o Espacio; el menú compacto y las fichas se abren con
  Enter porque son `<details>` y `:target`. El acordeón respondía solo a
  Espacio: Enter quedó roto por el `display` del `<summary>` y se arregló en el
  recorrido final (ver abajo).
- **Táctil**: ningún control de las páginas del sitio queda por debajo de 44 px,
  salvo los inputs ocultos que viven dentro de su etiqueta (radio de modalidad,
  checkbox de reglamento, input de archivo).
- **Responsive**: 0 px de scroll horizontal en 360, 390, 768, 1024 y 1280 en
  todas las páginas y en todos los estados por hash.
- **Imágenes**: sin `alt` faltantes y con `aspect-ratio` fijo; el CLS medido en
  las páginas queda por debajo de 0.01.

## Arreglos de esta pasada

1. **Campo de fecha sin anillo**: Chrome no marca `:focus-visible` en el
   `<input type="date">` nativo cuando el foco entra con Tab. Se agregó
   `.input--date:focus` con el mismo anillo de 2 px. Efecto lateral aceptado: el
   anillo también aparece al hacer clic en el campo.
2. **Skip link de 40 px**: pasó a 44 px (`min-height: var(--tap-min)`), que es el
   mínimo del sistema y el primer control de cada página.
3. **Avisos del paso 3 aplastados entre 1024 y 1279**: el mes y los avisos iban
   en dos columnas desde 1024, pero a ese ancho el panel deja unos 100 px para el
   aviso y el texto se parte en una tira ilegible. La composición de dos columnas
   pasa a arrancar en 1280; en el rango anterior el calendario conserva sus 26 rem
   y los avisos van debajo, con el ancho completo.

## Recorrido final por el sitio

Pasada de control sobre el sitio completo en el navegador: las cinco páginas y
los dieciocho estados por hash, en 360, 768 y 1280, más revisión visual en 390,
1024 y 1280. Se auditaron con axe-core 4.11 `index.html`, `reservar.html`
(paso 4, el formulario más cargado) y `pago.html` (estado rechazado): **0
violaciones** en las tres, con los grupos de formularios, `autocomplete`, foco y
contraste en verde.

Lo que encontró la pasada y quedó corregido:

1. **El acordeón no abría con Enter** (sí con Espacio y con clic). Causa: con
   `display: flex` en el `<summary>`, Chrome pierde la activación por Enter; con
   `display: block` también. Solo `display: list-item` la conserva, así que el
   resumen volvió a ese valor y el signo `+ / −` se ubica con posición absoluta.
   Verificado: Enter abre, Espacio abre, y el signo sigue alineado al borde.
2. **La tarjeta de albergue no tenía estado de hover**: declaraba la transición
   de `border-color` y `box-shadow` pero nunca la regla, así que la transición no
   se usaba y el brief quedaba a medias en `VenueCard`. Se agregó hover (borde
   fuerte y sombra 1) bajo `@media (hover: hover)` y el mismo tratamiento en
   `:focus-within`, para que el teclado marque la tarjeta igual que el puntero.
3. **El acordeón del sistema visual quedaba a su ancho natural** dentro de una
   celda más ancha: las líneas de cada pregunta terminaban antes que el marco y
   el borde parecía cortado. Ahora ocupa el ancho de la celda.
4. **El hero de escritorio dejaba media pantalla vacía** al costado del título.
   Desde 1024 pasa a dos columnas —título y bajada a la izquierda, panel de
   búsqueda a la derecha— con los campos de a dos por fila y la acción a ancho
   completo del panel. Entre 768 y 1023 sigue apilado como estaba. No se agregó
   contenido decorativo para llenar el hueco. Medido en 1024 (433 + 480) y en
   1280 (608 + 480), sin scroll horizontal y con axe todavía en 0 violaciones.

Verificación transversal de las 18 vistas en los tres anchos: 0 px de scroll
horizontal, ninguna imagen rota, ningún `img` sin `alt` y un solo `h1` por
página.

**Dependencia externa a tener en cuenta**: la tipografía entra por un `@import`
de Google Fonts al inicio de `tokens.css`. En un entorno sin salida a internet
el pedido falla y el sitio se dibuja con las familias de reemplazo (`Georgia` y
la sans del sistema), que es lo que muestran las capturas de esta pasada. El
diseño se sostiene, pero si el despliegue no puede depender de esa red conviene
autoalojar los `woff2` y declarar `@font-face` en `tokens.css`.

## Límites conocidos (del patrón sin JS, no del rediseño)

- La ficha del albergue se abre con `:target`: no tiene trampa de foco ni cierra
  con Escape. El contenedor lleva `tabindex="-1"` para que el diálogo se anuncie
  al abrirse y el cierre es un enlace real alcanzable con Tab.
- El menú compacto es un `<details>`: abre y cierra con Enter y Espacio, pero
  Escape no lo cierra (el navegador no lo hace por defecto).
- Los días del calendario y los botones del wizard son botones alcanzables y
  activables; la selección se resuelve en integración. El mock no tiene JS: el
  rango del 15 al 18 de noviembre está fijado en el markup y hacer clic en un día
  no cambia ninguna clase ni el texto de `cal__range`. Por eso los estados del
  rango —entrada esperando salida, rango inválido y rango cortado por falta de
  cupo— quedan documentados como clases en el sistema visual, listas para que la
  integración las aplique.
- La página del sistema visual (`styleguide.html`) es documentación: tiene
  estados forzados a mano y controles de muestra, así que no se audita con axe.

## Cómo repetir la revisión

1. Levantar el sitio: `python -m http.server 8080` dentro de `v2/`.
2. Abrir cada página con `#hash` para revisar también los estados (wizard:
   `#step-2-maestro` a `#step-4-maestro`; mi reserva: `#confirmar-cancelacion`,
   `#reserva-cancelada`, `#cancelacion-rechazada`; pago: `#subiendo`,
   `#recibido`, `#rechazado`, `#error-red`).
3. Recorrer con Tab y con lector de pantalla; el foco tiene que verse en cada
   control y el orden tiene que seguir el de la pantalla.
