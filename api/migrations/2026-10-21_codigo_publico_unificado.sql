CREATE SEQUENCE IF NOT EXISTS reserva_publica_seq START WITH 1;

ALTER TABLE reservas_visitas ADD COLUMN IF NOT EXISTS codigo_publico VARCHAR(12);
ALTER TABLE reservas_alojamiento ADD COLUMN IF NOT EXISTS codigo_publico VARCHAR(12);

TRUNCATE TABLE reserva_alojamiento_dias RESTART IDENTITY CASCADE;
TRUNCATE TABLE notificaciones_email RESTART IDENTITY CASCADE;
TRUNCATE TABLE reservas_visitas RESTART IDENTITY CASCADE;
TRUNCATE TABLE reservas_alojamiento RESTART IDENTITY CASCADE;

ALTER SEQUENCE reserva_publica_seq RESTART WITH 1;

UPDATE reservas_visitas SET codigo_publico = 'R-' || LPAD(nextval('reserva_publica_seq')::text, 6, '0') WHERE codigo_publico IS NULL;
UPDATE reservas_alojamiento SET codigo_publico = 'R-' || LPAD(nextval('reserva_publica_seq')::text, 6, '0') WHERE codigo_publico IS NULL;

ALTER TABLE reservas_visitas ALTER COLUMN codigo_publico SET NOT NULL;
ALTER TABLE reservas_alojamiento ALTER COLUMN codigo_publico SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_reservas_visitas_codigo_publico ON reservas_visitas(codigo_publico);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reservas_alojamiento_codigo_publico ON reservas_alojamiento(codigo_publico);

CREATE OR REPLACE VIEW v_reservas_todas AS
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
       r.pernocta,
       r.estado,
       NULL::text AS rango_fechas,
       NULL::text AS observaciones,
       r.estado_modificado_por,
       r.estado_modificado_at,
       r.estado_origen,
       r.email
FROM reservas_visitas r
JOIN albergues a ON a.id = r.albergue_id
UNION ALL
SELECT 'alojamiento'::text AS modalidad,
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
JOIN albergues a ON a.id = r.albergue_id;
