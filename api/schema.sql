-- Esquema SQLite del sistema de reservas de albergues.
-- PRAGMA (foreign_keys, journal_mode) se configuran en db.php.

CREATE TABLE IF NOT EXISTS albergues (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    clave     TEXT NOT NULL UNIQUE CHECK (clave IN ('maestro', 'tinku', 'aquilina')),
    nombre    TEXT NOT NULL UNIQUE,
    capacidad INTEGER NOT NULL CHECK (capacidad > 0)
);

-- Datos de referencia: capacidades confirmadas en el sistema anterior
-- (frontend + hojas de Configuraciones). El script migrar.php las reconcilia
-- contra los CSVs exportados e informa cualquier diferencia.
INSERT OR IGNORE INTO albergues (clave, nombre, capacidad) VALUES
    ('maestro',  'Maestro José Fierro', 92),
    ('tinku',    'Tinku Huasi',         49),
    ('aquilina', 'Aquilina Soldati',    58);

CREATE TABLE IF NOT EXISTS configuraciones (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    clave       TEXT NOT NULL UNIQUE,
    valor       TEXT NOT NULL,
    descripcion TEXT
);

-- Reservas de visita diurna (equivale a hoja "Reservas" del libro de Visitas).
-- pernocta IN ('Sí','No'): solo las reservas con 'Sí' consumen capacidad.
CREATE TABLE IF NOT EXISTS reservas_visitas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_reserva    INTEGER NOT NULL,                -- código 0-9999 (Date.now()%10000). NO único: reproduce el sheet
    albergue_id   INTEGER NOT NULL REFERENCES albergues(id),
    institucion   TEXT NOT NULL,
    responsable   TEXT NOT NULL,
    dni           TEXT,
    contacto      TEXT,
    cantidad      INTEGER NOT NULL CHECK (cantidad > 0),
    fecha_ingreso TEXT NOT NULL,                   -- ISO yyyy-MM-dd
    hora_ingreso  TEXT,
    hora_egreso   TEXT,
    pernocta      TEXT NOT NULL DEFAULT 'Sí' CHECK (pernocta IN ('Sí', 'No')),
    estado        TEXT NOT NULL DEFAULT 'Pre-Reserva',
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_visitas_fecha ON reservas_visitas (albergue_id, fecha_ingreso);
CREATE INDEX IF NOT EXISTS idx_visitas_id    ON reservas_visitas (id_reserva);

-- Reservas de alojamiento (equivale a hoja "ReservasAlojamiento").
CREATE TABLE IF NOT EXISTS reservas_alojamiento (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    id_reserva    INTEGER NOT NULL,
    albergue_id   INTEGER NOT NULL REFERENCES albergues(id),
    institucion   TEXT NOT NULL,
    responsable   TEXT NOT NULL,
    dni           TEXT,
    contacto      TEXT,
    cantidad      INTEGER NOT NULL CHECK (cantidad > 0),
    rango_fechas  TEXT NOT NULL,                   -- CSV conservado para compatibilidad con el sheet
    estado        TEXT NOT NULL DEFAULT 'Pre-Reserva',
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_alojamiento_id ON reservas_alojamiento (id_reserva);

-- Un día por cada fecha del rango de una reserva de alojamiento (normalizado).
CREATE TABLE IF NOT EXISTS reserva_alojamiento_dias (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    reserva_id INTEGER NOT NULL REFERENCES reservas_alojamiento(id) ON DELETE CASCADE,
    fecha      TEXT NOT NULL,                      -- ISO yyyy-MM-dd
    cantidad   INTEGER NOT NULL CHECK (cantidad > 0),
    UNIQUE (reserva_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_aloj_dias_fecha ON reserva_alojamiento_dias (fecha);