#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * Migración de datos: SQLite → PostgreSQL
 *
 * Uso:
 *   php migrar_sqlite_a_pg.php
 *
 * Requisitos:
 *   - Extensiones pdo_sqlite y pdo_pgsql habilitadas
 *   - schema_pg.sql ya ejecutado en la BD PostgreSQL (tablas vacías o se truncan)
 *   - config.php apuntando a PostgreSQL
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Este script solo debe ejecutarse por CLI\n");
    exit(1);
}

$config = require __DIR__ . '/config.php';

// --- Conexión SQLite (origen) ---
$sqlitePath = __DIR__ . '/med_albergues_migrada.sqlite';  // ajustá la ruta si es necesario
if (!is_file($sqlitePath)) {
    // Intentar la ruta relativa al proyecto típico
    $sqlitePath = dirname(__DIR__) . '/data/med_albergues.sqlite';
}
if (!is_file($sqlitePath)) {
    fwrite(STDERR, "No se encontró el archivo SQLite. Editá la ruta en el script.\n");
    exit(1);
}

$sqlite = new PDO('sqlite:' . $sqlitePath);
$sqlite->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$sqlite->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

// --- Conexión PostgreSQL (destino) ---
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s',
    $config['db_host'],
    $config['db_port'],
    $config['db_name']
);
$pg = new PDO($dsn, $config['db_user'], $config['db_pass'], [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

echo "=== Migración SQLite → PostgreSQL ===\n";
echo "Origen : {$sqlitePath}\n";
echo "Destino: {$config['db_name']}@{$config['db_host']}\n\n";

// Orden por dependencias de FK
$tablas = [
    'albergues',
    'configuraciones',
    'reservas_visitas',
    'reservas_alojamiento',
    'reserva_alojamiento_dias',
];

$pg->beginTransaction();
try {
    // Truncar en orden inverso (por FKs)
    echo "Truncando tablas destino...\n";
    $pg->exec('TRUNCATE reserva_alojamiento_dias, reservas_alojamiento, reservas_visitas, configuraciones, albergues RESTART IDENTITY CASCADE');

    foreach ($tablas as $tabla) {
        $rows = $sqlite->query("SELECT * FROM {$tabla}")->fetchAll();
        if (count($rows) === 0) {
            echo "  {$tabla}: 0 filas (omitido)\n";
            continue;
        }

        $cols = array_keys($rows[0]);
        $placeholders = implode(', ', array_fill(0, count($cols), '?'));
        $colList = implode(', ', $cols);

        // Para tablas con SERIAL, necesitamos permitir insertar el id explícito
        if (in_array($tabla, ['albergues', 'configuraciones', 'reservas_visitas', 'reservas_alojamiento', 'reserva_alojamiento_dias'], true)) {
            $pg->exec("SELECT setval(pg_get_serial_sequence('{$tabla}', 'id'), 1, false)");
        }

        $sql = "INSERT INTO {$tabla} ({$colList}) VALUES ({$placeholders})";
        $stmt = $pg->prepare($sql);

        $count = 0;
        foreach ($rows as $row) {
            $stmt->execute(array_values($row));
            $count++;
        }

        // Ajustar secuencia al máximo id insertado
        $pg->exec("SELECT setval(pg_get_serial_sequence('{$tabla}', 'id'), COALESCE((SELECT MAX(id) FROM {$tabla}), 1))");

        echo "  {$tabla}: {$count} filas migradas\n";
    }

    $pg->commit();
    echo "\n✓ Migración completada correctamente.\n";
} catch (Throwable $e) {
    if ($pg->inTransaction()) {
        $pg->rollBack();
    }
    fwrite(STDERR, "ERROR: " . $e->getMessage() . "\n");
    exit(1);
}

// Verificación
echo "\n=== Verificación de conteos ===\n";
foreach ($tablas as $tabla) {
    $src = (int) $sqlite->query("SELECT COUNT(*) FROM {$tabla}")->fetchColumn();
    $dst = (int) $pg->query("SELECT COUNT(*) FROM {$tabla}")->fetchColumn();
    $ok = $src === $dst ? '✓' : '✗';
    echo "  {$ok} {$tabla}: SQLite={$src}  PostgreSQL={$dst}\n";
}

echo "\nListo.\n";
exit(0);
