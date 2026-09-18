<?php
declare(strict_types=1);

/**
 * Conexión PDO a PostgreSQL (singleton).
 * El esquema se crea una sola vez con schema_pg.sql (no se ejecuta en cada request).
 */
function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = require __DIR__ . '/config.php';

    $dsn = sprintf(
        'pgsql:host=%s;port=%s;dbname=%s',
        $config['db_host'],
        $config['db_port'],
        $config['db_name']
    );

    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // PostgreSQL no necesita emulación de prepares
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    // Zona horaria de la sesión (opcional pero recomendable)
    $pdo->exec("SET TIME ZONE '{$config['timezone']}'");

    return $pdo;
}
