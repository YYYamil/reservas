# Brief para Kombai — Landing v2 (Propuesta 2)

Este documento es el **paquete de entrada** para el agente de diseño. No es una
propuesta abierta: es la especificación que Kombai debe implementar. Si algo no
está acá, se consulta antes de inventarlo.

Complementa a `PROPUESTA-LANDING-V2.md` (diagnóstico y fundamentos). Este archivo
manda cuando hay conflicto.

---

## 0. Cómo usar este brief

1. Leer completo antes de la primera pantalla.
2. Trabajar **una sección o pantalla por iteración**, nunca el sitio entero.
3. Cada iteración se entrega con: markup, estilos, **todos los estados** y
   revisión a 390 px y 768 px.
4. La conexión con la API **no** es parte del trabajo de diseño: la hace el equipo.

---

## 1. Contexto del producto

Sitio de reservas de los albergues del Ministerio de Educación de Tucumán. Lo usan
escuelas y delegaciones que viajan a la provincia: reservan estadía (con camas) o
una visita de un día.

- Albergues: se listan **dinámicamente** desde `listarAlbergues` (hoy devuelve 5:
  `maestro`, `tinku`, `aquilina`, `altoverde`, `albergue-unt`). Las claves
  históricas `maestro`, `aquilina` y `tinku` no cambian; no hardcodear cantidad ni
  nombres de tarjetas.
- Dos modalidades: **visita** (fecha única, por día) y **alojamiento** (rango de fechas + cantidad de camas).
- Condicionantes reales: cupo limitado por día, máximo de días según tipo de
  delegación (escuelas 4, otras instituciones 3), calendario con ventana de
  anticipación acotada, pago por transferencia con carga de comprobante.
- El usuario no es un turista: es un docente o directivo organizando un viaje con
  alumnos. Necesita certeza (fechas, cupo, precio, qué pasa si cancela), no
  inspiración de viaje.

**Tono:** claro, directo, humano. Nada de "estimado usuario". Sin jerga
administrativa ni numeración de artículos en la home.

---

## 2. Contrato duro: lo que no se toca

Estas cosas están fuera del alcance del rediseño. Si un pedido de diseño obliga a
cambiarlas, se frena y se consulta.

| Elemento | Por qué |
|---|---|
| `api/index.php` y sus acciones | Es el backend de reservas, cupos, pagos y notificaciones |
| `admin/` (HTML, CSS, JS) | Panel interno, público distinto |
| Reglas de negocio | Cancelación (+48 h 100 %, <48 h 50 %, día de ingreso 0), cupos, máximo de días por tipo de delegación, horizontes de anticipación |
| Textos del reglamento y condiciones | Contenido legal, lo redacta el Ministerio |
| Claves de albergue | Las que devuelve la API son la identidad en BD, URLs y API; `maestro`, `aquilina` y `tinku` no se renombran |
| Flujo de estados de la reserva | Pre-reserva → comprobante → confirmada → cancelada |
| Nombres de campos del formulario | El backend los espera con esos nombres |
| Mails transaccionales | Fuera de alcance |

**Lo único que se rediseña:** la capa de presentación (HTML de páginas, CSS y los
componentes visuales). La lógica existente se reutiliza, no se reescribe.

---

## 3. Mapa de páginas

### 3.1 `index.html` — Descubrimiento

Objetivo: que en menos de 10 segundos el usuario entienda qué puede reservar y
empiece. No es una página institucional de presentación.

Secciones, en orden:

1. **Nav** — logo institucional pequeño, links (`Albergues`, `Cómo funciona`,
   `Ayuda`), acción secundaria `Mi reserva`.
2. **Hero de reserva** — H1 orientado a la tarea, subtítulo de una línea y
   **buscador** con: albergue (todos + los habilitados), entrada, salida, personas, modalidad
   (visita / alojamiento) y CTA `Ver disponibilidad`.
3. **Línea de confianza** — 2 o 3 datos concretos: cancelación sin cargo hasta
   48 h antes, confirmación con comprobante, cupo por día.
4. **Resultados / albergues** — filtros (modalidad, capacidad) y tarjetas.
5. **Cómo funciona** — 3 pasos, ícono + una línea cada uno. Sin párrafos.
6. **Prueba** — números reales, instituciones que ya vinieron, fotos de las
   instalaciones. Si no hay testimonios reales, no inventar: usar fotos y datos.
7. **Reglas clave + FAQ** — cancelación, horarios (ingreso 09:00 / salida 18:00),
   duración máxima, qué llevar. 5 preguntas máximo.
8. **Footer** — logo, contacto, reglamento, legales.

CTA primario único: `Reservar`. El detalle del albergue va como link secundario.

### 3.2 `reservar.html` — Transacción

Recibe `?albergue=<clave>&modalidad=<visita|alojamiento>`. Es una página completa,
no un modal. Wizard de **4 pasos**, que es como está cableada la lógica hoy:

| Paso | Contenido | Salida |
|---|---|---|
| 1 | Cantidad de personas (visita) o de camas (alojamiento) + precio estimado | Cantidad válida |
| 2 | Tipo de delegación (escuelas / otra institución) — solo alojamiento | Tipo elegido |
| 3 | Fechas en el calendario (día único o rango) | Disponibilidad validada |
| 4 | Datos: institución, responsable, DNI, celular, email, aceptación del reglamento | Datos completos |

- **Resumen de precio** siempre visible: lateral en desktop, sticky al pie en móvil.
- Barra de progreso de 4 pasos, navegable hacia atrás.
- Al confirmar: pantalla de éxito con código de reserva, instrucciones de pago y
  botón `Cargar comprobante`.

> Por qué 4 y no 3: el flujo actual habilita y bloquea cuatro contenedores de paso
> (`paso-box-1..4`). Fusionarlos en 3 obliga a tocar la máquina de pasos. La
> versión visual puede agrupar 1 y 2 bajo un mismo título ("Tu grupo") sin cambiar
> la cantidad de contenedores.

### 3.3 `mi-reserva.html` — Autogestión

Alcance real del backend hoy: **solo cancelación**. No existe un endpoint público
para consultar el estado de una reserva por código. La página no debe prometer lo
que la API no puede dar.

- Formulario: código de reserva (`R-000000`) + DNI del responsable.
- Resultado: confirmación de la cancelación y el monto de devolución que
  corresponde según antigüedad, o el motivo por el que no se puede cancelar.
- Acción `Cancelar reserva` con confirmación previa y explicación de la política
  (100 % con más de 48 h, 50 % dentro de las 48 h, sin devolución el día de
  ingreso o después).
- Enlace a `pago.html` para subir el comprobante.
- Si se quiere mostrar el estado de la reserva, primero hay que crear el endpoint
  (fase 2, backend). No diseñar esa vista antes.

### 3.4 `pago.html` — Comprobante

Existe y se reestiliza. Formulario de carga con estados: sin archivo, subiendo,
recibido, rechazado, error de red.

---

## 4. Inventario de componentes

Cada componente se entrega con **todas** sus variantes y estados. Un componente
sin estados no se considera terminado.

| Componente | Variantes / estados |
|---|---|
| `NavBar` | desktop, móvil (menú colapsado), con sesión de reserva en curso |
| `HeroSearch` | default, con filtros aplicados, móvil (botón que abre panel), error de validación |
| `SearchField` | fecha, select, stepper, segmented |
| `VenueCard` | default, hover, sin disponibilidad, cargando (skeleton), sin foto |
| `FilterBar` | default, chip activo, chip deshabilitado, sin resultados |
| `HowItWorks` | 3 pasos, versión compacta móvil |
| `TrustStrip` | con y sin testimonios |
| `RulesFaq` | acordeón cerrado / abierto / multiabierto |
| `Stepper` | paso actual, completado, pendiente, con error |
| `Calendar` | día disponible, pocas camas, sin cupo, seleccionado, inicio de rango, fin de rango, dentro de rango, pasado, fuera de ventana, cargando |
| `PriceSummary` | sin fechas, con fechas, con cantidad, con descuento/ajuste si aplica |
| `BookingSummary` | vacío, parcial, completo, sticky móvil |
| `StatusBanner` | info, éxito, advertencia, error |
| `EmptyState` | sin resultados, sin disponibilidad, error de red, página no encontrada |
| `Skeleton` | tarjeta, calendario, resumen |
| `Footer` | único |

---

## 5. Sistema visual (definir antes de la primera pantalla)

Sin tokens definidos, Kombai produce un estilo distinto por sección. Estos son los
que hay que cerrar primero, como archivo de fundamentos:

| Token | Definición esperada |
|---|---|
| Color | 1 acento de marca + escala de neutrales (6-9 pasos) + semánticos (éxito, alerta, error, info). El azul institucional `#005CA2` deja de ser fondo dominante: pasa a acento o se reemplaza. |
| Tipografía | 1 familia de UI + 1 opcional para títulos. Escala fija (12/14/16/18/24/32/48). Pesos limitados a 3. |
| Espaciado | escala 4/8: 4, 8, 12, 16, 24, 32, 48, 64, 96. Sin valores sueltos. |
| Radios | 3 valores (8 / 12 / 20) y una sola familia por tipo de elemento. |
| Sombras | 2 niveles. Preferir borde de 1 px antes que sombra. |
| Movimiento | 150-200 ms, ease-out. Respetar `prefers-reduced-motion`. |
| Fotos | proporción fija 3:2 o 4:3, recorte consistente. La foto identifica al albergue, no el borde de color. |
| Iconografía | un solo set, trazo consistente, tamaño 20/24. |
| Accesibilidad | contraste AA (4.5:1) en texto, foco visible, targets táctiles ≥ 44 px, navegación por teclado en calendario y modales. |

---

## 6. Responsive

Breakpoints: **360 / 480 / 768 / 1024 / 1280**. Diseño mobile-first.

| Rango | Reglas |
|---|---|
| 360-767 | 1 columna de tarjetas; hero con un solo botón que abre el buscador; wizard a pantalla completa; resumen de precio fijo al pie; sin mapa embebido (link "Ver mapa"); sin hover como única señal |
| 768-1023 | 2 columnas; buscador en 2 filas; resumen debajo del paso |
| ≥ 1024 | 3 columnas; buscador en una fila; resumen lateral |

Prohibido: scroll horizontal, `100vh` en móvil, texto menor a 14 px, tablas que se
aplastan, calendario con celdas menores a 40 px.

---

## 7. Contrato técnico de acople

El JS existente encuentra los elementos por identificadores. El markup nuevo debe
exponer estos atributos; los nombres son parte del contrato.

**Atributos de datos (nuevos, preferidos):**

| Atributo | Dónde | Valores |
|---|---|---|
| `data-albergue` | raíz de la página y de cada tarjeta/ficha | clave tal como la devuelve la API (`maestro` \| `aquilina` \| `tinku` \| `altoverde` \| `albergue-unt` \| nuevas) |
| `data-modalidad` | raíz del wizard | `visita` \| `alojamiento` |
| `data-accion` | botones | `reservar`, `ver-detalle`, `ver-mapa`, `cancelar`, `pagar`, `consultar` |
| `data-paso` | contenedores e indicadores del wizard | `1` \| `2` \| `3` |
| `data-campo` | inputs del formulario | `institucion`, `responsable`, `dni`, `email`, `prefijo`, `numero`, `cantidad`, `delegacion`, `acepta-terminos` |
| `data-fecha` | celdas del calendario | `YYYY-MM-DD` |
| `data-rol` | elementos que el JS actualiza | `total`, `unitario`, `disponibles`, `estado`, `error`, `codigo` |

**Identificadores que se preservan** (si el HTML cambia de forma, se mapean uno a
uno):

```
modal-{clave}                 modal-alojamiento-{clave}
step-{n}-{clave}              paso-box-{n}-{clave}
btn-submit-alo-{clave}        cantidad-alo-{clave}
delegacion-alo-{clave}        calendario-alo-{clave}
monto-total-alo-{clave}       fecha-range-display-alo-{clave}
{institucion|responsable|dni|email|prefijo|numero|acepta-terminos}-alo-{clave}
```

Regla: **Kombai puede cambiar clases y estructura visual libremente; no puede
renombrar claves de albergue, valores de `data-*` ni los textos de los campos que
viajan al backend.**

---

## 8. Secuencia de trabajo sugerida

Cada paso es un pedido separado, con captura de referencia y datos reales de mock
(nombres, montos, capacidades de los albergues que devuelve la API).

1. Fundamentos: tokens, tipografía, escala, grilla, botones e inputs base.
2. Nav + footer.
3. Hero de reserva + buscador (desktop y móvil).
4. Tarjeta de albergue (con skeleton y sin disponibilidad).
5. Listado + filtros + estado vacío.
6. Cómo funciona + reglas/FAQ + footer completo.
7. Wizard: stepper + resumen de precio.
8. Calendario con todos sus estados.
9. Pasos 2 y 3 + pantalla de éxito.
10. `mi-reserva` (consulta, estado, cancelación).
11. `pago` (carga y estados).
12. Pasada de accesibilidad y responsive a 390 / 768 / 1280.

**Cómo pedir:** "implementá esta sección respetando los tokens y los atributos del
brief, con estos estados". **Cómo no pedir:** "hacé que se vea más moderno" o
"rediseñá el sitio completo".

---

## 9. Definición de terminado (por pantalla)

- [ ] Funciona a 360, 390, 768, 1024 y 1280 sin scroll horizontal.
- [ ] Todos los estados del inventario están implementados.
- [ ] Contraste AA y foco visible en todos los interactivos.
- [ ] Calendario y acordeones operables con teclado.
- [ ] Imágenes con proporción fija, `alt` descriptivo y sin salto de layout.
- [ ] Textos en español rioplatense, sin jerga administrativa.
- [ ] El markup expone los `data-*` y conserva las claves del contrato.
- [ ] Sin `!important`, sin estilos inline, sin colores hardcodeados fuera de tokens.
- [ ] No se agregaron pasos, campos ni reglas de negocio nuevas.

---

## 10. Anti-patrones

- **Usar el azul institucional como color dominante.** El restyling se lee como "lo
  mismo con bordes redondeados".
- **Resolver el wizard dentro de un modal.** En 390 px no entra.
- **Dos CTA del mismo peso por tarjeta.** La modalidad se elige en el flujo.
- **Mapa de Google embebido en la landing.** Pesa y rompe el layout; va como link o
  en la ficha.
- **Inventar testimonios, logos de instituciones o cifras.** Si no hay dato real,
  se usa foto o se omite el bloque.
- **Diseñar solo el estado feliz.** El sitio se rompe con la primera API lenta o un
  día sin cupo.
- **Pedirle al agente que conecte la API.** La conexión la hace el equipo por
  atributos de datos.
