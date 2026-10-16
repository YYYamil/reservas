<?php
declare(strict_types=1);

/*
 * Validador de SOLO LECTURA para la conexión vía túnel SSH a Oracle.
 * Uso: php validar-oracle.php
 * Lee las credenciales de api/config.php (+ override api/config.local.php).
 * NUNCA imprime la contraseña. No ejecuta INSERT/UPDATE/DELETE/DROP ni migraciones.
 */

error_reporting(E_ALL & ~E_DEPRECATED);

$config = require __DIR__ . '/api/config.php';

// Muestra todo menos el password.
printf(
    "Destino: %s:%s/%s user=%s\n",
    $config['db_host'],
    $config['db_port'],
    $config['db_name'],
    $config['db_user']
);

try {
    $pdo = new PDO(
        sprintf(
            'pgsql:host=%s;port=%s;dbname=%s;connect_timeout=10',
            $config['db_host'],
            $config['db_port'],
            $config['db_name']
        ),
        $config['db_user'],
        $config['db_pass'],
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    // Nota: si el mensaje es "password authentication failed", el túnel
    // funciona y PostgreSQL responde; falta/corrige la contraseña en
    // api/config.local.php. Si es "connection refused/timeout", el túnel
    // está caído: correr .\iniciar-tunel-oracle.ps1
    fwrite(STDERR, 'PDO_ERROR: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$una = static fn (string $sql) => $pdo->query($sql)->fetchColumn();

echo 'OK: ' . $una('SELECT version()') . PHP_EOL;
echo 'OK: usuario=' . $una('SELECT current_user') . ' bd=' . $una('SELECT current_database()') . PHP_EOL;
echo 'OK: albergues=' . $una('SELECT count(*) FROM albergues')
    . ' visitas=' . $una('SELECT count(*) FROM reservas_visitas')
    . ' alojamientos=' . $una('SELECT count(*) FROM reservas_alojamiento') . PHP_EOL;

echo "Validación de lectura OK." . PHP_EOL;
