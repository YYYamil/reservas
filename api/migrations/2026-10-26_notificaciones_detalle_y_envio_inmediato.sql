-- 2026-10-26 Notificaciones: detalle de la pre-reserva y envío inmediato
--
-- Cambios:
--   1) Nuevo tipo de evento 'cancelacion_cliente': se envía al usuario final
--      cuando ÉL MISMO cancela su pre-reserva (distinto de la cancelación por
--      vencimiento o por decisión del administrador).
--   2) Columnas de trazabilidad: cancelado_at / cancelado_origen en ambas
--      tablas de reservas (web | admin | auto-vencimiento).
--   3) configuracion_sistema: parámetros del envío inmediato
--      (notif_envio_inmediato, notif_enviar_admin, app_url).
--
-- Idempotente: puede ejecutarse más de una vez sin errores.
--
-- Ejecutar con:
--   psql -h <host> -p <puerto> -U <usuario> -d reserva_albergue \
--        -f api/migrations/2026-10-26_notificaciones_detalle_y_envio_inmediato.sql

BEGIN;

-- 1) Ampliar el CHECK de tipo_evento -------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notificaciones_email_tipo_evento_check') THEN
        ALTER TABLE notificaciones_email DROP CONSTRAINT notificaciones_email_tipo_evento_check;
    END IF;
    ALTER TABLE notificaciones_email
        ADD CONSTRAINT notificaciones_email_tipo_evento_check
        CHECK (tipo_evento IN ('creacion', 'confirmacion', 'cancelacion', 'cancelacion_cliente',
                               'recordatorio', 'pago_recibido', 'aviso_admin'));
END $$;

-- 2) Trazabilidad de la cancelación -------------------------------------------
ALTER TABLE reservas_visitas     ADD COLUMN IF NOT EXISTS cancelado_at     TIMESTAMPTZ;
ALTER TABLE reservas_visitas     ADD COLUMN IF NOT EXISTS cancelado_origen TEXT;
ALTER TABLE reservas_alojamiento ADD COLUMN IF NOT EXISTS cancelado_at     TIMESTAMPTZ;
ALTER TABLE reservas_alojamiento ADD COLUMN IF NOT EXISTS cancelado_origen TEXT;

COMMENT ON COLUMN reservas_visitas.cancelado_origen IS 'web | admin | auto-vencimiento';
COMMENT ON COLUMN reservas_alojamiento.cancelado_origen IS 'web | admin | auto-vencimiento';

-- 3) Parámetros del envío inmediato -------------------------------------------
-- notif_envio_inmediato: '1' intenta enviar el correo al instante (in-process)
--                        y, si SMTP falla, deja la notificación en cola.
--                        '0' solo encola (el cron la envía después).
-- notif_enviar_admin:    '1' además deja copia al mail_admin en cada evento.
--                        Por defecto '0': todas las notificaciones van al mail
--                        del usuario final cargado en el modal de la reserva.
INSERT INTO configuracion_sistema (clave, valor) VALUES ('notif_envio_inmediato', '1')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO configuracion_sistema (clave, valor) VALUES ('notif_enviar_admin', '0')
ON CONFLICT (clave) DO NOTHING;

-- app_url: URL pública del sitio, usada en los enlaces de los correos.
INSERT INTO configuracion_sistema (clave, valor) VALUES ('app_url', '')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
