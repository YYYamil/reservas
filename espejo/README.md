# Espejo en Google Sheets (opción "pull" con ngrok)

Estas dos planillas son una **vista de solo lectura** de la base SQLite:
SQLite es la fuente de verdad y una pestaña de cada spreadsheet se
**reconstruye completa** con las reservas cada vez que el script corre.
Al ser reconstrucción total, los alojamientos/visitas dadas de alta **y las
canceladas** se reflejan solos (una cancelación elimina la fila en SQLite).

- Planilla de **visitas**: `https://docs.google.com/spreadsheets/d/1iQ6RDBgaVlUOvvWbGmutsBfRVPDO0M8zpoQMz6adX9I`
- Planilla de **alojamiento**: `https://docs.google.com/spreadsheets/d/1LCfJtoCJ-Oo8HZLtKEHx-UWiHnRZrwh6inw9_OtgpI4`

## Paso 1 — Exponer la API pública con ngrok

Con la API corriendo en la máquina del servidor (Apache o `php -S`):

```
ngrok http 80
```

Si la API corre en otro puerto (p. ej. `php -S 0.0.0.0:8080`), usar `ngrok http 8080`.

ngrok mostrará una URL pública, p. ej. `https://abcd123.ngrok-free.dev`.
Verificá que responda (debe devolver JSON):

- `https://abcd123.ngrok-free.dev/api/index.php?action=espejoVisitas`
- `https://abcd123.ngrok-free.dev/api/index.php?action=espejoAlojamiento`

**Ojo:** con la cuenta gratuita de ngrok, la URL cambia cada vez que reiniciás
ngrok. Cuando cambie, hay que actualizar `API_URL` del script (solo el dominio,
sin `/api/...`; el path se arma solo en el código).

## Si aparece "You are about to visit..." (JSON no válido)

Es la advertencia de ngrok: le muestra una página HTML a quien parece un
navegador, y el JSON.parse falla. El script ya lo evita enviando el header
`ngrok-skip-browser-warning: true` con cada llamada. Si aun así lo vieras,
revisá que en `UrlFetchApp.fetch` estés mandando ese header.

## Paso 2 — Proteger los endpoints (recomendado)

Los datos contienen DNI, así que conviene un token compartido:

1. En `api/config.php` definir un valor, p. ej. `'espejo_token' => 'clave-larga-aleatoria'`.
2. Poner la misma clave en `API_TOKEN` del script. Con token presente, una
   consulta sin `?token=` correcto devuelve `403`.

## Paso 3 — Instalar el script en cada planilla

1. Abrir la planilla → **Extensiones → Apps Script**.
2. Pegar el contenido de `espejo/visitas.gs` en la planilla de **visitas** y
   `espejo/alojamiento.gs` en la de **alojamiento**.
3. Editar `API_URL` (poner SOLO el dominio de ngrok, p. ej.
   `https://abcd123.ngrok-free.dev`) y `API_TOKEN` si se usó.
4. Si se quiere otra pestaña de destino, cambiar `NOMBRE_PESTANA`
   (por defecto crea/usa una llamada `Espejo`).
5. Guardar → autorizar los permisos pedidos → recargar la planilla.

**No hace falta ninguna "implementación/publish"**: al ser un script pegado a
la planilla (no una web app), con **reemplazar el código y guardar** ya queda.
El menú **Espejo → Actualizar ahora** y el `onOpen` aparecen al recargar la
hoja. Si habías creado un disparador temporizado, sigue funcionando (apunta a
la función `actualizarEspejo`, que mantiene el mismo nombre).

## Fila de títulos (importante)

La **fila 1 se respeta por completo**:

- Si la celda `A1` está vacía, el script coloca los títulos una sola vez
  (con formato plano, sin estilo).
- Una vez que existan los títulos, **nunca los reescribe ni les toca el
  formato**: podés darles color de fondo, tipografía, negrita, etc., y se
  conserva en cada actualización.
- La actualización de datos se hace siempre **desde la fila 2 hacia abajo**;
  las filas sobrantes de un lote anterior se limpian automáticamente.

Para dejarla prolija: completá una sola vez la fila 1 con los encabezados
que ya devuelve la API y formatéala a gusto.

## Paso 4 — Actualización automática (recomendado: disparador instalable)

El `onOpen` simple puede no refrescar de forma fiable al abrir. La forma
segura es un **disparador instalable** con permisos completos:

1. Pegar el código nuevo (el que incluye la función `alAbrir`) y guardar.
2. En Apps Script, ir al **Reloj** (icono de disparador) → **Añadir
   disparador**.
3. Configurar: función **`alAbrir`**, implementación **`Head`**, evento **Al
   abrir**. Guardar y autorizar.
4. Además, para refrescar cada 5 minutos aunque nadie abra la hoja: ejecutar
   **una vez** `configurarDisparador()` (o agregar un segundo disparador de
   tiempo en el Reloj con función `actualizarEspejo`).

Con esto, al abrir (F5) la pestaña se actualiza sola y, si además hay
disparador de 5 min, también se refresca mientras está abierta.

Notas:
- **No ejecutes `onOpen` desde el editor de Apps Script**: da
  "Cannot call SpreadsheetApp.getUi() from this context", es normal (el
  editor no tiene UI). `onOpen` se dispara solo al abrir la hoja.
- Si algo falla (p. ej. cambió la URL de ngrok), revisá **Ejecuciones**
  (icono de reloj) para ver el error; la apertura de la hoja sigue normal.
- El menú **Espejo → Actualizar ahora** siempre funciona como opción manual.

## Formato de la respuesta de la API

```json
{
  "success": true,
  "columnas": ["id_Reserva", "Fecha de Tramite", ...],
  "filas": [ [9437, "2026-09-10 14:22", "Maestro José Fierro", ...] ]
}
```

`columnas` es el encabezado; cada elemento de `filas` es una reserva en el
mismo orden. La columna **Dias de estadía** (alojamiento) se calcula de los
días normalizados del rango.



COMANDOS:
📌 Resumen ultra corto

Cada vez que reinicies:

CMD 1:
D:
cd D:\yamil\med_albergues
php -S localhost:8000
CMD 2:
C:\ngrok.exe http 8000

Copiar la nueva URL de:

Forwarding https://XXXXXXXX.ngrok-free.dev

y reemplazarla en:

visitas.gs
alojamiento.gs

en:

const API_URL = 'https://XXXXXXXX.ngrok-free.dev';

Después seguimos con el token de seguridad y, finalmente, los disparadores automáticos de 5 minutos.