-- 2026-10-20 · Etapa 1 de notificaciones por email
--
-- Cambios:
--   1) Columna `email` en reservas_visitas y reservas_alojamiento (nullable
--      para no romper las reservas históricas; el alta nueva la exige y valida
--      tanto en el frontend como en el backend).
--   2) CHECK de formato de email: permite NULL (filas viejas) pero exige
--      estructura válida cuando hay valor.
--   3) Recreación de la vista v_reservas_todas para exponer `email`.
--   4) Tabla `notificaciones_email` (outbox) para el envío futuro de correos.
--
-- Es idempotente: puede ejecutarse más de una vez sin errores.

BEGIN;

-- 1) y 2) Columna + validación de formato -------------------------------------
ALTER TABLE reservas_visitas
    ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE reservas_alojamiento
    ADD COLUMN IF NOT EXISTS email TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_reservas_visitas_email'
    ) THEN
        ALTER TABLE reservas_visitas
            ADD CONSTRAINT chk_reservas_visitas_email
            CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_reservas_alojamiento_email'
    ) THEN
        ALTER TABLE reservas_alojamiento
            ADD CONSTRAINT chk_reservas_alojamiento_email
            CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
    END IF;
END $$;

-- 3) Vista unificada con email ------------------------------------------------
CREATE OR REPLACE VIEW v_reservas_todas AS
WITH v AS (
    SELECT 'visita'::text AS modalidad,
           r.id_reserva,
           r.created_at,
           r.id AS pk,
           al.nombre AS albergue,
           r.institucion,
           r.responsable,
           r.dni,
           r.contacto,
           r.cantidad,
           r.fecha_ingreso AS fecha_p,
           r.hora_ingreso,
           r.hora_egreso,
           r.pernocta,
           r.estado,
           NULL::text AS rango_fechas,
           r.observaciones,
           r.estado_modificado_por,
           r.estado_modificado_at,
           r.estado_origen,
           r.email
      FROM reservas_visitas r
      JOIN albergues al ON al.id = r.albergue_id
), a AS (
    SELECT 'alojamiento'::text AS modalidad,
           r.id_reserva,
           r.created_at,
           r.id AS pk,
           al.nombre AS albergue,
           r.institucion,
           r.responsable,
           r.dni,
           r.contacto,
           r.cantidad,
           NULL::text AS fecha_p,
           NULL::text AS hora_ingreso,
           NULL::text AS hora_egreso,
           NULL::text AS pernocta,
           r.estado,
           r.rango_fechas,
           r.observaciones,
           r.estado_modificado_por,
           r.estado_modificado_at,
           r.estado_origen,
           r.email
      FROM reservas_alojamiento r
      JOIN albergues al ON al.id = r.albergue_id
)
SELECT v.modalidad, v.id_reserva, v.created_at, v.pk, v.albergue, v.institucion,
       v.responsable, v.dni, v.contacto, v.cantidad, v.fecha_p, v.hora_ingreso,
       v.hora_egreso, v.pernocta, v.estado, v.rango_fechas, v.observaciones,
       v.estado_modificado_por, v.estado_modificado_at, v.estado_origen, v.email
  FROM v
UNION ALL
SELECT a.modalidad, a.id_reserva, a.created_at, a.pk, a.albergue, a.institucion,
       a.responsable, a.dni, a.contacto, a.cantidad, a.fecha_p, a.hora_ingreso,
       a.hora_egreso, a.pernocta, a.estado, a.rango_fechas, a.observaciones,
       a.estado_modificado_por, a.estado_modificado_at, a.estado_origen, a.email
  FROM a;

-- 4) Tabla de notificaciones (outbox) ----------------------------------------
CREATE TABLE IF NOT EXISTS notificaciones_email (
    id                BIGSERIAL PRIMARY KEY,
    reserva_modalidad TEXT NOT NULL CHECK (reserva_modalidad IN ('visita', 'alojamiento')),
    reserva_pk        INTEGER NOT NULL,
    destinatario      TEXT NOT NULL,
    tipo_evento       TEXT NOT NULL CHECK (tipo_evento IN ('creacion', 'confirmacion', 'cancelacion', 'recordatorio')),
    estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'fallido')),
    asunto            TEXT,
    cuerpo            TEXT,
    intentos          INTEGER NOT NULL DEFAULT 0,
    ultimo_error      TEXT,
    programado_para   TIMESTAMPTZ,
    enviado_at        TIMESTAMPTZ,
    proveedor_msg_id  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_reserva_evento
    ON notificaciones_email (reserva_modalidad, reserva_pk, tipo_evento);

CREATE INDEX IF NOT EXISTS ix_notif_estado_programado
    ON notificaciones_email (estado, programado_para);

COMMIT;
