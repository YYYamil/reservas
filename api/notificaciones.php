<?php
declare(strict_types=1);

/**
 * Notificaciones por email: encolado (outbox), plantillas y worker de envío.
 *
 * Flujo (ver docs/MAQUINA-ESTADOS-RESERVAS.md):
 *   1. crear reserva              -> 'creacion'            al cliente (envío inmediato)
 *   2. barrido: vence el pago     -> 'vencimiento'         al cliente
 *   3. barrido: vence en < 12 h   -> 'recordatorio'        al cliente
 *   4. cliente sube comprobante   -> 'pago_recibido'       al admin
 *   5. admin aprueba (Comprobar)  -> 'confirmacion'        al cliente
 *   6. admin aprueba (Comprobar)  -> 'validacion_admin'    al admin (con el nombre de quien validó)
 *   7. admin rechaza (Comprobar)  -> 'rechazo'             al cliente (con el motivo)
 *   7. cliente cancela impaga     -> 'cancelacion_cliente' al cliente
 *   8. cliente cancela paga       -> 'devolucion'          al cliente (con el importe)
 *   9. admin anula una Pre-Reserva-> 'cancelacion'         al cliente
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
    ?array $config = null,
    array $extra = []
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
    if ($extra !== []) {
        $ctx = array_merge($ctx, $extra);
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
        $sql = "SELECT r.id, r.codigo_publico, r.id_reserva, r.institucion, r.responsable,
                       r.dni, r.contacto, r.email, r.cantidad, r.fecha_ingreso, r.hora_ingreso,
                       r.hora_egreso, r.estado, r.monto_total, r.pago_vence_at, r.created_at,
                       r.inicio_at, r.comprobado_at, r.confirmado_at, r.validacion_vence_at, r.motivo_cierre,
                       r.estado_modificado_por, r.estado_modificado_at,
                       r.devolucion_pct, r.devolucion_monto, r.devolucion_ejecutada_at, r.cancelado_at,
                       al.nombre AS albergue, al.monto_visita, al.monto_cama,
                       (SELECT c.motivo_rechazo FROM comprobantes c
                         WHERE c.reserva_modalidad = 'visita' AND c.reserva_pk = r.id
                           AND c.estado = 'rechazado'
                         ORDER BY c.revisado_at DESC NULLS LAST, c.id DESC LIMIT 1) AS motivo_rechazo
                FROM reservas_visitas r JOIN albergues al ON al.id = r.albergue_id
                WHERE r.id = ?";
    } else {
        $sql = "SELECT r.id, r.codigo_publico, r.id_reserva, r.institucion, r.responsable,
                       r.dni, r.contacto, r.email, r.cantidad, r.rango_fechas, r.estado,
                       r.monto_total, r.pago_vence_at, r.created_at,
                       r.inicio_at, r.comprobado_at, r.confirmado_at, r.validacion_vence_at, r.motivo_cierre,
                       r.estado_modificado_por, r.estado_modificado_at,
                       r.devolucion_pct, r.devolucion_monto, r.devolucion_ejecutada_at, r.cancelado_at,
                       al.nombre AS albergue, al.monto_visita, al.monto_cama,
                       (SELECT c.motivo_rechazo FROM comprobantes c
                         WHERE c.reserva_modalidad = 'alojamiento' AND c.reserva_pk = r.id
                           AND c.estado = 'rechazado'
                         ORDER BY c.revisado_at DESC NULLS LAST, c.id DESC LIMIT 1) AS motivo_rechazo
                FROM reservas_alojamiento r JOIN albergues al ON al.id = r.albergue_id
                WHERE r.id = ?";
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
    $filas[] = ['Modalidad', $esVis ? 'Visita diaria' : 'Alojamiento con estadía'];
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
    } else {
        $dias = array_values(array_filter(array_map('trim', explode(',', (string) ($r['rango_fechas'] ?? ''))), static fn ($d) => $d !== ''));
        sort($dias);
        $fechas = implode(' / ', array_map(static fn ($d) => fmtFecha($d), $dias));
        $filas[] = ['Fechas de alojamiento', $fechas];
        $filas[] = ['Noches', (string) count($dias)];
    }

    $filas[] = ['Monto total', formatoMonto($r['monto_total'] ?? 0)];

    $estado = (string) ($r['estado'] ?? '');

    if ($estado === 'Pre-Reserva' && !empty($r['pago_vence_at'])) {
        $filas[] = ['Vence el', fmtFecha((string) $r['pago_vence_at'])];
    }
    if (!empty($r['comprobado_at'])) {
        $filas[] = ['Comprobante subido', fmtFechaHora((string) $r['comprobado_at'])];
    }
    if (isset($r['devolucion_monto']) && $r['devolucion_monto'] !== null && (float) $r['devolucion_monto'] > 0) {
        $pct = isset($r['devolucion_pct']) && $r['devolucion_pct'] !== null ? (int) round((float) $r['devolucion_pct']) : 0;
        $filas[] = ['Devolución', ($pct > 0 ? $pct . '% · ' : '') . formatoMonto($r['devolucion_monto'])];
        if (!empty($r['devolucion_ejecutada_at'])) {
            $filas[] = ['Devolución realizada', fmtFechaHora((string) $r['devolucion_ejecutada_at'])];
        }
    }
    $filas[] = ['Estado', $estado];

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
            $venceTxt = !empty($r['pago_vence_at']) ? fmtFecha((string) $r['pago_vence_at']) : '';
            $nota   = $venceTxt !== ''
                ? 'Para confirmarla, subí el comprobante de pago antes del ' . $venceTxt . '. Vencido ese plazo la pre-reserva se cancela y el cupo se libera.'
                : 'Para confirmarla, subí el comprobante de pago dentro del plazo indicado. Vencido ese plazo la pre-reserva se cancela y el cupo se libera.';
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
            $asunto = "Comprobante para validar - Reserva {$codigo}";
            $intro  = 'El cliente subió el comprobante de pago de la reserva ' . $codigo
                . '. Tenés que validarlo desde el panel.';
            $limiteVal = !empty($r['validacion_vence_at'])
                ? fmtFechaHora((string) $r['validacion_vence_at'])
                : '';
            $nota = $limiteVal !== ''
                ? 'Fecha límite para aprobar o rechazar: ' . $limiteVal
                    . '. Si no se valida, la reserva queda en Comprobar y el cupo sigue retenido.'
                : 'Aprobá o rechazá el comprobante desde el panel. Mientras no se valide, la reserva queda en Comprobar y el cupo sigue retenido.';
            return [$asunto, $base('Comprobante para validar', $intro, $nota, null)];

        case 'comprobante_recibido':
            $asunto = "Comprobante recibido - Reserva {$codigo}";
            $intro  = 'Recibimos tu comprobante de pago. La administración del albergue lo va a verificar '
                . 'y te avisaremos cuando la reserva quede confirmada.';
            $limiteVis = !empty($r['validacion_vence_at'])
                ? fmtFecha((string) $r['validacion_vence_at'])
                : '';
            $nota = 'Tu reserva sigue reservada; no tenés que hacer nada más.'
                . ($limiteVis !== '' ? ' La revisión está prevista antes del ' . $limiteVis . '.' : '');
            return [$asunto, $base('Comprobante recibido', $intro, $nota, null)];

        case 'validacion_admin':
            $quien = trim((string) ($r['validado_por_nombre'] ?? ''));
            if ($quien === '') {
                $quien = trim((string) ($r['estado_modificado_por'] ?? ''));
            }
            $cuando = !empty($r['estado_modificado_at'])
                ? fmtFechaHora((string) $r['estado_modificado_at'])
                : '';
            $asunto = "Reserva {$codigo} validada - {$alb}";
            $intro  = 'El comprobante de pago de la reserva ' . $codigo . ' fue aprobado'
                . ($quien !== '' ? ' por ' . $quien : '')
                . ($cuando !== '' ? ' el ' . $cuando : '')
                . '. La reserva quedó confirmada y el cliente recibió el aviso.';
            $nota   = 'Podés ver el detalle en el panel de administración.';
            return [$asunto, $base('Reserva validada', $intro, $nota, null)];

        case 'vencimiento':
            $asunto = "Pre-reserva {$codigo} vencida - {$alb}";
            $intro  = 'La pre-reserva venció porque no se recibió el comprobante de pago dentro del plazo.';
            $nota   = 'El cupo fue liberado. Si todavía querés reservar, podés iniciar una nueva pre-reserva desde el sitio.';
            return [$asunto, $base('Pre-reserva vencida', $intro, $nota, null)];

        case 'rechazo':
            // El motivo lo escribe el operador: se le quita el punto final para
            // no duplicarlo si ya lo escribió.
            $motivo = rtrim(trim((string) ($r['motivo_rechazo'] ?? '')), ". \t\n\r\0\x0B");
            $asunto = "Comprobante rechazado - Reserva {$codigo}";
            $intro  = $motivo !== ''
                ? 'El comprobante de pago que subiste no pudo ser validado: ' . $motivo . '.'
                : 'El comprobante de pago que subiste no pudo ser validado.';
            $venceTxt = !empty($r['pago_vence_at']) ? fmtFecha((string) $r['pago_vence_at']) : '';
            $nota   = $venceTxt !== ''
                ? 'Tu pre-reserva volvió a estado Pre-Reserva. Tenés tiempo hasta el ' . $venceTxt . ' para subir un comprobante válido; si no, el cupo se libera.'
                : 'Tu pre-reserva volvió a estado Pre-Reserva, pero ya no queda tiempo para reintentar. El cupo será liberado.';
            $cta    = $linkPago !== '' ? ['texto' => 'Subir un nuevo comprobante', 'url' => $linkPago] : null;
            return [$asunto, $base('Comprobante rechazado', $intro, $nota, $cta)];

        case 'devolucion':
            $pct    = isset($r['devolucion_pct']) ? (int) round((float) $r['devolucion_pct']) : 0;
            $monto  = formatoMonto($r['devolucion_monto'] ?? 0);
            $asunto = "Reserva {$codigo} cancelada - devolución {$pct}%";
            $intro  = 'Registramos la cancelación de tu reserva. Corresponde una devolución del ' . $pct . '% ('
                . $monto . ') sobre el total abonado.';
            $nota   = 'La devolución se realiza por transferencia desde la administración del albergue en los días hábiles siguientes. El cupo ya fue liberado.';
            return [$asunto, $base('Reserva cancelada', $intro, $nota, null)];

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
 * Barrido de vencimientos y recordatorios.
 *
 * La lógica vive en reservas_estado.php (reservaBarrido): aplica la política
 * de tiempos vigente, usa LEAST(pago_vence_at, inicio_at - anticipacion) y
 * libera el cupo pasando la reserva a 'Vencido'. Se conserva este alias para
 * las llamadas existentes (endpoint tareasVencimiento / cron).
 */
function tareasVencimiento(PDO $pdo, ?array $config = null): array
{
    if (!function_exists('reservaBarrido')) {
        require_once __DIR__ . '/reservas_estado.php';
    }
    if ($config === null) {
        $config = require __DIR__ . '/config.php';
    }
    return reservaBarrido($pdo, $config);
}

