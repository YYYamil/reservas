<?php
declare(strict_types=1);

/**
 * Envía un correo de muestra por cada evento del ciclo de vida de una reserva.
 *
 * Usa exactamente las mismas plantillas y el mismo Mailer que el sistema real,
 * con los datos de una reserva concreta (para que el detalle sea coherente).
 *
 * Uso:
 *   php api/tests/enviar_muestras_ciclo.php
 *       -> no envía nada: genera los HTML en api/tests/muestras/ciclo/ y lista los asuntos.
 *
 *   php api/tests/enviar_muestras_ciclo.php --enviar=yamiltolaba@gmail.com
 *       -> envía los 10 correos a esa dirección, con el prefijo [MUESTRA].
 *
 *   php api/tests/enviar_muestras_ciclo.php --codigo=R-000002 --enviar=...
 *       -> usa los datos de esa reserva como base.
 *
 *   php api/tests/enviar_muestras_ciclo.php --solo=rechazo --enviar=...
 *       -> envía solamente ese evento.
 */

require __DIR__ . '/../db.php';
require __DIR__ . '/../notificaciones.php';

$config = require __DIR__ . '/../config.php';
$pdo    = db();

$opts = [];
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([a-z-]+)=(.*)$/', $arg, $m)) {
        $opts[$m[1]] = $m[2];
    } elseif ($arg === '--help' || $arg === '-h') {
        echo "Uso: php api/tests/enviar_muestras_ciclo.php [--codigo=R-000002] [--enviar=correo@dominio]\n"
            . "       [--solo=evento] [--app-url=https://reservas.yamy.fun] [--prefijo=\"\"]\n";
        exit(0);
    }
}

$destino    = trim((string) ($opts['enviar'] ?? ''));
$codigo     = trim((string) ($opts['codigo'] ?? ''));
$solo       = trim((string) ($opts['solo'] ?? ''));
$appUrlOpt  = trim((string) ($opts['app-url'] ?? ''));
$prefijo    = $opts['prefijo'] ?? '[MUESTRA] ';
if ($destino !== '' && filter_var($destino, FILTER_VALIDATE_EMAIL) === false) {
    fwrite(STDERR, "Destinatario inválido: {$destino}\n");
    exit(1);
}

// ---------------------------------------------------------------- datos base
$sql = "SELECT r.codigo_publico, r.institucion, r.responsable, r.dni, r.contacto, r.email,
               r.cantidad, r.fecha_ingreso, r.hora_ingreso, r.hora_egreso, r.estado,
               r.monto_total, r.pago_vence_at, r.created_at, r.inicio_at,
               a.nombre AS albergue, a.monto_visita, a.monto_cama
          FROM reservas_visitas r
          JOIN albergues a ON a.id = r.albergue_id";
$params = [];
if ($codigo !== '') {
    $sql .= ' WHERE r.codigo_publico = ?';
    $params[] = $codigo;
}
$sql .= ' ORDER BY r.id DESC LIMIT 1';

$st = $pdo->prepare($sql);
$st->execute($params);
$base = $st->fetch(PDO::FETCH_ASSOC);

if ($base === false) {
    // Sin reservas en la base: contexto sintético con el mismo formato.
    $base = [
        'codigo_publico' => 'R-000123',
        'institucion'    => 'Escuela N° 12 "General San Martín"',
        'responsable'    => 'Ana Pérez',
        'dni'            => '30111222',
        'contacto'       => '3811234567',
        'email'          => 'ana.perez@example.com',
        'cantidad'       => 25,
        'fecha_ingreso'  => date('Y-m-d', strtotime('+30 days')),
        'hora_ingreso'   => '08:30',
        'hora_egreso'    => '18:00',
        'estado'         => 'Pre-Reserva',
        'monto_total'    => 50000,
        'pago_vence_at'  => date('Y-m-d H:i:s', strtotime('+2 days')),
        'created_at'     => date('Y-m-d H:i:s'),
        'inicio_at'      => date('Y-m-d H:i:s', strtotime('+30 days')),
        'albergue'       => 'Maestro José Fierro',
        'monto_visita'   => 2000,
        'monto_cama'     => 5000,
    ];
}

$base['modalidad']   = 'visita';
$base['rango_fechas'] = null;
$monto = (float) $base['monto_total'];
$appUrl = $appUrlOpt !== '' ? rtrim($appUrlOpt, '/') : appUrl($pdo, $config);

$ahora    = new DateTimeImmutable('now');
$vence48  = $ahora->modify('+48 hours')->format('Y-m-d H:i:sP');
$vence10  = $ahora->modify('+10 hours')->format('Y-m-d H:i:sP');
$vence24  = $ahora->modify('+24 hours')->format('Y-m-d H:i:sP');
$vencido  = $ahora->modify('-2 hours')->format('Y-m-d H:i:sP');
$comprAhora = $ahora->format('Y-m-d H:i:sP');

/**
 * Un caso por cada evento del ciclo de vida.
 * Cada uno ajusta el estado y los campos propios de ese momento.
 */
$casos = [
    'creacion' => [
        'titulo' => '1/10 · Pre-reserva creada',
        'ctx'    => ['estado' => 'Pre-Reserva', 'pago_vence_at' => $vence48],
    ],
    'recordatorio' => [
        'titulo' => '2/10 · Recordatorio de pago (vence en menos de 12 h)',
        'ctx'    => ['estado' => 'Pre-Reserva', 'pago_vence_at' => $vence10],
    ],
    'pago_recibido' => [
        'titulo' => '3/10 · Comprobante recibido (aviso al administrador)',
        'ctx'    => ['estado' => 'Comprobar', 'comprobado_at' => $comprAhora, 'pago_vence_at' => $vence48],
    ],
    'aviso_admin' => [
        'titulo' => '4/10 · Aviso de nueva pre-reserva (administrador)',
        'ctx'    => ['estado' => 'Pre-Reserva', 'pago_vence_at' => $vence48],
    ],
    'confirmacion' => [
        'titulo' => '5/10 · Reserva confirmada',
        'ctx'    => ['estado' => 'Confirmado', 'comprobado_at' => $comprAhora, 'pago_vence_at' => $vence48],
    ],
    'rechazo' => [
        'titulo' => '6/10 · Comprobante rechazado (vuelve a Pre-Reserva)',
        'ctx'    => [
            'estado' => 'Pre-Reserva',
            'pago_vence_at' => $vence24,
            'comprobado_at' => null,
            'motivo_rechazo' => 'El importe transferido no coincide con el total de la reserva.',
        ],
    ],
    'vencimiento' => [
        'titulo' => '7/10 · Pre-reserva vencida por falta de pago',
        'ctx'    => ['estado' => 'Vencido', 'pago_vence_at' => $vencido],
    ],
    'cancelacion_cliente' => [
        'titulo' => '8/10 · Cancelación del cliente (sin pago)',
        'ctx'    => ['estado' => 'Cancelado', 'cancelado_at' => $comprAhora],
    ],
    'cancelacion' => [
        'titulo' => '9/10 · Anulación desde la administración',
        'ctx'    => ['estado' => 'Cancelado', 'cancelado_at' => $comprAhora],
    ],
    'devolucion' => [
        'titulo' => '10/10 · Cancelación con devolución (100 %)',
        'ctx'    => [
            'estado' => 'Devolver',
            'cancelado_at' => $comprAhora,
            'devolucion_pct' => 100,
            'devolucion_monto' => $monto,
            'devolucion_calculada_at' => $comprAhora,
        ],
    ],
];

$dir = __DIR__ . '/muestras/ciclo';
if (!is_dir($dir)) {
    mkdir($dir, 0777, true);
}

echo "Base: reserva {$base['codigo_publico']} · {$base['albergue']} · {$base['institucion']}\n";
echo 'Enlaces: ' . ($appUrl !== '' ? $appUrl : '(app_url sin configurar)') . "\n";
echo $destino === ''
    ? "Modo: SOLO GENERAR (sin --enviar)\n\n"
    : "Modo: ENVIAR a {$destino}\n\n";

$mailer = $destino !== '' ? new Mailer($config) : null;
$enviados = 0;
$fallos = 0;
$procesados = 0;

foreach ($casos as $evento => $caso) {
    if ($solo !== '' && $solo !== $evento) {
        continue;
    }
    $procesados++;

    $ctx = array_merge($base, $caso['ctx']);
    [$asunto, $html] = plantillaCorreo($evento, $ctx, $appUrl);

    file_put_contents($dir . '/correo_' . $evento . '.html', $html);
    printf("[%s] %-62s %s\n", $evento === '' ? '' : '·', $caso['titulo'], $asunto);

    if ($mailer === null) {
        continue;
    }

    try {
        $msgId = $mailer->enviar($destino, $prefijo . $asunto, $html, textoDesdeHtml($html));
        $enviados++;
        printf("      enviado -> %s\n", trim(preg_replace('/\s+/', ' ', $msgId)));
    } catch (Throwable $e) {
        $fallos++;
        printf("      ERROR -> %s\n", $e->getMessage());
    }

    // Resend acepta ~2 solicitudes por segundo: se deja margen entre envíos.
    usleep(800000);
}

echo "\nHTML de muestra en api/tests/muestras/ciclo/\n";
if ($destino !== '') {
    printf("Resultado: %d enviados, %d fallidos (de %d)\n", $enviados, $fallos, $procesados);
}
exit($fallos > 0 ? 1 : 0);
