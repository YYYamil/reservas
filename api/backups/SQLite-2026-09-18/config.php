<?php
declare(strict_types=1);

/*
 * Configuración del backend PHP + SQLite.
 *
 * Ajustes:
 *  - db_path: ruta al archivo de la base SQLite. Se recomienda ubicarla
 *    fuera del directorio públicamente accesible por HTTP. Por defecto se
 *    aloja en /data (protegida por .htaccess), pero puede moverse.
 *  - timezone: zona horaria del servidor (se usa para los timestamps).
 *  - espejo_token: clave compartida opcional para proteger los endpoints
 *    espejoVisitas / espejoAlojamiento. Si queda vacía, se exponen sin clave
 *    (solo para desarrollo). Los scripts de Google deben enviarla como 'token'.
 */
return [
    'db_path'     => dirname(__DIR__) . '/data/med_albergues.sqlite',
    'timezone'    => 'America/Argentina/Tucuman',
    'espejo_token' => '',
];