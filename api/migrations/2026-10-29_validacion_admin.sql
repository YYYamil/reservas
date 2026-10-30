-- 2026-10-29 Aviso de validación al administrador
--
-- Nuevo tipo de evento 'validacion_admin': se envía al mail del administrador
-- cuando se aprueba un comprobante desde el panel, con el nombre de quien lo
-- validó. El correo al usuario final ('confirmacion') no cambia.
--
-- Idempotente: puede ejecutarse más de una vez sin errores.
--
-- Ejecutar con:
--   php api/tests/aplicar_migracion.php api/migrations/2026-10-29_validacion_admin.sql

BEGIN;

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
                               'comprobante_recibido', 'validacion_admin'));
END $$;

COMMIT;
