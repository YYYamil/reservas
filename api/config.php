<?php
declare(strict_types=1);

/*
 * Configuración del backend PHP + PostgreSQL.
 *
 * Ajustes:
 *  - db_*: datos de conexión a PostgreSQL
 *  - timezone: zona horaria del servidor (se usa para los timestamps)
 *  - espejo_token: clave compartida opcional para proteger los endpoints
 *    espejoVisitas / espejoAlojamiento. Si queda vacía, se exponen sin clave
 *    (solo para desarrollo). Los scripts de Google deben enviarla como 'token'.
 */
return [
    // --- PostgreSQL ---
    'db_host'     => '127.0.0.1',
    'db_port'     => '5432',
    'db_name'     => 'reserva_albergue',
    'db_user'     => 'usr_proyectos',
    'db_pass'     => 'guatemala2018',

    // --- General ---
    'timezone'    => 'America/Argentina/Tucuman',
    'espejo_token' => '',

    // --- Panel administrador ---
    // Credenciales del panel /admin (login por usuario y contraseña).
    // Cambiá estos valores para producción.
    'admin_user'   => 'admin',
    'admin_pass'   => 'Admin2026',
];
