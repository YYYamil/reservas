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
    $stmt = $pdo->prepare('SELECT id, clave, nombre, capacidad FROM albergues WHERE nombre = ?');
    $stmt->execute([$nombre]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function alberguePorClave(PDO $pdo, string $clave): ?array
{
    $stmt = $pdo->prepare('SELECT id, clave, nombre, capacidad FROM albergues WHERE clave = ?');
    $stmt->execute([$clave]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/**
 * Capacidad y cantidad ocupada de visita diaria para una fecha y albergue.
 * La disponibilidad se deriva siempre de las reservas existentes
 * (solo las que consumen capacidad: pernocta = 'Sí').
 */
function capacidadYOcupadosVisitas(PDO $pdo, int $albergueId, string $fecha): array
{
    $sql = 'SELECT al.capacidad,
                   COALESCE(SUM(r.cantidad), 0) AS ocupados
            FROM albergues al
            LEFT JOIN reservas_visitas r
              ON r.albergue_id = al.id
             AND r.fecha_ingreso = :fecha
             AND r.pernocta = :pernocta
            WHERE al.id = :albergue
            GROUP BY al.id';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        'fecha'    => $fecha,
        'pernocta' => 'Sí',
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
            LEFT JOIN reserva_alojamiento_dias d ON d.fecha = :fecha
            LEFT JOIN reservas_alojamiento r
              ON r.id = d.reserva_id
             AND r.albergue_id = al.id
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
 * Espejo de solo lectura para las planillas de Google (opción "pull"):
 * devuelve las reservas en las columnas exactas que definió el usuario.
 * Si hay espejo_token configurado, exige ?token= compatible.
 */
function espejoDatos(PDO $pdo, string $tipo): void
{
    global $config;
    $tokenEsperado = (string) ($config['espejo_token'] ?? '');
    if ($tokenEsperado !== '' && (string) ($_GET['token'] ?? '') !== $tokenEsperado) {
        responder(['success' => false, 'mensaje' => 'No autorizado'], 403);
    }

    if ($tipo === 'visitas') {
        $columnas = [
            'id_Reserva', 'Fecha de Tramite', 'Albergue', 'Institución/Delegación',
            'Responsable', 'DNI', 'Contacto', 'Cantidad de Personas',
            'Fecha de Ingreso', 'Hora de Ingreso', 'Hora de Egreso',
        ];
        $sql = 'SELECT r.id_reserva,
                       r.created_at,
                       al.nombre,
                       r.institucion,
                       r.responsable,
                       r.dni,
                       r.contacto,
                       r.cantidad,
                       r.fecha_ingreso,
                       r.hora_ingreso,
                       r.hora_egreso
                FROM reservas_visitas r
                JOIN albergues al ON al.id = r.albergue_id
                ORDER BY r.created_at, r.id';
    } else {
        $columnas = [
            'id_Reserva', 'Fecha Creación', 'Albergue', 'Institución',
            'Nombre Responsable', 'DNI Responsable', 'Contacto',
            'Cantidad Camas Reservadas', 'Dias de estadía',
        ];
        $sql = 'SELECT r.id_reserva,
                       r.created_at,
                       al.nombre,
                       r.institucion,
                       r.responsable,
                       r.dni,
                       r.contacto,
                       r.cantidad,
                       (SELECT COUNT(*) FROM reserva_alojamiento_dias d
                         WHERE d.reserva_id = r.id) AS dias
                FROM reservas_alojamiento r
                JOIN albergues al ON al.id = r.albergue_id
                ORDER BY r.created_at, r.id';
    }

    $filas = [];
    foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_NUM) as $fila) {
        $filas[] = array_map(static fn ($v) => $v === null ? '' : (string) $v, $fila);
    }

    responder([
        'success'  => true,
        'columnas' => $columnas,
        'filas'    => $filas,
    ]);
}

/**
 * Exige sesión de administrador activa (panel /admin).
 */
function requiereAdmin(): void
{
    if (empty($_SESSION['admin_logged'])) {
        responder(['success' => false, 'message' => 'No autorizado'], 401);
    }
}

// ============================= PROCESAMIENTO =============================

$data = array_merge($_GET, $_POST);
$action = (string) ($data['action'] ?? '');

$actionsAdmin = ['adminLogin', 'adminLogout', 'adminReservas', 'adminTotales'];
if (in_array($action, $actionsAdmin, true)) {
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
            $cantidad       = (int) parametro('cantidad');
            $fechaIngreso   = trim(parametro('fechaIngreso'));
            $horaIngreso    = trim(parametro('horaIngreso'));
            $horaEgreso     = trim(parametro('horaEgreso'));
            $pernoctaRaw    = strtolower(trim(parametro('pernocta', 'false')));

            if ($albergueNombre === '' || $institucion === '' || $responsable === ''
                || $dni === '' || $contacto === '' || $fechaIngreso === ''
                || $horaIngreso === '' || $horaEgreso === '') {
                responder(['success' => false, 'message' => 'Complete todos los campos']);
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
            if ($alb === null || (int) $alb['capacidad'] <= 0) {
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
                    if ((int) $alb['capacidad'] - $ocupados - $cantidad < 0) {
                        $pdo->rollBack();
                        responder(['success' => false]); // mismo comportamiento que Apps Script: sin mensaje
                    }
                }

                $stmt = $pdo->prepare(
                    'INSERT INTO reservas_visitas
                        (id_reserva, albergue_id, institucion, responsable, dni, contacto,
                         cantidad, fecha_ingreso, hora_ingreso, hora_egreso, pernocta, estado, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $stmt->execute([
                    $nuevoId,
                    $alb['id'],
                    $institucion,
                    $responsable,
                    $dni,
                    $contacto,
                    $cantidad,
                    $fechaIngreso,
                    $horaIngreso,
                    $horaEgreso,
                    $esPernocta ? 'Sí' : 'No',
                    'Pre-Reserva',
                    date('Y-m-d H:i:s'),
                ]);

                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }

            responder(['success' => true, 'idReserva' => $nuevoId]);
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
                // 1) Buscar en reservas de visita
                $stmt = $pdo->prepare('SELECT id FROM reservas_visitas WHERE id_reserva = ? AND dni = ?');
                $stmt->execute([$idRaw, $dniR]);
                $visitas = $stmt->fetchAll();

                if ($visitas) {
                    $del = $pdo->prepare('DELETE FROM reservas_visitas WHERE id_reserva = ? AND dni = ?');
                    $del->execute([$idRaw, $dniR]);
                    $borradas = $del->rowCount();

                    $pdo->commit();
                    responder(['success' => true, 'message' => "Cancelada {$borradas} Reserva"]);
                }

                // 2) Si no existe en visitas, buscar en alojamiento
                $stmt = $pdo->prepare(
                    'SELECT ra.id,
                            (SELECT COUNT(*) FROM reserva_alojamiento_dias d
                              WHERE d.reserva_id = ra.id) AS dias
                     FROM reservas_alojamiento ra
                     WHERE ra.id_reserva = ? AND ra.dni = ?'
                );
                $stmt->execute([$idRaw, $dniR]);
                $alo = $stmt->fetchAll();

                if (!$alo) {
                    $pdo->rollBack();
                    responder(['success' => false, 'message' => 'No se encontró una reserva con ese número y DNI']);
                }

                $diasBorrados = (int) array_sum(array_column($alo, 'dias'));

                $delAlo = $pdo->prepare('DELETE FROM reservas_alojamiento WHERE id_reserva = ? AND dni = ?');
                $delAlo->execute([$idRaw, $dniR]);
                $borradasAlo = $delAlo->rowCount();

                $pdo->commit();
                responder([
                    'success' => true,
                    'message' => "Cancelada {$borradasAlo} Reserva de {$diasBorrados} dias",
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

        // ---------- Crear reserva de alojamiento ----------
        case 'crearReservaAlojamiento':
            $albergueNombre = trim(parametro('albergue'));
            $institucion    = trim(parametro('institucion'));
            $responsable    = trim(parametro('responsable'));
            $dni            = trim(parametro('dni'));
            $contacto       = trim(parametro('contacto'));
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

            if ($institucion === '' || $responsable === '' || $dni === '' || $contacto === '') {
                responder(['success' => false, 'message' => 'Complete todos los campos']);
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

                $stmt = $pdo->prepare(
                    'INSERT INTO reservas_alojamiento
                        (id_reserva, albergue_id, institucion, responsable, dni, contacto,
                         cantidad, rango_fechas, estado, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $stmt->execute([
                    $nuevoId,
                    $alb['id'],
                    $institucion,
                    $responsable,
                    $dni,
                    $contacto,
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
            if (hash_equals($config['admin_user'], $usuario)
                && hash_equals($config['admin_pass'], $pass)) {
                $_SESSION['admin_logged'] = true;
                responder(['success' => true]);
            }
            responder(['success' => false, 'message' => 'Credenciales inválidas'], 401);
            break;

        case 'adminLogout':
            session_destroy();
            responder(['success' => true]);
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

            $totales = [
                'visitas'      => (int) $pdo->query('SELECT count(*) FROM reservas_visitas')->fetchColumn(),
                'alojamientos' => (int) $pdo->query('SELECT count(*) FROM reservas_alojamiento')->fetchColumn(),
            ];

            $v7 = $pdo->prepare('SELECT count(*) FROM reservas_visitas WHERE fecha_ingreso BETWEEN :h AND :f');
            $v7->execute(['h' => $hoy, 'f' => $f7]);
            $totales['visitas_proximos7'] = (int) $v7->fetchColumn();

            $a7 = $pdo->prepare(
                'SELECT count(DISTINCT r.id) FROM reservas_alojamiento r
                 JOIN reserva_alojamiento_dias d ON d.reserva_id = r.id
                 WHERE d.fecha BETWEEN :h AND :f'
            );
            $a7->execute(['h' => $hoy, 'f' => $f7]);
            $totales['aloj_proximos7'] = (int) $a7->fetchColumn();

            $porAlbergue = $pdo->query(
                'SELECT al.id, al.nombre AS albergue, al.capacidad,
                        (SELECT count(*) FROM reservas_visitas rv WHERE rv.albergue_id = al.id) AS visitas,
                        (SELECT count(*) FROM reservas_alojamiento ra WHERE ra.albergue_id = al.id) AS alojamientos
                 FROM albergues al
                 ORDER BY al.id'
            )->fetchAll(PDO::FETCH_ASSOC);

            $estados = $pdo->query(
                'SELECT DISTINCT estado FROM (
                    SELECT estado FROM reservas_visitas
                    UNION
                    SELECT estado FROM reservas_alojamiento
                 ) t ORDER BY estado'
            )->fetchAll(PDO::FETCH_COLUMN);

            responder([
                'success'      => true,
                'totales'      => $totales,
                'por_albergue' => $porAlbergue,
                'estados'      => $estados,
            ]);
            break;

        // ---------- Espejo para Google Sheets (vista de solo lectura) ----------
        case 'espejoVisitas':
            espejoDatos($pdo, 'visitas');
            break;

        case 'espejoAlojamiento':
            espejoDatos($pdo, 'alojamiento');
            break;

        // ---------- Acción desconocida ----------
        default:
            responder(['success' => false, 'message' => 'Acción no válida']);
    }
} catch (Throwable $e) {
    error_log('[med_albergues] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    responder(['success' => false, 'message' => 'Error en el servidor']);
}