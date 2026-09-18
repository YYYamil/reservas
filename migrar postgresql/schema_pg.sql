-- Esquema PostgreSQL del sistema de reservas de albergues.
-- Compatible con la API PHP actual (index.php / db.php).

CREATE TABLE IF NOT EXISTS albergues (
    id          SERIAL PRIMARY KEY,
    clave       TEXT NOT NULL UNIQUE,          -- sin CHECK restrictivo → permite agregar más albergues
    nombre      TEXT NOT NULL UNIQUE,
    capacidad   INTEGER NOT NULL CHECK (capacidad > 0)
);

-- Datos de referencia (capacidades del sistema actual)
INSERT INTO albergues (clave, nombre, capacidad) VALUES
    ('maestro',  'Maestro José Fierro', 92),
    ('tinku',    'Tinku Huasi',         49),
    ('aquilina', 'Aquilina Soldati',    58)
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS configuraciones (
    id          SERIAL PRIMARY KEY,
    clave       TEXT NOT NULL UNIQUE,
    valor       TEXT NOT NULL,
    descripcion TEXT
);

-- Reservas de visita diurna
CREATE TABLE IF NOT EXISTS reservas_visitas (
    id            SERIAL PRIMARY KEY,
    id_reserva    INTEGER NOT NULL,
    albergue_id   INTEGER NOT NULL REFERENCES albergues(id),
    institucion   TEXT NOT NULL,
    responsable   TEXT NOT NULL,
    dni           TEXT,
    contacto      TEXT,
    cantidad      INTEGER NOT NULL CHECK (cantidad > 0),
    fecha_ingreso TEXT NOT NULL,                   -- ISO yyyy-MM-dd (se mantiene TEXT por compatibilidad)
    hora_ingreso  TEXT,
    hora_egreso   TEXT,
    pernocta      TEXT NOT NULL DEFAULT 'Sí' CHECK (pernocta IN ('Sí', 'No')),
    estado        TEXT NOT NULL DEFAULT 'Pre-Reserva',
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitas_fecha ON reservas_visitas (albergue_id, fecha_ingreso);
CREATE INDEX IF NOT EXISTS idx_visitas_id    ON reservas_visitas (id_reserva);

-- Reservas de alojamiento
CREATE TABLE IF NOT EXISTS reservas_alojamiento (
    id            SERIAL PRIMARY KEY,
    id_reserva    INTEGER NOT NULL,
    albergue_id   INTEGER NOT NULL REFERENCES albergues(id),
    institucion   TEXT NOT NULL,
    responsable   TEXT NOT NULL,
    dni           TEXT,
    contacto      TEXT,
    cantidad      INTEGER NOT NULL CHECK (cantidad > 0),
    rango_fechas  TEXT NOT NULL,
    estado        TEXT NOT NULL DEFAULT 'Pre-Reserva',
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alojamiento_id ON reservas_alojamiento (id_reserva);

-- Días normalizados de cada reserva de alojamiento
CREATE TABLE IF NOT EXISTS reserva_alojamiento_dias (
    id         SERIAL PRIMARY KEY,
    reserva_id INTEGER NOT NULL REFERENCES reservas_alojamiento(id) ON DELETE CASCADE,
    fecha      TEXT NOT NULL,
    cantidad   INTEGER NOT NULL CHECK (cantidad > 0),
    UNIQUE (reserva_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_aloj_dias_fecha ON reserva_alojamiento_dias (fecha);
