<?php
declare(strict_types=1);

/**
 * Verifica la conexión y autenticación SMTP SIN enviar ningún correo.
 * Uso: php api/tests/verificar_smtp.php
 *
 * Hace el handshake completo (EHLO -> STARTTLS -> AUTH LOGIN) y cierra
 * con QUIT. Sirve para confirmar que las credenciales de Resend siguen
 * siendo válidas antes de habilitar el envío inmediato.
 */

error_reporting(E_ALL & ~E_DEPRECATED);

$config = require __DIR__ . '/../config.php';

$host = (string) ($config['smtp_host'] ?? '');
$port = (int) ($config['smtp_port'] ?? 587);
$user = (string) ($config['smtp_user'] ?? '');
$pass = (string) ($config['smtp_pass'] ?? '');

printf("SMTP: %s:%d  usuario=%s\n", $host, $port, $user !== '' ? $user : '(vacío)');

if ($host === '' || $user === '' || $pass === '') {
    fwrite(STDERR, "Faltan smtp_host/smtp_user/smtp_pass en la configuración.\n");
    exit(1);
}

$inicio = microtime(true);
$fp = @stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 15);
if ($fp === false) {
    fwrite(STDERR, "No se pudo conectar: {$errstr} ({$errno})\n");
    exit(1);
}
stream_set_timeout($fp, 20);
printf("OK: conexión TCP en %.2fs\n", microtime(true) - $inicio);

$leer = static function ($fp): string {
    $lineas = '';
    while (($linea = fgets($fp, 1024)) !== false) {
        $lineas .= $linea;
        if (strlen($linea) < 4 || $linea[3] !== '-') {
            break;
        }
    }
    return $lineas;
};

$cmd = static function ($fp, string $comando, string $esperado) use ($leer): string {
    fwrite($fp, $comando . "\r\n");
    $resp = $leer($fp);
    if (!str_starts_with(trim($resp), $esperado)) {
        fwrite(STDERR, "Respuesta inesperada a '" . substr($comando, 0, 12) . "': {$resp}\n");
        exit(1);
    }
    return $resp;
};

$saludo = $leer($fp);
if (!str_starts_with(trim($saludo), '220')) {
    fwrite(STDERR, "Saludo SMTP inesperado: {$saludo}\n");
    exit(1);
}
echo "OK: saludo 220\n";

$cmd($fp, 'EHLO albergues.local', '250');
echo "OK: EHLO\n";

$cmd($fp, 'STARTTLS', '220');
if (@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT) !== true) {
    fwrite(STDERR, "Falló el handshake TLS.\n");
    exit(1);
}
echo "OK: STARTTLS\n";

$cmd($fp, 'EHLO albergues.local', '250');
$cmd($fp, 'AUTH LOGIN', '334');
$cmd($fp, base64_encode($user), '334');
$auth = $cmd($fp, base64_encode($pass), '235');
echo 'OK: autenticación aceptada (' . trim($auth) . ")\n";

$cmd($fp, 'QUIT', '221');
fclose($fp);

printf("Verificación SMTP completa en %.2fs (no se envió ningún correo)\n", microtime(true) - $inicio);
