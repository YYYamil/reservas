# Prompt 12 — Pasada final de coherencia y accesibilidad

**Cómo usarlo:** último pedido, con las cuatro páginas ya construidas. No diseña:
audita y corrige.

**Qué esperás de vuelta:** la lista de problemas encontrados, los que se corrigieron
y los que no se pueden resolver sin tocar lógica.

---

## PROMPT (copiar desde acá)

Contexto: el sitio ya tiene sus cuatro páginas construidas y aprobadas sección por
sección: `index.html`, `reservar.html`, `mi-reserva.html` y `pago.html`, más el
`styleguide.html`. Cada una se revisó por separado; ahora hay que revisarlas como
sistema.

Objetivo: auditar la coherencia y la accesibilidad del conjunto y corregir **solo
lo que esté mal**. No es un rediseño.

Proceso, en este orden:

1. Recorrer cada página a 360, 390, 768, 1024 y 1280 px.
2. Anotar cada problema con página, viewport y elemento.
3. Corregir por grupos: primero layout, después estados, después accesibilidad.
4. Volver a recorrer todo al final.

Barrer estos puntos en cada página:

**Layout**

- Scroll horizontal en cualquier viewport.
- Elementos que se superponen (resumen fijo en móvil, menú abierto).
- Contenido pegado a los bordes (mínimo 16 px de margen en móvil).
- Texto que se corta o se trunca sin intención.
- Imágenes sin proporción fija o que generan salto de layout.

**Sistema**

- Colores, radios, sombras y espaciados fuera de los tokens.
- `!important` o estilos inline.
- Más de tres pesos tipográficos en una misma página.
- Componentes iguales con distinta apariencia entre páginas (mismo botón,
  distinto alto; mismo campo, distinto borde).

**Estados**

- Falta algún estado del inventario del brief.
- Estados de carga que cambian la altura del contenido.
- Errores sin explicación de qué hacer.

**Accesibilidad**

- Contraste menor a 4.5:1.
- Foco invisible o en orden ilógico.
- Campos sin etiqueta asociada.
- Botones que dependen del color para comunicar estado.
- Objetivos táctiles menores a 44 px.
- Imágenes sin `alt`.

**Flujo (sin tocar lógica)**

- Se puede ir y volver entre home, reserva, pago y mi-reserva sin callejones.
- El código de reserva se puede copiar en la pantalla de éxito.
- Los enlaces entre páginas conservan el contexto (el albergue elegido, el código
  cargado).
- La navegación del nav es idéntica en las cuatro páginas y marca la sección
  actual.

Entregables:

1. Los archivos corregidos.
2. Un resumen de máximo 15 líneas: qué se corrigió, qué quedó pendiente y por qué.

No hacer:

- No agregar secciones, componentes ni campos nuevos.
- No cambiar textos legales ni la política de cancelación.
- No tocar la cantidad de pasos del wizard ni el flujo de estados.
- No reemplazar componentes aprobados por versiones "mejores".

Criterio de aceptación:

- Las cuatro páginas pasan el `CHECKLIST-SECCION.md` completo.
- El nav y el footer son idénticos en todas.
- No hay diferencias visuales entre el mismo componente usado en dos páginas.
