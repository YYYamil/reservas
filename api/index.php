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
    $stmt = $pdo->prepare('SELECT id, clave, nombre, capacidad, capacidad_visitas FROM albergues WHERE nombre = ?');
    $stmt->execute([$nombre]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function alberguePorClave(PDO $pdo, string $clave): ?array
{
    $stmt = $pdo->prepare('SELECT id, clave, nombre, capacidad, capacidad_visitas FROM albergues WHERE clave = ?');
    $stmt->execute([$clave]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/**
 * Capacidad y cantidad ocupada de visita diaria para una fecha y albergue.
 * La disponibilidad se deriva siempre de las reservas existentes
 * (solo las que consumen capacidad: pernocta = 'Sí').
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
        'SELECT id, clave, nombre, capacidad, capacidad_visitas, descripcion, habilitado, color, mapa, pdf
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
    if (isset($http_response_header)) {
        foreach (array_reverse($http_response_header) as $cabecera) {
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
    'adminAlbergueSubirArchivo',
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
            $pernoctaRaw    = strtolower(trim(parametro('pernocta', 'false')));

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

            $hospeda   = ($horaEgreso === 'Pasar la noche');
            $esPernocta = $hospeda
                || in_array($pernoctaRaw, ['true', '1', 'sí', 'si'], true);

            $alb = alberguePorNombre($pdo, $albergueNombre);
            $capacidadMaxVis = (int) ($alb['capacidad_visitas'] ?? $alb['capacidad']);
            if ($alb === null || $capacidadMaxVis <= 0) {
                responder(['success' => false, 'message' => 'Albergue no configurado']);
            }

            $nuevoId = nuevoIdReserva();

            // Transacción con bloqueo de la fila del albergue (equivale al
            // BEGIN IMMEDIATE de SQLite): se revalida disponibilidad para
            // evitar reservas simultáneas sobre la misma capacidad.
            $pdo->beginTransaction();
            $lock = $pdo->prepare('SELECT id FROM albergues WHERE id = ? FOR UPDATE');
            $lock->execute([$alb['id']]);
            try {
                if ($esPernocta) {
                    [$capacidad, $ocupados] = capacidadYOcupadosVisitas($pdo, (int) $alb['id'], $fechaIngreso);
                    if ($capacidadMaxVis - $ocupados - $cantidad < 0) {
                        $pdo->rollBack();
                        responder(['success' => false]); // mismo comportamiento que Apps Script: sin mensaje
                    }
                }

                $codigoPublico = generarCodigoPublico($pdo);

                $stmt = $pdo->prepare(
                    'INSERT INTO reservas_visitas
                        (id_reserva, codigo_publico, albergue_id, institucion, responsable, dni, contacto, email,
                         cantidad, fecha_ingreso, hora_ingreso, hora_egreso, pernocta, estado, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
                    $esPernocta ? 'Sí' : 'No',
                    'Pre-Reserva',
                    date('Y-m-d H:i:s'),
                ]);

                $pdo->commit();
                responder([
                    'success'       => true,
                    'idReserva'     => $nuevoId,
                    'codigoPublico' => $codigoPublico,
                    'codigo_publico'=> $codigoPublico,
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

            $pdo->beginTransaction();
            try {
                // 1) Buscar por codigo_publico primero (identificador global)
                $stmt = $pdo->prepare('SELECT id, estado FROM reservas_visitas WHERE codigo_publico = ? AND dni = ?');
                $stmt->execute([$idRaw, $dniR]);
                $visitas = $stmt->fetchAll();

                if ($visitas) {
                    $up = $pdo->prepare('UPDATE reservas_visitas SET estado = \'Cancelado\' WHERE codigo_publico = ? AND dni = ?');
                    $up->execute([$idRaw, $dniR]);
                    $pdo->commit();
                    responder(['success' => true, 'message' => 'Reserva cancelada correctamente']);
                }

                $stmt = $pdo->prepare(
                    'SELECT ra.id,
                            ra.estado,
                            (SELECT COUNT(*) FROM reserva_alojamiento_dias d
                              WHERE d.reserva_id = ra.id) AS dias
                     FROM reservas_alojamiento ra
                     WHERE ra.codigo_publico = ? AND ra.dni = ?'
                );
                $stmt->execute([$idRaw, $dniR]);
                $alo = $stmt->fetchAll();

                if ($alo) {
                    $upAlo = $pdo->prepare('UPDATE reservas_alojamiento SET estado = \'Cancelado\' WHERE codigo_publico = ? AND dni = ?');
                    $upAlo->execute([$idRaw, $dniR]);
                    $pdo->commit();
                    responder(['success' => true, 'message' => 'Reserva cancelada correctamente']);
                }

                // 2) Fallback: compatibilidad con id_reserva + dni (form actual)
                $stmt = $pdo->prepare('SELECT id, estado FROM reservas_visitas WHERE id_reserva = ? AND dni = ?');
                $stmt->execute([$idRaw, $dniR]);
                $visitas2 = $stmt->fetchAll();

                if ($visitas2) {
                    $up = $pdo->prepare('UPDATE reservas_visitas SET estado = \'Cancelado\' WHERE id_reserva = ? AND dni = ?');
                    $up->execute([$idRaw, $dniR]);
                    $pdo->commit();
                    responder(['success' => true, 'message' => 'Reserva cancelada correctamente']);
                }

                $stmt = $pdo->prepare(
                    'SELECT ra.id,
                            ra.estado,
                            (SELECT COUNT(*) FROM reserva_alojamiento_dias d
                              WHERE d.reserva_id = ra.id) AS dias
                     FROM reservas_alojamiento ra
                     WHERE ra.id_reserva = ? AND ra.dni = ?'
                );
                $stmt->execute([$idRaw, $dniR]);
                $alo2 = $stmt->fetchAll();

                if (!$alo2) {
                    $pdo->rollBack();
                    responder(['success' => false, 'message' => 'No se encontró una reserva con ese número y DNI']);
                }

                $upAlo = $pdo->prepare('UPDATE reservas_alojamiento SET estado = \'Cancelado\' WHERE id_reserva = ? AND dni = ?');
                $upAlo->execute([$idRaw, $dniR]);
                $canceladasAlo = $upAlo->rowCount();

                $pdo->commit();
                responder([
                    'success' => true,
                    'message' => "Cancelada {$canceladasAlo} Reserva",
                ]);
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
                         cantidad, rango_fechas, estado, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
                ]);
                $reservaPk = (int) $pdo->lastInsertId();

                $insDia = $pdo->prepare(
                    'INSERT INTO reserva_alojamiento_dias (reserva_id, fecha, cantidad) VALUES (?, ?, ?)'
                );
                foreach ($rango as $fecha) {
                    $insDia->execute([$reservaPk, $fecha, $cantidad]);
                }

                $pdo->commit();
                responder([
                    'success'        => true,
                    'idReserva'      => $nuevoId,
                    'codigoPublico'  => $codigoPublico,
                    'codigo_publico' => $codigoPublico,
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
                $sql .= ' AND (institucion ILIKE :q OR responsable ILIKE :q OR dni ILIKE :q)';
                $params['q'] = '%' . $q . '%';
            }
            $sql .= ' ORDER BY created_at DESC, modalidad, id_reserva';

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
            $stmt  = $pdo->prepare("UPDATE {$tabla} SET estado = :estado WHERE id = :pk");
            $stmt->execute(['estado' => $estado, 'pk' => $pk]);
            if ($stmt->rowCount() === 0) {
                responder(['success' => false, 'message' => 'No se encontró la reserva']);
            }
            responder(['success' => true]);
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
            responder(['success' => true, 'albergues' => $salida]);
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
            $descripcion = trim(parametro('descripcion'));
            $color = trim(parametro('color')) !== '' ? trim(parametro('color')) : '#005CA2';
            $mapa = urlMapaNormalizada(parametro('mapa'));
            $pdf = trim(parametro('pdf'));
            $habilitado = parametro('habilitado', '1') === '1' ? 't' : 'f';

            if ($clave === '' || $nombre === '' || $capacidad <= 0) {
                responder(['success' => false, 'message' => 'Complete clave, nombre y capacidad (> 0)']);
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
                    'INSERT INTO albergues (clave, nombre, capacidad, descripcion, habilitado, color, mapa, pdf)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $ins->execute([$clave, $nombre, $capacidad, $descripcion, $habilitado, $color, $mapa, $pdf]);
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
            $descripcion = trim(parametro('descripcion'));
            $color = trim(parametro('color')) !== '' ? trim(parametro('color')) : '#005CA2';
            $mapa = urlMapaNormalizada(parametro('mapa'));
            $pdf = trim(parametro('pdf'));
            $habilitado = parametro('habilitado', '1') === '1' ? 't' : 'f';

            if ($id <= 0 || $nombre === '' || $capacidad <= 0) {
                responder(['success' => false, 'message' => 'Faltan datos o capacidad inválida']);
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
                     SET nombre = ?, capacidad = ?, descripcion = ?, habilitado = ?, color = ?, mapa = ?, pdf = ?
                     WHERE id = ?'
                );
                $upd->execute([$nombre, $capacidad, $descripcion, $habilitado, $color, $mapa, $pdf, $id]);
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
