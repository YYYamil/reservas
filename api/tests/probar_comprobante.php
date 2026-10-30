<?php
declare(strict_types=1);

/**
 * Prueba de punta a punta del circuito del comprobante:
 *   1) el cliente lo sube  -> 'comprobante_recibido' (cliente)
 *                           -> 'pago_recibido' (admin, con plazo de validación)
 *   2) el admin lo aprueba -> 'confirmacion' (cliente, sin cambios)
 *                           -> 'validacion_admin' (admin, con el nombre de quien validó)
 *
 * Crea una reserva de prueba, sube un comprobante, aprueba desde el panel y
 * verifica las notificaciones. Al final borra la reserva y sus registros.
 *
 * Uso:
 *   php api/tests/probar_comprobante.php              # envía correos reales
 *   php api/tests/probar_comprobante.php --sin-envio  # solo encola (no manda)
 */

error_reporting(E_ALL);
$DIR  = dirname(__DIR__, 2);
$PORT = 8027;
$BASE = "http://127.0.0.1:{$PORT}/api/index.php";

$config = require __DIR__ . '/../config.php';
date_default_timezone_set((string) ($config['timezone'] ?? 'America/Argentina/Tucuman'));

require __DIR__ . '/../db.php';
require __DIR__ . '/../notificaciones.php';
$pdo = db();

// --sin-envio: deja las notificaciones en cola (no manda correos reales).
$sinEnvio = in_array('--sin-envio', $argv, true);
$inmediatoAntes = null;
if ($sinEnvio) {
    $inmediatoAntes = $pdo->query("SELECT valor FROM configuracion_sistema WHERE clave='notif_envio_inmediato'")->fetchColumn();
    $pdo->exec("UPDATE configuracion_sistema SET valor='0' WHERE clave='notif_envio_inmediato'");
    register_shutdown_function(static function () use ($pdo, $inmediatoAntes): void {
        try {
            $pdo->exec("UPDATE configuracion_sistema SET valor = "
                . $pdo->quote((string) ($inmediatoAntes ?: '1'))
                . " WHERE clave='notif_envio_inmediato'");
        } catch (Throwable $e) {
        }
    });
}

// Dirección del administrador (la que recibe los avisos).
$mailAdmin = trim(configSistema($pdo, 'mail_admin'));
if ($mailAdmin === '') {
    $mailAdmin = 'yamiltolaba@gmail.com';
    $pdo->prepare(
        "INSERT INTO configuracion_sistema (clave, valor, updated_at) VALUES ('mail_admin', ?, NOW())
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()"
    )->execute([$mailAdmin]);
}
echo "Admin: {$mailAdmin}\n";

$log = tempnam(sys_get_temp_dir(), 'comprob_') . '.log';
$server = proc_open(
    [PHP_BINARY, '-S', "127.0.0.1:{$PORT}", '-t', $DIR],
    [1 => ['file', $log, 'w'], 2 => ['file', $log, 'a']],
    $pipes,
    $DIR
);
usleep(800000);

function api(string $base, string $action, array $params): array
{
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => http_build_query($params),
        'timeout' => 60,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($base . '?action=' . urlencode($action), false, $ctx);
    $json = json_decode((string) $resp, true);
    return is_array($json) ? $json : ['_raw' => (string) $resp];
}

function apiConCookie(string $base, string $action, array $params, string &$cookie): array
{
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n"
            . ($cookie !== '' ? "Cookie: {$cookie}\r\n" : ''),
        'content' => http_build_query($params),
        'timeout' => 60,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($base . '?action=' . urlencode($action), false, $ctx);
    $headers = function_exists('http_get_last_response_headers')
        ? (http_get_last_response_headers() ?? [])
        : ($http_response_header ?? []);
    foreach ($headers as $h) {
        if (stripos($h, 'Set-Cookie:') === 0) {
            $cookie = explode(';', trim(substr($h, 11)))[0];
        }
    }
    $json = json_decode((string) $resp, true);
    return is_array($json) ? $json : ['_raw' => (string) $resp];
}

function apiMultipart(string $base, string $action, array $campos, string $campo, string $nombre, string $mime, string $contenido): array
{
    $b = '----prueba' . bin2hex(random_bytes(8));
    $body = '';
    foreach ($campos as $k => $v) {
        $body .= "--{$b}\r\nContent-Disposition: form-data; name=\"{$k}\"\r\n\r\n{$v}\r\n";
    }
    $body .= "--{$b}\r\nContent-Disposition: form-data; name=\"{$campo}\"; filename=\"{$nombre}\"\r\n"
        . "Content-Type: {$mime}\r\n\r\n{$contenido}\r\n--{$b}--\r\n";

    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: multipart/form-data; boundary={$b}\r\nContent-Length: " . strlen($body) . "\r\n",
        'content' => $body,
        'timeout' => 60,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($base . '?action=' . urlencode($action), false, $ctx);
    $json = json_decode((string) $resp, true);
    return is_array($json) ? $json : ['_raw' => (string) $resp];
}

function notificaciones(PDO $pdo, int $pk): array
{
    $st = $pdo->prepare(
        "SELECT tipo_evento, destinatario, estado, intentos, cuerpo
           FROM notificaciones_email
          WHERE reserva_modalidad = 'alojamiento' AND reserva_pk = ?
       ORDER BY id"
    );
    $st->execute([$pk]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $n) {
        $out[$n['tipo_evento']] = $n;
    }
    return $out;
}

// ---- 1) Crear y subir comprobante -----------------------------------------
$fecha = date('Y-m-d', strtotime('+20 days'));
$crear = api($BASE, 'crearReservaAlojamiento', [
    'albergue'    => 'Maestro José Fierro',
    'institucion' => 'PRUEBA COMPROBANTE',
    'responsable' => 'Prueba Comprobante',
    'dni'         => '33777888',
    'contacto'    => '3817777777',
    'email'       => 'yamiltolaba@gmail.com',
    'cantidad'    => 3,
    'rangoFechas' => $fecha,
]);
echo 'Crear: ' . json_encode($crear, JSON_UNESCAPED_UNICODE) . "\n";
$codigo = (string) ($crear['codigoPublico'] ?? '');
if ($codigo === '') {
    proc_terminate($server);
    exit(1);
}

$st = $pdo->prepare("SELECT id FROM reservas_alojamiento WHERE codigo_publico = ?");
$st->execute([$codigo]);
$pk = (int) $st->fetchColumn();

$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
$subir = apiMultipart($BASE, 'subirComprobante', ['codigo' => $codigo], 'comprobante', 'pago.png', 'image/png', $png);
echo 'Subir: ' . json_encode($subir, JSON_UNESCAPED_UNICODE) . "\n";

$st = $pdo->prepare("SELECT estado, comprobado_at, validacion_vence_at FROM reservas_alojamiento WHERE id = ?");
$st->execute([$pk]);
$trasSubir = $st->fetch(PDO::FETCH_ASSOC);
$notifsSubida = notificaciones($pdo, $pk);

// ---- 2) Aprobar desde el panel --------------------------------------------
$cookie = '';
apiConCookie($BASE, 'adminLogin', ['usuario' => 'admin', 'pass' => 'Admin2026'], $cookie);
$aprobar = apiConCookie($BASE, 'adminEstado', ['accion' => 'aprobar', 'pk' => (string) $pk, 'modalidad' => 'alojamiento'], $cookie);
echo 'Aprobar: ' . json_encode($aprobar, JSON_UNESCAPED_UNICODE) . "\n";

$st = $pdo->prepare("SELECT estado, estado_modificado_por FROM reservas_alojamiento WHERE id = ?");
$st->execute([$pk]);
$trasAprobar = $st->fetch(PDO::FETCH_ASSOC);
$notifs = notificaciones($pdo, $pk);

proc_terminate($server);

// ---- Verificación ----------------------------------------------------------
$limiteCorto = date('d/m/Y', strtotime((string) $trasSubir['validacion_vence_at']));
$limiteLargo = date('d/m/Y H:i', strtotime((string) $trasSubir['validacion_vence_at']));

echo "\nReserva {$codigo}\n";
foreach ($notifs as $tipo => $n) {
    printf("  %-22s -> %-28s %-9s intentos=%d\n", $tipo, $n['destinatario'], $n['estado'], $n['intentos']);
}

$checks = [
    'tras subir queda en Comprobar' => ($trasSubir['estado'] ?? '') === 'Comprobar',
    'acuse al cliente' => isset($notifsSubida['comprobante_recibido'])
        && $notifsSubida['comprobante_recibido']['destinatario'] === 'yamiltolaba@gmail.com'
        && str_contains((string) $notifsSubida['comprobante_recibido']['cuerpo'], $limiteCorto),
    'aviso al admin con plazo' => isset($notifsSubida['pago_recibido'])
        && $notifsSubida['pago_recibido']['destinatario'] === $mailAdmin
        && str_contains((string) $notifsSubida['pago_recibido']['cuerpo'], $limiteLargo),
    'la aprobación confirma la reserva' => ($aprobar['success'] ?? false) === true
        && ($trasAprobar['estado'] ?? '') === 'Confirmado',
    'confirmación al cliente' => isset($notifs['confirmacion'])
        && $notifs['confirmacion']['destinatario'] === 'yamiltolaba@gmail.com',
    'aviso de validación al admin con el nombre' => isset($notifs['validacion_admin'])
        && $notifs['validacion_admin']['destinatario'] === $mailAdmin
        && str_contains((string) $notifs['validacion_admin']['cuerpo'], 'por admin'),
];

echo "\n";
$fallos = 0;
foreach ($checks as $nombre => $ok) {
    printf("[%s] %s\n", $ok ? 'PASS' : 'FAIL', $nombre);
    if (!$ok) {
        $fallos++;
    }
}

// ---- Limpieza --------------------------------------------------------------
$rutas = $pdo->prepare("SELECT ruta FROM comprobantes WHERE reserva_modalidad='alojamiento' AND reserva_pk = ?");
$rutas->execute([$pk]);
foreach ($rutas->fetchAll(PDO::FETCH_COLUMN) as $ruta) {
    @unlink($DIR . '/' . $ruta);
}
$pdo->prepare("DELETE FROM comprobantes WHERE reserva_modalidad='alojamiento' AND reserva_pk = ?")->execute([$pk]);
$pdo->prepare("DELETE FROM notificaciones_email WHERE reserva_modalidad='alojamiento' AND reserva_pk = ?")->execute([$pk]);
$pdo->prepare("DELETE FROM reservas_alojamiento WHERE id = ?")->execute([$pk]);
echo "\nReserva de prueba eliminada.\n";

exit($fallos > 0 ? 1 : 0);
