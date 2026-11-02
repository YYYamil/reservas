# Checklist por entrega de Kombai

Se corre después de **cada** entrega, antes del commit. Si algo falla, se corrige
en el mismo pedido; no se acumula para el final.

## 1. Contrato (lo que no se negocia)

- [ ] Las claves `maestro`, `aquilina`, `tinku` aparecen exactamente así.
- [ ] Los `data-*` del brief están presentes y con los valores acordados.
- [ ] Los campos del formulario conservan sus nombres (`institucion`,
      `responsable`, `dni`, `email`, `prefijo`, `numero`, `delegacion`,
      `cantidad`, `acepta-terminos`).
- [ ] Las clases hook del contrato siguen presentes (`step-container`,
      `step-indicator`, `progress-fill`, `btn-submit`, `btn-label`, `dia`,
      `verde`, `rojo`, `badge-libre`, `en-rango`, `inicio-rango`, `fin-rango`).
- [ ] No se agregaron pasos, campos ni reglas de negocio nuevas.
- [ ] No se tocó `api/`, `admin/`, `script.js` ni `styles.css`.

## 2. Datos

- [ ] Usa los valores de `docs/datos-mock.md`, no Lorem ipsum.
- [ ] Los montos se muestran con formato de moneda argentino.
- [ ] Las fechas se muestran en formato local (`dd/mm/aaaa`), no ISO.
- [ ] Los códigos de reserva se ven como `R-000000`.

## 3. Estados

- [ ] Existen todos los estados del inventario del brief para esa sección.
- [ ] El estado vacío y el de error son informativos, no callejones sin salida.
- [ ] El estado de carga no rompe el layout (skeleton con la misma altura).

## 4. Responsive

- [ ] 390 px sin scroll horizontal.
- [ ] 768 px: la grilla cambia como corresponde, no solo se achica.
- [ ] 1280 px: el contenido no se estira al infinito (ancho máximo definido).
- [ ] Nada depende de `hover` para ser usable en táctil.
- [ ] Texto mínimo 14 px en móvil.

## 5. Accesibilidad

- [ ] Contraste AA en texto y en botones.
- [ ] Foco visible en todos los interactivos, en orden lógico.
- [ ] Calendario, acordeón y menú móvil operables con teclado.
- [ ] Imágenes con `alt` descriptivo; decorativas con `alt` vacío.
- [ ] Etiquetas asociadas a cada campo (no placeholder como etiqueta).

## 6. Consistencia visual

- [ ] No hay colores, radios ni espaciados fuera de los tokens.
- [ ] No hay `!important` ni estilos inline.
- [ ] Un solo set de íconos, mismo grosor y tamaño.
- [ ] Las fotos respetan la proporción definida.

## 7. Integración (paso propio, no de Kombai)

- [ ] El estado que muestra la vista coincide con lo que devuelve la API en local.
- [ ] Probar el flujo completo: buscar → reservar → comprobante → cancelar.
- [ ] Comparar contra la captura del "antes" y contra el test de humo.

## Commit

Un commit por sección, con el nombre de la sección en el mensaje. Ejemplo:
`feat(landing-v2): hero y buscador`.
