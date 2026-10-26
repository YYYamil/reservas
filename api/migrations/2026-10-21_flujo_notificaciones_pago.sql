-- 2026-10-21 Etapa 2: flujo de notificaciones por email + pago
--
-- Cambios:
--   1) Montos por albergue: monto_visita (por persona) y monto_cama
--      (por cama/noche de alojamiento).
--   2) Monto total congelado al crear la reserva (monto_total) + fecha de
--      vencimiento de pago (pago_vence_at) en ambas tablas de reservas.
--   3) Tabla configuracion_sistema (clave/valor) para el mail del admin.
--   4) Tabla comprobantes (archivo de pago subido por el cliente).
--   5) notificaciones_email: agregar tipo 'pago_recibido' y 'aviso_admin',
--      y columna destinatario_tipo ('cliente' / 'admin').
--
-- Idempotente: puede ejecutarse mas de una vez sin errores.

BEGIN;

-- 1) Montos por albergue ------------------------------------------------------
ALTER TABLE albergues ADD COLUMN IF NOT EXISTS monto_visita NUMERIC(12,2) NOT NULL DEFAULT 2000;
ALTER TABLE albergues ADD COLUMN IF NOT EXISTS monto_cama   NUMERIC(12,2) NOT NULL DEFAULT 5000;

-- 2) Monto congelado y vencimiento de pago -----------------------------------
ALTER TABLE reservas_visitas     ADD COLUMN IF NOT EXISTS monto_total   NUMERIC(12,2);
ALTER TABLE reservas_visitas     ADD COLUMN IF NOT EXISTS pago_vence_at TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento ADD COLUMN IF NOT EXISTS monto_total   NUMERIC(12,2);
ALTER TABLE reservas_alojamiento ADD COLUMN IF NOT EXISTS pago_vence_at TIMESTAMPTZ;

-- 3) Configuracion del sistema (mail del admin, etc.) ------------------------
CREATE TABLE IF NOT EXISTS configuracion_sistema (
    clave      TEXT PRIMARY KEY,
    valor      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion_sistema (clave, valor)
VALUES ('mail_admin', 'yamiltolaba@gmail.com')
ON CONFLICT (clave) DO NOTHING;

-- 4) Comprobantes de pago -----------------------------------------------------
CREATE TABLE IF NOT EXISTS comprobantes (
    id                BIGSERIAL PRIMARY KEY,
    reserva_modalidad TEXT NOT NULL CHECK (reserva_modalidad IN ('visita', 'alojamiento')),
    reserva_pk        INTEGER NOT NULL,
    ruta              TEXT NOT NULL,
    nombre_original   TEXT NOT NULL,
    mime              TEXT,
    tamano_bytes      BIGINT,
    subido_por        TEXT NOT NULL DEFAULT 'cliente',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_comprobantes_reserva
    ON comprobantes (reserva_modalidad, reserva_pk);

-- 5) Ampliar outbox -----------------------------------------------------------
ALTER TABLE notificaciones_email ADD COLUMN IF NOT EXISTS destinatario_tipo TEXT NOT NULL DEFAULT 'cliente';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notificaciones_email_tipo_evento_check') THEN
        ALTER TABLE notificaciones_email DROP CONSTRAINT notificaciones_email_tipo_evento_check;
    END IF;
    ALTER TABLE notificaciones_email
        ADD CONSTRAINT notificaciones_email_tipo_evento_check
        CHECK (tipo_evento IN ('creacion', 'confirmacion', 'cancelacion', 'recordatorio', 'pago_recibido', 'aviso_admin'));
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notif_destinatario_tipo') THEN
        ALTER TABLE notificaciones_email
            ADD CONSTRAINT chk_notif_destinatario_tipo
            CHECK (destinatario_tipo IN ('cliente', 'admin'));
    END IF;
END $$;

-- El índice de unicidad ahora incluye destinatario (cliente/admin pueden
-- recibir el mismo evento sin colisionar).
DROP INDEX IF EXISTS ux_notif_reserva_evento;
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_reserva_evento_dest
    ON notificaciones_email (reserva_modalidad, reserva_pk, tipo_evento, destinatario);

-- 6) Vista unificada: exponer monto y vencimiento + comprobante vigente ---------
CREATE OR REPLACE VIEW v_reservas_todas AS
SELECT v.modalidad, v.id_reserva, v.codigo_publico, v.created_at, v.pk, v.albergue,
       v.institucion, v.responsable, v.dni, v.contacto, v.cantidad, v.fecha_p,
       v.hora_ingreso, v.hora_egreso, v.pernocta, v.estado, v.rango_fechas,
       v.observaciones, v.estado_modificado_por, v.estado_modificado_at,
       v.estado_origen, v.email, v.monto_total, v.pago_vence_at,
       cmp.id AS comprobante_id, cmp.ruta AS comprobante_ruta
FROM (
    SELECT 'visita'::text AS modalidad, r.id_reserva, r.codigo_publico, r.created_at,
           r.id AS pk, a.nombre AS albergue, r.institucion, r.responsable, r.dni,
           r.contacto, r.cantidad, r.fecha_ingreso AS fecha_p, r.hora_ingreso,
           r.hora_egreso, r.pernocta, r.estado, NULL::text AS rango_fechas,
           NULL::text AS observaciones, r.estado_modificado_por, r.estado_modificado_at,
           r.estado_origen, r.email, r.monto_total, r.pago_vence_at
    FROM reservas_visitas r JOIN albergues a ON a.id = r.albergue_id
    UNION ALL
    SELECT 'alojamiento'::text, r.id_reserva, r.codigo_publico, r.created_at,
           r.id, a.nombre, r.institucion, r.responsable, r.dni, r.contacto,
           r.cantidad, NULL::text, NULL::text, NULL::text, NULL::text, r.estado,
           r.rango_fechas, r.observaciones, r.estado_modificado_por, r.estado_modificado_at,
           r.estado_origen, r.email, r.monto_total, r.pago_vence_at
    FROM reservas_alojamiento r JOIN albergues a ON a.id = r.albergue_id
) v
LEFT JOIN LATERAL (
    SELECT c.id, c.ruta FROM comprobantes c
     WHERE c.reserva_modalidad = v.modalidad AND c.reserva_pk = v.pk
     ORDER BY c.created_at DESC LIMIT 1
) cmp ON true;

COMMIT;
