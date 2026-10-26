<?php
declare(strict_types=1);

/**
 * Notificaciones por email: encolado (outbox), plantillas y worker de envío.
 *
 * Flujo:
 *   1. crear reserva            -> 'creacion'            al cliente (envío inmediato)
 *   2. cliente cancela          -> 'cancelacion_cliente' al cliente (envío inmediato)
 *   3. cron día 6               -> 'recordatorio'        al cliente
 *   4. cron día 7               -> cancelar + 'cancelacion'
 *   5. cliente sube comprobante -> 'pago_recibido'       al admin
 *   6. admin pasa a Confirmado  -> 'confirmacion'        al cliente (envío inmediato)
 *   7. admin cancela            -> 'cancelacion'         al cliente (envío inmediato)
 *
 * Todos los correos incluyen el detalle completo de la reserva (código, albergue,
 * institución, responsable, fechas, cantidad, monto, vencimiento y estado).
 *
 * El envío inmediato se intenta en el mismo request; si SMTP falla el registro
 * queda 'pendiente' y el worker `procesarNotificaciones()` lo reintenta.
 * Se puede desactivar por configuración (`notif_envio_inmediato`), en cuyo caso
 * todo se encola y el cron se encarga del envío.
 */

require_once __DIR__ . '/mailer.php';

/** Lee una clave de configuracion_sistema (con valor por defecto). */
function configSistema(PDO $pdo, string $clave, string $default = ''): string
{
    try {
        $stmt = $pdo->prepare('SELECT valor FROM configuracion_sistema WHERE clave = ?');
        $stmt->execute([$clave]);
        $v = $stmt->fetchColumn();
        return $v === false || $v === null ? $default : (string) $v;
    } catch (Throwable $e) {
        return $default;
    }
}

/** Formatea un monto en pesos argentinos. */
function formatoMonto($monto): string
{
    return '$' . number_format((float) $monto, 0, ',', '.');
}

/** Escapa texto para incrustarlo en el HTML del correo. */
function h($valor): string
{
    return htmlspecialchars((string) $valor, ENT_QUOTES, 'UTF-8');
}

/** Fecha ISO (Y-m-d) -> dd/mm/aaaa. Devuelve el original si no parsea. */
function fmtFecha(?string $fecha): string
{
    if ($fecha === null || trim($fecha) === '') {
        return '';
    }
    $ts = strtotime($fecha);
    return $ts === false ? (string) $fecha : date('d/m/Y', $ts);
}

/** Timestamp completo -> dd/mm/aaaa hh:mm. */
function fmtFechaHora(?string $fecha): string
{
    if ($fecha === null || trim($fecha) === '') {
        return '';
    }
    $ts = strtotime($fecha);
    return $ts === false ? (string) $fecha : date('d/m/Y H:i', $ts);
}

/**
 * URL pública del sitio (para los enlaces del correo).
 * Prioridad: config 'app_url' -> configuracion_sistema.app_url -> host actual.
 */
function appUrl(PDO $pdo, array $config = []): string
{
    $url = trim((string) ($config['app_url'] ?? ''));
    if ($url === '') {
        $url = trim(configSistema($pdo, 'app_url'));
    }
    if ($url === '' && !empty($_SERVER['HTTP_HOST'])) {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        $dir = str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')));
        $dir = rtrim($dir, '/');
        if (str_ends_with($dir, '/api')) {
            $dir = substr($dir, 0, -4);
        }
        if ($dir === '.' || $dir === '/') {
            $dir = '';
        }
        $url = ($https ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . $dir;
    }
    return rtrim($url, '/');
}

/** Indica si la tabla de reservas ya tiene las columnas de cancelación. */
function soportaColumnasCancelacion(PDO $pdo, string $tabla): bool
{
    static $cache = [];
    if (array_key_exists($tabla, $cache)) {
        return $cache[$tabla];
    }
    try {
        $stmt = $pdo->prepare(
            "SELECT 1 FROM information_schema.columns
              WHERE table_name = ? AND column_name = 'cancelado_at' LIMIT 1"
        );
        $stmt->execute([$tabla]);
        $cache[$tabla] = $stmt->fetchColumn() !== false;
    } catch (Throwable $e) {
        $cache[$tabla] = false;
    }
    return $cache[$tabla];
}

/**
 * Marca una reserva como cancelada, registrando fecha y origen cuando el
 * esquema lo permite (migración 2026-10-26).
 */
function marcarCancelada(PDO $pdo, string $tabla, int $pk, string $origen): void
{
    if (soportaColumnasCancelacion($pdo, $tabla)) {
        $pdo->prepare(
            "UPDATE {$tabla}
                SET estado = 'Cancelado', cancelado_at = NOW(), cancelado_origen = ?
              WHERE id = ?"
        )->execute([$origen, $pk]);
        return;
    }
    $pdo->prepare("UPDATE {$tabla} SET estado = 'Cancelado' WHERE id = ?")->execute([$pk]);
}

/**
 * Encola una notificación (idempotente por reserva+evento+destinatario).
 * Recalcula asunto/cuerpo al vuelo con los datos actuales de la reserva.
 * Devuelve el id del registro encolado o null si no se pudo encolar.
 */
function encolarNotificacion(
    PDO $pdo,
    string $modalidad,
    int $reservaPk,
    string $tipoEvento,
    string $destinatario,
    string $destinatarioTipo = 'cliente',
    ?DateTimeInterface $programadoPara = null,
    ?array $config = null
): ?int {
    if (!in_array($modalidad, ['visita', 'alojamiento'], true)) {
        throw new InvalidArgumentException('Modalidad inválida');
    }
    if (filter_var($destinatario, FILTER_VALIDATE_EMAIL) === false) {
        return null; // sin email válido no se encola
    }

    $ctx = datosReserva($pdo, $modalidad, $reservaPk);
    if ($ctx === null) {
        return null;
    }
    [$asunto, $html] = plantillaCorreo($tipoEvento, $ctx, appUrl($pdo, $config ?? []));

    $sql = 'INSERT INTO notificaciones_email
                (reserva_modalidad, reserva_pk, destinatario, destinatario_tipo, tipo_evento,
                 estado, asunto, cuerpo, programado_para)
            VALUES (?, ?, ?, ?, ?, \'pendiente\', ?, ?, ?)
            ON CONFLICT (reserva_modalidad, reserva_pk, tipo_evento, destinatario)
            DO UPDATE SET estado = \'pendiente\', asunto = EXCLUDED.asunto,
                          cuerpo = EXCLUDED.cuerpo, programado_para = EXCLUDED.programado_para,
                          intentos = 0, ultimo_error = NULL, updated_at = NOW()
            RETURNING id';

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            $modalidad,
            $reservaPk,
            $destinatario,
            $destinatarioTipo,
            $tipoEvento,
            $asunto,
            $html,
            $programadoPara ? $programadoPara->format('Y-m-d H:i:sP') : null,
        ]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : (int) $id;
    } catch (PDOException $e) {
        // Compatibilidad: si la base todavía no tiene el tipo 'cancelacion_cliente'
        // en el CHECK de tipo_evento, se degrada al evento 'cancelacion' para no
        // perder el aviso al usuario final.
        if ($tipoEvento === 'cancelacion_cliente' && str_contains($e->getMessage(), 'tipo_evento')) {
            return encolarNotificacion($pdo, $modalidad, $reservaPk, 'cancelacion', $destinatario, $destinatarioTipo, $programadoPara, $config);
        }
        throw $e;
    }
}

/** Reúne los datos necesarios de una reserva para las plantillas. */
function datosReserva(PDO $pdo, string $modalidad, int $reservaPk): ?array
{
    if ($modalidad === 'visita') {
        $sql = 'SELECT r.id, r.codigo_publico, r.id_reserva, r.institucion, r.responsable,
                       r.dni, r.contacto, r.email, r.cantidad, r.fecha_ingreso, r.hora_ingreso,
                       r.hora_egreso, r.pernocta, r.estado, r.monto_total, r.pago_vence_at, r.created_at,
                       al.nombre AS albergue, al.monto_visita, al.monto_cama
                FROM reservas_visitas r JOIN albergues al ON al.id = r.albergue_id
                WHERE r.id = ?';
    } else {
        $sql = 'SELECT r.id, r.codigo_publico, r.id_reserva, r.institucion, r.responsable,
                       r.dni, r.contacto, r.email, r.cantidad, r.rango_fechas, r.estado,
                       r.monto_total, r.pago_vence_at, r.created_at,
                       al.nombre AS albergue, al.monto_visita, al.monto_cama
                FROM reservas_alojamiento r JOIN albergues al ON al.id = r.albergue_id
                WHERE r.id = ?';
    }
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$reservaPk]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        return null;
    }
    $row['modalidad'] = $modalidad;
    return $row;
}

/**
 * Arma las filas [etiqueta, valor] con el detalle de la reserva que se incluye
 * en todos los correos.
 */
function detalleReserva(array $r): array
{
    $esVis = ($r['modalidad'] ?? '') === 'visita';
    $filas = [];

    $filas[] = ['Código de reserva', (string) ($r['codigo_publico'] ?? '')];
    $filas[] = ['Albergue', (string) ($r['albergue'] ?? '')];
    $filas[] = ['Modalidad', $esVis ? 'Visita diaria' : 'Alojamiento con pernocta'];
    $filas[] = ['Institución', (string) ($r['institucion'] ?? '')];
    $filas[] = ['Responsable', (string) ($r['responsable'] ?? '')];

    if (!empty($r['dni'])) {
        $filas[] = ['DNI', (string) $r['dni']];
    }
    if (!empty($r['contacto'])) {
        $filas[] = ['Teléfono', (string) $r['contacto']];
    }
    if (!empty($r['email'])) {
        $filas[] = ['Email', (string) $r['email']];
    }

    $filas[] = ['Cantidad de personas', (string) (int) ($r['cantidad'] ?? 0)];

    if ($esVis) {
        $filas[] = ['Fecha de ingreso', fmtFecha($r['fecha_ingreso'] ?? '')];
        if (!empty($r['hora_ingreso'])) {
            $filas[] = ['Hora de ingreso', (string) $r['hora_ingreso']];
        }
        if (!empty($r['hora_egreso'])) {
            $filas[] = ['Hora de egreso', (string) $r['hora_egreso']];
        }
        if (!empty($r['pernocta'])) {
            $filas[] = ['Pernocta', $r['pernocta'] === 'Sí' ? 'Sí (se quedan a dormir)' : 'No'];
        }
    } else {
        $dias = array_values(array_filter(array_map('trim', explode(',', (string) ($r['rango_fechas'] ?? ''))), static fn ($d) => $d !== ''));
        sort($dias);
        $fechas = implode(' / ', array_map(static fn ($d) => fmtFecha($d), $dias));
        $filas[] = ['Fechas de alojamiento', $fechas];
        $filas[] = ['Noches', (string) count($dias)];
    }

    $filas[] = ['Monto total', formatoMonto($r['monto_total'] ?? 0)];

    if (!empty($r['pago_vence_at'])) {
        $filas[] = ['Vence el', fmtFecha((string) $r['pago_vence_at'])];
    }
    $filas[] = ['Estado', (string) ($r['estado'] ?? '')];

    if (!empty($r['created_at'])) {
        $filas[] = ['Pre-reserva registrada', fmtFechaHora((string) $r['created_at'])];
    }

    return $filas;
}

/** Genera [asunto, html] para un tipo de evento. */
function plantillaCorreo(string $tipoEvento, array $r, string $appUrl = ''): array
{
    $alb    = (string) ($r['albergue'] ?? '');
    $codigo = (string) ($r['codigo_publico'] ?? '');
    $filas  = detalleReserva($r);
    $base   = correoBase($filas, $appUrl);

    $linkPago = $appUrl !== ''
        ? $appUrl . '/pago.html' . ($codigo !== '' ? '?codigo=' . rawurlencode($codigo) : '')
        : '';

    switch ($tipoEvento) {
        case 'creacion':
            $asunto = "Pre-reserva {$codigo} recibida - {$alb}";
            $intro  = 'Recibimos tu pre-reserva. Este es el detalle registrado:';
            $nota   = 'Para confirmarla, realizá el pago dentro de los próximos 7 días y subí el comprobante. Vencido ese plazo la pre-reserva se cancela y el cupo se libera.';
            $cta    = $linkPago !== '' ? ['texto' => 'Subir comprobante de pago', 'url' => $linkPago] : null;
            return [$asunto, $base('Detalle de tu pre-reserva', $intro, $nota, $cta)];

        case 'recordatorio':
            $asunto = "Recordatorio de pago - Pre-reserva {$codigo}";
            $intro  = 'Tu pre-reserva está por vencer. Este es el detalle:';
            $nota   = 'Tenés hasta el ' . fmtFecha((string) ($r['pago_vence_at'] ?? '')) . ' para realizar el pago; de lo contrario se cancelará y se liberará el cupo.';
            $cta    = $linkPago !== '' ? ['texto' => 'Subir comprobante de pago', 'url' => $linkPago] : null;
            return [$asunto, $base('Recordatorio de pago', $intro, $nota, $cta)];

        case 'confirmacion':
            $asunto = "Reserva {$codigo} CONFIRMADA - {$alb}";
            $intro  = 'Verificamos tu comprobante de pago y tu reserva quedó confirmada. ¡Te esperamos!';
            $nota   = 'Presentate con el código de reserva y el DNI del responsable. Ante cualquier duda comunicate al (0381) 452-6408.';
            return [$asunto, $base('Reserva confirmada', $intro, $nota, null)];

        case 'cancelacion_cliente':
            $asunto = "Pre-reserva {$codigo} cancelada - {$alb}";
            $intro  = 'Registramos la cancelación de tu pre-reserva. A continuación el detalle de la reserva cancelada:';
            $nota   = 'El cupo fue liberado. Si la cancelación no fue solicitada por vos, comunicate de inmediato al (0381) 452-6408.';
            return [$asunto, $base('Pre-reserva cancelada', $intro, $nota, null)];

        case 'cancelacion':
            $asunto = "Pre-reserva {$codigo} cancelada - {$alb}";
            $intro  = 'Tu pre-reserva quedó cancelada. Este es el detalle:';
            $nota   = 'El cupo fue liberado. Si querés volver a reservar, podés iniciar una nueva pre-reserva desde el sitio. Ante dudas comunicate al (0381) 452-6408.';
            return [$asunto, $base('Pre-reserva cancelada', $intro, $nota, null)];

        case 'pago_recibido':
            $asunto = "Comprobante de pago recibido - Reserva {$codigo}";
            $intro  = 'Se recibió un comprobante de pago para la reserva ' . $codigo . '. Revisá el panel para verificarlo y confirmar la reserva.';
            $nota   = 'Cuando lo verifiques, cambiá el estado de la reserva a "Confirmado" desde el panel: el usuario recibirá el aviso automáticamente.';
            return [$asunto, $base('Comprobante recibido', $intro, $nota, null)];

        case 'aviso_admin':
            $asunto = "Nueva pre-reserva {$codigo} - {$alb}";
            $intro  = 'Se registró una nueva pre-reserva. Detalle para seguimiento:';
            $nota   = 'Recordá verificar el comprobante de pago cuando el usuario lo suba.';
            return [$asunto, $base('Aviso al administrador', $intro, $nota, null)];

        default:
            throw new InvalidArgumentException('Tipo de evento desconocido: ' . $tipoEvento);
    }
}

/**
 * Devuelve un closure que arma el HTML final del correo con el bloque de detalle.
 *
 * @param array<int, array{0:string,1:string}> $filas
 */
function correoBase(array $filas, string $appUrl = ''): callable
{
    $htmlFilas = '';
    foreach ($filas as $fila) {
        [$etiqueta, $valor] = $fila;
        if ((string) $valor === '') {
            continue;
        }
        $destacar = in_array($etiqueta, ['Código de reserva', 'Monto total'], true);
        $estilo   = $destacar
            ? 'padding:6px 0;text-align:right;font-weight:700;color:#005CA2'
            : 'padding:6px 0;text-align:right';
        $htmlFilas .= '<tr><td style="padding:6px 0;color:#64748b;vertical-align:top">' . h($etiqueta) . '</td>'
            . '<td style="' . $estilo . '">' . h($valor) . '</td></tr>';
    }

    return function (string $titulo, string $intro, string $nota = '', ?array $cta = null) use ($htmlFilas): string {
        $htmlNota = $nota !== ''
            ? '<p style="margin:16px 0 0;line-height:1.5;color:#334155;background:#f1f5f9;border-radius:6px;padding:12px">' . h($nota) . '</p>'
            : '';
        $htmlCta = '';
        if ($cta !== null && ($cta['url'] ?? '') !== '') {
            $htmlCta = '<p style="margin:20px 0 0;text-align:center">'
                . '<a href="' . h((string) $cta['url']) . '" style="display:inline-block;background:#005CA2;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">'
                . h((string) ($cta['texto'] ?? 'Ver detalle')) . '</a></p>';
        }

        return <<<HTML
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a">
  <div style="background:#005CA2;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">Albergues Tucumán</h2>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <h3 style="margin:0 0 12px;font-size:16px">{$titulo}</h3>
    <p style="margin:0;line-height:1.5;color:#334155">{$intro}</p>
    <table style="width:100%;margin-top:16px;border-collapse:collapse;font-size:14px">
      {$htmlFilas}
    </table>
    {$htmlNota}
    {$htmlCta}
    <p style="margin-top:20px;font-size:12px;color:#94a3b8">Este es un mensaje automático, no responda a este correo.</p>
  </div>
</div>
HTML;
    };
}

/** Convierte el HTML del correo en una versión de texto plano. */
function textoDesdeHtml(string $html): string
{
    $t = preg_replace(['/<br\s*\/?>/i', '/<\/p>/i', '/<\/tr>/i', '/<\/h[1-6]>/i'], "\n", $html);
    $t = strip_tags($t);
    $t = html_entity_decode($t, ENT_QUOTES, 'UTF-8');
    return trim(preg_replace('/\n{3,}/', "\n\n", $t));
}

/** Indica si el envío inmediato está habilitado (config + base de datos). */
function envioInmediatoHabilitado(PDO $pdo, array $config): bool
{
    if (($config['notif_envio_inmediato'] ?? false) !== true) {
        return false;
    }
    return configSistema($pdo, 'notif_envio_inmediato', '1') !== '0';
}

/**
 * Indica si se envían copias al mail del administrador.
 *
 * Por defecto es false: todas las notificaciones van al usuario final (el mail
 * cargado en el formulario de la reserva). El aviso al admin solo se envía si
 * se habilita explícitamente con 'notif_enviar_admin' => true y existe
 * configuracion_sistema.mail_admin.
 */
function avisoAdminHabilitado(PDO $pdo, array $config): bool
{
    if (($config['notif_enviar_admin'] ?? false) !== true) {
        return false;
    }
    return configSistema($pdo, 'notif_enviar_admin', '0') === '1';
}

/**
 * Envía un registro concreto de la outbox.
 * Devuelve 'enviado' | 'error' | 'no_existe'.
 */
function enviarNotificacion(PDO $pdo, array $config, int $id): string
{
    $stmt = $pdo->prepare('SELECT * FROM notificaciones_email WHERE id = ?');
    $stmt->execute([$id]);
    $n = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($n === false) {
        return 'no_existe';
    }

    $pdo->prepare(
        "UPDATE notificaciones_email
            SET estado = 'enviando', intentos = intentos + 1, updated_at = NOW()
          WHERE id = ?"
    )->execute([$id]);

    try {
        $mailer = new Mailer($config);
        $msgId  = $mailer->enviar(
            (string) $n['destinatario'],
            (string) $n['asunto'],
            (string) $n['cuerpo'],
            textoDesdeHtml((string) $n['cuerpo'])
        );
        $pdo->prepare(
            "UPDATE notificaciones_email
                SET estado = 'enviado', enviado_at = NOW(), proveedor_msg_id = ?,
                    ultimo_error = NULL, updated_at = NOW()
              WHERE id = ?"
        )->execute([$msgId, $id]);
        return 'enviado';
    } catch (Throwable $e) {
        $intentos = (int) $n['intentos'] + 1;
        $nuevo    = $intentos >= 5 ? 'fallido' : 'pendiente';
        $pdo->prepare(
            "UPDATE notificaciones_email
                SET estado = ?, ultimo_error = ?, updated_at = NOW()
              WHERE id = ?"
        )->execute([$nuevo, substr($e->getMessage(), 0, 500), $id]);
        return 'error';
    }
}

/**
 * Encola un evento y, si está habilitado, intenta enviarlo en el acto.
 * Devuelve 'enviado' | 'encolado' | 'error' | 'omitido'.
 */
function notificar(
    PDO $pdo,
    array $config,
    string $modalidad,
    int $reservaPk,
    string $tipoEvento,
    string $destinatario,
    string $destinatarioTipo = 'cliente',
    bool $inmediato = true
): string {
    $id = encolarNotificacion($pdo, $modalidad, $reservaPk, $tipoEvento, $destinatario, $destinatarioTipo, null, $config);
    if ($id === null) {
        return 'omitido';
    }
    if (!$inmediato || !envioInmediatoHabilitado($pdo, $config)) {
        return 'encolado';
    }
    return enviarNotificacion($pdo, $config, $id);
}

/**
 * Intenta enviar en el acto una lista de notificaciones recién encoladas.
 * Se llama SIEMPRE después del commit: si el envío falla la notificación
 * queda 'pendiente'/'fallido' en la outbox y el cron la reintenta.
 */
function enviarNotificacionesInmediatas(PDO $pdo, array $config, array $ids): void
{
    $ids = array_values(array_filter(array_map('intval', $ids)));
    if ($ids === [] || !envioInmediatoHabilitado($pdo, $config)) {
        return;
    }
    foreach ($ids as $id) {
        try {
            enviarNotificacion($pdo, $config, $id);
        } catch (Throwable $e) {
            error_log('[med_albergues][notif] ' . $e->getMessage() . ' (id ' . $id . ')');
        }
    }
}

/**
 * Worker: envía las notificaciones pendientes.
 * Devuelve ['enviados' => n, 'fallidos' => n].
 */
function procesarNotificaciones(PDO $pdo, array $config, int $limite = 50): array
{
    $stmt = $pdo->prepare(
        "SELECT * FROM notificaciones_email
          WHERE estado = 'pendiente'
            AND (programado_para IS NULL OR programado_para <= NOW())
          ORDER BY created_at
          LIMIT ?"
    );
    $stmt->bindValue(1, $limite, PDO::PARAM_INT);
    $stmt->execute();
    $pendientes = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $enviados = 0;
    $fallidos = 0;

    foreach ($pendientes as $n) {
        $r = enviarNotificacion($pdo, $config, (int) $n['id']);
        if ($r === 'enviado') {
            $enviados++;
        } elseif ($r === 'error') {
            $fallidos++;
        }
    }

    return ['enviados' => $enviados, 'fallidos' => $fallidos];
}

/**
 * Tarea cron diaria:
 *  - día 6: encola recordatorio.
 *  - día 7+: cancela pre-reservas vencidas y encola cancelación.
 * Devuelve contadores.
 */
function tareasVencimiento(PDO $pdo): array
{
    $recordatorios = 0;
    $canceladas = 0;

    foreach (['visita' => 'reservas_visitas', 'alojamiento' => 'reservas_alojamiento'] as $modalidad => $tabla) {
        // Recordatorio: pre-reservas que vencen en <= 1 día y sin recordatorio aún
        $stmt = $pdo->prepare(
            "SELECT r.id, r.email FROM {$tabla} r
              WHERE r.estado = 'Pre-Reserva'
                AND r.pago_vence_at IS NOT NULL
                AND r.pago_vence_at <= NOW() + INTERVAL '1 day'
                AND r.pago_vence_at > NOW()
                AND NOT EXISTS (
                    SELECT 1 FROM notificaciones_email n
                     WHERE n.reserva_modalidad = ? AND n.reserva_pk = r.id AND n.tipo_evento = 'recordatorio'
                )"
        );
        $stmt->execute([$modalidad]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            encolarNotificacion($pdo, $modalidad, (int) $r['id'], 'recordatorio', (string) $r['email']);
            $recordatorios++;
        }

        // Cancelación: pre-reservas ya vencidas
        $stmt = $pdo->prepare(
            "SELECT r.id, r.email FROM {$tabla} r
              WHERE r.estado = 'Pre-Reserva'
                AND r.pago_vence_at IS NOT NULL
                AND r.pago_vence_at < NOW()"
        );
        $stmt->execute();
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (soportaColumnasCancelacion($pdo, $tabla)) {
                $pdo->prepare(
                    "UPDATE {$tabla}
                        SET estado = 'Cancelado', estado_origen = 'auto-vencimiento',
                            estado_modificado_at = NOW(), cancelado_at = NOW(),
                            cancelado_origen = 'auto-vencimiento'
                      WHERE id = ?"
                )->execute([$r['id']]);
            } else {
                $pdo->prepare(
                    "UPDATE {$tabla}
                        SET estado = 'Cancelado', estado_origen = 'auto-vencimiento',
                            estado_modificado_at = NOW()
                      WHERE id = ?"
                )->execute([$r['id']]);
            }
            encolarNotificacion($pdo, $modalidad, (int) $r['id'], 'cancelacion', (string) $r['email']);
            $canceladas++;
        }
    }

    return ['recordatorios' => $recordatorios, 'canceladas' => $canceladas];
}
