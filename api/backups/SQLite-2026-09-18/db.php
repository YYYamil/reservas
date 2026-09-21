<?php
declare(strict_types=1);

/**
 * Conexión PDO a SQLite (singleton), con creación automática del esquema.
 */
function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = require __DIR__ . '/config.php';
    $dbPath = $config['db_path'];

    $dbDir = dirname($dbPath);
    if (!is_dir($dbDir)) {
        if (!mkdir($dbDir, 0775, true) && !is_dir($dbDir)) {
            throw new RuntimeException("No se pudo crear el directorio de la base: {$dbDir}");
        }
    }

    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    // Integridad referencial y concurrencia de escrituras
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->query('PRAGMA journal_mode = WAL')->fetchColumn();
    $pdo->exec('PRAGMA busy_timeout = 10000');

    // Crear esquema (idempotente: todas las sentencias usan IF NOT EXISTS)
    $schema = (string) file_get_contents(__DIR__ . '/schema.sql');
    if ($schema !== '') {
        $pdo->exec($schema);
    }

    return $pdo;
}