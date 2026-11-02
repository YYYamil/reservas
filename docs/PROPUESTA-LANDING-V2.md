# Landing v2: estructura, sistema visual y brief para Kombai

Documento de trabajo para el restyling del landing de reservas. No reemplaza
`FLUJO-GIT.md` ni `MAQUINA-ESTADOS-RESERVAS.md`: define **que** se cambia en la
estructura y **como** encarar el rediseno con un agente de diseno (Kombai) sin
romper la logica de reservas.

> Este documento explica el **por que**. La especificacion operativa que se le
> entrega al agente esta en `BRIEF-KOMBAI.md`, que tiene prioridad si hay
> diferencias.

---

## 1. El cambio de fondo

Hoy el landing es un **catalogo institucional con formularios adentro de modales**.
La propuesta es que sea el **arranque de un flujo de reserva**: una pagina que
contesta, en orden, tres preguntas y despues deja de estorbar.

> "Que albergue" -> "para cuando y cuanta gente" -> "visita o alojamiento".

Todo lo demas (pasos, reglamento, confianza, FAQ) va **despues** de la accion,
no antes. Eso es lo que hoy hace que la pagina se sienta "institucional": explica
mucho antes de dejar hacer.

---

## 2. Diagnostico: por que la estructura actual frena el rediseno

| # | Sintoma | Donde | Consecuencia |
|---|---|---|---|
| 1 | Caja de 3 pasos con parrafos ocupa el primer scroll | `index.html:37-59` | El usuario lee antes de ver opciones; en movil empuja las tarjetas fuera de pantalla |
| 2 | Dos CTA del mismo peso por tarjeta ("Reservar Visita" / "Reservar Alojamiento") | `script.js:273-275` | El usuario tiene que entender la diferencia antes de poder elegir. Es la principal friccion del landing |
| 3 | El wizard completo (4 pasos + calendario + formulario) vive dentro de un modal generado por JS | `script.js:448-657` | En movil es hostil; el modal es el contenedor equivocado para un flujo de 4 pasos |
| 4 | Mapa de Google embebido en cada tarjeta | `script.js:220-227` | Peso, layouts desparejos, CLS y scroll atrapado dentro de la card |
| 5 | Grid `auto-fit minmax(350px)` sin breakpoint real | `styles.css:210-215` | A 360-390 px el contenido se aprieta; no hay diseno movil, hay "achicamiento" |
| 6 | Acciones globales sueltas entre las tarjetas y el footer | `index.html:73-86` | "Cancelar reserva" y "Pago y comprobante" no pertenecen a la landing; compiten con la reserva |
| 7 | 33 `!important`, estilos inline en los templates, 3 fuentes de color (variables, hex, `--acc` dinamico) | `styles.css`, `script.js` | Cualquier rediseno global se vuelve una pelea de especificidad |
| 8 | Todo el markup de tarjetas y modales son strings de JS | `script.js:229-657` | Un agente de diseno trabaja sobre codigo/HTML estable. Lo que no existe como markup no lo puede redisenar |
| 9 | Nombres de clases con significado visual ("rojo", "verde", "cuadrado") | `script.js:556-564` | El sistema visual queda clavado al lenguaje actual |

**El punto 8 es el mas importante para Kombai.** Si el HTML de las tarjetas y los
modales se genera por concatenacion, el agente va a tener que reescribir
`script.js` para tocar el diseno, y ahi se rompen reservas, cupos y calendarios.

---

## 3. Principio rector

- **Una decision por pantalla.** Nada de "elegi modalidad, fecha, camas y datos"
  en el mismo lugar.
- **La accion primero, la explicacion despues.** Los pasos y el reglamento se
  leen cuando el usuario ya decidio, o cuando tiene una duda concreta.
- **Un solo CTA primario por tarjeta.** La modalidad se elige en el flujo, no en
  la tarjeta.

---

## 4. Nueva arquitectura de informacion

### Landing (`index.html`)

```
+--------------------------------------------------------------+
| NAV   [logo chico]        Albergues  Como funciona  Ayuda    |
|                                   [Consultar mi reserva]     |
+--------------------------------------------------------------+
| HERO DE RESERVA                                              |
|  H1: "Reserva el albergue para tu delegacion"                |
|  Sub: 3 albergues en Tucuman. Confirmas con comprobante.     |
|  +--------------------------------------------------------+  |
|  | [Albergue v] [Entrada] [Salida] [Personas] [Visita|Alo]|  |
|  |                                        [Ver disponib.] |  |
|  +--------------------------------------------------------+  |
|  Confianza: "Cancelacion gratuita +48 h" - "Cupo por dia"    |
+--------------------------------------------------------------+
| ALBERGUES / RESULTADOS                                       |
|  Chips: [Todos] [Visita] [Alojamiento] [Hasta 50] [Hasta 100]|
|  +-------------+ +-------------+ +-------------+             |
|  | foto        | | foto        | | foto        |             |
|  | Nombre      | | ...         | | ...         |             |
|  | Capacidad   | |             | |             |             |
|  | Desde $X    | |             | |             |             |
|  | [Reservar]  | | [Reservar]  | | [Reservar]  |             |
|  | Ver detalle | |             | |             |             |
|  +-------------+ +-------------+ +-------------+             |
+--------------------------------------------------------------+
| COMO FUNCIONA  (3 pasos, icono + 1 linea, sin parrafos)      |
+--------------------------------------------------------------+
| PRUEBA: numeros reales, instituciones que ya vinieron,       |
| fotos de las instalaciones, 1-2 testimonios cortos           |
+--------------------------------------------------------------+
| REGLAS CLAVE + FAQ  (cancelacion, horarios, duracion maxima) |
+--------------------------------------------------------------+
| FOOTER slim: logo, contacto, reglamento, legales             |
+--------------------------------------------------------------+
```

### Pantallas separadas (no modales)

| Pantalla | Contenido | Reemplaza a |
|---|---|---|
| `reservar.html` | Wizard de 4 pasos (cantidad, delegacion, fechas, datos) + resumen de precio fijo (sticky en movil) | `modal-visita` + `modal-alojamiento` |
| `pago.html` | Carga de comprobante (ya existe, se reestiliza) | — |
| `mi-reserva.html` | Consultar / cancelar con codigo + DNI | Modal "Cancelar reserva" de la landing |

En movil, el wizard es una **pagina completa**, no un modal con scroll interno.

---

## 5. Inventario de componentes (para pedirle pantallas a Kombai)

| Componente | Variantes / estados |
|---|---|
| `NavBar` | desktop, mobile (menu colapsado) |
| `HeroSearch` | default, con filtros aplicados, mobile (boton que abre sheet) |
| `SearchField` | fecha rango, select, stepper de personas, segmented visita/alojamiento |
| `VenueCard` | default, hover, sin disponibilidad, cargando (skeleton) |
| `FilterChips` | default, activo, disabled |
| `HowItWorks` | 3 pasos |
| `TrustStrip` | numeros, logos de instituciones, testimonios |
| `RulesFaq` | acordeon abierto/cerrado |
| `BookingSummary` | vacio, parcial, completo (sticky bottom en movil) |
| `Calendar` | dia libre, ocupado, seleccionado, rango, pasado, cargando |
| `PriceSummary` | sin fechas, con fechas, con cantidad |
| `StatusBanner` | info, exito, error, advertencia |
| `EmptyState` | sin resultados, sin disponibilidad, error de red |
| `Footer` | unico |

Regla: por cada componente, pedir **todos** los estados. Un agente de diseno solo
entrega lo que le mostras; si no le pedis "sin disponibilidad" ni "error", no
existen en el resultado.

---

## 6. Sistema visual minimo (definir ANTES de pedir pantallas)

Sin esto, Kombai inventa un estilo distinto por seccion y el resultado se ve
armado con retazos (que es exactamente lo que hoy pasa con los `!important`).

```
Color     1 acento de marca + escala de neutrales (no usar el azul #005CA2
          como fondo de todo: pasa a ser acento, o se reemplaza).
          Texto con contraste AA (4.5:1) sobre cada fondo.
Tipografia 1 familia para UI + 1 opcional para titulos. Escala definida
          (12/14/16/18/24/32/48), no tamanos sueltos.
Espaciado  escala 4/8: 4 8 12 16 24 32 48 64 96.
Radios     3 valores (chico 8, medio 12, grande 20) y un solo radio por familia.
Sombras    2 niveles. Bordes de 1 px en vez de sombra donde se pueda.
Movimiento 150-200 ms, ease-out. Respetar prefers-reduced-motion.
Fotos      proporcion fija (4:3 o 3:2) y recorte consistente: reemplazan
          el borde de color como identificador del albergue.
```

La identidad institucional no desaparece: se reduce a un logo en el nav y en el
footer. El resto de la pagina habla el idioma del producto (foto grande, datos
concretos, precio, disponibilidad).

---

## 7. Responsive

Breakpoints explicitos: **360 / 480 / 768 / 1024 / 1280**. Mobile-first.

- **360-767 (movil)**
  - Hero: H1 corto + un solo boton "Buscar albergue" que abre un sheet con los campos.
  - Tarjetas: 1 columna, foto 3:2, CTA a ancho completo, sin iframe de mapa (link "Ver mapa").
  - Wizard: pagina completa; resumen de precio fijo abajo; un paso visible por vez.
  - Targets tactiles >= 44 px; sin hover como unica senal.
- **768-1023 (tablet)**: 2 columnas de tarjetas, hero con buscador en 2 filas.
- **>= 1024**: 3 columnas, buscador en una fila, resumen lateral en el wizard.
- Evitar: scroll horizontal, `100vh` en movil, texto menor a 14 px, tablas que se aplastan.

---

## 8. Estados que hay que disenar (y hoy no existen)

- Cargando albergues (skeleton de 3 cards, no un spinner centrado).
- Error de red (mensaje + reintentar).
- Albergue sin disponibilidad en las fechas elegidas (fecha alternativa sugerida).
- Rango de fechas invalido / supera el maximo de dias por tipo de delegacion.
- Cupo insuficiente para la cantidad de personas pedida.
- Reserva enviada / pendiente de comprobante / confirmada / cancelada.
- Formulario con errores por campo (no un alert global).

---

## 9. Contrato con la logica actual (no romper)

El JS esta acoplado a IDs generados. Si se reescribe el markup, estos nombres se
mantienen (o se mapean 1 a 1 en un adaptador):

```
claves de albergue:  maestro | aquilina | tinku
patrones de id:      step-{n}-{clave}         (indicadores de paso)
                     paso-box-{n}-{clave}     (contenedores de paso)
                     btn-submit-alo-{clave}   (boton de confirmacion)
                     cantidad-alo-{clave}, delegacion-alo-{clave},
                     calendario-alo-{clave}, monto-total-alo-{clave}
                     {campo}-alo-{clave}      (institucion, responsable, dni, email)
                     modal-{clave}, modal-alojamiento-{clave}
endpoints:           api/index.php?action=listarAlbergues
                     api/index.php (crear reserva / disponibilidad / cancelar)
datos de la API:     clave, nombre, capacidad, capacidad_visitas, monto_visita,
                     monto_cama, imagenes[], caracteristicas[], mapa, pdf, color,
                     habilitado, meses_anticipacion, horizonte_horas,
                     fecha_minima_reserva
```

**No tocar en el restyling:** reglas de negocio (cancelacion 48 h / 50 %, cupos,
maximo de dias por tipo de delegacion), textos legales del reglamento, mails,
panel admin, `pago.html` en su logica de carga.

**Recomendacion practica:** un solo punto de acople. El JS busca por `data-*`
(`data-albergue`, `data-paso`, `data-accion`) en lugar de por clases visuales.
Asi Kombai puede cambiar clases y estructura visual sin que se rompa nada.

---

## 10. Como trabajar con Kombai (orden sugerido)

1. **Primero el sistema, despues las pantallas.** Un archivo de tokens + los
   componentes base (boton, input, card, chip). Todo lo que venga despues hereda.
2. **Una seccion por pedido**, con captura de referencia y datos reales de mock
   (nombres y montos reales de los albergues que devuelve la API, no "Lorem ipsum").
3. **Pedir estados explicitos** en el mismo mensaje (vacio, cargando, error).
4. **Revisar 390 px y 768 px en cada iteracion**, no al final.
5. **No pedirle que conecte la API.** El agente entrega la vista; la conexion se
   hace por `data-*` contra `script.js`.
6. **Iterar por diff, no por regeneracion.** Pedir "cambia solo la jerarquia del
   hero" en vez de "rehace el hero".

Archivos de referencia utiles para el agente: capturas de Bookings de albergues
juveniles / hosteleria, no de portales de gobierno.

---

## 11. Fases

| Fase | Entregable | Riesgo si se saltea |
|---|---|---|
| 0 | Rama `restyling`, congelar logica, inventario de IDs | Se rompe reserva en produccion |
| 1 | Tokens + shell (nav, footer, tipografia, grilla) | Estilos inconsistentes por seccion |
| 2 | Hero de reserva + buscador (sin funcionalidad) | — |
| 3 | Tarjetas v2 (1 CTA, sin mapa embebido, skeleton) | — |
| 4 | Wizard en pagina propia (4 pasos) + resumen sticky | Abandono en movil |
| 5 | Pago y "mi reserva" reestilizados | Flujo cortado al final |
| 6 | QA responsive, accesibilidad, performance (LCP, CLS) | Percepcion de "sigue lento" |

---

## 12. Riesgos

- **Perder el codigo de reserva** por reescribir templates: mitigar con Fase 0 y
  el contrato de IDs.
- **Disenar pantallas sin estados**: el resultado se ve bien en Figma y se rompe
  con la primera API lenta.
- **Mantener el azul institucional como color dominante**: el restyling se lee
  como "lo mismo con bordes redondeados".
- **Modal para todo**: el wizard de 4 pasos no entra en un modal en 390 px.
- **Iframe de mapa en la landing**: seguir cargando Google Maps en cada tarjeta
  anula buena parte de la mejora percibida de velocidad.
