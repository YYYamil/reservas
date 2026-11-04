# Datos mock — fuente única para el rediseño

Todos los pedidos a Kombai usan estos datos. Si cada pantalla inventa valores
distintos, el diseño no se puede evaluar y después no se puede conectar.

## Origen de estos datos

Capturados el **2026-10-30** desde el entorno local:

```
http://127.0.0.1:8000/api/index.php?action=listarAlbergues
```

Servidor `php -S 127.0.0.1:8000`, túnel SSH abierto y base
`reserva_albergue_dev` (nunca producción). El JSON completo del response está
al final de este archivo, tal como lo devuelve la API.

Para refrescarlos:

1. Levantá el servidor local (`php -S 127.0.0.1:8000`) con el túnel abierto.
2. Abrí `http://127.0.0.1:8000/api/index.php?action=listarAlbergues`.
3. Reemplazá la tabla y el JSON de abajo con los valores reales.

No inventar capacidades ni precios: si un campo viene vacío (por ejemplo, el PDF
de `albergue-unt`), la tarjeta y el flujo tienen que funcionar igual.

## Albergues

| Campo | maestro | tinku | aquilina | altoverde | albergue-unt |
|---|---|---|---|---|---|
| `id` | 1 | 2 | 3 | 5 | 6 |
| Nombre público | Maestro José Fierro | Tinku Huasi | Aquilina Soldati | Alto Verde | Quinta Agronomica |
| Clave (no cambia) | `maestro` | `tinku` | `aquilina` | `altoverde` | `albergue-unt` |
| Habilitado | sí | sí | sí | sí | sí |
| Capacidad (camas) | 92 | 49 | 58 | 50 | 150 |
| Capacidad visita (por día) | 150 | 100 | 100 | 100 | 250 |
| Monto visita | $2.000 | $2.000 | $2.000 | $2.000 | $3.000 |
| Monto cama / noche | $5.000 | $5.000 | $5.000 | $5.000 | $8.000 |
| Color de acento actual | azul `#005CA2` | celeste `#84CFED` | amarillo `#FEC800` | verde `#47d60a` | bordó `#a30029` |
| PDF de reglamento | `docs/Albergue_Escolar_Maestro_José_Fierro__1_.pdf` | `docs/Albergue_Tinku_Huasi__1_.pdf` | `docs/Albergue Aquilina.pdf` | `Img/albergues/altoverde/prestapp-manual-usuario-e3088a.pdf` | *(vacío)* |
| Mapa (embed) | sí | sí | sí | sí | sí |

> Los campos largos (`descripcion`, `mapa`, `caracteristicas`, `imagenes`) están
> completos en el JSON de abajo. Las descripciones y los íconos se muestran tal
> cual los entrega la API: **no normalizarlos en el diseño**.

### Las tarjetas son dinámicas

- Las tarjetas **no se hardcodean**: se generan desde `listarAlbergues`. La
  cantidad puede cambiar sin tocar el diseño (hoy la base dev devuelve 5).
- `maestro`, `tinku` y `aquilina` son los históricos y sus claves **no cambian**.
  `altoverde` y `albergue-unt` son albergues cargados en la base, con el mismo
  tratamiento que los otros: pueden estar habilitados, deshabilitados o sumarse
  nuevos. El diseño no debe asumir un número fijo de tarjetas.
- Casos reales que la tarjeta tiene que tolerar:
  - `altoverde`: descripción corta de prueba (`"Nuevo albergue 2026 test desde BD pg"`),
    2 características y 3 imágenes. Es data de la BD, no un texto de diseño: el
    layout tiene que funcionar con descripciones de cualquier largo.
  - `albergue-unt`: **sin PDF** de reglamento y una sola característica. Es el caso
    de prueba del botón "Reglamento" no disponible.
- El diseño tiene que verse bien con **3, 5 o más tarjetas**, y con tarjetas de
  distinta cantidad de características (1 a 3) e imágenes (3 o 4).

## Configuración del sistema devuelta por la API

| Campo | Valor | Qué significa |
|---|---|---|
| `meses_anticipacion` | 3 | ventana máxima de reserva |
| `anticipacion_horas` | 60 | anticipación mínima al crear; además es el techo de la ventana de pago |
| `horizonte_horas` | 66 | horizonte mínimo total (anticipación + colchón) |
| `ventana_pago_horas` | 48 | horas antes del día de ingreso para subir el comprobante |
| `ventana_pago_min_horas` | 6 | plazo mínimo que queda para pagar al momento de crear |
| `cancelacion_horas` | 48 | umbral de devolución 100 % / 50 % |
| `fecha_minima_reserva` | `2026-11-03` | primera fecha reservable al momento de la captura |

> `fecha_minima_reserva` se mueve todos los días. No hardcodearla en el diseño:
> cualquier fecha de ejemplo tiene que leerse como relativa a "hoy".

## JSON real de `listarAlbergues`

Respuesta cruda del 2026-10-30 (formateada, sin cambios de contenido):

```json
{
    "success": true,
    "albergues": [
        {
            "id": 1,
            "clave": "maestro",
            "nombre": "Maestro José Fierro",
            "capacidad": 92,
            "capacidad_visitas": 150,
            "descripcion": "El Albergue Escolar Maestro José Fierro se encuentra ubicado al sureste de la ciudad capital.",
            "habilitado": true,
            "color": "#005CA2",
            "mapa": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3558.3469779765946!2d-65.19288722381081!3d-26.89248109236016!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x94225a28fd68b2a5%3A0x9e70e2029ffb5445!2sAlbergue%20Maestro%20Jos%C3%A9%20Fierro!5e0!3m2!1sen!2sar!4v1753473767982!5m2!1sen!2sar",
            "pdf": "docs/Albergue_Escolar_Maestro_José_Fierro__1_.pdf",
            "monto_visita": "2000.00",
            "monto_cama": "5000.00",
            "caracteristicas": [
                {
                    "icono": "fa-utensils",
                    "texto": "Comedor con capacidad para 150 personas."
                },
                {
                    "icono": "fa-bed",
                    "texto": "Dormitorios compartidos en 6 habitaciones."
                },
                {
                    "icono": "fa-gamepad",
                    "texto": "Áreas recreativas iluminadas."
                }
            ],
            "imagenes": [
                "Img/jose-fierro/WhatsAppImage2025-06-12at12.44.19.jpeg",
                "Img/jose-fierro/20180407_143307 (1).jpg",
                "Img/jose-fierro/WhatsApp-Image-2024-01-09-at-15.33.39.jpeg",
                "Img/jose-fierro/Gin5K2tWoAEgoet.jpg"
            ]
        },
        {
            "id": 2,
            "clave": "tinku",
            "nombre": "Tinku Huasi",
            "capacidad": 49,
            "capacidad_visitas": 100,
            "descripcion": "El Albergue Escolar Tinku Huasi, se encuentra ubicado en Avenida Central y Diagonal 1 (CEF N.º 18).",
            "habilitado": true,
            "color": "#84CFED",
            "mapa": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3561.0615264368676!2d-65.2531118238137!3d-26.806169488762055!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x94225df192f9345f%3A0x7a6e80a152e8999d!2sAlbergue%20Tinku%20Huasi!5e0!3m2!1sen!2sar!4v1753473842656!5m2!1sen!2sar",
            "pdf": "docs/Albergue_Tinku_Huasi__1_.pdf",
            "monto_visita": "2000.00",
            "monto_cama": "5000.00",
            "caracteristicas": [
                {
                    "icono": "fa-utensils",
                    "texto": "Cocina equipada."
                },
                {
                    "icono": "fa-couch",
                    "texto": "Salón comedor equipado para 50 personas."
                },
                {
                    "icono": "fa-bath",
                    "texto": "Baños con duchas."
                }
            ],
            "imagenes": [
                "Img/tinku-huasi/Captura de pantalla 2025-07-30 155706.jpg",
                "Img/tinku-huasi/unnqqamed (1).jpg",
                "Img/tinku-huasi/Captura de pantalla 2025-07-30 155744.jpg",
                "Img/tinku-huasi/unnamed (1).jpg"
            ]
        },
        {
            "id": 3,
            "clave": "aquilina",
            "nombre": "Aquilina Soldati",
            "capacidad": 58,
            "capacidad_visitas": 100,
            "descripcion": "El Albergue Aquilina Soldati se encuentra ubicado en Las Heras 4124 – San Pedro de Colalao.",
            "habilitado": true,
            "color": "#FEC800",
            "mapa": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3578.830146788623!2d-65.49806782383205!3d-26.234707965218533!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x9418bd7589be37d9%3A0x56985f9492fd5f84!2sAquilina%20Soldatti%20De%20%C3%81lvarez!5e0!3m2!1sen!2sar!4v1753473913567!5m2!1sen!2sar",
            "pdf": "docs/Albergue Aquilina.pdf",
            "monto_visita": "2000.00",
            "monto_cama": "5000.00",
            "caracteristicas": [
                {
                    "icono": "fa-solid fa-fire-burner",
                    "texto": "Quincho con asador y horno ecológico."
                },
                {
                    "icono": "fa-tree",
                    "texto": "Zona parquizada para el esparcimiento."
                },
                {
                    "icono": "fa-toilet",
                    "texto": "Cuenta con 2 vestuarios y duchas."
                }
            ],
            "imagenes": [
                "Img/aquilina/01 (1).jpg",
                "Img/aquilina/unnamed (1).webp",
                "Img/aquilina/imagepng.jpg",
                "Img/aquilina/unnamed (2).webp"
            ]
        },
        {
            "id": 5,
            "clave": "altoverde",
            "nombre": "Alto Verde",
            "capacidad": 50,
            "capacidad_visitas": 100,
            "descripcion": "Nuevo albergue 2026 test desde BD pg",
            "habilitado": true,
            "color": "#47d60a",
            "mapa": "https://www.google.com/maps/place/26%C2%B050'01.6%22S+65%C2%B011'40.7%22W/@-26.833786,-65.194629,17z/data=!3m1!4b1!4m4!3m3!8m2!3d-26.833786!4d-65.194629!5m1!1e1?entry=ttu&g_ep=EgoyMDI2MDkyMi4wIKXMDSoASAFQAw%3D%3D",
            "pdf": "Img/albergues/altoverde/prestapp-manual-usuario-e3088a.pdf",
            "monto_visita": "2000.00",
            "monto_cama": "5000.00",
            "caracteristicas": [
                {
                    "icono": "fa-solid fa-house",
                    "texto": "Quincho"
                },
                {
                    "icono": "fa-solid fa-utensils",
                    "texto": "Comedor"
                }
            ],
            "imagenes": [
                "Img/albergues/altoverde/galeria-marazul-30-230711.jpg",
                "Img/albergues/altoverde/images-2-93558d.jpg",
                "Img/albergues/altoverde/camping-tennenwald2-e72f89.jpg"
            ]
        },
        {
            "id": 6,
            "clave": "albergue-unt",
            "nombre": "Quinta Agronomica",
            "capacidad": 150,
            "capacidad_visitas": 250,
            "descripcion": "El Centro Universitario Herrera, más conocido como Quinta Agronómica, ya cuenta con un corredor seguro.",
            "habilitado": true,
            "color": "#a30029",
            "mapa": "https://www.google.com/maps/place/UNT+Quinta+Agronomica/@-26.8413312,-65.2306426,17z/data=!3m1!4b1!4m6!3m5!1s0x94225c7b92de6935:0x8028d81ea4a7b204!8m2!3d-26.8413312!4d-65.2306426!16s%2Fg%2F11b7l9b3rz?entry=tts&g_ep=EgoyMDI2MTAyMC4wIPu8ASoASAFQAw%3D%3D&skid=0e2b96be-82a6-4714-8a89-b0c521528574",
            "pdf": "",
            "monto_visita": "3000.00",
            "monto_cama": "8000.00",
            "caracteristicas": [
                {
                    "icono": "fa-utensil",
                    "texto": "Comedor"
                }
            ],
            "imagenes": [
                "Img/albergues/albergue-unt/images-1-a42971.jpg",
                "Img/albergues/albergue-unt/5-da6517.jpg",
                "Img/albergues/albergue-unt/images-0d09b2.jpg"
            ]
        }
    ],
    "meses_anticipacion": 3,
    "anticipacion_horas": 60,
    "ventana_pago_horas": 48,
    "ventana_pago_min_horas": 6,
    "cancelacion_horas": 48,
    "horizonte_horas": 66,
    "fecha_minima_reserva": "2026-11-03"
}
```

## Escenarios que el diseño tiene que poder mostrar

| Escenario | Cómo se representa en el mock |
|---|---|
| Día libre | Maestro: 90 de 92 camas libres |
| Día casi lleno | Maestro: 2 camas libres (la tarjeta debe avisar, no ocultar) |
| Día sin cupo | 0 camas libres (estado rojo, no seleccionable) |
| Visita con cupo amplio | Maestro: 145 de 150 lugares |
| Rango corto | 2 noches, 3 camas, escuela |
| Rango al máximo | 4 noches (escuela) / 3 noches (otra institución) |
| Rango inválido | salida anterior a la entrada |
| Fuera de ventana | fecha a 6 meses (la ventana es 3 meses) |
| Albergue sin PDF | `albergue-unt`: botón "Reglamento" no disponible |
| Grilla dinámica | response actual completo (hoy 5 tarjetas, sin asumir un número fijo) |

## Fechas de ejemplo

Usar **noviembre de 2026** en todas las capturas y prompts: es la ventana que
usan los tests y evita mostrar fechas pasadas.

- Visita: `2026-11-10`
- Alojamiento: `2026-11-15` a `2026-11-18` (3 noches)

## Datos de contexto (para textos y prueba social)

- Horarios: ingreso 09:00, salida 18:00.
- Cancelación: +48 h 100 %, dentro de 48 h 50 %, día de ingreso o después 0 %.
- Duración máxima: escuelas 4 días, otras instituciones 3 días.
- Ventana de reserva: 3 meses de anticipación.
- Código de reserva: formato `R-000000`.
- Confirmación: requiere comprobante de pago.

## Prohibido en el mock

- Testimonios inventados.
- Logos de instituciones que no reservaron.
- Cifras de "más de X escuelas" sin dato del sistema.
- Fotos de stock que no sean de los albergues (confunde y no se puede publicar).
- Hardcodear nombres, claves o cantidad de tarjetas: salen de `listarAlbergues`.
