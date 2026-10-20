<?php
declare(strict_types=1);

/*
 * Configuración del backend PHP + PostgreSQL.
 *
 * Ajustes:
 *  - db_*: datos de conexión a PostgreSQL
 *  - timezone: zona horaria del servidor (se usa para los timestamps)
 *
 * Las credenciales del panel viven en la tabla `usuarios` (rol super_admin/admin/lector);
 * el primer super_admin se crea con el script de instalación.
 */
$config = [
    // --- PostgreSQL ---
    'db_host'     => '127.0.0.1',
    'db_port'     => '5432',
    'db_name'     => 'reserva_albergue',
    'db_user'     => 'usr_proyectos',
    // Sin contraseña por defecto: cada ambiente la define en api/config.local.php
    // (archivo ignorado por git). No commitear secretos.
    'db_pass'     => '',

    // --- General ---
    'timezone'    => 'America/Argentina/Tucuman',
];

// Configuración por ambiente: si existe config.local.php (ignorada por git),
// sus valores sobrescriben a los de arriba. Cada máquina define el suyo.
$localFile = __DIR__ . '/config.local.php';
if (is_file($localFile)) {
    $local = require $localFile;
    if (is_array($local)) {
        $config = array_merge($config, $local);
    }
}

return $config;
