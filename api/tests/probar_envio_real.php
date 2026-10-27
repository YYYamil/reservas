<?php

declare(strict_types=1);

/*
 * Prueba de ENVÍO REAL de punta a punta.
 *
 * Crea una pre-reserva por HTTP contra el router real (api/index.php), deja que
 * el envío inmediato dispare el SMTP, y luego muestra el estado de la outbox
 * (estado, intentos, ultimo_error, proveedor_msg_id) para confirmar si el
 * proveedor aceptó el mensaje.
 *
 * Uso:
 *   php api/tests/probar_envio_real.php                        (destino por defecto)
 *   php api/tests/probar_envio_real.php otro@dominio.com
 *   php api/tests/probar_envio_real.php otro@dominio.com --limpiar
 *
 * --limpiar borra al final la reserva de prueba y su notificación.
 *
 * NO forma parte del smoke test: el smoke test apaga el envío inmediato a
 * propósito porque usa direcciones @example.com.
 */

if (PHP_SAPI !== 'cli') {
    exit("Este script solo se ejecuta por CLI.\n");
}

const DIR_PRUEBA = __DIR__ . '/../..';
const BASE_PRUEBA = 'http://127.0.0.1:8005/api/index.php';

$config = require DIR_PRUEBA . '/api/config.php';

$destino = 'yamiltolaba@gmail.com';
$limpiar = false;
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--limpiar') {
        $limpiar = true;
    } elseif (!str_starts_with($arg, '--')) {
        $destino = $arg;
    }
}

if (filter_var($destino, FILTER_VALIDATE_EMAIL) === false) {
    exit("Destino inválido: {$destino}\n");
}

function db(array $config): PDO
{
    $pdo = new PDO(
        'pgsql:host=' . $config['db_host'] . ';port=' . $config['db_port'] . ';dbname=' . $config['db_name'],
        $config['db_user'],
        $config['db_pass']
    );
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    return $pdo;
}

function post(string $action, array $params, int $timeout = 120): array
{
    $opts = ['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query($params),
        'timeout'       => $timeout,
        'ignore_errors' => true,
    ]];
    $body = @file_get_contents(BASE_PRUEBA . '?action=' . urlencode($action), false, stream_context_create($opts));
    $json = json_decode((string) $body, true);
    return is_array($json) ? $json : ['_raw' => (string) $body];
}

/** Compara un archivo de la BD usando LIKE de PDO con comodines. */
function trueFlag(PDO $pdo, string $clave): string
{
    $stmt = $pdo->prepare('SELECT valor FROM configuracion_sistema WHERE clave = ?');
    $stmt->execute([$clave]);
    $v = $stmt->fetchColumn();
    return $v === false ? '(ausente)' : (string) $v;
}

echo "=== PRUEBA DE ENVÍO REAL ===\n";
echo 'Destino: ' . $destino . "\n";
echo 'Envío inmediato (config): ' . var_export($config['notif_envio_inmediato'] ?? null, true) . "\n";
echo 'Aviso al admin (config):  ' . var_export($config['notif_enviar_admin'] ?? null, true) . "\n\n";

$pdo = db($config);
echo "Flags en configuracion_sistema:\n";
foreach (['notif_envio_inmediato', 'notif_enviar_admin', 'mail_admin'] as $clave) {
    echo '  ' . $clave . ' = ' . trueFlag($pdo, $clave) . "\n";
}
echo "\n";

// ---------- Levantar el servidor del router real ----------
$srvLog = tempnam(sys_get_temp_dir(), 'enviosrv_') . '.log';
$server = proc_open(
    [PHP_BINARY, '-S', '127.0.0.1:8005', '-t', DIR_PRUEBA],
    [1 => ['file', $srvLog, 'w'], 2 => ['file', $srvLog, 'a']],
    $pipes,
    DIR_PRUEBA
);
$pid = is_resource($server) ? proc_get_status($server)['pid'] : 0;

$salida = 1;
try {
    $vivo = false;
    for ($i = 0; $i < 25; $i++) {
        usleep(300000);
        $probe = @file_get_contents(BASE_PRUEBA . '?action=listarAlbergues');
        if ($probe !== false && str_contains((string) $probe, 'success')) {
            $vivo = true;
            break;
        }
    }

    if (!$vivo) {
        echo "ERROR: el servidor local no respondió en " . BASE_PRUEBA . "\n";
        echo "--- log del servidor ---\n" . (string) @file_get_contents($srvLog) . "\n";
    } else {
        echo 'Servidor local OK en ' . BASE_PRUEBA . "\n\n";

        // ---------- Crear la pre-reserva (dispara el envío inmediato) ----------
        $fecha = date('Y-m-d', strtotime('+45 days'));
        echo "Creando pre-reserva de visita para {$fecha} ...\n";
        $t0 = microtime(true);
        $resp = post('crearReserva', [
            'albergue'     => 'Maestro José Fierro',
            'institucion'  => 'PRUEBA ENVIO REAL',
            'responsable'  => 'Prueba Envio',
            'dni'          => '30999888',
            'contacto'     => '3815550000',
            'email'        => $destino,
            'cantidad'     => 4,
            'fechaIngreso' => $fecha,
            'horaIngreso'  => '09:00',
            'horaEgreso'   => '17:00'
        ], 120);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        echo 'Respuesta (' . $ms . ' ms): ' . json_encode($resp, JSON_UNESCAPED_UNICODE) . "\n\n";

        $codigo = (string) ($resp['codigoPublico'] ?? $resp['codigo_publico'] ?? '');
        if ($codigo === '') {
            echo "ERROR: no se obtuvo código público.\n";
        } else {
            $stmt = $pdo->prepare('SELECT id FROM reservas_visitas WHERE codigo_publico = ?');
            $stmt->execute([$codigo]);
            $pk = (int) $stmt->fetchColumn();

            $stmt = $pdo->prepare(
                'SELECT id, tipo_evento, destinatario, destinatario_tipo, estado, intentos,
                        proveedor_msg_id, ultimo_error
                   FROM notificaciones_email
                  WHERE reserva_modalidad = ? AND reserva_pk = ?
                  ORDER BY id'
            );
            $stmt->execute(['visita', $pk]);
            $filas = $stmt->fetchAll(PDO::FETCH_ASSOC);

            echo "Outbox para {$codigo} (pk={$pk}):\n";
            if ($filas === []) {
                echo "  (sin registros)\n";
            }
            $entregado = false;
            foreach ($filas as $f) {
                echo sprintf(
                    "  #%d %-14s -> %-30s [%s] intentos=%d msg_id=%s error=%s\n",
                    $f['id'],
                    $f['tipo_evento'],
                    $f['destinatario'],
                    $f['estado'],
                    $f['intentos'],
                    $f['proveedor_msg_id'] ?: '-',
                    $f['ultimo_error'] ?: '-'
                );
                if ($f['destinatario_tipo'] === 'cliente'
                    && $f['tipo_evento'] === 'creacion'
                    && $f['estado'] === 'enviado') {
                    $entregado = true;
                }
            }

            echo "\n";
            if ($entregado) {
                echo "RESULTADO: OK - el proveedor SMTP aceptó el correo para {$destino}.\n";
                echo "Revisá la bandeja de entrada y la carpeta de spam.\n";
                $salida = 0;
            } else {
                echo "RESULTADO: el correo al cliente NO quedó como 'enviado'.\n";
                echo "Revisá 'ultimo_error' arriba y los flags de configuracion_sistema.\n";
            }

            if ($limpiar) {
                echo "\nLimpiando la reserva de prueba {$codigo} ...\n";
                $pdo->beginTransaction();
                $pdo->prepare('DELETE FROM notificaciones_email WHERE reserva_modalidad = ? AND reserva_pk = ?')
                    ->execute(['visita', $pk]);
                $pdo->prepare('DELETE FROM reservas_visitas WHERE id = ?')->execute([$pk]);
                $pdo->commit();
                echo "Reserva de prueba eliminada.\n";
            } elseif ($salida === 0) {
                echo "\nLa reserva {$codigo} quedó en la BD. Para borrarla:\n";
                echo '  php api/tests/probar_envio_real.php ' . $destino . " --limpiar\n";
            }
        }
    }
} finally {
    if ($pid > 0) {
        @exec('taskkill /F /PID ' . $pid . ' >NUL 2>NUL');
    }
}

exit($salida);
