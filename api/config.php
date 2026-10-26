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

    // --- Email / SMTP (Resend) ---
    // Sin credenciales por defecto: cada ambiente las define en api/config.local.php
    // (archivo ignorado por git). No commitear secretos.
    'smtp_host'   => 'smtp.resend.com',
    'smtp_port'   => 587,
    'smtp_user'   => 'resend',
    'smtp_pass'   => '',
    'smtp_secure' => 'tls', // STARTTLS
    'mail_from'       => 'notificaciones@reservas.yamy.fun',
    'mail_from_name'  => 'Albergues Tucumán',

    // --- Notificaciones ---
    // URL pública del sitio, usada en los enlaces de los correos.
    // Si queda vacía se toma configuracion_sistema.app_url y, como último
    // recurso, el host del request actual.
    'app_url' => '',

    // Intenta enviar el correo en el mismo request (transacción de la reserva).
    // Si SMTP falla, la notificación queda en cola y el cron la reintenta.
    // En bases de prueba conviene dejarlo en false (no envía correos reales).
    'notif_envio_inmediato' => true,

    // Copias del aviso al mail del administrador (configuracion_sistema.mail_admin).
    // false = solo se notifica al usuario final que cargó su mail en la reserva.
    'notif_enviar_admin' => false,

    // Token para invocar los endpoints de cron (procesarNotificaciones,
    // tareasVencimiento). Definir uno propio en config.local.php en producción.
    'cron_token'  => '',
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
