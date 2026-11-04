# Prompt 01 — Fundamentos del sistema visual

**Cómo usarlo:** abrí VS Code con la carpeta `v2/` como raíz (ventana aparte, no el
repo completo). Adjuntá a Kombai: el contenido de `docs/BRIEF-KOMBAI.md`, el de
`docs/datos-mock.md` y 3 capturas de referencia. La decisión de marca ya está
completada más abajo. Las rutas del prompt son relativas a `v2/`.

**Qué esperás de vuelta:** 3 archivos CSS + `styleguide.html`. Ninguna página del
sitio todavía.

---

## PROMPT (copiar desde acá)

Contexto: sitio de reservas de albergues del Ministerio de Educación de Tucumán.
Los albergues se listan desde la API (hoy 5 habilitados, sin número fijo), con dos
modalidades (visita de un día y alojamiento con camas) y pago por transferencia con
comprobante. Lo usan docentes y directivos que organizan viajes escolares:
necesitan certeza, no inspiración de viaje.

La identidad actual es institucional (azul `#005CA2` dominante, Roboto, íconos
Font Awesome). Se reemplaza por un producto de reservas moderno, claro y humano.
El respaldo institucional se conserva solo en el logo del nav y del footer.

Decisión de marca (cerrada): paleta **terracota + verde** sobre neutros cálidos.
Terracota como acento principal (referencia `#B4552D`, ajustable si falla el
contraste), verde profundo como acento secundario (referencia `#2F5D43`), fondos
marfil/arena y texto carbón. El azul `#005CA2` no se usa como color dominante ni
de fondo. Tipografía: sans para UI (Manrope o Inter) y serif para títulos
(Source Serif 4 o Fraunces), máximo 3 pesos; Google Fonts con fallback de sistema,
sin build step.

Objetivo de este pedido: definir el sistema visual y los componentes base. **No
diseñar pantallas del sitio.**

Entradas: el brief de diseño y la hoja de datos mock adjuntos a este mensaje
(contrato, restricciones, datos reales y escenarios).

Entregables, con rutas relativas a la raíz del workspace:

1. `assets/css/tokens.css` — variables: color, tipografía, espaciado, radios,
   sombras, movimiento.
2. `assets/css/base.css` — reset, tipografía, foco, utilidades mínimas.
3. `assets/css/components.css` — componentes base.
4. `styleguide.html` — página que muestra todo el sistema con todos los estados
   a la vista, sin depender del servidor.

Sistema:

- Color: 1 acento + escala de neutrales (6-9 pasos) + semánticos (éxito, alerta,
  error, info). El acento no puede ser el color de fondo dominante del sitio.
- Tipografía: 1 familia de UI + 1 opcional para títulos. Escala fija
  12/14/16/18/24/32/48. Máximo 3 pesos.
- Espaciado: escala 4/8 (4, 8, 12, 16, 24, 32, 48, 64, 96). Sin valores sueltos.
- Radios: 3 valores. Sombras: 2 niveles; preferir borde de 1 px antes que sombra.
- Movimiento: 150-200 ms, ease-out, respetando `prefers-reduced-motion`.

Componentes a entregar:

- Botón: primario, secundario, ghost y peligro; tamaños sm/md/lg; estados
  default, hover, focus-visible, activo, deshabilitado y cargando.
- Campos: texto, email, teléfono compuesto (prefijo + número), select, checkbox
  de aceptación de reglamento y campo de fecha. Con estado de error y texto de
  ayuda.
- Stepper numérico (cantidad de personas o camas).
- Chip de filtro y badge de estado.
- Contenedor de tarjeta y skeleton de carga.
- Enlaces, encabezados de sección y separadores.

Requisitos:

- Mobile first. Target táctil mínimo 44 px.
- Contraste AA (4.5:1) en todo texto.
- Sin `!important`, sin estilos inline, sin colores fuera de los tokens.
- Nombres de clase semánticos y estables (`btn-primary`, `field-error`), nunca
  visuales (`rojo`, `verde`, `cuadrado`).
- Un solo set de íconos, consistente, en SVG. No Font Awesome.
- El styleguide debe verse bien a 390 px y a 1280 px.

No hacer:

- No crear páginas del sitio (ni home, ni wizard).
- No conectar API, no escribir lógica de reservas.
- No usar gradientes institucionales ni el azul como fondo del header.
- No inventar fotos: usar marcos de proporción 3:2 con placeholders.

Criterio de aceptación:

- El styleguide muestra cada componente en todos sus estados.
- Cambiar un token cambia el sistema entero (nada hardcodeado).
- Se puede recorrer con teclado y el foco se ve siempre.
- No hay scroll horizontal a 390 px.

Al terminar, resumí en 5 líneas: paleta elegida, tipografía, y qué decisiones
quedaron pendientes de mi confirmación.
