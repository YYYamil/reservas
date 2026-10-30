-- 2026-10-29 Comprobante recibido: acuse al cliente, aviso al admin y plazo de validación
--
-- Cambios:
--   1) validacion_vence_at en ambas tablas: fecha límite para que el operador
--      apruebe o rechace el comprobante desde el panel. Se calcula al subir el
--      comprobante como min(ahora + validacion_horas, inicio de la reserva).
--   2) Nuevo tipo de evento 'comprobante_recibido' (acuse al usuario final).
--   3) Parámetro 'validacion_horas' (default 24).
--   4) v_reservas_todas expone validacion_vence_at (se agrega al final).
--
-- Idempotente: puede ejecutarse más de una vez sin errores.
--
-- Ejecutar con:
--   php api/tests/aplicar_migracion.php api/migrations/2026-10-29_2_comprobante_recibido_y_plazo_validacion.sql
--
-- ORDEN: requiere 2026-10-29_1_maquina_estados_y_liberacion.sql (usa
-- comprobado_at, inicio_at y las columnas de devolución).

BEGIN;

-- ============================================================================
-- 1) Plazo de validación
-- ============================================================================
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS validacion_vence_at TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS validacion_vence_at TIMESTAMPTZ;

COMMENT ON COLUMN reservas_visitas.validacion_vence_at     IS 'Fecha limite para que el operador valide el comprobante.';
COMMENT ON COLUMN reservas_alojamiento.validacion_vence_at IS 'Fecha limite para que el operador valide el comprobante.';

-- Backfill: las reservas que ya estan en Comprobar toman comprobado_at + 24 h.
UPDATE reservas_visitas
   SET validacion_vence_at = comprobado_at + INTERVAL '24 hours'
 WHERE validacion_vence_at IS NULL
   AND comprobado_at IS NOT NULL;

UPDATE reservas_alojamiento
   SET validacion_vence_at = comprobado_at + INTERVAL '24 hours'
 WHERE validacion_vence_at IS NULL
   AND comprobado_at IS NOT NULL;

-- ============================================================================
-- 2) Nuevo tipo de evento
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notificaciones_email_tipo_evento_check') THEN
        ALTER TABLE notificaciones_email DROP CONSTRAINT notificaciones_email_tipo_evento_check;
    END IF;
    ALTER TABLE notificaciones_email
        ADD CONSTRAINT notificaciones_email_tipo_evento_check
        CHECK (tipo_evento IN ('creacion', 'confirmacion', 'cancelacion', 'cancelacion_cliente',
                               'recordatorio', 'pago_recibido', 'aviso_admin',
                               'vencimiento', 'rechazo', 'devolucion',
                               'comprobante_recibido'));
END $$;

-- ============================================================================
-- 3) Parámetro de política
-- ============================================================================
INSERT INTO configuracion_sistema (clave, valor) VALUES ('validacion_horas', '24')
ON CONFLICT (clave) DO NOTHING;

-- ============================================================================
-- 4) Vista unificada: se agrega validacion_vence_at al final
-- ============================================================================
CREATE OR REPLACE VIEW v_reservas_todas AS
SELECT v.modalidad,
       v.id_reserva,
       v.codigo_publico,
       v.created_at,
       v.pk,
       v.albergue,
       v.institucion,
       v.responsable,
       v.dni,
       v.contacto,
       v.cantidad,
       v.fecha_p,
       v.hora_ingreso,
       v.hora_egreso,
       v.estado,
       v.rango_fechas,
       v.observaciones,
       v.estado_modificado_por,
       v.estado_modificado_at,
       v.estado_origen,
       v.email,
       v.monto_total,
       v.pago_vence_at,
       cmp.id AS comprobante_id,
       cmp.ruta AS comprobante_ruta,
       v.inicio_at,
       v.comprobado_at,
       v.finalizado_at,
       v.motivo_cierre,
       v.devolucion_pct,
       v.devolucion_monto,
       v.devolucion_ejecutada_at,
       cmp.estado AS comprobante_estado,
       v.validacion_vence_at
  FROM (
        SELECT 'visita'::text AS modalidad,
               r.id_reserva,
               r.codigo_publico,
               r.created_at,
               r.id AS pk,
               a.nombre AS albergue,
               r.institucion,
               r.responsable,
               r.dni,
               r.contacto,
               r.cantidad,
               r.fecha_ingreso AS fecha_p,
               r.hora_ingreso,
               r.hora_egreso,
               r.estado,
               NULL::text AS rango_fechas,
               r.observaciones,
               r.estado_modificado_por,
               r.estado_modificado_at,
               r.estado_origen,
               r.email,
               r.monto_total,
               r.pago_vence_at,
               r.inicio_at,
               r.comprobado_at,
               r.finalizado_at,
               r.motivo_cierre,
               r.devolucion_pct,
               r.devolucion_monto,
               r.devolucion_ejecutada_at,
               r.validacion_vence_at
          FROM reservas_visitas r
          JOIN albergues a ON a.id = r.albergue_id
        UNION ALL
        SELECT 'alojamiento'::text AS modalidad,
               r.id_reserva,
               r.codigo_publico,
               r.created_at,
               r.id,
               a.nombre,
               r.institucion,
               r.responsable,
               r.dni,
               r.contacto,
               r.cantidad,
               NULL::text AS fecha_p,
               NULL::text AS hora_ingreso,
               NULL::text AS hora_egreso,
               r.estado,
               r.rango_fechas,
               r.observaciones,
               r.estado_modificado_por,
               r.estado_modificado_at,
               r.estado_origen,
               r.email,
               r.monto_total,
               r.pago_vence_at,
               r.inicio_at,
               r.comprobado_at,
               r.finalizado_at,
               r.motivo_cierre,
               r.devolucion_pct,
               r.devolucion_monto,
               r.devolucion_ejecutada_at,
               r.validacion_vence_at
          FROM reservas_alojamiento r
          JOIN albergues a ON a.id = r.albergue_id
       ) v
  LEFT JOIN LATERAL (
        SELECT c.id, c.ruta, c.estado
          FROM comprobantes c
         WHERE c.reserva_modalidad = v.modalidad
           AND c.reserva_pk = v.pk
         ORDER BY c.created_at DESC
         LIMIT 1
       ) cmp ON true;

COMMIT;
