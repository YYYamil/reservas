-- 2026-10-29 Máquina de estados y liberación de cupos
--
-- Cambios:
--   1) Nuevos estados del ciclo de vida de una reserva:
--        Pre-Reserva -> Comprobar -> Confirmado -> Finalizado
--        Pre-Reserva -> Vencido            (no pagó a tiempo)
--        Pre-Reserva -> Cancelado          (canceló sin haber pagado)
--        Comprobar/Confirmado -> Devolver -> Cancelado (canceló habiendo pagado)
--      El estado NO tenía CHECK: se agrega uno NOT VALID (valida filas nuevas,
--      no bloquea la migración si quedara algún valor viejo).
--   2) inicio_at: ancla temporal de la reserva (00:00 del día de ingreso, en la
--      zona horaria del sistema). Hasta ahora la fecha vivía solo en texto.
--      Para alojamiento se toma MIN(fecha) de reserva_alojamiento_dias.
--   3) Columnas de trazabilidad del pago y de la devolución.
--   4) comprobantes: ciclo propio (pendiente | aprobado | rechazado) y auditoría
--      de la revisión.
--   5) Nuevos tipos de evento de notificación: vencimiento, rechazo, devolucion.
--   6) Parámetros de política (horizonte, ventana de pago, devolución).
--   7) v_reservas_todas expone las columnas nuevas (se agregan al final).
--
-- Idempotente: puede ejecutarse más de una vez sin errores.
--
-- Ejecutar con:
--   php api/tests/aplicar_migracion.php api/migrations/2026-10-29_1_maquina_estados_y_liberacion.sql
--
-- ORDEN: debe aplicarse antes que 2026-10-29_2_... (esa usa inicio_at y
-- comprobado_at, que crea esta migración).

BEGIN;

-- ============================================================================
-- 1) Columnas nuevas en las dos tablas de reservas
-- ============================================================================
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS inicio_at                TIMESTAMPTZ;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS comprobado_at            TIMESTAMPTZ;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS confirmado_at            TIMESTAMPTZ;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS finalizado_at            TIMESTAMPTZ;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS motivo_cierre            TEXT;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS devolucion_pct           NUMERIC(5,2);
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS devolucion_monto         NUMERIC(12,2);
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS devolucion_calculada_at  TIMESTAMPTZ;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS devolucion_ejecutada_at  TIMESTAMPTZ;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS devolucion_ejecutada_por TEXT;
ALTER TABLE reservas_visitas      ADD COLUMN IF NOT EXISTS comprobante_validado_id  BIGINT;

ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS inicio_at                TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS comprobado_at            TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS confirmado_at            TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS finalizado_at            TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS motivo_cierre            TEXT;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS devolucion_pct           NUMERIC(5,2);
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS devolucion_monto         NUMERIC(12,2);
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS devolucion_calculada_at  TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS devolucion_ejecutada_at  TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS devolucion_ejecutada_por TEXT;
ALTER TABLE reservas_alojamiento  ADD COLUMN IF NOT EXISTS comprobante_validado_id  BIGINT;

COMMENT ON COLUMN reservas_visitas.inicio_at     IS 'Inicio de la reserva (00:00 del dia de ingreso, zona del sistema). Ancla de todos los plazos.';
COMMENT ON COLUMN reservas_alojamiento.inicio_at IS 'Inicio de la reserva (00:00 de la primera noche). Ancla de todos los plazos.';
COMMENT ON COLUMN reservas_visitas.motivo_cierre IS 'vencido_sin_pago | vencido_sin_tiempo | cancelado_cliente | cancelado_admin | sin_validar | no_show | cumplida';

-- ============================================================================
-- 2) Backfill de inicio_at para las reservas existentes
-- ============================================================================
UPDATE reservas_visitas
   SET inicio_at = (fecha_ingreso::date)::timestamptz
 WHERE inicio_at IS NULL
   AND fecha_ingreso ~ '^\d{4}-\d{2}-\d{2}$';

UPDATE reservas_alojamiento r
   SET inicio_at = d.min_fecha
  FROM (
        SELECT reserva_id, MIN(fecha::date)::timestamptz AS min_fecha
          FROM reserva_alojamiento_dias
         WHERE fecha ~ '^\d{4}-\d{2}-\d{2}$'
         GROUP BY reserva_id
       ) d
 WHERE d.reserva_id = r.id
   AND r.inicio_at IS NULL;

-- NOT NULL solo si no quedaron filas sin ancla (no bloquea la migración).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM reservas_visitas WHERE inicio_at IS NULL) THEN
        ALTER TABLE reservas_visitas ALTER COLUMN inicio_at SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM reservas_alojamiento WHERE inicio_at IS NULL) THEN
        ALTER TABLE reservas_alojamiento ALTER COLUMN inicio_at SET NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- 3) CHECK de estados (NOT VALID: valida escrituras nuevas)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reservas_visitas_estado') THEN
        ALTER TABLE reservas_visitas DROP CONSTRAINT chk_reservas_visitas_estado;
    END IF;
    ALTER TABLE reservas_visitas
        ADD CONSTRAINT chk_reservas_visitas_estado
        CHECK (estado IN ('Pre-Reserva', 'Comprobar', 'Confirmado', 'Cancelado',
                          'Vencido', 'Devolver', 'Finalizado')) NOT VALID;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reservas_alojamiento_estado') THEN
        ALTER TABLE reservas_alojamiento DROP CONSTRAINT chk_reservas_alojamiento_estado;
    END IF;
    ALTER TABLE reservas_alojamiento
        ADD CONSTRAINT chk_reservas_alojamiento_estado
        CHECK (estado IN ('Pre-Reserva', 'Comprobar', 'Confirmado', 'Cancelado',
                          'Vencido', 'Devolver', 'Finalizado')) NOT VALID;
END $$;

-- ============================================================================
-- 4) Comprobantes: ciclo propio y auditoría de la revisión
-- ============================================================================
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS estado         TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS revisado_por   TEXT;
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS revisado_at    TIMESTAMPTZ;
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_comprobantes_estado') THEN
        ALTER TABLE comprobantes DROP CONSTRAINT chk_comprobantes_estado;
    END IF;
    ALTER TABLE comprobantes
        ADD CONSTRAINT chk_comprobantes_estado
        CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')) NOT VALID;
END $$;

-- ============================================================================
-- 5) Nuevos tipos de evento de notificación
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
                               'vencimiento', 'rechazo', 'devolucion'));
END $$;

-- ============================================================================
-- 6) Índices para el barrido de vencimientos
-- ============================================================================
CREATE INDEX IF NOT EXISTS ix_visitas_estado_vence
    ON reservas_visitas (estado, pago_vence_at);
CREATE INDEX IF NOT EXISTS ix_aloj_estado_vence
    ON reservas_alojamiento (estado, pago_vence_at);
CREATE INDEX IF NOT EXISTS ix_visitas_estado_inicio
    ON reservas_visitas (estado, inicio_at);
CREATE INDEX IF NOT EXISTS ix_aloj_estado_inicio
    ON reservas_alojamiento (estado, inicio_at);

-- ============================================================================
-- 7) Política de tiempos (editable; el código usa estos valores con defaults)
-- ============================================================================
INSERT INTO configuracion_sistema (clave, valor) VALUES ('anticipacion_horas', '60')
ON CONFLICT (clave) DO NOTHING;
INSERT INTO configuracion_sistema (clave, valor) VALUES ('ventana_pago_horas', '48')
ON CONFLICT (clave) DO NOTHING;
INSERT INTO configuracion_sistema (clave, valor) VALUES ('ventana_pago_min_horas', '6')
ON CONFLICT (clave) DO NOTHING;
INSERT INTO configuracion_sistema (clave, valor) VALUES ('cancelacion_horas', '48')
ON CONFLICT (clave) DO NOTHING;
INSERT INTO configuracion_sistema (clave, valor) VALUES ('devolucion_temprana_pct', '100')
ON CONFLICT (clave) DO NOTHING;
INSERT INTO configuracion_sistema (clave, valor) VALUES ('devolucion_tardia_pct', '50')
ON CONFLICT (clave) DO NOTHING;

-- ============================================================================
-- 8) Vista unificada: se agregan columnas al final (no se alteran las previas)
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
       cmp.estado AS comprobante_estado
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
               r.devolucion_ejecutada_at
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
               r.devolucion_ejecutada_at
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
