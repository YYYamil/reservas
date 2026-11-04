# Prompt 08 — Calendario de disponibilidad

**Cómo usarlo:** después del 07. Es el componente más delicado del sitio: si falla,
no hay reserva posible.

**Qué esperás de vuelta:** el calendario completo, la leyenda y todos sus estados,
con una regla clara: **se estiliza el DOM que ya genera el JS, no se rediseña su
estructura**.

---

## PROMPT (copiar desde acá)

Contexto: calendario de selección de fechas del wizard. En la modalidad visita se
elige un día; en alojamiento, un rango de entrada y salida.

Restricción estructural, leer antes de empezar: el calendario **no está en el
HTML**. Lo construye el JavaScript, celda por celda, y aplica estas clases:

- `dia` en cada celda, `otro-mes` en las de relleno.
- `verde` (cupo suficiente), `rojo` (sin cupo para la cantidad pedida),
  `azul-seleccion` (selección temporal mientras se confirma).
- `en-rango`, `inicio-rango`, `fin-rango` para el rango elegido.
- `badge-libre` para el número de camas libres dentro de la celda.

Por eso: se puede cambiar todo el aspecto, pero **no la estructura de las celdas**
ni sus nombres de clase. Cada celda es un elemento con texto (el número del día) y,
a veces, un badge. Diseñar el CSS sobre eso.

Objetivo: un calendario legible, que muestre disponibilidad real de un vistazo y
que se pueda tocar con el pulgar.

Contenido:

- Encabezado: mes y año, con botones de mes anterior y siguiente. El botón de
  siguiente se deshabilita al llegar al límite de la ventana de reserva.
- Fila de días de la semana, empezando en domingo.
- Grilla de 7 columnas por 6 filas.
- Número del día grande y legible; el cupo disponible como badge secundario.
- Leyenda: verde = hay lugar, rojo = no hay lugar para la cantidad pedida, azul =
  selección en verificación. Texto corto, sin párrafos.
- Aviso de horarios debajo: ingreso 09:00, salida 18:00.

Estados por celda:

1. Disponible.
2. Pocas camas (1 o 2): mismo color, con señal de urgencia discreta.
3. Sin cupo.
4. Seleccionada.
5. Inicio de rango.
6. Fin de rango.
7. Dentro del rango.
8. Día pasado (no interactuable, atenuado).
9. Antes de la fecha mínima de reserva.
10. Fuera del mes (relleno).

Estados del componente:

- Cargando disponibilidad: overlay con indicador que no tape la grilla elegida.
- Error de conexión al consultar un día.
- Un solo día elegido (visita).
- Rango de un día, de varios días, y rango inválido.

Entregables:

1. `assets/css/calendar.css` con los estilos de las clases que emite el JS.
2. La sección del paso "Fechas" dentro de `reservar.html`, con el markup de
   encabezado, leyenda y contenedor de la grilla.
3. En `styleguide.html`: una réplica estática del calendario con todos los estados
   de celda, para poder revisarlos sin backend.

Requisitos:

- A 390 px entran 7 columnas sin scroll horizontal: la celda mínima es 40 px.
- El área táctil de cada día es de al menos 44 px.
- Contraste suficiente entre número, badge y fondo, en los tres estados de color.
- El estado seleccionado y el rango se distinguen también sin color (borde,
  relleno o marca), para daltonismo.

No hacer:

- No reemplazar el calendario por un selector de fechas nativo.
- No agregar un segundo calendario para "entrada" y "salida".
- No cambiar los nombres de clase ni envolver las celdas en contenedores nuevos.
- No usar rojo saturado para "sin cupo": que no parezca un error del sistema.

Criterio de aceptación:

- Se entiende qué días se pueden elegir sin tocar ninguno.
- El rango se lee como un bloque continuo.
- La leyenda alcanza para interpretar los colores sin ayuda externa.

Nota de deuda conocida: las celdas hoy no son navegables por teclado (son
elementos genéricos con click). El rediseño puede preparar estilos de foco, pero
habilitar teclado requiere un cambio de JS que se hace en la integración, no acá.
