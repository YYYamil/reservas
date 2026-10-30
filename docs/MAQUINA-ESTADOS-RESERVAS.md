# Máquina de estados y liberación de cupos

Documento de referencia del ciclo de vida de una reserva en el sistema de
albergues. Aplica **igual** a las dos modalidades (visita diaria y alojamiento
con estadía de hasta 4 días): los estados, las transiciones y los invariantes
son los mismos; solo cambia el ancla temporal y la unidad de cupo.

Implementación: `api/reservas_estado.php` (dominio), `api/index.php` (endpoints),
`api/notificaciones.php` (plantillas) y las migraciones
`api/migrations/2026-10-29_1_*.sql`, `_2_*.sql` y `_3_*.sql`.

---

## 1. Estados

| Estado | Significado | ¿Ocupa cupo? | ¿Terminal? |
|---|---|---|---|
| `Pre-Reserva` | Creada, sin comprobante. Tiene plazo para pagar | Sí, mientras no venza | No |
| `Comprobar` | El cliente subió el comprobante; falta que el admin lo verifique. Tiene `validacion_vence_at` como plazo de atención | Sí | No |
| `Confirmado` | El admin verificó el comprobante | Sí | No |
| `Cancelado` | Cancelada o anulada. Cierre definitivo | No | Sí |
| `Vencido` | No se pagó dentro del plazo; el cupo se liberó | No | Sí |
| `Devolver` | Cancelada con pago: falta ejecutar la devolución | **No** | No (cierra en `Cancelado`) |
| `Finalizado` | La estadía ya pasó | No | Sí |

**Regla de oro:** el cupo se adquiere **solo** al crear la reserva, bajo el
lock de la fila del albergue (`SELECT ... FOR UPDATE`). Todo lo demás libera.
Por eso la lista de estados que ocupan es una **lista blanca**:
`Pre-Reserva`, `Comprobar`, `Confirmado`. Cualquier estado nuevo que no esté en
esa lista no ocupa cupo por defecto, que es el comportamiento seguro.

`Devolver` **no ocupa**: el cupo se libera cuando el cliente cancela, no cuando
el operador termina de devolver la plata. Una devolución pendiente no debe
bloquear inventario.

---

## 2. Transiciones

| # | Desde | Acción / evento | Guarda | Hacia | Cupo | Correo |
|---|---|---|---|---|---|---|
| T1 | — | crear reserva | cupo, horizonte, monto > 0, rango válido | `Pre-Reserva` | ocupa | `creacion` |
| T2 | `Pre-Reserva` | el cliente sube comprobante | `ahora < vencimiento` | `Comprobar` | ocupa | `comprobante_recibido` (cliente) + `pago_recibido` (admin, con el plazo de validación) |
| T3 | `Pre-Reserva` | barrido: llega el vencimiento | `ahora >= vencimiento` | `Vencido` | **libera** | `vencimiento` |
| T4 | `Comprobar` | admin `aprobar` | — | `Confirmado` | ocupa | `confirmacion` (cliente) + `validacion_admin` (admin, con el nombre de quien validó) |
| T5 | `Comprobar` | admin `rechazar` | motivo obligatorio | `Pre-Reserva` con nuevo plazo, o `Vencido` si no queda tiempo | ocupa / libera | `rechazo` |
| T6 | `Pre-Reserva` | cliente cancela | antes del día de ingreso | `Cancelado` | **libera** | `cancelacion_cliente` |
| T7 | `Comprobar` / `Confirmado` | cliente cancela | antes del día de ingreso | `Devolver` | **libera** | `devolucion` |
| T8 | `Devolver` | admin `devolver` (marcar ejecutada) | — | `Cancelado` | ya liberado | — |
| T9 | `Pre-Reserva` | admin `anular` | — | `Cancelado` | **libera** | `cancelacion` |
| T10 | `Comprobar` / `Confirmado` | barrido: fin de estadía | fecha final ya pasó | `Finalizado` | no aplica | — |
| T11 | cualquier terminal | cualquier acción | — | rechazada | — | — |

**No existe reactivación.** Un estado terminal es terminal: si el cliente quiere
volver, inicia una reserva nueva. Esto elimina la única transición que podría
reocupar un cupo ya vendido.

**No existe reprogramación.** Solo cancelar.

---

## 3. Tiempos

Parámetros vigentes (editables en `configuracion_sistema`):

| Clave | Valor | Significado |
|---|---|---|
| `anticipacion_horas` | 60 | Tope del hold: una reserva impaga nunca vive después de `inicio − 60 h` |
| `ventana_pago_horas` | 48 | Ventana máxima que se le da al cliente para pagar |
| `ventana_pago_min_horas` | 6 | Ventana mínima aceptable para crear una reserva |
| `cancelacion_horas` | 48 | Borde de la devolución: más de 48 h → 100 %; menos → 50 % |
| `devolucion_temprana_pct` | 100 | Devolución fuera del plazo |
| `devolucion_tardia_pct` | 50 | Devolución dentro del plazo |
| `validacion_horas` | 24 | Plazo para que el operador valide el comprobante desde el panel (se guarda en `validacion_vence_at`) |

### Vencimiento del pago

```
vencimiento = min( creación + ventana_pago_horas ,  inicio − anticipacion_horas )
```

La segunda rama es la que evita el problema original: una reserva para mañana
no puede quedar bloqueando el cupo hasta después de la visita.

### Horizonte para crear

```
inicio − ahora  >=  anticipacion_horas + ventana_pago_min_horas   (66 h)
```

El corte real de venta online es **derivado**, no configurado: sale de
`60 + 6`. Si se quiere aceptar reservas más cerca del ingreso, el parámetro que
se baja es `anticipacion_horas` (y con él se acorta la ventana de reventa).

### Cancelación

```
horas_hasta_inicio = inicio − ahora

horas_hasta_inicio > cancelacion_horas   -> devolución 100 %
0 < horas_hasta_inicio <= cancelacion_horas -> devolución 50 %
horas_hasta_inicio <= 0                  -> cancelación bloqueada
```

El día de ingreso o después no se puede cancelar: las plazas ya están
comprometidas. El sistema responde con un mensaje explicativo.

### Ancla temporal (`inicio_at`)

- Visita diaria: `fecha_ingreso` a las 00:00 de la zona del sistema.
- Alojamiento: `MIN(fecha)` de `reserva_alojamiento_dias` a las 00:00.

`inicio_at` es una columna `timestamptz` que se graba al crear la reserva y se
backfilleó para las existentes.

---

## 4. Disponibilidad: lista blanca + vencimiento perezoso

La consulta de disponibilidad ya no es `estado <> 'Cancelado'`. Ahora:

```sql
estado IN ('Pre-Reserva', 'Comprobar', 'Confirmado')
AND ( estado <> 'Pre-Reserva'
      OR COALESCE(LEAST(pago_vence_at, inicio_at - INTERVAL '60 hours'),
                  inicio_at - INTERVAL '60 hours') > NOW() )
```

Consecuencias:

- `Vencido`, `Cancelado`, `Devolver` y `Finalizado` **no ocupan**.
- Una `Pre-Reserva` vencida deja de ocupar **en el mismo instante** en que
  vence, aunque el barrido todavía no la haya pasado de estado. Es la garantía
  de que el sistema no depende de que el cron esté vivo para no sobrevender.
- El `LEAST(...)` protege también a las reservas viejas, que tienen 7 días
  grabados en `pago_vence_at`, sin necesidad de backfill.

El vencimiento se evalúa **también en las escrituras**: `subirComprobante` y
`cancelarReserva` recalculan el estado efectivo antes de actuar.

---

## 5. Devoluciones

Sin pasarela de pago el sistema **no puede devolver plata**: registra la
obligación y su ejecución.

Al cancelar una reserva pagada (`Comprobar` o `Confirmado`) se guarda:

- `devolucion_pct` — 100 o 50.
- `devolucion_monto` — `monto_total × pct / 100`.
- `devolucion_calculada_at` — cuándo se calculó.

El operador transfiere y luego marca la devolución desde el panel (`accion=devolver`),
lo que registra `devolucion_ejecutada_at` y `devolucion_ejecutada_por`, y pasa
la reserva a `Cancelado`.

El panel debe vigilar la cola de `Devolver`: son obligaciones pendientes de pago.

---

## 6. Barrido (cron)

`reservaBarrido()` en `api/reservas_estado.php`, expuesto por los endpoints
`procesarNotificaciones` y `tareasVencimiento` (con `cron_token`).

Cada corrida:

1. Pasa a `Vencido` las `Pre-Reserva` que llegaron a su límite y encola
   `vencimiento`. Libera el cupo.
2. Encola `recordatorio` para las que vencen dentro de las próximas 12 h
   (una sola vez, y no en la primera hora de vida de la reserva).
3. Cierra como `Finalizado` las reservas cuya estadía ya terminó.
4. Deja `ultimo_barrido_at` en `configuracion_sistema` (heartbeat).

Es idempotente y usa `pg_try_advisory_lock` para que dos corridas solapadas no
se pisen. **Recomendación operativa: cada 15 minutos.**

Si el cron no corre, la disponibilidad sigue siendo correcta por el vencimiento
perezoso; lo que se pierde son los avisos y el cierre administrativo. El
heartbeat permite detectar que el cron se cayó.

---

## 7. Endpoints

| Acción | Cambios |
|---|---|
| `crearReserva` / `crearReservaAlojamiento` | Validan horizonte, monto > 0 y (alojamiento) máximo 4 días, fechas consecutivas y orden. Graban `inicio_at` y el vencimiento calculado. |
| `subirComprobante` | Solo desde `Pre-Reserva` y dentro del plazo. Pasa a `Comprobar`, registra el comprobante como `pendiente`, fija `validacion_vence_at` y encola dos avisos: acuse al cliente (`comprobante_recibido`) y aviso al admin (`pago_recibido`) con la fecha límite para validar. |
| `cancelarReserva` | Aplica la política de devolución y bloquea el día de ingreso. `Pre-Reserva` → `Cancelado`; pagada → `Devolver`. |
| `adminEstado` | Acepta `accion` = `aprobar` \| `rechazar` \| `anular` \| `devolver`. Valida la transición y no permite estados arbitrarios. Mantiene compatibilidad con el parámetro `estado` anterior. Al aprobar encola la confirmación al cliente y el aviso `validacion_admin` al administrador. |
| `adminReservas` | Devuelve `estado_efectivo` (una `Pre-Reserva` vencida se muestra como `Vencido`). |
| `listarAlbergues` | Expone `horizonte_horas` y `fecha_minima_reserva` (primer día reservable, calculado en el servidor) para que el calendario deshabilite fechas sin depender del reloj del navegador. |
| `tareasVencimiento` / `procesarNotificaciones` | Ejecutan el barrido. Devuelven `{recordatorios, vencidas, finalizadas, omitido}`. |

---

## 8. Casos borde cubiertos

| Caso | Comportamiento |
|---|---|
| Reserva dentro del horizonte (66 h) | Rechazada con mensaje |
| Fecha pasada | Rechazada |
| Monto total 0 (albergue sin tarifa) | Rechazada |
| Rango no consecutivo | Rechazado |
| Rango de más de 4 días | Rechazado |
| Dos reservas por el último cupo | Serializado por `FOR UPDATE` |
| Comprobante subido justo al vencer | Gana el que cierra el estado (`UPDATE ... WHERE estado`) |
| Comprobante sobre reserva vencida | Rechazado, aunque el barrido no haya corrido |
| Segundo comprobante con uno en revisión | Rechazado |
| Admin aprueba dos veces | Rechazado (transición inválida) |
| Admin intenta reactivar una cancelada | Rechazado |
| Cancelación el día de ingreso | Bloqueada |
| Devolución pendiente | No bloquea cupo |
| Barrido caído | La disponibilidad sigue correcta (vencimiento perezoso) |
| Dos barridos simultáneos | El segundo se omite (advisory lock) |

---

## 9. Puesta en marcha

1. Aplicar las migraciones **en orden** (el script de deploy las toma
   alfabéticamente; por eso llevan el prefijo `_1_`, `_2_`, `_3_`):
   ```
   php api/tests/aplicar_migracion.php api/migrations/2026-10-29_1_maquina_estados_y_liberacion.sql
   php api/tests/aplicar_migracion.php api/migrations/2026-10-29_2_comprobante_recibido_y_plazo_validacion.sql
   php api/tests/aplicar_migracion.php api/migrations/2026-10-29_3_validacion_admin.sql
   ```
   Son aditivas e idempotentes. Agregan columnas, backfill de `inicio_at`, CHECK de
   estados (`NOT VALID`), columnas de comprobantes, tipos de evento y la vista
   actualizada.
2. Configurar el cron cada 15 minutos:
   ```
   */15 * * * * curl -s "https://<host>/api/index.php?action=procesarNotificaciones&token=<cron_token>"
   ```
3. Verificar en el panel que `ultimo_barrido_at` avance.
4. Pruebas:
   ```
   php api/tests/smoke_test.php --destructivo
   ```
   **Atención:** el smoke test trunca las tablas de reservas. Solo contra una
   base descartable.

---

## 10. Decisiones tomadas

- **Misma máquina para las dos modalidades.** Una sola definición de estados y
  transiciones.
- **El no-show no libera cupo.** Si la reserva está paga y validada, las plazas
  quedan comprometidas hasta el final de la estadía; el barrido la cierra como
  `Finalizado` sin liberar nada.
- **Toda liberación es total.** No hay liberación parcial de noches: las noches
  pasadas no se pueden revender, así que marcar la reserva completa como
  terminal produce el mismo efecto práctico.
- **`Devolver` libera al cancelar**, no al devolver el dinero.
- **Rechazo de comprobante:** vuelve a `Pre-Reserva` con
  `min(ahora + 24 h, inicio − 60 h)`; si no queda tiempo, pasa a `Vencido`.
- **El horizonte efectivo es 66 h** (`60 + 6`) y es derivado. Si se cambia
  `anticipacion_horas`, cambia el corte de venta.
- **La subida del comprobante genera dos correos:** acuse al cliente
  (`comprobante_recibido`) y aviso al administrador (`pago_recibido`) con la
  fecha límite de validación. El aviso al admin depende solo de que
  `configuracion_sistema.mail_admin` tenga una dirección; no de
  `notif_enviar_admin` (que sigue gobernando las copias de otros eventos).
- **La aprobación genera dos correos:** la confirmación al cliente
  (`confirmacion`, sin cambios) y un aviso al administrador
  (`validacion_admin`) con el nombre de quien validó. El correo al cliente no
  se modifica.
- **El plazo de validación no cancela nada:** si el operador no valida a
  tiempo, la reserva queda en `Comprobar` y el cupo sigue retenido. El plazo es
  un compromiso operativo y se muestra en el panel; no una acción automática.

## 11. Pendientes / próximos pasos

- Conectar el cron real en el servidor y monitorear el heartbeat.
- Definir en el panel una vista específica de `Devolver` con antigüedad.
- Evaluar (con datos) si el borde de devolución de 48 h debe alinearse con el
  corte de venta de 66 h para cerrar la ventana en que se devuelve el 100 % y
  el cupo ya no se puede vender online.
- Si se incorpora pasarela de pago, el estado `Comprobar` pasa a ser un paso
  automático y el `vencimiento` debe alinearse con la expiración de la
  preferencia de pago.
