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
 * Identidad visual (tokens del sistema v2, ver v2/assets/css/tokens.css):
 * fondo marfil, cabecera con el escudo de la UNT, caja blanca de 600 px,
 * acento terracota y tono semántico por tipo de evento (verde/ámbar/rojo/arena).
 * Las imágenes se sirven desde Img/brand/ por URL absoluta: el mailer no
 * adjunta archivos, así que ese directorio tiene que estar publicado en el
 * sitio para que el logo aparezca.
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
    [$asunto, $html] = plantillaCorreo($tipoEvento, $ctx, appUrl($pdo, $config ?? []), $pdo);

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

/** Paleta semántica de los correos (tokens del sistema visual v2).
 *
 * Cada tono trae fondo, borde y texto: se usa en la caja de nota, en el
 * eyebrow y en el chip de estado. Los valores están verificados contra
 * WCAG AA sobre fondo claro. */
function tonoCorreo(string $tono): array
{
    $tonos = [
        'ok'      => ['bg' => '#e1eadf', 'borde' => '#c7d8c8', 'texto' => '#1f4530'],
        'alerta'  => ['bg' => '#f6e9d2', 'borde' => '#e4d2ab', 'texto' => '#7e5219'],
        'peligro' => ['bg' => '#f5dfd8', 'borde' => '#e3c3b8', 'texto' => '#7a3024'],
        'info'    => ['bg' => '#f6f0e5', 'borde' => '#e9e1d3', 'texto' => '#4c463d'],
    ];
    return $tonos[$tono] ?? $tonos['info'];
}

/**
 * Chip de estado [texto visible, tono] según el estado de la reserva.
 * 'Devolver' es un estado interno: al usuario se le muestra como
 * "Devolución pendiente". Devuelve null si no hay estado.
 */
function chipEstado(string $estado): ?array
{
    $map = [
        'Confirmado'  => ['Confirmado', 'ok'],
        'Pre-Reserva' => ['Pre-Reserva', 'alerta'],
        'Comprobar'   => ['Comprobar', 'alerta'],
        'Devolver'    => ['Devolución pendiente', 'alerta'],
        'Cancelado'   => ['Cancelado', 'peligro'],
        'Vencido'     => ['Vencido', 'peligro'],
        'Rechazado'   => ['Rechazado', 'peligro'],
    ];
    $e = trim($estado);
    if ($e === '') {
        return null;
    }
    [$texto, $tono] = $map[$e] ?? [$e, 'info'];
    return [$texto, tonoCorreo($tono)];
}

/**
 * Agrupa las filas del detalle en tres bloques para que se lean en el móvil.
 * 'Estado' queda afuera de la tabla: se muestra como chip al inicio del
 * correo, que es lo primero que se quiere ver.
 *
 * @param array<int, array{0:string,1:string}> $filas
 * @return array<int, array{titulo:string, filas:array<int, array{0:string,1:string}>}>
 */
function agruparDetalle(array $filas): array
{
    $orden = [
        'Reserva' => ['Código de reserva', 'Albergue', 'Modalidad', 'Vence el',
            'Pre-reserva registrada', 'Comprobante subido', 'Devolución', 'Devolución realizada'],
        'Personas' => ['Institución', 'Responsable', 'DNI', 'Teléfono', 'Email', 'Cantidad de personas'],
        'Fechas y pago' => ['Fecha de ingreso', 'Hora de ingreso', 'Hora de egreso',
            'Fechas de alojamiento', 'Noches', 'Monto total', 'CBU para transferir'],
    ];

    $grupos = array_fill_keys(array_keys($orden), []);
    foreach ($filas as $fila) {
        $etiqueta = (string) ($fila[0] ?? '');
        if ($etiqueta === '' || $etiqueta === 'Estado') {
            continue;
        }
        $destino = null;
        foreach ($orden as $nombre => $etiquetas) {
            if (in_array($etiqueta, $etiquetas, true)) {
                $destino = $nombre;
                break;
            }
        }
        // Etiqueta nueva o inesperada: no se pierde, va en el primer bloque.
        $grupos[$destino ?? 'Reserva'][] = $fila;
    }

    $salida = [];
    foreach (array_keys($orden) as $nombre) {
        if ($grupos[$nombre] !== []) {
            $salida[] = ['titulo' => $nombre, 'filas' => $grupos[$nombre]];
        }
    }
    return $salida;
}

/**
 * Datos visuales fijos por tipo de evento: eyebrow, tono, preheader (la línea
 * que el cliente de correo muestra junto al asunto) y el enlace secundario.
 * El estado de la reserva lo agrega plantillaCorreo() aparte.
 */
function metaCorreo(string $tipoEvento, array $r, string $appUrl): array
{
    $cod    = (string) ($r['codigo_publico'] ?? '');
    $alb    = (string) ($r['albergue'] ?? '');
    $vence  = !empty($r['pago_vence_at']) ? fmtFecha((string) $r['pago_vence_at']) : '';
    $limite = !empty($r['validacion_vence_at']) ? fmtFechaHora((string) $r['validacion_vence_at']) : '';
    $pct    = isset($r['devolucion_pct']) && $r['devolucion_pct'] !== null
        ? (int) round((float) $r['devolucion_pct'])
        : 0;

    $mapa = [
        'creacion'             => ['Pre-reserva registrada', 'alerta',
            'Pre-reserva ' . $cod . ($vence !== '' ? ' · pago hasta el ' . $vence : ' registrada')],
        'recordatorio'         => ['Recordatorio de pago', 'alerta',
            'Pre-reserva ' . $cod . ($vence !== '' ? ' · vence el ' . $vence : '')],
        'confirmacion'         => ['Reserva confirmada', 'ok',
            'Reserva ' . $cod . ' confirmada · presentá el código al ingreso'],
        'cancelacion_cliente'  => ['Cancelación solicitada', 'peligro',
            'Pre-reserva ' . $cod . ' cancelada · cupo liberado'],
        'cancelacion'          => ['Pre-reserva cancelada', 'peligro',
            'Pre-reserva ' . $cod . ' cancelada · cupo liberado'],
        'pago_recibido'        => ['Comprobante para validar', 'alerta',
            'Reserva ' . $cod . ($limite !== '' ? ' · validación hasta el ' . $limite : ' · comprobante nuevo')],
        'comprobante_recibido' => ['Comprobante recibido', 'ok',
            'Reserva ' . $cod . ' · comprobante en revisión'],
        'validacion_admin'     => ['Reserva validada', 'ok',
            'Reserva ' . $cod . ' confirmada · comprobante aprobado'],
        'vencimiento'          => ['Pre-reserva vencida', 'peligro',
            'Pre-reserva ' . $cod . ' vencida · cupo liberado'],
        'rechazo'              => ['Comprobante rechazado', 'peligro',
            'Comprobante rechazado · reserva ' . $cod],
        'devolucion'           => ['Cancelación con devolución', 'info',
            'Reserva ' . $cod . ' cancelada' . ($pct > 0 ? ' · devolución ' . $pct . '%' : '')],
        'aviso_admin'          => ['Nueva pre-reserva', 'alerta',
            'Nueva pre-reserva ' . $cod . ($alb !== '' ? ' · ' . $alb : '')],
    ];

    [$eyebrow, $tono, $preheader] = $mapa[$tipoEvento]
        ?? ['Detalle de la reserva', 'info', 'Reserva ' . $cod];

    // Enlace secundario: el panel para los avisos al administrador, una nueva
    // reserva cuando no queda nada que hacer, y la ficha de la reserva para
    // el usuario final (mi-reserva.html?codigo=..., prefilado por la v2).
    $link = null;
    if ($appUrl !== '') {
        if (in_array($tipoEvento, ['pago_recibido', 'validacion_admin', 'aviso_admin'], true)) {
            $link = ['texto' => 'Abrir el panel de administración', 'url' => $appUrl . '/admin/'];
        } elseif (in_array($tipoEvento, ['vencimiento', 'cancelacion'], true)) {
            $link = ['texto' => 'Reservar de nuevo', 'url' => $appUrl . '/index.html'];
        } else {
            $link = ['texto' => 'Ver mi reserva en el sitio', 'url' => $appUrl . '/v2/mi-reserva.html'
                . ($cod !== '' ? '?codigo=' . rawurlencode($cod) : '')];
        }
    }

    return ['eyebrow' => $eyebrow, 'tono' => $tono, 'preheader' => $preheader, 'link' => $link];
}

/** Genera [asunto, html] para un tipo de evento.
 *
 * `$pdo` es opcional y solo lo usan los correos que piden pagar: lee el CBU
 * de cobro de `configuracion_sistema`. Sin PDO (scripts de muestras) no se
 * agrega la fila. */
function plantillaCorreo(string $tipoEvento, array $r, string $appUrl = '', ?PDO $pdo = null): array
{
    $alb    = (string) ($r['albergue'] ?? '');
    $codigo = (string) ($r['codigo_publico'] ?? '');
    $filas  = detalleReserva($r);

    // CBU de cobro: fila debajo de "Monto total" en los correos que piden
    // pagar (pre-reserva y recordatorio). Sin dato configurado se pide por
    // teléfono en lugar de dejar la fila vacía (correoBase omite valores
    // vacíos, así que la leyenda nunca se perdería igual).
    if (($tipoEvento === 'creacion' || $tipoEvento === 'recordatorio') && $pdo instanceof PDO) {
        $cbu   = trim(configSistema($pdo, 'cbu_cobro', ''));
        $fila  = ['CBU para transferir', $cbu !== '' ? $cbu : 'Pedir CBU a la entidad telefonicamente'];
        $pos   = false;
        foreach ($filas as $i => $f) {
            if (($f[0] ?? '') === 'Monto total') {
                $pos = $i;
                break;
            }
        }
        if ($pos !== false) {
            array_splice($filas, $pos + 1, 0, [$fila]);
        } else {
            $filas[] = $fila;
        }
    }

    $meta            = metaCorreo($tipoEvento, $r, $appUrl);
    $meta['estado']  = (string) ($r['estado'] ?? '');
    $base            = correoBase($filas, $appUrl, $meta);

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
 * Devuelve un closure que arma el HTML final del correo.
 *
 * Estructura (sistema visual v2): preheader, cabecera con el escudo de la UNT,
 * eyebrow semántico, título, chip de estado, detalle agrupado en tres bloques,
 * caja de nota con el tono del evento, CTA y pie institucional con el logo.
 *
 * $opts trae eyebrow, tono, preheader, estado y link (ver metaCorreo()).
 * Las imágenes se sirven por URL absoluta porque el mailer no adjunta archivos.
 *
 * @param array<int, array{0:string,1:string}> $filas
 * @param array{eyebrow?:string,tono?:string,preheader?:string,estado?:string,link?:array|null} $opts
 */
function correoBase(array $filas, string $appUrl = '', array $opts = []): callable
{
    $tono      = tonoCorreo((string) ($opts['tono'] ?? 'info'));
    $eyebrow   = (string) ($opts['eyebrow'] ?? '');
    $preheader = (string) ($opts['preheader'] ?? '');
    $estado    = (string) ($opts['estado'] ?? '');
    $link      = ($opts['link'] ?? null);
    if (!is_array($link) || ($link['url'] ?? '') === '') {
        $link = null;
    }

    // Escudo (96x119) en la cabecera y logo completo (400x203, con fondo
    // blanco propio) en el pie sobre placa blanca: igual que la nav y el
    // footer del sitio. Sin appUrl no hay dónde servirlos y el correo queda
    // solo con texto, que es como se lee igual si el cliente bloquea imágenes.
    $sello = $appUrl !== '' ? $appUrl . '/Img/brand/unt-sello.png' : '';
    $logo  = $appUrl !== '' ? $appUrl . '/Img/brand/unt-logo.png' : '';

    if ($sello !== '') {
        $cabeceraMarca = '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            . '<td valign="middle" style="padding-right:12px;">'
            . '<img src="' . h($sello) . '" width="34" height="42" alt="Universidad Nacional de Tucumán" style="display:block;border:0;">'
            . '</td><td valign="middle">'
            . '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:17px;line-height:1.2;color:#2c2622;">Albergues recreativos</div>'
            . '<div style="margin-top:3px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.3;letter-spacing:0.06em;text-transform:uppercase;color:#6b6355;">Universidad Nacional de Tucumán</div>'
            . '</td></tr></table>';
    } else {
        $cabeceraMarca = '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:17px;color:#2c2622;">Albergues recreativos</div>';
    }

    // --- Detalle agrupado en tres bloques ---------------------------------
    $bloques = '';
    foreach (agruparDetalle($filas) as $g) {
        $filasHtml = '';
        foreach ($g['filas'] as $fila) {
            [$etiqueta, $valor] = $fila;
            if ((string) $valor === '') {
                continue;
            }
            $destacar    = in_array($etiqueta, ['Código de reserva', 'Monto total'], true);
            $estiloValor = $destacar ? 'font-weight:700;color:#a84c27;' : 'color:#2c2622;';
            $filasHtml  .= '<tr>'
                . '<td style="padding:7px 0;width:44%;vertical-align:top;color:#6b6355;border-bottom:1px solid #f4efe6;">' . h($etiqueta) . '</td>'
                . '<td style="padding:7px 0;text-align:right;vertical-align:top;border-bottom:1px solid #f4efe6;' . $estiloValor . '">'
                . h((string) $valor) . '</td></tr>';
        }
        if ($filasHtml === '') {
            continue;
        }
        $bloques .= '<tr><td style="padding:12px 14px 6px;background:#fcf9f2;border-bottom:1px solid #e9e1d3;">'
            . '<span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b6355;">'
            . h((string) $g['titulo']) . '</span></td></tr>'
            . '<tr><td style="padding:4px 14px 10px;">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">'
            . $filasHtml . '</table></td></tr>';
    }

    // --- Chip de estado ----------------------------------------------------
    $chip     = $estado !== '' ? chipEstado($estado) : null;
    $chipHtml = '';
    if ($chip !== null) {
        [$chipTexto, $chipTono] = $chip;
        $chipHtml = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>'
            . '<td style="background:' . $chipTono['bg'] . ';border:1px solid ' . $chipTono['borde'] . ';border-radius:8px;padding:6px 12px;">'
            . '<span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:'
            . $chipTono['texto'] . ';">' . h($chipTexto) . '</span></td></tr></table>';
    }

    return function (string $titulo, string $intro, string $nota = '', ?array $cta = null) use (
        $appUrl, $eyebrow, $preheader, $tono, $chipHtml, $bloques, $cabeceraMarca, $logo, $link
    ): string {
        $tituloH = h($titulo);
        $introH  = h($intro);

        // Línea de vista previa: el cliente de correo la muestra junto al
        // asunto. Va primero y oculta, para que no se vea en el cuerpo.
        $pre = $preheader !== ''
            ? '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:#fcf9f2;">'
                . h($preheader) . '</div>'
            : '';

        $htmlEyebrow = $eyebrow !== ''
            ? '<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:'
                . $tono['texto'] . ';">' . h($eyebrow) . '</p>'
            : '';

        $htmlNota = $nota !== ''
            ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>'
                . '<td style="background:' . $tono['bg'] . ';border:1px solid ' . $tono['borde']
                . ';border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.5;color:' . $tono['texto'] . ';">'
                . h($nota) . '</td></tr></table>'
            : '';

        $htmlCta = '';
        if ($cta !== null && ($cta['url'] ?? '') !== '') {
            $htmlCta = '<div style="margin-top:18px;text-align:center;">'
                . '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
                . '<td style="background:#a84c27;border-radius:8px;">'
                . '<a href="' . h((string) $cta['url']) . '" style="display:inline-block;padding:13px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">'
                . h((string) ($cta['texto'] ?? 'Ver detalle')) . '</a>'
                . '</td></tr></table></div>';
        }

        $htmlLink = '';
        if ($link !== null) {
            $htmlLink = '<p style="margin:16px 0 0;font-size:13px;line-height:1.5;text-align:center;color:#6b6355;">'
                . '<a href="' . h((string) $link['url']) . '" style="color:#a84c27;text-decoration:underline;">'
                . h((string) $link['texto']) . '</a></p>';
        }

        // --- Pie institucional ---------------------------------------------
        $htmlLogo = '';
        if ($logo !== '') {
            $htmlLogo = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;"><tr>'
                . '<td style="background:#ffffff;border:1px solid #e9e1d3;padding:6px 10px;">'
                . '<img src="' . h($logo) . '" width="160" height="81" alt="Universidad Nacional de Tucumán" style="display:block;border:0;">'
                . '</td></tr></table>';
        }

        $htmlLinksPie = '';
        if ($appUrl !== '') {
            $pie = [
                ['Mi reserva', $appUrl . '/v2/mi-reserva.html'],
                ['Reglamento', $appUrl . '/reglamento.html'],
                ['Ir al sitio', $appUrl . '/index.html'],
            ];
            $items = [];
            foreach ($pie as [$textoPie, $urlPie]) {
                $items[] = '<a href="' . h($urlPie) . '" style="color:#a84c27;text-decoration:underline;">' . h($textoPie) . '</a>';
            }
            $htmlLinksPie = '<p style="margin:12px 0 0;font-size:13px;line-height:1.6;">'
                . implode(' &nbsp;·&nbsp; ', $items) . '</p>';
        }

        return <<<HTML
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{$tituloH}</title>
</head>
<body style="margin:0;padding:0;background:#fcf9f2;">
{$pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fcf9f2;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d6cbb8;border-radius:12px;">
        <tr><td style="height:6px;font-size:0;line-height:0;background:#a84c27;">&nbsp;</td></tr>
        <tr><td style="padding:16px 24px;border-bottom:1px solid #e9e1d3;">{$cabeceraMarca}</td></tr>
        <tr>
          <td style="padding:24px;">
            {$htmlEyebrow}
            <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;font-weight:normal;color:#2c2622;">{$tituloH}</h1>
            <p style="margin:0;font-size:15px;line-height:1.55;color:#4c463d;">{$introH}</p>
            {$chipHtml}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border:1px solid #e9e1d3;border-radius:8px;">
              {$bloques}
            </table>
            {$htmlNota}
            {$htmlCta}
            {$htmlLink}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px;background:#f6f0e5;border-top:1px solid #e9e1d3;">
            {$htmlLogo}
            <p style="margin:0;font-size:13px;line-height:1.6;color:#4c463d;">Universidad Nacional de Tucumán · Reservas de los albergues recreativos</p>
            <p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:#4c463d;">Consultas: (0381) 452-6408</p>
            {$htmlLinksPie}
            <p style="margin:14px 0 0;font-size:11px;line-height:1.5;color:#8e8474;">Este es un mensaje automático del sistema de reservas. No responder a este correo.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
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

