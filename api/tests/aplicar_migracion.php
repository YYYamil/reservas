<?php
declare(strict_types=1);

/**
 * Aplicador de migraciones SQL vía PDO (alternativa a psql).
 *
 * Uso:
 *   php api/tests/aplicar_migracion.php api/migrations/2026-10-26_notificaciones_detalle_y_envio_inmediato.sql
 *
 * Sin argumentos aplica la migración de notificaciones por defecto.
 * Las migraciones del proyecto son idempotentes, por lo que puede
 * ejecutarse más de una vez sin efectos secundarios.
 */

error_reporting(E_ALL & ~E_DEPRECATED);

$config = require __DIR__ . '/../config.php';

$archivo = $argv[1] ?? __DIR__ . '/../migrations/2026-10-26_notificaciones_detalle_y_envio_inmediato.sql';
if (!is_file($archivo)) {
    fwrite(STDERR, "No existe el archivo: {$archivo}\n");
    exit(1);
}

$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;connect_timeout=10',
    $config['db_host'],
    $config['db_port'],
    $config['db_name']
);

try {
    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, 'PDO_ERROR: ' . $e->getMessage() . PHP_EOL);
    fwrite(STDERR, "Verificá el túnel SSH: .\\iniciar-tunel-oracle.ps1\n");
    exit(1);
}

printf("Destino: %s:%s/%s\n", $config['db_host'], $config['db_port'], $config['db_name']);
printf("Migración: %s\n", basename($archivo));

$sql = file_get_contents($archivo);
if ($sql === false || trim($sql) === '') {
    fwrite(STDERR, "El archivo de migración está vacío.\n");
    exit(1);
}

try {
    $pdo->exec($sql);
} catch (PDOException $e) {
    fwrite(STDERR, 'MIGRACION_ERROR: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

echo "OK: migración aplicada.\n";

// --- Verificación de los objetos creados -------------------------------------
$col = static function (string $tabla, string $columna) use ($pdo): bool {
    $st = $pdo->prepare(
        'SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?'
    );
    $st->execute([$tabla, $columna]);
    return (bool) $st->fetchColumn();
};

foreach ([
    ['reservas_visitas', 'cancelado_at'],
    ['reservas_visitas', 'cancelado_origen'],
    ['reservas_alojamiento', 'cancelado_at'],
    ['reservas_alojamiento', 'cancelado_origen'],
] as [$tabla, $columna]) {
    printf("  %-22s %-16s %s\n", $tabla, $columna, $col($tabla, $columna) ? 'OK' : 'FALTA');
}

$st = $pdo->query("SELECT tipo_evento FROM notificaciones_email LIMIT 0");
unset($st);

$check = $pdo->query("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notificaciones_email_tipo_evento_check'")
    ->fetchColumn();
echo '  CHECK tipo_evento: ' . ($check !== false ? $check : 'NO ENCONTRADO') . PHP_EOL;

$params = $pdo->query(
    "SELECT clave, valor FROM configuracion_sistema
      WHERE clave IN ('notif_envio_inmediato', 'notif_enviar_admin', 'app_url')
      ORDER BY clave"
)->fetchAll(PDO::FETCH_ASSOC);

$actuales = array_column($params, 'valor', 'clave');
foreach (['notif_envio_inmediato', 'notif_enviar_admin', 'app_url'] as $clave) {
    printf("  config %-22s = '%s'\n", $clave, $actuales[$clave] ?? '(sin definir)');
}

echo "Listo.\n";
