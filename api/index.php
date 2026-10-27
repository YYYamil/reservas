<?php
declare(strict_types=1);

/*
 * API PHP + PostgreSQL para el sistema de reservas de albergues.
 *
 * Reemplaza por completo a Google Apps Script / Google Sheets.
 * Un solo punto de entrada que enruta por la acción recibida.
 *
 * Acciones soportadas:
 *   - obtenerDisponibilidadDia            (POST)  Disponibilidad de visita diaria.
 *   - crearReserva                        (POST)  Crear reserva de visita diaria.
 *   - cancelarReserva                     (POST)  Cancelar reserva (visita o alojamiento).
 *   - obtenerDisponibilidadDiaAlojamiento (GET)   Disponibilidad de alojamiento.
 *   - crearReservaAlojamiento             (POST)  Crear reserva de alojamiento.
 *
 * Las respuestas JSON mantienen la misma estructura que devolvía Apps Script
 * para no alterar el frontend.
 */

require __DIR__ . '/db.php';
require __DIR__ . '/notificaciones.php';

$config = require __DIR__ . '/config.php';
date_default_timezone_set($config['timezone']);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function responder(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Lee un parámetro desde GET o POST (form-urlencoded, como enviaba el frontend).
 */
function parametro(string $nombre, string $default = ''): string
{
    if (isset($_GET[$nombre]) && $_GET[$nombre] !== '') {
        return (string) $_GET[$nombre];
    }
    if (isset($_POST[$nombre]) && $_POST[$nombre] !== '') {
        return (string) $_POST[$nombre];
    }
    return $default;
}

function esFechaISOValida(string $fecha): bool
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
        return false;
    }
    [$y, $m, $d] = array_map('intval', explode('-', $fecha));
    return checkdate($m, $d, $y);
}

/**
 * Mismo esquema de ID que Apps Script: Date.now() % 10000 (0-9999).
 */
function nuevoIdReserva(): int
{
    return (int) (round(microtime(true) * 1000)) % 10000;
}

function alberguePorNombre(PDO $pdo, string $nombre): ?array
{
    $stmt = $pdo->prepare('SELECT id, clave, nombre, capacidad, capacidad_visitas, monto_visita, monto_cama FROM albergues WHERE nombre = ?');
    $stmt->execute([$nombre]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function alberguePorClave(PDO $pdo, string $clave): ?array
{
    $stmt = $pdo->prepare('SELECT id, clave, nombre, capacidad, capacidad_visitas, monto_visita, monto_cama FROM albergues WHERE clave = ?');
    $stmt->execute([$clave]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/**
 * Capacidad y cantidad ocupada de visita diaria para una fecha y albergue.
 * La disponibilidad se deriva siempre de las reservas de visita activas.
 * Usa capacidad_visitas (separada de la capacidad de alojamiento).
 */
function capacidadYOcupadosVisitas(PDO $pdo, int $albergueId, string $fecha): array
{
    $sql = 'SELECT COALESCE(al.capacidad_visitas, al.capacidad) AS capacidad,
                   COALESCE(SUM(r.cantidad), 0) AS ocupados
            FROM albergues al
            LEFT JOIN reservas_visitas r
              ON r.albergue_id = al.id
             AND r.fecha_ingreso = :fecha
             AND r.estado <> \'Cancelado\'
            WHERE al.id = :albergue
            GROUP BY al.id, al.capacidad_visitas, al.capacidad';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        'fecha'    => $fecha,
        'albergue' => $albergueId,
    ]);

    $row = $stmt->fetch();
    if ($row === false) {
        return [0, 0];
    }
    return [(int) $row['capacidad'], (int) $row['ocupados']];
}

/**
 * Capacidad y cantidad ocupada de alojamiento para una fecha y albergue.
 * Un día queda ocupado por toda reserva de alojamiento que lo incluya.
 */
function capacidadYOcupadosAlojamiento(PDO $pdo, int $albergueId, string $fecha): array
{
    $sql = 'SELECT al.capacidad,
                   COALESCE(SUM(d.cantidad), 0) AS ocupados
            FROM albergues al
            LEFT JOIN reservas_alojamiento r
              ON r.albergue_id = al.id
             AND r.estado <> \'Cancelado\'
            LEFT JOIN reserva_alojamiento_dias d
              ON d.reserva_id = r.id
             AND d.fecha = :fecha
            WHERE al.id = :albergue
            GROUP BY al.id';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        'fecha'    => $fecha,
        'albergue' => $albergueId,
    ]);

    $row = $stmt->fetch();
    if ($row === false) {
        return [0, 0];
    }
    return [(int) $row['capacidad'], (int) $row['ocupados']];
}

function respuestaDisponibilidad(string $fecha, string $albergue, int $capacidad, int $ocupados): void
{
    responder([
        'success'     => true,
        'fecha'       => $fecha,
        'albergue'    => $albergue,
        'capacidad'   => $capacidad,
        'ocupados'    => $ocupados,
        'disponibles' => max(0, $capacidad - $ocupados),
    ]);
}

/**
 * Camas libres de alojamiento para cada día de un mes.
 * Devuelve un mapa ['YYYY-MM-DD' => libres] con todos los días del mes.
 * El frontend lo usa para dibujar el badge verde con la cantidad de camas
 * disponibles en cada día del calendario de alojamiento.
 */
function disponibilidadLibresMesAlojamiento(PDO $pdo, int $albergueId, int $capacidad, int $anio, int $mes): array
{
    $primerDia = sprintf('%04d-%02d-01', $anio, $mes);
    $ultimoDia = date('Y-m-t', strtotime($primerDia));

    $sql = 'SELECT d.fecha::text AS fecha,
                   COALESCE(SUM(d.cantidad), 0) AS ocupados
            FROM reserva_alojamiento_dias d
            JOIN reservas_alojamiento r
              ON r.id = d.reserva_id
             AND r.albergue_id = :albergue
             AND r.estado <> \'Cancelado\'
            WHERE d.fecha BETWEEN :desde AND :hasta
            GROUP BY d.fecha';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        'albergue' => $albergueId,
        'desde'    => $primerDia,
        'hasta'    => $ultimoDia,
    ]);

    $ocupadosPorDia = [];
    foreach ($stmt->fetchAll() as $fila) {
        $ocupadosPorDia[$fila['fecha']] = (int) $fila['ocupados'];
    }

    $dias = [];
    $cursor = strtotime($primerDia);
    $fin = strtotime($ultimoDia);
    while ($cursor <= $fin) {
        $iso = date('Y-m-d', $cursor);
        $ocupados = $ocupadosPorDia[$iso] ?? 0;
        $dias[$iso] = max(0, $capacidad - $ocupados);
        $cursor = strtotime('+1 day', $cursor);
    }

    return $dias;
}

/**
 * Exige sesión de administrador activa (panel /admin).
 */
function requiereAdmin(): void
{
    if (empty($_SESSION['admin'])) {
        responder(['success' => false, 'message' => 'No autorizado'], 401);
    }
}

/**
 * Rol del usuario en sesión (o null si no hay sesión).
 */
function rolActual(): ?string
{
    return isset($_SESSION['admin']) ? (string) $_SESSION['admin']['rol'] : null;
}

/**
 * Albergues permitidos para el usuario en sesión.
 * null = todos; array = ids restringidos (lector).
 */
function alberguesPermitidos(): ?array
{
    if (empty($_SESSION['admin'])) {
        return null;
    }
    $al = $_SESSION['admin']['albergues'];
    return is_array($al) ? $al : null;
}

/**
 * Exige sesión Y que el rol esté dentro de la lista permitida.
 */
function requiereRol(array $roles): void
{
    requiereAdmin();
    if (!in_array(rolActual(), $roles, true)) {
        responder(['success' => false, 'message' => 'Permiso denegado'], 403);
    }
}

/**
 * WHERE con restricción de albergues permitidos (para consultas del panel).
 * Devuelve string vacío si el usuario ve todos.
 */
function whereAlberguesPermitidos(string $prefijo = ''): string
{
    $al = alberguesPermitidos();
    if ($al === null || count($al) === 0) {
        return '';
    }
    return ' AND ' . $prefijo . 'albergue_id IN (' . implode(',', array_map('intval', $al)) . ')';
}

/**
 * Albergue completo (tarjeta del landing): datos + características + imágenes.
 */
function albergueCompleto(PDO $pdo, int $id): array
{
    $st = $pdo->prepare(
        'SELECT id, clave, nombre, capacidad, capacidad_visitas, descripcion, habilitado, color, mapa, pdf,
                monto_visita, monto_cama
         FROM albergues WHERE id = ?'
    );
    $st->execute([$id]);
    $a = $st->fetch(PDO::FETCH_ASSOC);
    if ($a === false) {
        return [];
    }
    $a['habilitado'] = (bool) $a['habilitado'];

    $c = $pdo->prepare('SELECT icono, texto FROM albergue_caracteristicas WHERE albergue_id = ? ORDER BY orden, id');
    $c->execute([$id]);
    $a['caracteristicas'] = $c->fetchAll(PDO::FETCH_ASSOC);

    $im = $pdo->prepare('SELECT ruta FROM albergue_imagenes WHERE albergue_id = ? ORDER BY orden, id');
    $im->execute([$id]);
    $a['imagenes'] = array_column($im->fetchAll(PDO::FETCH_ASSOC), 'ruta');

    return $a;
}

/**
 * Decodifica un parámetro JSON opcional (array). null = campo ausente.
 */
function jsonOpcional(string $nombre): ?array
{
    $raw = trim(parametro($nombre));
    if ($raw === '') {
        return null;
    }
    $v = json_decode($raw, true);
    if (!is_array($v)) {
        responder(['success' => false, 'message' => 'Los datos de ' . $nombre . ' son inválidos']);
    }
    return array_values($v);
}

function claveNormalizada(string $c): string
{
    $c = strtolower(trim($c));
    $c = preg_replace('/[^a-z0-9-]+/', '-', $c);
    return trim($c, '-');
}

/**
 * Normaliza la URL de mapa del albergue.
 * - Resuelve enlaces cortos (maps.app.goo.gl) a su URL canónica de google.com/maps,
 *   dejando la coordenada @lat,lng que el landing usa para generar el embed.
 * - No modifica enlaces que ya funcionan (maps.google.com/maps/embed?pb=..., etc.).
 */
function urlMapaNormalizada(string $mapa): string
{
    $m = trim($mapa);
    if ($m === '' || !preg_match('#^https?://maps\.app\.goo\.gl/#i', $m)) {
        return $m;
    }

    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 8,
            'max_redirects' => 10,
            'header' => "Accept: text/html\r\nUser-Agent: Mozilla/5.0 (compatible; med-albergues/1.0)\r\n",
        ],
    ]);
    $body = @file_get_contents($m, false, $ctx);
    $final = $m;
    // PHP 8.5+ deprecó $http_response_header en favor de esta función.
    $cabecerasHttp = function_exists('http_get_last_response_headers')
        ? (http_get_last_response_headers() ?? [])
        : ($http_response_header ?? []);
    if ($cabecerasHttp !== []) {
        foreach (array_reverse($cabecerasHttp) as $cabecera) {
            if (preg_match('/^Location:\s*(.+)$/i', $cabecera, $m2)) {
                $final = trim($m2[1]);
                if ($final !== '' && $final[0] === '/') {
                    $u = parse_url($m);
                    $final = (isset($u['scheme']) ? $u['scheme'] : 'https') . '://'
                        . ($u['host'] ?? 'maps.app.goo.gl') . $final;
                }
                break;
            }
        }
    }
    if ($body !== false && stripos($final, 'google.com/maps') !== false) {
        return $final;
    }
    return $m;
}

/**
 * Reemplaza las características de un albergue (orden = posición en el listado).
 */
function reemplazarCaracteristicas(PDO $pdo, int $albergueId, array $items): void
{
    $pdo->prepare('DELETE FROM albergue_caracteristicas WHERE albergue_id = ?')->execute([$albergueId]);
    $ins = $pdo->prepare(
        'INSERT INTO albergue_caracteristicas (albergue_id, icono, texto, orden) VALUES (?, ?, ?, ?)'
    );
    foreach ($items as $i => $it) {
        $icono = trim((string) ($it['icono'] ?? ''));
        $texto = trim((string) ($it['texto'] ?? ''));
        if ($texto === '') {
            continue;
        }
        $ins->execute([$albergueId, $icono, $texto, $i]);
    }
}

function reemplazarImagenes(PDO $pdo, int $albergueId, array $items): void
{
    $pdo->prepare('DELETE FROM albergue_imagenes WHERE albergue_id = ?')->execute([$albergueId]);
    $ins = $pdo->prepare('INSERT INTO albergue_imagenes (albergue_id, ruta, orden) VALUES (?, ?, ?)');
    foreach ($items as $i => $ruta) {
        $ruta = trim((string) $ruta);
        if ($ruta === '') {
            continue;
        }
        $ins->execute([$albergueId, $ruta, $i]);
    }
}

/**
 * Borra del disco las imágenes subidas (carpeta Img/albergues/) que dejaron
 * de estar referenciadas. Las imágenes "de semilla" (Img/<legacy>/) se ignoran.
 */
function borrarImagenesHuerfanas(PDO $pdo, int $albergueId, array $nuevas): void
{
    $old = $pdo->prepare('SELECT ruta FROM albergue_imagenes WHERE albergue_id = ?');
    $old->execute([$albergueId]);
    $anteriores = array_column($old->fetchAll(PDO::FETCH_ASSOC), 'ruta');
    $nuevasSet = array_flip($nuevas);
    $baseImg = realpath(__DIR__ . '/../Img');
    foreach ($anteriores as $r) {
        if (isset($nuevasSet[$r]) || !preg_match('#^Img/albergues/[^/]+/[^/]+$#', $r)) {
            continue;
        }
        $abs = realpath(__DIR__ . '/../' . $r);
        if ($baseImg !== false && $abs !== false
            && strpos($abs, $baseImg) === 0 && is_file($abs)) {
            @unlink($abs);
        }
    }
}

// ============================= PROCESAMIENTO =============================

$data = array_merge($_GET, $_POST);
$action = (string) ($data['action'] ?? '');

$actionsAdmin = [
    'adminLogin', 'adminLogout', 'adminSesion', 'adminReservas', 'adminTotales',
    'adminEstado', 'adminObservaciones',
    'adminUsuarios', 'adminUsuarioCrear', 'adminUsuarioEditar',
    'adminAlbergues', 'adminAlbergueCrear', 'adminAlbergueEditar', 'adminAlbergueSubirImagen',
    'adminAlbergueSubirArchivo', 'adminConfig', 'adminConfigGuardar',
    'adminConfiguraciones', 'adminConfiguracionEditar', 'adminComprobante',
];
if (in_array($action, $actionsAdmin, true)) {
    ini_set('session.use_strict_mode', '1');
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    ]);
    session_start();
}

try {
    $pdo = db();

    switch ($action) {

        // ---------- Disponibilidad de visita diaria ----------
        case 'obtenerDisponibilidadDia':
            $fecha    = trim(parametro('fecha'));
            $albergue = trim(parametro('albergue'));

            if ($fecha === '' || !esFechaISOValida($fecha)) {
                responder(['success' => false, 'message' => 'Fecha inválida']);
            }

            $alb = alberguePorNombre($pdo, $albergue);
            if ($alb === null) {
                // Compatibilidad con Apps Script: albergue desconocido → ceros
                respuestaDisponibilidad($fecha, $albergue, 0, 0);
            }

            [$capacidad, $ocupados] = capacidadYOcupadosVisitas($pdo, (int) $alb['id'], $fecha);
            respuestaDisponibilidad($fecha, $albergue, $capacidad, $ocupados);
            break;

        // ---------- Crear reserva de visita diaria ----------
        case 'crearReserva':
            $albergueNombre = trim(parametro('albergue'));
            $institucion    = trim(parametro('institucion'));
            $responsable    = trim(parametro('responsable'));
            $dni            = trim(parametro('dni'));
            $contacto       = trim(parametro('contacto'));
            $email          = trim(parametro('email'));
            $cantidad       = (int) parametro('cantidad');
            $fechaIngreso   = trim(parametro('fechaIngreso'));
            $horaIngreso    = trim(parametro('horaIngreso'));
            $horaEgreso     = trim(parametro('horaEgreso'));

            if ($albergueNombre === '' || $institucion === '' || $responsable === ''
                || $dni === '' || $contacto === '' || $email === '' || $fechaIngreso === ''
                || $horaIngreso === '' || $horaEgreso === '') {
                responder(['success' => false, 'message' => 'Complete todos los campos']);
            }
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                responder(['success' => false, 'message' => 'Email inválido']);
            }
            if ($cantidad <= 0) {
                responder(['success' => false, 'message' => 'Cantidad inválida']);
            }
            if (!esFechaISOValida($fechaIngreso)) {
                responder(['success' => false, 'message' => 'Fecha inválida']);
            }

            $alb = alberguePorNombre($pdo, $albergueNombre);
            $capacidadMaxVis = (int) ($alb['capacidad_visitas'] ?? $alb['capacidad']);
            if ($alb === null || $capacidadMaxVis <= 0) {
                responder(['success' => false, 'message' => 'Albergue no configurado']);
            }

            $nuevoId = nuevoIdReserva();
            $montoVisita = (float) ($alb['monto_visita'] ?? 2000);
            $montoTotal = $cantidad * $montoVisita;

            // Transacción con bloqueo de la fila del albergue (equivale al
            // BEGIN IMMEDIATE de SQLite): se revalida disponibilidad para
            // evitar reservas simultáneas sobre la misma capacidad.
            $pdo->beginTransaction();
            $lock = $pdo->prepare('SELECT id FROM albergues WHERE id = ? FOR UPDATE');
            $lock->execute([$alb['id']]);
            try {
                [$capacidad, $ocupados] = capacidadYOcupadosVisitas($pdo, (int) $alb['id'], $fechaIngreso);
                if ($capacidadMaxVis - $ocupados - $cantidad < 0) {
                    $pdo->rollBack();
                    responder(['success' => false]); // mismo comportamiento que Apps Script: sin mensaje
                }

                $codigoPublico = generarCodigoPublico($pdo);

                $stmt = $pdo->prepare(
                    'INSERT INTO reservas_visitas
                        (id_reserva, codigo_publico, albergue_id, institucion, responsable, dni, contacto, email,
                         cantidad, fecha_ingreso, hora_ingreso, hora_egreso, estado, created_at,
                         monto_total, pago_vence_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL \'7 days\')'
                );
                $stmt->execute([
                    $nuevoId,
                    $codigoPublico,
                    $alb['id'],
                    $institucion,
                    $responsable,
                    $dni,
                    $contacto,
                    $email,
                    $cantidad,
                    $fechaIngreso,
                    $horaIngreso,
                    $horaEgreso,
                    'Pre-Reserva',
                    date('Y-m-d H:i:s'),
                    $montoTotal,
                ]);
                $reservaPkVis = (int) $pdo->lastInsertId();

                // Notificación 1: detalle de la pre-reserva al cliente + aviso al
                // administrador. Se encolan dentro de la transacción; el envío se
                // intenta después del commit para no bloquear la operación.
                $notifs = [];
                $notifs[] = encolarNotificacion($pdo, 'visita', $reservaPkVis, 'creacion', $email, 'cliente', null, $config);
                $mailAdmin = avisoAdminHabilitado($pdo, $config) ? configSistema($pdo, 'mail_admin') : '';
                if ($mailAdmin !== '') {
                    $notifs[] = encolarNotificacion($pdo, 'visita', $reservaPkVis, 'aviso_admin', $mailAdmin, 'admin', null, $config);
                }

                $pdo->commit();

                // Envío inmediato: si SMTP falla, queda en cola para el cron.
                enviarNotificacionesInmediatas($pdo, $config, $notifs);

                responder([
                    'success'       => true,
                    'idReserva'     => $nuevoId,
                    'codigoPublico' => $codigoPublico,
                    'codigo_publico'=> $codigoPublico,
                    'montoTotal'    => $montoTotal,
                    'modalidad'     => 'visita',
                    'mensaje'       => 'Reserva creada correctamente',
                ]);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
            break;

        // ---------- Cancelar reserva (visita o alojamiento) ----------
        case 'cancelarReserva':
            $idRaw = trim(parametro('idReserva'));
            $dniR  = trim(parametro('dni'));

            if ($idRaw === '' || $dniR === '') {
                responder(['success' => false, 'message' => 'Faltan datos (ID o DNI)']);
            }

            /**
             * Cancela las reservas que matchean (campo = valor AND dni), marca el
             * origen 'web' y encola el aviso de cancelación al usuario final.
             * Devuelve [cantidadCancelada, idsDeNotificaciones].
             */
            $cancelar = static function (PDO $pdo, array $cfg, string $modalidad, string $campo, $valor, string $dni): array {
                $tabla = $modalidad === 'visita' ? 'reservas_visitas' : 'reservas_alojamiento';
                $sel = $pdo->prepare("SELECT id, email FROM {$tabla} WHERE {$campo} = ? AND dni = ?");
                $sel->execute([$valor, $dni]);
                $filas = $sel->fetchAll(PDO::FETCH_ASSOC);

                $notifs = [];
                foreach ($filas as $f) {
                    marcarCancelada($pdo, $tabla, (int) $f['id'], 'web');
                    // Refuerzo de la cancelación: copia al usuario final.
                    $n = encolarNotificacion($pdo, $modalidad, (int) $f['id'], 'cancelacion_cliente', (string) $f['email'], 'cliente', null, $cfg);
                    if ($n !== null) {
                        $notifs[] = $n;
                    }
                }
                return [count($filas), $notifs];
            };

            $pdo->beginTransaction();
            try {
                $idNumerico = ctype_digit($idRaw) ? $idRaw : null;
                // Orden de búsqueda: código público (identificador global) y luego
                // id_reserva numérico (compatibilidad con el formulario anterior).
                $intentos = [
                    ['codigo_publico', $idRaw],
                    ['id_reserva', $idNumerico],
                ];

                foreach ($intentos as [$campo, $valor]) {
                    if ($valor === null) {
                        continue;
                    }
                    foreach (['visita', 'alojamiento'] as $modalidad) {
                        [$cantidad, $notifs] = $cancelar($pdo, $config, $modalidad, $campo, $valor, $dniR);
                        if ($cantidad > 0) {
                            $pdo->commit();
                            enviarNotificacionesInmediatas($pdo, $config, $notifs);
                            responder([
                                'success' => true,
                                'message' => $modalidad === 'alojamiento' && $campo === 'id_reserva'
                                    ? "Cancelada {$cantidad} Reserva"
                                    : 'Reserva cancelada correctamente',
                            ]);
                        }
                    }
                }

                $pdo->rollBack();
                responder(['success' => false, 'message' => 'No se encontró una reserva con ese número y DNI']);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
            // no break intencional: responden y salen

        // ---------- Disponibilidad de alojamiento ----------
        case 'obtenerDisponibilidadDiaAlojamiento':
            $fecha    = trim(parametro('fecha'));
            $albergue = trim(parametro('albergue'));

            if ($fecha === '' || !esFechaISOValida($fecha)) {
                responder(['success' => false, 'message' => 'Fecha inválida']);
            }

            $alb = alberguePorNombre($pdo, $albergue);
            if ($alb === null) {
                respuestaDisponibilidad($fecha, $albergue, 0, 0);
            }

            [$capacidad, $ocupados] = capacidadYOcupadosAlojamiento($pdo, (int) $alb['id'], $fecha);
            respuestaDisponibilidad($fecha, $albergue, $capacidad, $ocupados);
            break;

        // ---------- Disponibilidad de alojamiento por mes (badge de camas) ----------
        case 'disponibilidadAlojamientoMes':
            $albergue = trim(parametro('albergue'));
            $anio     = (int) parametro('anio');
            $mes      = (int) parametro('mes');

            if ($albergue === '') {
                responder(['success' => false, 'message' => 'Albergue inválido']);
            }
            if ($anio < 2000 || $anio > 2100 || $mes < 1 || $mes > 12) {
                responder(['success' => false, 'message' => 'Mes o año inválido']);
            }

            $alb = alberguePorNombre($pdo, $albergue);
            if ($alb === null) {
                responder(['success' => false, 'message' => "Albergue no encontrado: {$albergue}"]);
            }

            $dias = disponibilidadLibresMesAlojamiento($pdo, (int) $alb['id'], (int) $alb['capacidad'], $anio, $mes);

            responder([
                'success'   => true,
                'albergue'  => $albergue,
                'anio'      => $anio,
                'mes'       => $mes,
                'capacidad' => (int) $alb['capacidad'],
                'dias'      => $dias,
            ]);
            break;

        // ---------- Crear reserva de alojamiento ----------
        case 'crearReservaAlojamiento':
            $albergueNombre = trim(parametro('albergue'));
            $institucion    = trim(parametro('institucion'));
            $responsable    = trim(parametro('responsable'));
            $dni            = trim(parametro('dni'));
            $contacto       = trim(parametro('contacto'));
            $email          = trim(parametro('email'));
            $cantidad       = (int) parametro('cantidad');
            $rangoStr       = trim(parametro('rangoFechas'));

            $rango = array_values(array_unique(array_filter(
                array_map('trim', explode(',', $rangoStr)),
                static fn (string $f): bool => $f !== ''
            )));

            foreach ($rango as $fecha) {
                if (!esFechaISOValida($fecha)) {
                    responder(['success' => false, 'message' => 'Rango de fechas inválido']);
                }
            }

            if ($institucion === '' || $responsable === '' || $dni === '' || $contacto === '' || $email === '') {
                responder(['success' => false, 'message' => 'Complete todos los campos']);
            }
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                responder(['success' => false, 'message' => 'Email inválido']);
            }
            if ($cantidad <= 0) {
                responder(['success' => false, 'message' => 'Capacidad inválida']);
            }
            if (count($rango) === 0) {
                responder(['success' => false, 'message' => 'Rango de fechas inválido']);
            }

            $alb = alberguePorNombre($pdo, $albergueNombre);
            if ($alb === null) {
                responder(['success' => false, 'message' => "Albergue no encontrado: {$albergueNombre}"]);
            }

            $capacidadMax = (int) $alb['capacidad'];
            if ($capacidadMax <= 0 || $cantidad > $capacidadMax) {
                responder(['success' => false, 'message' => 'Capacidad inválida']);
            }

            $nuevoId = nuevoIdReserva();
            $rangoCSV = implode(',', $rango);
            $noches = count($rango);
            $montoCama = (float) ($alb['monto_cama'] ?? 5000);
            $montoTotal = $cantidad * $noches * $montoCama;

            // Transacción de una sola validación/escritura para todo el rango.
            // Bloqueo de la fila del albergue para serializar las escrituras.
            $pdo->beginTransaction();
            $lock = $pdo->prepare('SELECT id FROM albergues WHERE id = ? FOR UPDATE');
            $lock->execute([$alb['id']]);
            try {
                foreach ($rango as $fecha) {
                    [, $ocupados] = capacidadYOcupadosAlojamiento($pdo, (int) $alb['id'], $fecha);
                    if ($capacidadMax - $ocupados - $cantidad < 0) {
                        $pdo->rollBack();
                        responder(['success' => false, 'message' => 'Sin disponibilidad']);
                    }
                }

                $codigoPublico = generarCodigoPublico($pdo);

                $stmt = $pdo->prepare(
                    'INSERT INTO reservas_alojamiento
                        (id_reserva, codigo_publico, albergue_id, institucion, responsable, dni, contacto, email,
                         cantidad, rango_fechas, estado, created_at, monto_total, pago_vence_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL \'7 days\')'
                );
                $stmt->execute([
                    $nuevoId,
                    $codigoPublico,
                    $alb['id'],
                    $institucion,
                    $responsable,
                    $dni,
                    $contacto,
                    $email,
                    $cantidad,
                    $rangoCSV,
                    'Pre-Reserva',
                    date('Y-m-d H:i:s'),
                    $montoTotal,
                ]);
                $reservaPk = (int) $pdo->lastInsertId();

                $insDia = $pdo->prepare(
                    'INSERT INTO reserva_alojamiento_dias (reserva_id, fecha, cantidad) VALUES (?, ?, ?)'
                );
                foreach ($rango as $fecha) {
                    $insDia->execute([$reservaPk, $fecha, $cantidad]);
                }

                // Notificación 1: detalle de la pre-reserva al cliente + aviso al
                // administrador. Se encolan dentro de la transacción; el envío se
                // intenta después del commit para no bloquear la operación.
                $notifs = [];
                $notifs[] = encolarNotificacion($pdo, 'alojamiento', $reservaPk, 'creacion', $email, 'cliente', null, $config);
                $mailAdmin = avisoAdminHabilitado($pdo, $config) ? configSistema($pdo, 'mail_admin') : '';
                if ($mailAdmin !== '') {
                    $notifs[] = encolarNotificacion($pdo, 'alojamiento', $reservaPk, 'aviso_admin', $mailAdmin, 'admin', null, $config);
                }

                $pdo->commit();

                // Envío inmediato: si SMTP falla, queda en cola para el cron.
                enviarNotificacionesInmediatas($pdo, $config, $notifs);

                responder([
                    'success'        => true,
                    'idReserva'      => $nuevoId,
                    'codigoPublico'  => $codigoPublico,
                    'codigo_publico' => $codigoPublico,
                    'montoTotal'     => $montoTotal,
                    'modalidad'      => 'alojamiento',
                    'mensaje'        => 'Reserva creada correctamente',
                ]);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }

            responder(['success' => true, 'idReserva' => $nuevoId]);
            break;

        // ---------- Panel administrador (requiere sesión) ----------
        case 'adminLogin':
            $usuario = trim(parametro('usuario'));
            $pass    = (string) parametro('pass');
            $ip      = (string) ($_SERVER['REMOTE_ADDR'] ?? '');

            // Anti fuerza bruta: 5 fallos en 15 min bloquea (por usuario+IP).
            $q = $pdo->prepare(
                "SELECT count(*) FROM login_intentos
                 WHERE usuario = :u AND ip = :ip AND exito = false
                   AND fecha > NOW() - INTERVAL '15 minutes'"
            );
            $q->execute(['u' => $usuario, 'ip' => $ip]);
            if ((int) $q->fetchColumn() >= 5) {
                responder(['success' => false, 'message' => 'Demasiados intentos. Esperá 15 minutos.'], 429);
            }

            $stmt = $pdo->prepare('SELECT * FROM usuarios WHERE usuario = :u');
            $stmt->execute(['u' => $usuario]);
            $usr = $stmt->fetch();

            $ok = $usr !== false
                && (bool) $usr['activo']
                && password_verify($pass, $usr['pass_hash']);

            $reg = $pdo->prepare('INSERT INTO login_intentos (usuario, ip, exito, fecha) VALUES (?, ?, ?, NOW())');
            $reg->execute([$usuario, $ip, $ok ? 1 : 0]);

            if (!$ok) {
                responder(['success' => false, 'message' => 'Credenciales inválidas'], 401);
            }

            $nombre = (string) $usr['nombre'];
            $rol    = (string) $usr['rol'];
            $albergues = null;
            if ($rol === 'lector') {
                $sc = $pdo->prepare('SELECT albergue_id FROM usuario_albergues WHERE usuario_id = ?');
                $sc->execute([(int) $usr['id']]);
                $albergues = array_values(array_map('intval', $sc->fetchAll(PDO::FETCH_COLUMN)));
            }

            session_regenerate_id(true);
            $_SESSION['admin'] = [
                'id'        => (int) $usr['id'],
                'usuario'   => $usr['usuario'],
                'nombre'    => $nombre,
                'rol'       => $rol,
                'albergues' => $albergues,
            ];
            $pdo->prepare('UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?')
                ->execute([(int) $usr['id']]);

            responder(['success' => true, 'rol' => $rol, 'nombre' => $nombre]);
            break;

        case 'adminLogout':
            $_SESSION = [];
            session_destroy();
            responder(['success' => true]);
            break;

        case 'adminSesion':
            if (!empty($_SESSION['admin'])) {
                responder([
                    'success' => true,
                    'rol'     => $_SESSION['admin']['rol'],
                    'nombre'  => $_SESSION['admin']['nombre'],
                ]);
            }
            responder(['success' => false, 'message' => 'No autorizado'], 401);
            break;

        case 'adminReservas':
            requiereAdmin();
            $desde    = trim(parametro('desde'));
            $hasta    = trim(parametro('hasta'));
            $albergue = trim(parametro('albergue'));
            $tipo     = trim(parametro('tipo'));
            $estado   = trim(parametro('estado'));
            $q        = trim(parametro('q'));

            $sql = 'SELECT * FROM v_reservas_todas WHERE 1 = 1';
            $params = [];

            $al = alberguesPermitidos();
            if ($al !== null && count($al) > 0) {
                $sql .= ' AND albergue IN (SELECT nombre FROM albergues WHERE id IN ('
                    . implode(',', array_map('intval', $al)) . '))';
            }

            if ($desde !== '') {
                if (!esFechaISOValida($desde)) {
                    responder(['success' => false, 'message' => 'Fecha desde inválida']);
                }
                $sql .= ' AND created_at >= :desde';
                $params['desde'] = $desde . ' 00:00:00';
            }
            if ($hasta !== '') {
                if (!esFechaISOValida($hasta)) {
                    responder(['success' => false, 'message' => 'Fecha hasta inválida']);
                }
                $sql .= ' AND created_at <= :hasta';
                $params['hasta'] = $hasta . ' 23:59:59';
            }
            if ($albergue !== '') {
                $sql .= ' AND albergue = :albergue';
                $params['albergue'] = $albergue;
            }
            if ($tipo !== '' && in_array($tipo, ['visita', 'alojamiento'], true)) {
                $sql .= ' AND modalidad = :tipo';
                $params['tipo'] = $tipo;
            }
            if ($estado !== '') {
                $sql .= ' AND estado = :estado';
                $params['estado'] = $estado;
            }
            if ($q !== '') {
                $sql .= ' AND (codigo_publico ILIKE :q OR institucion ILIKE :q OR responsable ILIKE :q OR dni ILIKE :q)';
                $params['q'] = '%' . $q . '%';
            }
            $sql .= ' ORDER BY created_at DESC, modalidad, codigo_publico';

            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            responder(['success' => true, 'reservas' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            break;

        case 'adminTotales':
            requiereAdmin();
            $hoy = date('Y-m-d');
            $f7  = date('Y-m-d', strtotime('+6 days'));
            $w   = whereAlberguesPermitidos();

            $totales = [
                'visitas'      => (int) $pdo->query('SELECT count(*) FROM reservas_visitas WHERE 1=1' . $w)->fetchColumn(),
                'alojamientos' => (int) $pdo->query('SELECT count(*) FROM reservas_alojamiento WHERE 1=1' . $w)->fetchColumn(),
            ];

            $v7 = $pdo->prepare('SELECT count(*) FROM reservas_visitas WHERE fecha_ingreso BETWEEN :h AND :f AND estado <> \'Cancelado\'' . $w);
            $v7->execute(['h' => $hoy, 'f' => $f7]);
            $totales['visitas_proximos7'] = (int) $v7->fetchColumn();

            $a7 = $pdo->prepare(
                'SELECT count(DISTINCT r.id) FROM reservas_alojamiento r
                 JOIN reserva_alojamiento_dias d ON d.reserva_id = r.id
                 WHERE d.fecha BETWEEN :h AND :f AND r.estado <> \'Cancelado\'' . $w
            );
            $a7->execute(['h' => $hoy, 'f' => $f7]);
            $totales['aloj_proximos7'] = (int) $a7->fetchColumn();

            $sqlPorAlb = 'SELECT al.id, al.nombre AS albergue, al.capacidad,
                        (SELECT count(*) FROM reservas_visitas rv WHERE rv.albergue_id = al.id) AS visitas,
                        (SELECT count(*) FROM reservas_alojamiento ra WHERE ra.albergue_id = al.id) AS alojamientos
                 FROM albergues al';
            $al = alberguesPermitidos();
            if ($al !== null && count($al) > 0) {
                $sqlPorAlb .= ' WHERE al.id IN (' . implode(',', array_map('intval', $al)) . ')';
            }
            $sqlPorAlb .= ' ORDER BY al.id';

            $porAlbergue = $pdo->query($sqlPorAlb)->fetchAll(PDO::FETCH_ASSOC);

            $estados = $pdo->query(
                'SELECT DISTINCT estado FROM (
                    SELECT estado FROM reservas_visitas
                    UNION
                    SELECT estado FROM reservas_alojamiento
                 ) t ORDER BY estado'
            )->fetchAll(PDO::FETCH_COLUMN);

            responder([
                'success'      => true,
                'rol'          => rolActual(),
                'totales'      => $totales,
                'por_albergue' => $porAlbergue,
                'estados'      => $estados,
            ]);
            break;

        case 'adminEstado':
            requiereRol(['admin']);
            $estado    = trim(parametro('estado'));
            $modalidad = trim(parametro('modalidad'));
            $pk        = (int) parametro('pk');

            if (!in_array($estado, ['Pre-Reserva', 'Confirmado', 'Cancelado'], true)) {
                responder(['success' => false, 'message' => 'Estado inválido']);
            }
            if (!in_array($modalidad, ['visita', 'alojamiento'], true)) {
                responder(['success' => false, 'message' => 'Modalidad inválida']);
            }
            if ($pk <= 0) {
                responder(['success' => false, 'message' => 'ID inválido']);
            }

            $tabla = $modalidad === 'visita' ? 'reservas_visitas' : 'reservas_alojamiento';

            $prev = $pdo->prepare("SELECT estado, email FROM {$tabla} WHERE id = ?");
            $prev->execute([$pk]);
            $actual = $prev->fetch(PDO::FETCH_ASSOC);
            if ($actual === false) {
                responder(['success' => false, 'message' => 'No se encontró la reserva']);
            }
            $estadoAnterior = (string) $actual['estado'];
            $mailCliente    = (string) ($actual['email'] ?? '');

            if ($estadoAnterior === $estado) {
                responder(['success' => true, 'sin_cambios' => true]);
            }

            // Auditoría del cambio de estado (quién y cuándo, desde el panel).
            $usuarioPanel = (string) ($_SESSION['admin']['usuario'] ?? 'admin');

            if ($estado === 'Cancelado') {
                marcarCancelada($pdo, $tabla, $pk, 'admin');
            } else {
                $stmt = $pdo->prepare(
                    "UPDATE {$tabla}
                        SET estado = :estado,
                            estado_modificado_por = :por,
                            estado_modificado_at  = NOW(),
                            estado_origen         = 'panel'
                      WHERE id = :pk"
                );
                $stmt->execute(['estado' => $estado, 'por' => $usuarioPanel, 'pk' => $pk]);
            }

            // marcarCancelada() no registra la auditoría del panel: se completa acá.
            if ($estado === 'Cancelado') {
                $pdo->prepare(
                    "UPDATE {$tabla}
                        SET estado_modificado_por = ?, estado_modificado_at = NOW(), estado_origen = 'panel'
                      WHERE id = ?"
                )->execute([$usuarioPanel, $pk]);
            }

            // Avisos automáticos al usuario final:
            //   Pre-Reserva -> Confirmado : el admin verificó el comprobante y aprueba.
            //   *           -> Cancelado  : el admin rechaza/cancela la solicitud.
            $notifs = [];
            if ($mailCliente !== '') {
                if ($estado === 'Confirmado') {
                    $n = encolarNotificacion($pdo, $modalidad, $pk, 'confirmacion', $mailCliente, 'cliente', null, $config);
                    if ($n !== null) {
                        $notifs[] = $n;
                    }
                } elseif ($estado === 'Cancelado') {
                    $n = encolarNotificacion($pdo, $modalidad, $pk, 'cancelacion', $mailCliente, 'cliente', null, $config);
                    if ($n !== null) {
                        $notifs[] = $n;
                    }
                }
            }

            // Envío inmediato post-commit (si SMTP falla, el cron reintenta).
            enviarNotificacionesInmediatas($pdo, $config, $notifs);

            $meta = $pdo->prepare("SELECT estado_modificado_por, estado_modificado_at, estado_origen FROM {$tabla} WHERE id = ?");
            $meta->execute([$pk]);
            $m = $meta->fetch(PDO::FETCH_ASSOC) ?: [];

            responder([
                'success'             => true,
                'estado'              => $estado,
                'estado_anterior'     => $estadoAnterior,
                'notificacion'        => $notifs === [] ? 'sin_email' : 'enviada',
                'modificado_por'      => $m['estado_modificado_por'] ?? null,
                'modificado_at'       => $m['estado_modificado_at'] ?? null,
                'origen'              => $m['estado_origen'] ?? 'panel',
            ]);
            break;

        case 'adminObservaciones':
            requiereRol(['admin']);
            $texto     = trim(parametro('observaciones'));
            $modalidad = trim(parametro('modalidad'));
            $pk        = (int) parametro('pk');

            if (strlen($texto) > 1000) {
                responder(['success' => false, 'message' => 'Observaciones demasiado largas (máx. 1000 caracteres)']);
            }
            if (!in_array($modalidad, ['visita', 'alojamiento'], true)) {
                responder(['success' => false, 'message' => 'Modalidad inválida']);
            }
            if ($pk <= 0) {
                responder(['success' => false, 'message' => 'ID inválido']);
            }

            $tabla = $modalidad === 'visita' ? 'reservas_visitas' : 'reservas_alojamiento';
            $stmt  = $pdo->prepare("UPDATE {$tabla} SET observaciones = :texto WHERE id = :pk");
            $stmt->execute(['texto' => $texto === '' ? null : $texto, 'pk' => $pk]);
            if ($stmt->rowCount() === 0) {
                responder(['success' => false, 'message' => 'No se encontró la reserva']);
            }
            responder(['success' => true]);
            break;

        // ---------- Gestión de usuarios y albergues (solo super_admin) ----------
        case 'adminUsuarios':
            requiereRol(['super_admin']);
            $sql = 'SELECT u.id, u.usuario, u.nombre, u.rol, u.activo, u.ultimo_login,
                           COALESCE((
                               SELECT string_agg(al.nombre, \', \' ORDER BY al.nombre)
                               FROM usuario_albergues ua JOIN albergues al ON al.id = ua.albergue_id
                               WHERE ua.usuario_id = u.id
                           ), \'\') AS albergues,
                           (SELECT ua.albergue_id FROM usuario_albergues ua
                            WHERE ua.usuario_id = u.id LIMIT 1) AS albergue_id
                    FROM usuarios u
                    ORDER BY u.id';
            responder(['success' => true, 'usuarios' => $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC)]);
            break;

        case 'adminUsuarioCrear':
            requiereRol(['super_admin']);
            $usuario = trim(parametro('usuario'));
            $nombre  = trim(parametro('nombre'));
            $rol     = trim(parametro('rol'));
            $pass    = (string) parametro('pass');
            $albId   = (int) parametro('albergue_id', '0');

            if ($usuario === '' || $nombre === '' || $rol === '' || $pass === '') {
                responder(['success' => false, 'message' => 'Complete todos los campos']);
            }
            if (!in_array($rol, ['super_admin', 'admin', 'lector'], true)) {
                responder(['success' => false, 'message' => 'Rol inválido']);
            }
            if (strlen($pass) < 8) {
                responder(['success' => false, 'message' => 'La contraseña debe tener al menos 8 caracteres']);
            }
            if ($rol === 'lector') {
                $alb = $pdo->prepare('SELECT id FROM albergues WHERE id = ?');
                $alb->execute([$albId]);
                if ($alb->fetch() === false) {
                    responder(['success' => false, 'message' => 'Albergue inválido para el lector']);
                }
            }
            $existe = $pdo->prepare('SELECT 1 FROM usuarios WHERE usuario = ?');
            $existe->execute([$usuario]);
            if ($existe->fetch() !== false) {
                responder(['success' => false, 'message' => 'Ese usuario ya existe']);
            }

            $hash = password_hash($pass, PASSWORD_DEFAULT);
            $pdo->beginTransaction();
            try {
                $ins = $pdo->prepare(
                    'INSERT INTO usuarios (usuario, pass_hash, nombre, rol, activo, created_at)
                     VALUES (?, ?, ?, ?, true, NOW())'
                );
                $ins->execute([$usuario, $hash, $nombre, $rol]);
                $uid = (int) $pdo->lastInsertId();
                if ($rol === 'lector') {
                    $pdo->prepare('INSERT INTO usuario_albergues (usuario_id, albergue_id) VALUES (?, ?)')
                        ->execute([$uid, $albId]);
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
            responder(['success' => true]);
            break;

        case 'adminUsuarioEditar':
            requiereRol(['super_admin']);
            $id      = (int) parametro('id');
            $nombre  = trim(parametro('nombre'));
            $rol     = trim(parametro('rol'));
            $activo  = (string) parametro('activo', '1');
            $pass    = (string) parametro('pass');
            $albId   = (int) parametro('albergue_id', '0');

            if ($id <= 0 || $nombre === '' || $rol === '') {
                responder(['success' => false, 'message' => 'Faltan datos']);
            }
            if (!in_array($rol, ['super_admin', 'admin', 'lector'], true)) {
                responder(['success' => false, 'message' => 'Rol inválido']);
            }
            $cambiaPass = $pass !== '';
            if ($cambiaPass && strlen($pass) < 8) {
                responder(['success' => false, 'message' => 'La contraseña debe tener al menos 8 caracteres']);
            }
            if ($rol === 'lector') {
                $alb = $pdo->prepare('SELECT id FROM albergues WHERE id = ?');
                $alb->execute([$albId]);
                if ($alb->fetch() === false) {
                    responder(['success' => false, 'message' => 'Albergue inválido para el lector']);
                }
            }

            $usr = $pdo->prepare('SELECT * FROM usuarios WHERE id = ?');
            $usr->execute([$id]);
            $u = $usr->fetch();
            if ($u === false) {
                responder(['success' => false, 'message' => 'No existe el usuario']);
            }

            $nuevoActivo = ($activo === '1');
            if ($u['rol'] === 'super_admin' && ($rol !== 'super_admin' || !$nuevoActivo)) {
                // Evita dejar el sistema sin super_admin activo
                $otros = $pdo->prepare(
                    "SELECT count(*) FROM usuarios WHERE rol = 'super_admin' AND activo = true AND id <> ?"
                );
                $otros->execute([$id]);
                if ((int) $otros->fetchColumn() === 0) {
                    responder(['success' => false, 'message' => 'Debe quedar al menos un super_admin activo']);
                }
            }

            $activoText = $nuevoActivo ? 't' : 'f';
            $hash = $cambiaPass ? password_hash($pass, PASSWORD_DEFAULT) : null;
            $pdo->beginTransaction();
            try {
                if ($cambiaPass) {
                    $upd = $pdo->prepare(
                        'UPDATE usuarios SET nombre = ?, rol = ?, activo = ?, pass_hash = ? WHERE id = ?'
                    );
                    $upd->execute([$nombre, $rol, $activoText, $hash, $id]);
                } else {
                    $upd = $pdo->prepare(
                        'UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?'
                    );
                    $upd->execute([$nombre, $rol, $activoText, $id]);
                }
                $pdo->prepare('DELETE FROM usuario_albergues WHERE usuario_id = ?')->execute([$id]);
                if ($rol === 'lector') {
                    $pdo->prepare('INSERT INTO usuario_albergues (usuario_id, albergue_id) VALUES (?, ?)')
                        ->execute([$id, $albId]);
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
            responder(['success' => true]);
            break;

        // ---------- Landing: albergues visibles (público, genera las tarjetas) ----------
        case 'listarAlbergues':
            $ids = $pdo->query('SELECT id FROM albergues WHERE habilitado = true ORDER BY id')
                ->fetchAll(PDO::FETCH_COLUMN);
            $salida = [];
            foreach ($ids as $id) {
                $salida[] = albergueCompleto($pdo, (int) $id);
            }
            // Meses de anticipación configurables desde el panel (script.js los usa
            // para habilitar los selectores de mes del calendario). Se lee de forma
            // defensiva: es un endpoint público y no debe caer si falta la tabla.
            $mesesAnticipacion = 3;
            try {
                $mesesAnticipacion = (int) configSistema($pdo, 'meses_anticipacion', '3');
            } catch (Throwable $e) {
                $mesesAnticipacion = 3;
            }
            if ($mesesAnticipacion < 1 || $mesesAnticipacion > 24) {
                $mesesAnticipacion = 3;
            }
            responder([
                'success'            => true,
                'albergues'          => $salida,
                'meses_anticipacion' => $mesesAnticipacion,
            ]);
            break;

        case 'adminAlbergues':
            requiereRol(['super_admin']);
            $ids = $pdo->query('SELECT id FROM albergues ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
            $salida = [];
            foreach ($ids as $id) {
                $salida[] = albergueCompleto($pdo, (int) $id);
            }
            responder(['success' => true, 'albergues' => $salida]);
            break;

        case 'adminAlbergueCrear':
            requiereRol(['super_admin']);
            $clave = claveNormalizada(parametro('clave'));
            $nombre = trim(parametro('nombre'));
            $capacidad = (int) parametro('capacidad');
            $capacidadVisitas = (int) parametro('capacidad_visitas', (string) $capacidad);
            $montoVisita = (float) parametro('monto_visita', '2000');
            $montoCama = (float) parametro('monto_cama', '5000');
            $descripcion = trim(parametro('descripcion'));
            $color = trim(parametro('color')) !== '' ? trim(parametro('color')) : '#005CA2';
            $mapa = urlMapaNormalizada(parametro('mapa'));
            $pdf = trim(parametro('pdf'));
            $habilitado = parametro('habilitado', '1') === '1' ? 't' : 'f';

            if ($clave === '' || $nombre === '' || $capacidad <= 0) {
                responder(['success' => false, 'message' => 'Complete clave, nombre y capacidad (> 0)']);
            }
            if ($capacidadVisitas <= 0) { $capacidadVisitas = $capacidad; }
            if ($montoVisita < 0 || $montoCama < 0) {
                responder(['success' => false, 'message' => 'Los montos no pueden ser negativos']);
            }
            if (!preg_match('/^[a-z0-9-]+$/', $clave)) {
                responder(['success' => false, 'message' => 'Clave inválida (solo letras minúsculas, números y guiones)']);
            }
            $dup = $pdo->prepare('SELECT 1 FROM albergues WHERE clave = ? OR nombre = ?');
            $dup->execute([$clave, $nombre]);
            if ($dup->fetch() !== false) {
                responder(['success' => false, 'message' => 'Ya existe un albergue con esa clave o nombre']);
            }

            $carac = jsonOpcional('caracteristicas');
            $imgs  = jsonOpcional('imagenes');

            $pdo->beginTransaction();
            try {
                $ins = $pdo->prepare(
                    'INSERT INTO albergues (clave, nombre, capacidad, capacidad_visitas, descripcion, habilitado, color, mapa, pdf, monto_visita, monto_cama)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $ins->execute([$clave, $nombre, $capacidad, $capacidadVisitas, $descripcion, $habilitado, $color, $mapa, $pdf, $montoVisita, $montoCama]);
                $nuevoId = (int) $pdo->lastInsertId();
                if ($carac !== null) { reemplazarCaracteristicas($pdo, $nuevoId, $carac); }
                if ($imgs !== null)  { reemplazarImagenes($pdo, $nuevoId, $imgs); }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
            responder(['success' => true, 'id' => $nuevoId]);
            break;

        case 'adminAlbergueEditar':
            requiereRol(['super_admin']);
            $id = (int) parametro('id');
            $nombre = trim(parametro('nombre'));
            $capacidad = (int) parametro('capacidad');
            $capacidadVisitas = (int) parametro('capacidad_visitas', (string) $capacidad);
            $montoVisita = (float) parametro('monto_visita', '2000');
            $montoCama = (float) parametro('monto_cama', '5000');
            $descripcion = trim(parametro('descripcion'));
            $color = trim(parametro('color')) !== '' ? trim(parametro('color')) : '#005CA2';
            $mapa = urlMapaNormalizada(parametro('mapa'));
            $pdf = trim(parametro('pdf'));
            $habilitado = parametro('habilitado', '1') === '1' ? 't' : 'f';

            if ($id <= 0 || $nombre === '' || $capacidad <= 0) {
                responder(['success' => false, 'message' => 'Faltan datos o capacidad inválida']);
            }
            if ($capacidadVisitas <= 0) { $capacidadVisitas = $capacidad; }
            if ($montoVisita < 0 || $montoCama < 0) {
                responder(['success' => false, 'message' => 'Los montos no pueden ser negativos']);
            }
            $atum = $pdo->prepare('SELECT id FROM albergues WHERE id = ?');
            $atum->execute([$id]);
            if ($atum->fetch() === false) {
                responder(['success' => false, 'message' => 'No existe el albergue']);
            }
            $dupN = $pdo->prepare('SELECT id FROM albergues WHERE nombre = ? AND id <> ?');
            $dupN->execute([$nombre, $id]);
            if ($dupN->fetch() !== false) {
                responder(['success' => false, 'message' => 'Ya existe otro albergue con ese nombre']);
            }

            $carac = jsonOpcional('caracteristicas');
            $imgs  = jsonOpcional('imagenes');

            $pdo->beginTransaction();
            try {
                $upd = $pdo->prepare(
                    'UPDATE albergues
                     SET nombre = ?, capacidad = ?, capacidad_visitas = ?, descripcion = ?, habilitado = ?,
                         color = ?, mapa = ?, pdf = ?, monto_visita = ?, monto_cama = ?
                     WHERE id = ?'
                );
                $upd->execute([$nombre, $capacidad, $capacidadVisitas, $descripcion, $habilitado, $color, $mapa, $pdf, $montoVisita, $montoCama, $id]);
                if ($carac !== null) { reemplazarCaracteristicas($pdo, $id, $carac); }
                if ($imgs !== null) {
                    borrarImagenesHuerfanas($pdo, $id, $imgs);
                    reemplazarImagenes($pdo, $id, $imgs);
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
            responder(['success' => true]);
            break;

        case 'adminAlbergueSubirImagen':
            requiereRol(['super_admin']);
            $clave = claveNormalizada(parametro('clave'));
            if ($clave === '') {
                responder(['success' => false, 'message' => 'Falta la clave del albergue']);
            }
            if (!isset($_FILES['archivo']) || $_FILES['archivo']['error'] !== UPLOAD_ERR_OK) {
                responder(['success' => false, 'message' => 'No se recibió la imagen']);
            }
            $f = $_FILES['archivo'];
            if ($f['size'] > 8 * 1024 * 1024) {
                responder(['success' => false, 'message' => 'La imagen supera los 8 MB']);
            }
            $info = getimagesize($f['tmp_name']);
            if ($info === false) {
                responder(['success' => false, 'message' => 'El archivo no es una imagen válida']);
            }
            $extOrden = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
            $ext = $extOrden[$info[2]] ?? '';
            if ($ext === '') {
                responder(['success' => false, 'message' => 'Formato no permitido (JPG, PNG, WEBP, GIF)']);
            }

            $dir = __DIR__ . '/../Img/albergues/' . $clave;
            if (!is_dir($dir) && !mkdir($dir, 0777, true)) {
                responder(['success' => false, 'message' => 'No se pudo crear la carpeta de imágenes']);
            }
            $base = strtolower(pathinfo($f['name'], PATHINFO_FILENAME));
            $base = preg_replace('/[^a-z0-9_\-]+/', '-', $base);
            $base = trim($base, '-');
            $base = $base === '' ? 'img' : substr($base, 0, 60);
            $nombreFinal = $base . '-' . substr(uniqid(), -6) . '.' . $ext;
            $destino = $dir . '/' . $nombreFinal;
            if (!move_uploaded_file($f['tmp_name'], $destino)) {
                responder(['success' => false, 'message' => 'No se pudo guardar la imagen']);
            }
            responder(['success' => true, 'ruta' => 'Img/albergues/' . $clave . '/' . $nombreFinal]);
            break;

        case 'adminAlbergueSubirArchivo':
            requiereRol(['super_admin']);
            $clave = claveNormalizada(parametro('clave'));
            if ($clave === '') {
                responder(['success' => false, 'message' => 'Falta la clave del albergue']);
            }
            if (!isset($_FILES['archivo']) || $_FILES['archivo']['error'] !== UPLOAD_ERR_OK) {
                responder(['success' => false, 'message' => 'No se recibió el archivo']);
            }
            $f = $_FILES['archivo'];
            if ($f['size'] > 8 * 1024 * 1024) {
                responder(['success' => false, 'message' => 'El archivo supera los 8 MB']);
            }
            $ext   = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
            $magic = (string) @file_get_contents($f['tmp_name'], false, null, 0, 5);
            if ($ext !== 'pdf' || $magic !== '%PDF-') {
                responder(['success' => false, 'message' => 'Solo se aceptan archivos PDF']);
            }

            $dir = __DIR__ . '/../Img/albergues/' . $clave;
            if (!is_dir($dir) && !mkdir($dir, 0777, true)) {
                responder(['success' => false, 'message' => 'No se pudo crear la carpeta de archivos']);
            }
            $base = strtolower(pathinfo($f['name'], PATHINFO_FILENAME));
            $base = preg_replace('/[^a-z0-9_\-]+/', '-', $base);
            $base = trim($base, '-');
            $base = $base === '' ? 'doc' : substr($base, 0, 60);
            $nombreFinal = $base . '-' . substr(uniqid(), -6) . '.pdf';
            $destino = $dir . '/' . $nombreFinal;
            if (!move_uploaded_file($f['tmp_name'], $destino)) {
                responder(['success' => false, 'message' => 'No se pudo guardar el PDF']);
            }
            responder(['success' => true, 'ruta' => 'Img/albergues/' . $clave . '/' . $nombreFinal]);
            break;

        // ---------- Configuración del sistema (super_admin) ----------
        case 'adminConfig':
            requiereRol(['super_admin']);
            $rows = $pdo->query('SELECT clave, valor FROM configuracion_sistema ORDER BY clave')->fetchAll(PDO::FETCH_KEY_PAIR);
            responder(['success' => true, 'config' => $rows]);
            break;

        case 'adminConfigGuardar':
            requiereRol(['super_admin']);
            $mailAdmin = trim(parametro('mail_admin'));
            if ($mailAdmin !== '' && filter_var($mailAdmin, FILTER_VALIDATE_EMAIL) === false) {
                responder(['success' => false, 'message' => 'Email del administrador inválido']);
            }
            $pdo->prepare(
                "INSERT INTO configuracion_sistema (clave, valor, updated_at) VALUES ('mail_admin', ?, NOW())
                 ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()"
            )->execute([$mailAdmin]);
            responder(['success' => true]);
            break;

        // Listado genérico de configuraciones (panel: meses_anticipacion, etc.)
        case 'adminConfiguraciones':
            requiereRol(['super_admin', 'admin']);
            $filas = $pdo->query('SELECT clave, valor, updated_at FROM configuracion_sistema ORDER BY clave')
                ->fetchAll(PDO::FETCH_ASSOC);
            responder(['success' => true, 'configuraciones' => $filas]);
            break;

        // Edición de una configuración puntual (solo claves permitidas).
        case 'adminConfiguracionEditar':
            requiereRol(['super_admin']);
            $clave = trim(parametro('clave'));
            $valor = trim(parametro('valor'));
            $permitidas = ['meses_anticipacion', 'mail_admin'];
            if (!in_array($clave, $permitidas, true)) {
                responder(['success' => false, 'message' => 'Clave de configuración no válida']);
            }
            if ($clave === 'meses_anticipacion') {
                if (!ctype_digit($valor) || (int) $valor < 1 || (int) $valor > 24) {
                    responder(['success' => false, 'message' => 'Ingresá un valor entre 1 y 24']);
                }
            }
            if ($clave === 'mail_admin' && $valor !== '' && filter_var($valor, FILTER_VALIDATE_EMAIL) === false) {
                responder(['success' => false, 'message' => 'Email del administrador inválido']);
            }
            $pdo->prepare(
                'INSERT INTO configuracion_sistema (clave, valor, updated_at) VALUES (?, ?, NOW())
                 ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()'
            )->execute([$clave, $valor]);
            responder(['success' => true, 'clave' => $clave, 'valor' => $valor]);
            break;

        // ---------- Comprobantes de pago (cliente) ----------
        case 'subirComprobante':
            $codigo = strtoupper(trim(parametro('codigo')));

            if ($codigo === '') {
                responder(['success' => false, 'message' => 'Ingrese el código de reserva']);
            }
            if (!isset($_FILES['comprobante']) || $_FILES['comprobante']['error'] !== UPLOAD_ERR_OK) {
                responder(['success' => false, 'message' => 'No se recibió el comprobante']);
            }
            $f = $_FILES['comprobante'];
            if ($f['size'] > 8 * 1024 * 1024) {
                responder(['success' => false, 'message' => 'El comprobante supera los 8 MB']);
            }

            // El codigo_publico se genera con una secuencia unica compartida por ambas
            // tablas (ver 2026-10-21_codigo_publico_unificado.sql), por lo que por si
            // solo identifica la reserva y su modalidad.
            $reserva    = false;
            $modalidad  = '';
            foreach (['visita' => 'reservas_visitas', 'alojamiento' => 'reservas_alojamiento'] as $mod => $tabla) {
                $stmt = $pdo->prepare("SELECT id, email, estado FROM {$tabla} WHERE codigo_publico = ?");
                $stmt->execute([$codigo]);
                $encontrada = $stmt->fetch(PDO::FETCH_ASSOC);
                if ($encontrada !== false) {
                    $reserva   = $encontrada;
                    $modalidad = $mod;
                    break;
                }
            }
            if ($reserva === false) {
                responder(['success' => false, 'message' => 'No se encontró una reserva con ese código']);
            }

            // Validar tipo real por contenido (no solo extensión).
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = (string) $finfo->file($f['tmp_name']);
            $permitidos = ['application/pdf', 'image/jpeg', 'image/png'];
            if (!in_array($mime, $permitidos, true)) {
                responder(['success' => false, 'message' => 'Formato no permitido (PDF, JPG o PNG)']);
            }
            $ext = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png'][$mime];

            $dir = __DIR__ . '/../comprobantes/' . $modalidad;
            if (!is_dir($dir) && !mkdir($dir, 0777, true)) {
                responder(['success' => false, 'message' => 'No se pudo crear la carpeta de comprobantes']);
            }
            $nombreFinal = $codigo . '_' . date('YmdHis') . '.' . $ext;
            if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $nombreFinal)) {
                responder(['success' => false, 'message' => 'No se pudo guardar el comprobante']);
            }

            $pdo->prepare(
                'INSERT INTO comprobantes (reserva_modalidad, reserva_pk, ruta, nombre_original, mime, tamano_bytes, subido_por)
                 VALUES (?, ?, ?, ?, ?, ?, \'cliente\')'
            )->execute([
                $modalidad,
                (int) $reserva['id'],
                'comprobantes/' . $modalidad . '/' . $nombreFinal,
                (string) $f['name'],
                $mime,
                (int) $f['size'],
            ]);

            // Avisar al administrador que llegó un comprobante. Como el aviso al
            // admin está deshabilitado por defecto (notif_enviar_admin), no se
            // encola: la verificación del comprobante se hace desde el panel.
            $mailAdmin = avisoAdminHabilitado($pdo, $config) ? configSistema($pdo, 'mail_admin') : '';
            if ($mailAdmin !== '') {
                encolarNotificacion($pdo, $modalidad, (int) $reserva['id'], 'pago_recibido', $mailAdmin, 'admin');
            }

            responder([
                'success'  => true,
                'codigo'   => $codigo,
                'mensaje'  => 'Comprobante recibido. El administrador lo verificará y confirmará tu reserva.',
            ]);
            break;

        // ---------- Ver/descargar comprobante (admin) ----------
        case 'adminComprobante':
            requiereRol(['admin']);
            $id = (int) parametro('id');
            if ($id <= 0) {
                responder(['success' => false, 'message' => 'ID inválido']);
            }
            $stmt = $pdo->prepare('SELECT ruta, nombre_original, mime FROM comprobantes WHERE id = ?');
            $stmt->execute([$id]);
            $c = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($c === false) {
                responder(['success' => false, 'message' => 'Comprobante no encontrado']);
            }
            $rutaAbs = __DIR__ . '/../' . $c['ruta'];
            if (!is_file($rutaAbs)) {
                responder(['success' => false, 'message' => 'El archivo no está disponible']);
            }
            header_remove('Content-Type');
            header('Content-Type: ' . ($c['mime'] ?: 'application/octet-stream'));
            header('Content-Disposition: inline; filename="' . basename((string) $c['nombre_original']) . '"');
            header('Content-Length: ' . filesize($rutaAbs));
            readfile($rutaAbs);
            exit;

        // ---------- Worker de notificaciones (cron) ----------
        case 'procesarNotificaciones':
            $token = trim(parametro('token'));
            $tokEsperado = (string) ($config['cron_token'] ?? '');
            if ($tokEsperado !== '' && $token !== $tokEsperado) {
                responder(['success' => false, 'message' => 'No autorizado']);
            }
            $resultado = procesarNotificaciones($pdo, $config);
            $vencidos  = tareasVencimiento($pdo);
            responder(['success' => true, 'enviados' => $resultado['enviados'], 'fallidos' => $resultado['fallidos'], 'vencimientos' => $vencidos]);
            break;

        case 'tareasVencimiento':
            $token = trim(parametro('token'));
            $tokEsperado = (string) ($config['cron_token'] ?? '');
            if ($tokEsperado !== '' && $token !== $tokEsperado) {
                responder(['success' => false, 'message' => 'No autorizado']);
            }
            responder(['success' => true, 'vencimientos' => tareasVencimiento($pdo)]);
            break;

        // ---------- Acción desconocida ----------
        default:
            responder(['success' => false, 'message' => 'Acción no válida']);
    }
} catch (Throwable $e) {
    error_log('[med_albergues] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    responder(['success' => false, 'message' => 'Error en el servidor']);
}
function generarCodigoPublico(PDO $pdo): string
{
    $stmt = $pdo->prepare("SELECT 'R-' || LPAD(nextval('reserva_publica_seq')::text, 6, '0') AS codigo");
    $stmt->execute();
    $row = $stmt->fetch();
    return (string) $row['codigo'];
}
