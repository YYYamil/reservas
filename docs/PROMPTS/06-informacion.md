# Prompt 06 — Cómo funciona, reglas clave y FAQ

**Cómo usarlo:** después del listado. Adjuntá el styleguide y una captura de la
caja "Pasos para reservar" actual (la que hoy está arriba de todo, con párrafos).

**Qué esperás de vuelta:** tres bloques donde hoy hay un muro de texto: cómo
funciona, reglas escaneables y preguntas frecuentes.

---

## PROMPT (copiar desde acá)

Contexto: home del sitio de reservas. Estos tres bloques van **después** de las
tarjetas: el usuario ya vio las opciones y ahora necesita entender el proceso y
las condiciones. Hoy esta información está antes de las tarjetas, en párrafos
largos, y empuja la acción fuera de pantalla.

Objetivo: diseñar los tres bloques informativos, escaneables, sin párrafos.

### 1. Cómo funciona

Tres pasos, en este orden, con ícono, título de 2-4 palabras y una línea de
explicación como máximo:

1. **Elegí albergue y fechas** — visita de un día o estadía con camas.
2. **Completá los datos** — recibís un código de pre-reserva.
3. **Subí el comprobante** — la reserva queda confirmada.

Sin numeración romana, sin sub-listas, sin negritas dentro del texto.

### 2. Reglas clave

Cuatro datos en formato escaneable (fichas o lista de definición, no párrafos):

- **Cancelación** — 100 % hasta 48 h antes del ingreso; 50 % dentro de las 48 h
  previas; sin devolución el día de ingreso.
- **Horarios** — ingreso 09:00, salida 18:00.
- **Duración máxima** — escuelas hasta 4 días; otras instituciones hasta 3.
- **Anticipación** — se reserva con hasta 3 meses de anticipación.

Cada ficha con enlace al `Uso y reglamento` completo.

### 3. Preguntas frecuentes

Acordeón con cinco preguntas. El texto de las respuestas sale del reglamento, no
lo inventes: usá exactamente estos temas.

1. ¿Cómo reservo un albergue?
2. ¿Cuándo queda confirmada la reserva?
3. ¿Qué pasa si tengo que cancelar?
4. ¿Con cuánta anticipación puedo reservar?
5. ¿Cuántas noches puede quedarse una delegación?

Reglas del acordeón:

- Una sola respuesta abierta a la vez.
- El título es clickeable en toda su superficie, con estado de foco visible.
- La respuesta no empuja el contenido de forma brusca: altura animada o
  transición corta.
- Funciona con teclado (Enter y Espacio) y anuncia el estado expandido.

Entregables:

1. Los tres bloques en `index.html`, debajo del listado.
2. Estilos en `assets/css/sections.css`.
3. En `styleguide.html`: paso individual, ficha de regla y acordeón en estado
   cerrado y abierto.

Requisitos:

- Los pasos usan la misma iconografía del sistema (SVG, trazo consistente).
- Las respuestas del acordeón no superan las 3 líneas en desktop.
- Nada de tablas: no se leen bien a 390 px.

No hacer:

- No repetir el reglamento completo. Si la respuesta necesita más de 3 líneas, va
  al documento y se enlaza.
- No usar un carrusel de pasos.
- No poner estos bloques antes de las tarjetas.

Criterio de aceptación:

- Los tres bloques se leen de un vistazo, sin abrir el reglamento.
- A 390 px el acordeón sigue siendo usable y el texto no queda cortado.
- El bloque de reglas responde "¿me devuelven la plata?" sin que haya que buscar.
