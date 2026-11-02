# Contrato de integración — markup nuevo ↔ lógica actual

El rediseño **no reescribe** `script.js`: lo reutiliza. Para eso, el markup que
genere Kombai tiene que exponer los identificadores que el JS ya busca, o un
puente que los mapee.

Este documento es el inventario completo, extraído de `script.js`. Si un
identificador de esta lista falta en el markup, la función asociada falla en
silencio o lanza error.

---

## Regla general

Hay dos caminos. Se recomienda el primero para la primera versión.

| Camino | Qué implica | Cuándo |
|---|---|---|
| **A. Conservar los IDs** | El markup nuevo usa exactamente los mismos `id`. Cero cambios en `script.js` | Primera integración (recomendado) |
| **B. Puente por datos** | El markup usa `data-*` y una capa nueva traduce a los IDs que el JS espera | Cuando el rediseño esté estable y se quiera limpiar |

En ambos casos, las **claves** (`maestro`, `aquilina`, `tinku`) y los **nombres de
campo** no cambian.

---

## 1. Globales (todas las páginas)

| ID | Quién lo usa | Qué debe existir |
|---|---|---|
| `anioActual` | año del footer | Un elemento de texto |
| `albergues-container` | `cargarAlbergues` | Contenedor de tarjetas (solo en la home) |
| `modal-confirmacion` | `mostrarConfirmacion` | Contenedor del modal de éxito |
| `datos-reserva-confirmacion` | `mostrarConfirmacion` | Contenedor interno donde se inyecta el detalle |
| `app-snackbar` | `showSnackbar` | Lo crea el JS si no existe; no hace falta en el markup |

El aviso con video (`site-notice`, `aviso-video`, `sound-toggle`, `icon-mute`,
`icon-sound`) está desactivado y no forma parte del rediseño.

## 2. Cancelación (pasa a `mi-reserva.html`)

| ID | Quién lo usa |
|---|---|
| `modal-cancelar` | abrir/cerrar el modal |
| `open-cancel-modal` | botón que lo abre |
| `close-cancel-modal` | botón que lo cierra |
| `cancelForm` | formulario |
| `cancel-id` | campo código de reserva |
| `cancel-dni` | campo DNI |
| `btn-cancelar-enviar` | botón de envío (estado de carga) |

La API recibe `idReserva` (acepta el código público `R-000123` o el id numérico) y
`dni`. No hay endpoint público para consultar el estado de una reserva: si el
rediseño muestra un estado, hay que crearlo antes (backend, fuera de alcance).

### Pago (`pago.html`)

La página de comprobante es autónoma: su script está embebido en el HTML, no en
`script.js`. Si se reescribe el markup, estos IDs se conservan.

| ID | Quién lo usa |
|---|---|
| `pagoForm` | formulario de carga |
| `pago-codigo` | campo código de reserva |
| `pago-archivo` | input de archivo (PDF/JPG/PNG, máximo 8 MB) |
| `pagoBtn` | botón de envío |
| `pagoMsg` | contenedor del mensaje de resultado (éxito o error) |

La acción es `subirComprobante` y el campo del archivo se llama `comprobante`.

## 3. Visita — patrón `{campo}-{clave}`

Para cada albergue (`maestro`, `aquilina`, `tinku`):

| ID | Función que lo lee | Nota |
|---|---|---|
| `modal-{clave}` | `openModal` / `closeModal` | Contenedor del wizard de visita |
| `reservaForm{Clave}` | `handleFormSubmit` | `Clave` con mayúscula inicial: `reservaFormMaestro` |
| `institucion-{clave}` | `getFormData` | Requerido |
| `responsable-{clave}` | `getFormData` | Requerido |
| `dni-{clave}` | `getFormData` | Requerido |
| `email-{clave}` | `getFormData` | Requerido, se normaliza a minúsculas |
| `contacto-{clave}` | `getFormData` | **Oculto**: lo arma el par prefijo + número |
| `prefijo-visita-{clave}` | `setupFieldGuards` | Código de área |
| `numero-visita-{clave}` | `setupFieldGuards` | Número |
| `cantidad-{clave}` | `actualizarMontoVisita` | Personas |
| `fechaIngreso-{clave}` | `getFormData`, calendario | Input de solo lectura |
| `horaIngreso-{clave}` | `getFormData` | Select poblado por JS |
| `horaEgreso-{clave}` | `getFormData` | Select poblado por JS |
| `calendario-{clave}` | `generarCalendario` | Grilla que el JS **rellena** |
| `mes-actual-{clave}` | `generarCalendario` | Texto del mes |
| `cal-loader-{clave}` | `showCalendarLoading` | Overlay de carga |
| `disponibles-{clave}` | `mostrarInfoDia` | Cupo del día |
| `capacidad-{clave}` | `mostrarInfoDia` | Capacidad total |
| `ocupacion-fill-{clave}` | `updateOcupacionUI` | Barra de ocupación |
| `ocupacion-info-{clave}` | `updateOcupacionUI` | Texto de ocupación |
| `monto-total-{clave}` | `actualizarMontoVisita` | Total |
| `monto-unitario-{clave}` | `actualizarMontoVisita` | Unitario |
| `monto-ayuda-{clave}` | `actualizarMontoVisita` | Texto de ayuda |

## 4. Alojamiento — patrón `{campo}-alo-{clave}`

| ID | Función que lo lee | Nota |
|---|---|---|
| `modal-alojamiento-{clave}` | `openAlojamientoModal` | Contenedor del wizard |
| `aloForm{Clave}` | `handleFormSubmitAlo` | `aloFormMaestro` |
| `cantidad-alo-{clave}` | `actualizarMontoAlo` | Camas |
| `delegacion-alo-{clave}` | `setupDelegacionListenerAlo` | Escuelas / otra institución |
| `delegacion-hidden-alo-{clave}` | `getFormDataAlo` | Oculta, espejo del select |
| `institucion-alo-{clave}` | `getFormDataAlo` | Requerido |
| `responsable-alo-{clave}` | `getFormDataAlo` | Requerido |
| `dni-alo-{clave}` | `getFormDataAlo` | Requerido |
| `email-alo-{clave}` | `getFormDataAlo` | Requerido |
| `prefijo-alo-{clave}` | `setupTelefonoAlojamiento` | Código de área |
| `numero-alo-{clave}` | `setupTelefonoAlojamiento` | Número |
| `contacto-alo-{clave}` | `getFormDataAlo` | **Oculto**, lo arma el par anterior |
| `acepta-terminos-alo-{clave}` | validación del submit | Checkbox obligatorio |
| `calendario-alo-{clave}` | `generarCalendarioAlo` | Grilla que el JS **rellena** |
| `mes-actual-alo-{clave}` | `generarCalendarioAlo` | Texto del mes |
| `nav-prev-alo-{clave}` | `cambiarMesAlo` | Botón mes anterior |
| `nav-next-alo-{clave}` | `cambiarMesAlo` | Botón mes siguiente |
| `cal-loader-alo-{clave}` | carga de disponibilidad | Overlay |
| `disponibles-alo-{clave}` | `mostrarInfoDiaAlo` | Cupo |
| `ocupacion-fill-alo-{clave}` | `updateOcupacionUIAlo` | Barra |
| `ocupacion-info-alo-{clave}` | `updateOcupacionUIAlo` | Texto |
| `monto-unitario-alo-{clave}` | `actualizarMontoAlo` | Unitario (paso 1) |
| `monto-total-alo-{clave}` | `actualizarMontoAlo` | Total (paso 1) |
| `monto-ayuda-alo-{clave}` | `actualizarMontoAlo` | Ayuda (paso 1) |
| `monto-unitario-alo-p3-{clave}` | `actualizarMontoAlo` | Unitario (paso 3) |
| `monto-total-alo-p3-{clave}` | `actualizarMontoAlo` | Total (paso 3) |
| `monto-ayuda-alo-p3-{clave}` | `actualizarMontoAlo` | Ayuda (paso 3) |
| `fecha-range-display-alo-{clave}` | `updateRangeDisplay` | Rango elegido |
| `step-{n}-{clave}` | `initPasoFlujoAlo` | Indicador del paso, `n` de 1 a 4 |
| `paso-box-{n}-{clave}` | `enableStepAlo` | Contenedor del paso, `n` de 1 a 4 |
| `btn-submit-alo-{clave}` | `habilitarBotonReservaAlo` | Botón de confirmación |

> **Atención con la cantidad de pasos:** el JS maneja **4** pasos (`step-1..4`,
> `paso-box-1..4`). El brief fija el wizard en 4 pasos por esa razón. Si el diseño
> propone 3, hay que adaptar la máquina de pasos (fusionar 1 y 2) o mantener los 4
> contenedores y agruparlos visualmente bajo un mismo título. Es el único punto
> donde el rediseño y la lógica no coinciden de forma directa.

---

## 5. Clases que el JS usa como hooks

El JS no solo busca por `id`: también consulta por **clase**. Hay dos categorías y
se comportan distinto.

### 5.1 Clases en el markup (las escribe el rediseño)

| Selector | Dónde | Qué hace el JS |
|---|---|---|
| `.step-container` | wizard | Las cuenta **por orden**: la primera es el paso 1 |
| `.step-indicator` | wizard | Mismo criterio, para el círculo del paso |
| `.progress-fill` | wizard | Le aplica el ancho en porcentaje |
| `.btn-submit` | formularios | Le cambia el estado (cargando, éxito, error) |
| `.btn-label` | dentro del botón | Es el texto que cambia |
| `.nav-mes` | calendario | Engancha los botones de mes anterior y siguiente |
| `.modal-visita` / `.modal-alojamiento` | modales | Recorren sus campos para validar y formatear |
| `.modal.active` | modal | Detecta cuál está abierto al presionar Escape |
| `.modal-confirmacion-title` | confirmación | Cambia el título a "Prereserva realizada" |
| `.close-modal-confirmacion` | confirmación | Botón de cierre |
| `.btn-aceptar-modal-confirmacion` | confirmación | Botón "Aceptar" |
| `.glide` / `.glide__arrow` | carrusel | Inicializa el carrusel de fotos |

### 5.2 Clases que el JS **genera** (el rediseño solo puede estilarlas)

El calendario no está en el HTML: lo construye `generarCalendarioAlo` /
`generarCalendario`. Cada celda se crea con `class="dia …"` y recibe clases de
estado. Si el rediseño no apunta a estas clases, el calendario aparece sin estilo.

| Clase | Significado |
|---|---|
| `.dia` | Cada celda del calendario |
| `.otro-mes` | Celda vacía de relleno |
| `.verde` | Día con cupo suficiente |
| `.rojo` | Día sin cupo para la cantidad pedida |
| `.azul-seleccion` | Selección temporal mientras se confirma disponibilidad |
| `.en-rango` / `.inicio-rango` / `.fin-rango` | Marcas del rango elegido |
| `.badge-libre` | Número de camas libres dentro de la celda |
| `.disabled` | Botón o campo bloqueado |

**Consecuencia:** el calendario se rediseña por CSS sobre ese DOM, o se reescribe
el generador. No hay término medio. Planificar el prompt 08 en consecuencia.

### 5.3 Regla

Estas clases son **hooks técnicos, no estilos**. Se conservan junto a las visuales:
un elemento puede ser `class="cal-day dia verde"` y verse como se quiera. Si se
renombran, hay que actualizar `script.js` en el mismo commit.

Verificación: antes de dar por integrada una pantalla, buscar en `v2/` cada cadena
de las dos tablas. Si falta alguna, esa función no va a encontrar el elemento.

---

## 6. Qué se rompe si falta cada grupo

| Falta | Consecuencia |
|---|---|
| `modal-{clave}` o `modal-alojamiento-{clave}` | El botón de la tarjeta no abre nada (error de JS) |
| `reservaForm{Clave}` / `aloForm{Clave}` | No se engancha el submit: el formulario no envía |
| `contacto-{clave}` / `contacto-alo-{clave}` | El teléfono viaja vacío y la API rechaza la reserva |
| `calendario-{clave}` | No se puede elegir fecha: no hay reserva posible |
| `btn-submit-alo-{clave}` | El botón nunca se habilita |
| `step-*` / `paso-box-*` | El wizard no avanza ni desbloquea pasos |
| `cancel-*` / `cancelForm` | No se puede cancelar una reserva |
| `datos-reserva-confirmacion` | La reserva se crea pero el usuario no ve el código |

## 7. Punto de entrada por página

Hoy `script.js` termina con `cargarAlbergues()` en `DOMContentLoaded`, pensado
para la home. En las páginas nuevas eso no aplica:

| Página | Bootstrap necesario |
|---|---|
| `index.html` | Igual que hoy: cargar los albergues que devuelve la API y renderizar tarjetas |
| `reservar.html` | Cargar el albergue de `?albergue=`, inicializar su wizard y abrirlo |
| `mi-reserva.html` | No cargar albergues; solo enganchar el formulario de cancelación |
| `pago.html` | No cargar albergues; solo el formulario de comprobante |

Sin este ajuste, `reservar.html` falla al buscar `#albergues-container` (que no
existe) y `mi-reserva.html` intenta renderizar tarjetas que no van.

---

## 8. Verificación mínima después de integrar

1. Home: se ven las 3 tarjetas y cada botón abre su wizard.
2. Visita: elegir fecha, completar datos, confirmar, ver el código.
3. Alojamiento: cantidad → delegación → rango de fechas → datos → confirmar.
4. Cupo: pedir más camas de las disponibles y ver que lo impide.
5. mi-reserva: consultar un código real y cancelarlo.
6. pago: subir un comprobante de prueba y ver el estado.
7. Consola del navegador sin errores en las 4 páginas.

Cada punto se prueba contra `reserva_albergue_dev`, nunca contra producción.
