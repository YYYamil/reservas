-- 2026-10-27 Eliminar la columna pernocta de las reservas de visita
--
-- La pernocta dejó de usarse: la reserva de alojamiento ya contempla la
-- estadía con noches y la visita diaria consume capacidad siempre.
--
-- Cambios:
--   1) Dropear la vista v_reservas_todas (PostgreSQL no permite quitar
--      columnas con CREATE OR REPLACE VIEW).
--   2) Dropear reservas_visitas.pernocta.
--   3) Recrear la vista unificada sin esa columna.
--
-- Idempotente: puede ejecutarse más de una vez sin errores.
--
-- Ejecutar con:
--   php api/tests/aplicar_migracion.php api/migrations/2026-10-27_eliminar_pernocta_visitas.sql

BEGIN;

DROP VIEW IF EXISTS v_reservas_todas;

ALTER TABLE reservas_visitas DROP COLUMN IF EXISTS pernocta;

CREATE OR REPLACE VIEW v_reservas_todas AS
SELECT v.modalidad, v.id_reserva, v.codigo_publico, v.created_at, v.pk, v.albergue,
       v.institucion, v.responsable, v.dni, v.contacto, v.cantidad, v.fecha_p,
       v.hora_ingreso, v.hora_egreso, v.estado, v.rango_fechas,
       v.observaciones, v.estado_modificado_por, v.estado_modificado_at,
       v.estado_origen, v.email, v.monto_total, v.pago_vence_at,
       cmp.id AS comprobante_id, cmp.ruta AS comprobante_ruta
FROM (
    SELECT 'visita'::text AS modalidad, r.id_reserva, r.codigo_publico, r.created_at,
           r.id AS pk, a.nombre AS albergue, r.institucion, r.responsable, r.dni,
           r.contacto, r.cantidad, r.fecha_ingreso AS fecha_p, r.hora_ingreso,
           r.hora_egreso, r.estado, NULL::text AS rango_fechas,
           NULL::text AS observaciones, r.estado_modificado_por, r.estado_modificado_at,
           r.estado_origen, r.email, r.monto_total, r.pago_vence_at
    FROM reservas_visitas r JOIN albergues a ON a.id = r.albergue_id
    UNION ALL
    SELECT 'alojamiento'::text, r.id_reserva, r.codigo_publico, r.created_at,
           r.id, a.nombre, r.institucion, r.responsable, r.dni, r.contacto,
           r.cantidad, NULL::text, NULL::text, NULL::text, r.estado,
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
