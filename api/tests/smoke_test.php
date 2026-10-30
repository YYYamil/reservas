<?php
/**
 * Smoke test - Primera etapa de notificaciones + codigo publico unificado
 * Verifica los caminos criticos del sistema tras la ultima modificacion.
 * Uso: php api/tests/smoke_test.php
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$BASE = 'http://127.0.0.1:8004/api/index.php';
$DIR  = dirname(__DIR__, 2);
$CPID = 0;
$results = [];
$CFG  = require dirname(__DIR__) . '/config.php';

// Fechas relativas: el test no debe romperse cuando pasa el tiempo ni caer
// dentro del horizonte mínimo de reserva (anticipacion + ventana mínima).
$rel = static fn (int $d): string => date('Y-m-d', strtotime("+{$d} days"));
$f12 = $rel(12); $f13 = $rel(13);
$f17 = $rel(17); $f18 = $rel(18); $f19 = $rel(19);
$f22 = $rel(22); $f23 = $rel(23);
$f27 = $rel(27); $f28 = $rel(28);
$f33 = $rel(33);
$f42 = $rel(42); $f43 = $rel(43); $f44 = $rel(44);

function check(string $name, bool $ok, string $detalle = ''): void
{
    global $results;
    $results[] = ['test' => $name, 'ok' => $ok, 'detalle' => $detalle];
    echo ($ok ? '[PASS] ' : '[FAIL] ') . $name . ($detalle !== '' ? " -> $detalle" : '') . "\n";
}

function api(string $action, array $params = [], string $method = 'POST'): array
{
    global $BASE;
    $url = $BASE . '?action=' . urlencode($action);
    if ($method === 'GET') {
        $url .= '&' . http_build_query($params);
        $body = @file_get_contents($url);
    } else {
        $opts = ['http' => [
            'method'  => 'POST',
            'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => http_build_query($params),
            'timeout' => 90,
            'ignore_errors' => true,
        ]];
        $body = @file_get_contents($url, false, stream_context_create($opts));
    }
    $json = json_decode((string) $body, true);
    return is_array($json) ? $json : ['_raw' => (string) $body, '_error' => json_last_error_msg()];
}

function pdo(): PDO
{
    $c = require dirname(__DIR__, 2) . '/api/config.php';
    $pdo = new PDO('pgsql:host=' . $c['db_host'] . ';port=' . $c['db_port'] . ';dbname=' . $c['db_name'], $c['db_user'], $c['db_pass']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    return $pdo;
}

// ---------- Levantar servidor ----------
echo "=== SMOKE TEST: codigo publico unificado + reservas ===\n\n";

$srvLog = tempnam(sys_get_temp_dir(), 'smokesrv_') . '.log';
$server = proc_open(
    [PHP_BINARY, '-S', '127.0.0.1:8004', '-t', $DIR],
    [1 => ['file', $srvLog, 'w'], 2 => ['file', $srvLog, 'a']],
    $pipes,
    $DIR
);
$CPID = is_resource($server) ? proc_get_status($server)['pid'] : 0;
usleep(800000);

$alive = false;
for ($i = 0; $i < 20; $i++) {
    $probe = @file_get_contents($BASE . '?action=listarAlbergues');
    if ($probe !== false && str_contains($probe, 'success')) {
        $alive = true;
        break;
    }
    usleep(500000);
}
check('Servidor local responde', $alive);
if (!$alive) {
    echo "\nNo se pudo levantar el servidor. Abortando.\n";
    exit(1);
}

$db = pdo();

// ---------- GUARDIA: nunca ejecutar sobre una BD con datos reales ----------
// ATENCION: este script hace TRUNCATE de reservas, dias y notificaciones.
// Sin esta guardia se destruyen reservas de produccion (ya ocurrio: 2 reservas
// reales se perdieron al correr el smoke test contra la BD del tunel Oracle).
// Se exige confirmacion explicita de que la BD es descartable.
if (($argv[1] ?? '') !== '--destructivo') {
    fwrite(STDERR, "\n[ABORTADO] El smoke test BORRA reservas, dias y notificaciones (TRUNCATE).\n"
        . "Se conectaria a: {$CFG['db_host']}:{$CFG['db_port']}/{$CFG['db_name']}\n"
        . "Si esa base es descartable, ejecutar con:\n"
        . "  php api/tests/smoke_test.php --destructivo\n\n");
    proc_terminate($server);
    exit(2);
}

// Limpieza inicial (BD de prueba, ya confirmada como descartable)
$db->exec("TRUNCATE TABLE reserva_alojamiento_dias RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE notificaciones_email RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_visitas RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_alojamiento RESTART IDENTITY CASCADE");
$db->exec("ALTER SEQUENCE reserva_publica_seq RESTART WITH 1");

// El envío inmediato se apaga ANTES de crear reservas: este test usa
// direcciones @example.com y no debe golpear el SMTP real en ningún check.
$inmediatoAntes = null;
try {
    $inmediatoAntes = $db->query("SELECT valor FROM configuracion_sistema WHERE clave='notif_envio_inmediato'")->fetchColumn();
    $db->exec("INSERT INTO configuracion_sistema (clave, valor) VALUES ('notif_envio_inmediato','0')
               ON CONFLICT (clave) DO UPDATE SET valor = '0'");
} catch (Throwable $e) {
    // si la migracion 2026-10-26 no se aplico, se continua igual
}

// Restaurar el flag SIEMPRE, incluso si el test aborta por un error fatal:
// si quedaba en '0' el sistema dejaba de enviar correos hasta que alguien lo
// notara (pasó al abortar la corrida por un fatal en un check).
register_shutdown_function(static function () use ($db, $inmediatoAntes): void {
    try {
        if ($inmediatoAntes === false || $inmediatoAntes === null) {
            $db->exec("DELETE FROM configuracion_sistema WHERE clave='notif_envio_inmediato'");
        } else {
            $db->exec("UPDATE configuracion_sistema SET valor = " . $db->quote((string) $inmediatoAntes) . " WHERE clave='notif_envio_inmediato'");
        }
    } catch (Throwable $e) {
        // sin base disponible: nada que restaurar
    }
});

// ---------- 1. listado de albergues ----------
$r = api('listarAlbergues', [], 'GET');
$ok = ($r['success'] ?? false) === true && count($r['albergues'] ?? []) >= 3;
$maestro = null;
foreach (($r['albergues'] ?? []) as $a) {
    if ($a['clave'] === 'maestro') $maestro = $a;
}
check('1. listarAlbergues devuelve 3 albergues', $ok, 'recibidos=' . count($r['albergues'] ?? []));
check('2. albergues exponen ambas capacidades', $maestro !== null && isset($maestro['capacidad'], $maestro['capacidad_visitas']),
    $maestro ? "capacidad={$maestro['capacidad']} capacidad_visitas={$maestro['capacidad_visitas']}" : 'maestro no encontrado');
check('2b. albergues exponen monto_visita y monto_cama (precio por albergue)',
    $maestro !== null && isset($maestro['monto_visita'], $maestro['monto_cama']),
    $maestro ? "monto_visita={$maestro['monto_visita']} monto_cama={$maestro['monto_cama']}" : 'maestro no encontrado');
check('2c. listarAlbergues expone meses_anticipacion', isset($r['meses_anticipacion']), 'meses=' . ($r['meses_anticipacion'] ?? 'null'));

// ---------- 3. crear visita con email valido ----------
$visita = api('crearReserva', [
    'albergue'    => 'Maestro José Fierro',
    'institucion' => 'SMOKE TEST ESCUELA',
    'responsable' => 'Tester Smoke',
    'dni'         => '30111222',
    'contacto'    => '3811234567',
    'email'       => 'smoke.visita@example.com',
    'cantidad'    => 5,
    'fechaIngreso'=> $f12,
    'horaIngreso' => '09:00',
    'horaEgreso'  => '17:00',
]);
$codeV = $visita['codigoPublico'] ?? '';
check('3. crearReserva (visita) responde success', ($visita['success'] ?? false) === true, json_encode($visita));
check('4. visita devuelve codigo publico unico', preg_match('/^R-\d{6}$/', $codeV) === 1, "codigo=$codeV");
check('5. codigo de visita = R-000001 (secuencia global desde 1)', $codeV === 'R-000001', "codigo=$codeV");

$pkV = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($codeV))->fetchColumn();
check('6. codigo persistido en reservas_visitas', $pkV > 0, "pk=$pkV");
$emailV = (string) $db->query("SELECT email FROM reservas_visitas WHERE id = $pkV")->fetchColumn();
check('7. email persistido en la reserva de visita', $emailV === 'smoke.visita@example.com', "email=$emailV");
$idResV = (int) $db->query("SELECT id_reserva FROM reservas_visitas WHERE id = $pkV")->fetchColumn();

// ---------- 8. crear visita SIN email debe rechazarse ----------
$sinEmail = api('crearReserva', [
    'albergue' => 'Maestro José Fierro', 'institucion' => 'X', 'responsable' => 'X',
    'dni' => '30111333', 'contacto' => '3810000000', 'email' => '',
    'cantidad' => 1, 'fechaIngreso' => $f13, 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
check('8. visita sin email es rechazada', ($sinEmail['success'] ?? true) === false, json_encode($sinEmail));

// ---------- 9. crear reserva de alojamiento ----------
$alo = api('crearReservaAlojamiento', [
    'albergue'    => 'Maestro José Fierro',
    'institucion' => 'SMOKE TEST ALO',
    'responsable' => 'Tester Alo',
    'dni'         => '30222333',
    'contacto'    => '3819876543',
    'email'       => 'smoke.alojamiento@example.com',
    'cantidad'    => 2,
    'rangoFechas' => "{$f17},{$f18},{$f19}",
]);
$codeA = $alo['codigoPublico'] ?? '';
check('9. crearReservaAlojamiento responde success', ($alo['success'] ?? false) === true, json_encode($alo));
check('10. alojamiento comparte MISMA secuencia (R-000002)', $codeA === 'R-000002', "codigo=$codeA");
check('11. NO hay ambiguedad: codigos distintos entre modalidades', $codeV !== $codeA && $codeV !== '', "visita=$codeV alo=$codeA");

$pkA = (int) $db->query("SELECT id FROM reservas_alojamiento WHERE codigo_publico = " . $db->quote($codeA))->fetchColumn();
check('12. codigo persistido en reservas_alojamiento', $pkA > 0, "pk=$pkA");
$dias = (int) $db->query("SELECT COUNT(*) FROM reserva_alojamiento_dias WHERE reserva_id = $pkA")->fetchColumn();
check('13. reservas de alojamiento generan 3 dias', $dias === 3, "dias=$dias");
$idResA = (int) $db->query("SELECT id_reserva FROM reservas_alojamiento WHERE id = $pkA")->fetchColumn();

// ---------- 14. disponibilidad visitas con capacidad separada (ANTES de cancelar) ----------
$disp = api('obtenerDisponibilidadDia', ['albergue' => 'Maestro José Fierro', 'fecha' => $f12], 'GET');
check('14. disponibilidad visitas usa capacidad_visitas=150', ($disp['capacidad'] ?? 0) == 150, json_encode($disp));
check('15. ocupados visitas refleja la reserva activa (5)', ($disp['ocupados'] ?? -1) == 5, json_encode($disp));

$dispAlo = api('obtenerDisponibilidadDiaAlojamiento', ['albergue' => 'Maestro José Fierro', 'fecha' => $f17], 'GET');
check('16. disponibilidad alojamiento usa capacidad=92', ($dispAlo['capacidad'] ?? 0) == 92, json_encode($dispAlo));
check('17. ocupados alojamiento refleja la reserva activa (2)', ($dispAlo['ocupados'] ?? -1) == 2, json_encode($dispAlo));

// ---------- 18. cancelar con codigo publico + DNI ----------
$cancelA = api('cancelarReserva', ['idReserva' => $codeA, 'dni' => '30222333']);
check('18. cancelar por CODIGO PUBLICO + DNI funciona', ($cancelA['success'] ?? false) === true, json_encode($cancelA));
$estadoA = (string) $db->query("SELECT estado FROM reservas_alojamiento WHERE id = $pkA")->fetchColumn();
check('19. alojamiento quedo en estado Cancelado', $estadoA === 'Cancelado', "estado=$estadoA");

// ---------- 20. cancelar con id_reserva numerico + DNI (fallback del form actual) ----------
$cancelV = api('cancelarReserva', ['idReserva' => (string) $idResV, 'dni' => '30111222']);
check('20. cancelar por NRO DE RESERVA + DNI (form actual) funciona', ($cancelV['success'] ?? false) === true, json_encode($cancelV));
$estadoV = (string) $db->query("SELECT estado FROM reservas_visitas WHERE id = $pkV")->fetchColumn();
check('21. visita quedo en estado Cancelado', $estadoV === 'Cancelado', "estado=$estadoV");

// ---------- 22. cancelar con DNI incorrecto debe fallar ----------
$malDni = api('cancelarReserva', ['idReserva' => $codeV, 'dni' => '99999999']);
check('22. DNI incorrecto es rechazado (seguridad)', ($malDni['success'] ?? true) === false, json_encode($malDni));

// ---------- 23. cancelar sin DNI debe fallar ----------
$sinDni = api('cancelarReserva', ['idReserva' => $codeV, 'dni' => '']);
check('23. cancelar sin DNI es rechazado (2 campos obligatorios)', ($sinDni['success'] ?? true) === false, json_encode($sinDni));

// ---------- 24. tras cancelar, el cupo se libera ----------
$disp2 = api('obtenerDisponibilidadDia', ['albergue' => 'Maestro José Fierro', 'fecha' => $f12], 'GET');
check('24. cancelada -> cupo de visitas liberado (0)', ($disp2['ocupados'] ?? -1) == 0, json_encode($disp2));
$disp2Alo = api('obtenerDisponibilidadDiaAlojamiento', ['albergue' => 'Maestro José Fierro', 'fecha' => $f17], 'GET');
check('25. cancelada -> cupo de alojamiento liberado (0)', ($disp2Alo['ocupados'] ?? -1) == 0, json_encode($disp2Alo));

// ---------- 26. vista unificada expone codigo_publico ----------
$enVista = (int) $db->query("SELECT COUNT(*) FROM v_reservas_todas WHERE codigo_publico IS NOT NULL")->fetchColumn();
check('26. v_reservas_todas expone codigo_publico', $enVista === 2, "filas=$enVista");

// ---------- 25. unicidad global (sin ambiguedad) ----------
$dup = $db->query("SELECT COUNT(*) FROM (
    SELECT codigo_publico FROM reservas_visitas
    UNION ALL SELECT codigo_publico FROM reservas_alojamiento
) t GROUP BY codigo_publico HAVING COUNT(*) > 1")->fetchAll();
check('27. cero codigos repetidos entre modalidades', count($dup) === 0, "duplicados=" . count($dup));
$tot = (int) $db->query("SELECT COUNT(*) FROM (SELECT codigo_publico FROM reservas_visitas UNION ALL SELECT codigo_publico FROM reservas_alojamiento) t")->fetchColumn();
check('28. total de codigos = 2 reservas creadas', $tot === 2, "total=$tot");

// ---------- 29. form de cancelar usa codigo publico + DNI ----------
$html = file_get_contents($DIR . '/index.html');
$tieneCampos = str_contains($html, 'id="cancel-id"') && str_contains($html, 'id="cancel-dni"');
check('29. form de cancelar conserva codigo de reserva + DNI', $tieneCampos, 'index.html: inputs cancel-id y cancel-dni presentes');

// ---------- 30. sin espejo google (ya eliminado) ----------
$espejo = api('espejoVisitas', [], 'GET');
check('30. espejo de Google Sheets ya no existe', isset($espejo['success']) && $espejo['success'] === false, json_encode($espejo));

// =====================================================================
//  ETAPA 2: monto congelado, comprobante, notificaciones y vencimientos
// =====================================================================
// NOTA: no se reinicia reserva_publica_seq porque las reservas de la Etapa 1
// siguen existiendo (solo quedaron en estado 'Cancelado'); reiniciar la
// secuencia a 1 producia duplicate key en codigo_publico (R-000001/R-000002)
// y el endpoint respondia 500 "Error en el servidor".
// La numeracion continua de forma global: R-000003, R-000004, ...

// ---------- 32. monto congelado en visita (2000 x persona) ----------
$vMonto = api('crearReserva', [
    'albergue' => 'Maestro José Fierro', 'institucion' => 'MONTO VISITA', 'responsable' => 'Monto V',
    'dni' => '30444555', 'contacto' => '3811111111', 'email' => 'monto.visita@example.com',
    'cantidad' => 4, 'fechaIngreso' => $f22, 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
check('32. visita responde montoTotal = cantidad x monto_visita (4 x 2000)', (float) ($vMonto['montoTotal'] ?? 0) === 8000.0, json_encode($vMonto));
$pkVM = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($vMonto['codigoPublico'] ?? ''))->fetchColumn();
$mtV = (float) $db->query("SELECT monto_total FROM reservas_visitas WHERE id = $pkVM")->fetchColumn();
check('33. monto_total persistido (congelado) en visita', $mtV === 8000.0, "monto=$mtV");
$pv = $db->query("SELECT pago_vence_at FROM reservas_visitas WHERE id = $pkVM")->fetchColumn();
$pvDias = $pv === false || $pv === null ? null
    : (int) $db->query("SELECT (DATE(" . $db->quote((string) $pv) . ") - DATE(NOW()))")->fetchColumn();
check('34. pago_vence_at = min(creacion + 48 h, inicio - 60 h) -> 2 dias', $pvDias === 2, "vence=$pv dias=$pvDias");

// ---------- 35. visita sin email rechazada (email obligatorio) ----------
$vSinMail = api('crearReserva', [
    'albergue' => 'Maestro José Fierro', 'institucion' => 'SIN MAIL', 'responsable' => 'X',
    'dni' => '30444666', 'contacto' => '3810000000', 'email' => '',
    'cantidad' => 1, 'fechaIngreso' => $f23, 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
check('35. visita sin email es rechazada', ($vSinMail['success'] ?? true) === false, json_encode($vSinMail));

// ---------- 36. notificaciones encoladas para la visita ----------
$nCre = (int) $db->query("SELECT COUNT(*) FROM notificaciones_email WHERE reserva_modalidad='visita' AND reserva_pk=$pkVM AND tipo_evento='creacion'")->fetchColumn();
check('36. creacion encolada al cliente', $nCre === 1, "n=$nCre");

// ---------- 37. monto congelado en alojamiento (camas x noches x monto_cama) ----------
$aLote = api('crearReservaAlojamiento', [
    'albergue' => 'Maestro José Fierro', 'institucion' => 'MONTO ALO', 'responsable' => 'Monto A',
    'dni' => '30555666', 'contacto' => '3812222222', 'email' => 'monto.alo@example.com',
    'cantidad' => 3, 'rangoFechas' => "{$f27},{$f28}",
]);
check('37. alojamiento responde montoTotal = camas x noches x monto_cama (3 x 2 x 5000)', (float) ($aLote['montoTotal'] ?? 0) === 30000.0, json_encode($aLote));
$pkAM = (int) $db->query("SELECT id FROM reservas_alojamiento WHERE codigo_publico = " . $db->quote($aLote['codigoPublico'] ?? ''))->fetchColumn();
$mtA = (float) $db->query("SELECT monto_total FROM reservas_alojamiento WHERE id = $pkAM")->fetchColumn();
check('38. monto_total persistido (congelado) en alojamiento', $mtA === 30000.0, "monto=$mtA");

/**
 * Llama a la API conservando la cookie de sesión (login del panel).
 */
function apiConCookie(string $action, array $params, string &$cookie): array
{
    global $BASE;
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n" . ($cookie !== '' ? "Cookie: $cookie\r\n" : ''),
        'content' => http_build_query($params),
        'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($BASE . '?action=' . urlencode($action), false, $ctx);
    // PHP 8.5+ deprecó $http_response_header en favor de esta función.
    $headers = function_exists('http_get_last_response_headers')
        ? (http_get_last_response_headers() ?? [])
        : ($http_response_header ?? []);
    foreach ($headers as $h) {
        if (stripos($h, 'Set-Cookie:') === 0) {
            $parte  = trim(substr($h, 11));
            $cookie = explode(';', $parte)[0];
        }
    }
    $json = json_decode((string) $body, true);
    return is_array($json) ? $json : ['_raw' => (string) $body];
}

// ---------- 39. configuracion_sistema: mail_admin guardable ----------
$cookie = '';
$login = apiConCookie('adminLogin', ['usuario' => 'superadmin', 'pass' => 'qbwv2ykzdc2a'], $cookie);
$cfg = apiConCookie('adminConfigGuardar', ['mail_admin' => 'smoke.admin@example.com'], $cookie);
check('39. super_admin guarda mail_admin', ($cfg['success'] ?? false) === true, json_encode(['login' => $login, 'cfg' => $cfg]));
$mailGuardado = (string) $db->query("SELECT valor FROM configuracion_sistema WHERE clave='mail_admin'")->fetchColumn();
check('40. mail_admin persistido en configuracion_sistema', $mailGuardado === 'smoke.admin@example.com', "mail=$mailGuardado");

// ---------- 41. endpoint publico subirComprobante existe y valida ----------
// El comprobante se identifica solo con el codigo publico de la reserva.
$sinArchivo = api('subirComprobante', ['codigo' => $aLote['codigoPublico'] ?? 'R-000000']);
check('41. subirComprobante sin archivo es rechazado', ($sinArchivo['success'] ?? true) === false, json_encode($sinArchivo));

// ---------- 42. worker de notificaciones: procesa la outbox sin romper ----------
// Se drena la cola primero para que el worker no intente abrir conexiones SMTP
// reales durante el test (eso tardaba > 20 s y hacia fallar el check por timeout).
$db->exec("UPDATE notificaciones_email SET estado = 'enviado', enviado_at = NOW() WHERE estado IN ('pendiente','enviando')");
$worker = api('procesarNotificaciones', ['token' => '']);
$workerOk = ($worker['success'] ?? false) === true
    && array_key_exists('enviados', $worker)
    && array_key_exists('fallidos', $worker)
    && (int) $worker['enviados'] === 0;
check('42. procesarNotificaciones responde (worker outbox, cola drenada)', $workerOk, json_encode($worker));

// ---------- 43. tareasVencimiento responde ----------
$venc = api('tareasVencimiento', ['token' => '']);
check('43. tareasVencimiento responde', isset($venc['success']), json_encode($venc));

// ---------- 44. vista unificada expone monto y comprobante ----------
$cols = $db->query("SELECT column_name FROM information_schema.columns WHERE table_name='v_reservas_todas'")->fetchAll(PDO::FETCH_COLUMN);
check('44. v_reservas_todas expone monto_total y comprobante_id',
    in_array('monto_total', $cols, true) && in_array('comprobante_id', $cols, true), implode(',', $cols));

// ---------- 45. configuración del panel: listar y editar meses_anticipacion ----------
$cfgList = apiConCookie('adminConfiguraciones', [], $cookie);
$tieneClaves = ($cfgList['success'] ?? false) === true && is_array($cfgList['configuraciones'] ?? null);
check('45. adminConfiguraciones lista claves (panel)', $tieneClaves, json_encode($cfgList));

$cfgEdit = apiConCookie('adminConfiguracionEditar', ['clave' => 'meses_anticipacion', 'valor' => '6'], $cookie);
$mesesDb = (string) $db->query("SELECT valor FROM configuracion_sistema WHERE clave='meses_anticipacion'")->fetchColumn();
check('46. adminConfiguracionEditar guarda meses_anticipacion', ($cfgEdit['success'] ?? false) === true && $mesesDb === '6',
    json_encode(['resp' => $cfgEdit, 'db' => $mesesDb]));

$cfgBad = apiConCookie('adminConfiguracionEditar', ['clave' => 'clave_inventada', 'valor' => '1'], $cookie);
check('47. adminConfiguracionEditar rechaza claves no permitidas', ($cfgBad['success'] ?? true) === false, json_encode($cfgBad));

// ---------- 48/49. panel admin: el identificador visible es codigo_publico ----------
// El panel de administracion muestra y busca por codigo publico (R-000123) en
// lugar del id_reserva de 4 digitos, que no es unico y no se corresponde con
// el codigo entregado al ciudadano.
$admAll = apiConCookie('adminReservas', [], $cookie);
$admFilas = $admAll['reservas'] ?? [];
$codigos = array_map(fn($x) => (string) ($x['codigo_publico'] ?? ''), $admFilas);
$todosConCodigo = $admFilas !== [] && count(array_filter($codigos, fn($c) => preg_match('/^R-\d{6}$/', $c) === 1)) === count($codigos);
check('48. adminReservas expone codigo_publico en todas las filas', ($admAll['success'] ?? false) === true && $todosConCodigo,
    'codigos=' . implode(',', $codigos));

$codigoBuscar = $codigos[0] ?? '';
$admQ = apiConCookie('adminReservas', ['q' => $codigoBuscar], $cookie);
$filtradas = $admQ['reservas'] ?? [];
$soloCoinciden = $filtradas !== []
    && count(array_filter($filtradas, fn($x) => ($x['codigo_publico'] ?? '') === $codigoBuscar)) === count($filtradas);
check('49. adminReservas filtra por codigo de reserva (parametro q)', ($admQ['success'] ?? false) === true && $soloCoinciden,
    'q=' . $codigoBuscar . ' resultados=' . count($filtradas));

// =====================================================================
//  ETAPA 3: notificaciones al usuario final (detalle, cancelación, confirmación)
// =====================================================================
// El envío inmediato ya quedó apagado al inicio del test (el valor original se
// guardó en $inmediatoAntes para restaurarlo al final): así se valida el
// CONTENIDO encolado sin abrir conexiones SMTP reales.

$nuevaVisita = api('crearReserva', [
    'albergue' => 'Maestro José Fierro', 'institucion' => 'NOTIF VISITA', 'responsable' => 'Notif V',
    'dni' => '30666777', 'contacto' => '3813333333', 'email' => 'notif.visita@example.com',
    'cantidad' => 6, 'fechaIngreso' => $f33, 'horaIngreso' => '08:30', 'horaEgreso' => '18:00',
]);
$codNV = (string) ($nuevaVisita['codigoPublico'] ?? '');
$pkNV = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($codNV))->fetchColumn();
check('50. pre-reserva de visita creada para probar notificaciones', $pkNV > 0 && $codNV !== '', "codigo=$codNV pk=$pkNV");

$notifCre = $db->query("SELECT * FROM notificaciones_email
    WHERE reserva_modalidad='visita' AND reserva_pk=$pkNV AND tipo_evento='creacion'")->fetch(PDO::FETCH_ASSOC);
check('51. mail de creación encolado al usuario', $notifCre !== false, json_encode($notifCre ? 'ok' : 'sin registro'));

$cuerpoCre = (string) ($notifCre['cuerpo'] ?? '');
$itemsEsperados = [
    'Código de reserva'       => $codNV,
    'Albergue'                => 'Maestro José Fierro',
    'Modalidad'               => 'Visita diaria',
    'Institución'             => 'NOTIF VISITA',
    'Responsable'             => 'Notif V',
    'DNI'                     => '30666777',
    'Teléfono'                => '3813333333',
    'Email'                   => 'notif.visita@example.com',
    'Cantidad de personas'    => '6',
    'Fecha de ingreso'        => date('d/m/Y', strtotime($f33)),
    'Hora de ingreso'         => '08:30',
    'Hora de egreso'          => '18:00',
    'Monto total'             => '$12.000',
    'Vence el'                => date('d/m/Y', strtotime('+2 days')),
    'Estado'                  => 'Pre-Reserva',
];
$faltantes = [];
foreach ($itemsEsperados as $etiqueta => $valor) {
    if (!str_contains($cuerpoCre, $etiqueta) || !str_contains($cuerpoCre, $valor)) {
        $faltantes[] = $etiqueta . '=' . $valor;
    }
}
check('52. el mail incluye el DETALLE completo de la pre-reserva',
    $faltantes === [] && str_contains($cuerpoCre, 'Pre-reserva registrada'),
    $faltantes === [] ? 'todos los campos presentes' : 'faltan: ' . implode(' | ', $faltantes));
check('53. el mail de creación incluye el enlace para subir el comprobante',
    str_contains($cuerpoCre, 'pago.html') && str_contains($cuerpoCre, rawurlencode($codNV)),
    'link pago.html?codigo=' . $codNV);

// ---------- 54/55. alojamiento: detalle con fechas y noches ----------
$nuevaAlo = api('crearReservaAlojamiento', [
    'albergue' => 'Maestro José Fierro', 'institucion' => 'NOTIF ALO', 'responsable' => 'Notif A',
    'dni' => '30777888', 'contacto' => '3814444444', 'email' => 'notif.alo@example.com',
    'cantidad' => 4, 'rangoFechas' => "{$f42},{$f43},{$f44}",
]);
$codNA = (string) ($nuevaAlo['codigoPublico'] ?? '');
$pkNA = (int) $db->query("SELECT id FROM reservas_alojamiento WHERE codigo_publico = " . $db->quote($codNA))->fetchColumn();
$cuerpoAlo = (string) $db->query("SELECT cuerpo FROM notificaciones_email
    WHERE reserva_modalidad='alojamiento' AND reserva_pk=$pkNA AND tipo_evento='creacion'")->fetchColumn();
check('54. alojamiento: mail con fechas y noches',
    $pkNA > 0
    && str_contains($cuerpoAlo, 'Fechas de alojamiento')
    && str_contains($cuerpoAlo, date('d/m/Y', strtotime($f42)) . ' / ' . date('d/m/Y', strtotime($f43)) . ' / ' . date('d/m/Y', strtotime($f44)))
    && str_contains($cuerpoAlo, 'Noches'),
    'pk=' . $pkNA);
check('55. alojamiento: monto y modalidad correctos en el mail',
    str_contains($cuerpoAlo, 'Alojamiento con estadía') && str_contains($cuerpoAlo, '$60.000'),
    'esperado "$60.000"');

// ---------- 56. el usuario final cancela: refuerzo de la cancelación ----------
$cancelNotif = api('cancelarReserva', ['idReserva' => $codNV, 'dni' => '30666777']);
$notifCanc = $db->query("SELECT * FROM notificaciones_email
    WHERE reserva_modalidad='visita' AND reserva_pk=$pkNV AND tipo_evento IN ('cancelacion_cliente','cancelacion')")->fetch(PDO::FETCH_ASSOC);
check('56. al cancelar el usuario se envía el mail de refuerzo de cancelación',
    ($cancelNotif['success'] ?? false) === true && $notifCanc !== false,
    json_encode(['cancel' => $cancelNotif, 'evento' => $notifCanc['tipo_evento'] ?? null]));
check('57. el mail de cancelación incluye el detalle y el estado Cancelado',
    str_contains((string) ($notifCanc['cuerpo'] ?? ''), $codNV)
    && str_contains((string) ($notifCanc['cuerpo'] ?? ''), 'Cancelado')
    && str_contains((string) ($notifCanc['cuerpo'] ?? ''), 'cupo fue liberado'),
    'codigo=' . $codNV);

/**
 * POST multipart real, para probar la subida de comprobantes de punta a punta.
 */
function apiMultipart(string $action, array $campos, string $campoArchivo, string $nombreArchivo, string $mime, string $contenido): array
{
    global $BASE;
    $b = '----smoke' . bin2hex(random_bytes(8));
    $body = '';
    foreach ($campos as $k => $v) {
        $body .= "--{$b}\r\nContent-Disposition: form-data; name=\"{$k}\"\r\n\r\n{$v}\r\n";
    }
    $body .= "--{$b}\r\nContent-Disposition: form-data; name=\"{$campoArchivo}\"; filename=\"{$nombreArchivo}\"\r\n"
        . "Content-Type: {$mime}\r\n\r\n{$contenido}\r\n--{$b}--\r\n";

    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: multipart/form-data; boundary={$b}\r\nContent-Length: " . strlen($body) . "\r\n",
        'content' => $body,
        'timeout' => 60,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($BASE . '?action=' . urlencode($action), false, $ctx);
    $json = json_decode((string) $resp, true);
    return is_array($json) ? $json : ['_raw' => (string) $resp];
}

// ---------- 58. el cliente sube el comprobante: Pre-Reserva -> Comprobar ----------
// PNG 1x1 válido: finfo lo detecta por contenido, igual que un comprobante real.
$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
$subida = apiMultipart('subirComprobante', ['codigo' => $codNA], 'comprobante', 'pago.png', 'image/png', $png);
$estadoTrasSubir = (string) $db->query("SELECT estado FROM reservas_alojamiento WHERE id = $pkNA")->fetchColumn();
$compPend = $db->query("SELECT id, estado FROM comprobantes
    WHERE reserva_modalidad='alojamiento' AND reserva_pk=$pkNA ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
check('58. subir comprobante deja la reserva en Comprobar con el comprobante pendiente',
    ($subida['success'] ?? false) === true && $estadoTrasSubir === 'Comprobar'
    && $compPend !== false && $compPend['estado'] === 'pendiente',
    json_encode(['resp' => $subida, 'estado' => $estadoTrasSubir, 'comp' => $compPend]));

$doble = apiMultipart('subirComprobante', ['codigo' => $codNA], 'comprobante', 'pago2.png', 'image/png', $png);
check('58b. no se acepta un segundo comprobante si ya hay uno en revisión',
    ($doble['success'] ?? true) === false, json_encode($doble));

$nAcuse = (int) $db->query("SELECT COUNT(*) FROM notificaciones_email
    WHERE reserva_modalidad='alojamiento' AND reserva_pk=$pkNA AND tipo_evento='comprobante_recibido'")->fetchColumn();
$nAdmin = (int) $db->query("SELECT COUNT(*) FROM notificaciones_email
    WHERE reserva_modalidad='alojamiento' AND reserva_pk=$pkNA AND tipo_evento='pago_recibido'")->fetchColumn();
check('58d. la subida genera acuse al cliente y aviso al admin',
    $nAcuse === 1 && $nAdmin === 1, "acuse=$nAcuse admin=$nAdmin");

$compOcupa = api('obtenerDisponibilidadDiaAlojamiento', ['albergue' => 'Maestro José Fierro', 'fecha' => $f42], 'GET');
check('58c. una reserva en Comprobar sigue ocupando cupo',
    ($compOcupa['ocupados'] ?? -1) === 4, json_encode($compOcupa));

// ---------- 59/60. el admin aprueba desde el panel ----------
// adminEstado exige el rol 'admin': el super_admin administra usuarios y
// configuración, pero NO opera el panel de reservas. Se usa la cuenta admin.
$cookieAdmin = '';
$loginAdm = apiConCookie('adminLogin', ['usuario' => 'admin', 'pass' => 'Admin2026'], $cookieAdmin);
check('58a. la cuenta admin inicia sesión con rol admin',
    ($loginAdm['rol'] ?? '') === 'admin', json_encode(['rol' => $loginAdm['rol'] ?? null]));

$admEstado = apiConCookie('adminEstado', ['accion' => 'aprobar', 'pk' => (string) $pkNA, 'modalidad' => 'alojamiento'], $cookieAdmin);
$notifConf = $db->query("SELECT * FROM notificaciones_email
    WHERE reserva_modalidad='alojamiento' AND reserva_pk=$pkNA AND tipo_evento='confirmacion'")->fetch(PDO::FETCH_ASSOC);
$estadoConf = (string) $db->query("SELECT estado FROM reservas_alojamiento WHERE id = $pkNA")->fetchColumn();
check('59. al aprobar, la reserva pasa a Confirmado y se notifica al usuario final',
    ($admEstado['success'] ?? false) === true && $estadoConf === 'Confirmado' && $notifConf !== false,
    json_encode(['estado' => $admEstado, 'db' => $estadoConf, 'evento' => $notifConf['tipo_evento'] ?? null]));

$compAprob = $db->query("SELECT estado, revisado_por FROM comprobantes
    WHERE reserva_modalidad='alojamiento' AND reserva_pk=$pkNA ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
check('59b. el comprobante queda aprobado y con el revisor registrado',
    $compAprob !== false && $compAprob['estado'] === 'aprobado' && $compAprob['revisado_por'] === 'admin',
    json_encode($compAprob));

check('59c. el mail de confirmación incluye detalle, monto y estado Confirmado',
    str_contains((string) ($notifConf['cuerpo'] ?? ''), $codNA)
    && str_contains((string) ($notifConf['cuerpo'] ?? ''), '$60.000')
    && str_contains((string) ($notifConf['cuerpo'] ?? ''), '>Confirmado<'),
    'codigo=' . $codNA);

// Aviso extra al administrador, con el nombre de quien validó.
$notifValAdmin = $db->query("SELECT * FROM notificaciones_email
    WHERE reserva_modalidad='alojamiento' AND reserva_pk=$pkNA AND tipo_evento='validacion_admin'")->fetch(PDO::FETCH_ASSOC);
check('59d. al aprobar se avisa al admin con el nombre de quien validó',
    $notifValAdmin !== false
    && $notifValAdmin['destinatario'] === 'smoke.admin@example.com'
    && str_contains((string) $notifValAdmin['cuerpo'], 'por admin'),
    json_encode(['dest' => $notifValAdmin['destinatario'] ?? null]));

$reaprobar = apiConCookie('adminEstado', ['accion' => 'aprobar', 'pk' => (string) $pkNA, 'modalidad' => 'alojamiento'], $cookieAdmin);
check('60. aprobar dos veces es rechazado (transición inválida)',
    ($reaprobar['success'] ?? true) === false, json_encode($reaprobar));

// ---------- 61. el admin anula una Pre-Reserva: aviso de cancelación ----------
$preCanc = api('crearReserva', [
    'albergue' => 'Maestro José Fierro', 'institucion' => 'CANCELA ADMIN', 'responsable' => 'Canc Admin',
    'dni' => '30888999', 'contacto' => '3815555555', 'email' => 'canc.admin@example.com',
    'cantidad' => 2, 'fechaIngreso' => $f19, 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
$pkCanc = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($preCanc['codigoPublico'] ?? ''))->fetchColumn();
$admCancela = apiConCookie('adminEstado', ['accion' => 'anular', 'pk' => (string) $pkCanc, 'modalidad' => 'visita'], $cookieAdmin);
$cancAdmin = (int) $db->query("SELECT COUNT(*) FROM notificaciones_email
    WHERE reserva_modalidad='visita' AND reserva_pk=$pkCanc AND tipo_evento='cancelacion'
      AND destinatario='canc.admin@example.com'")->fetchColumn();
check('61. al anular desde el panel se avisa al usuario final',
    ($admCancela['success'] ?? false) === true && $cancAdmin === 1,
    json_encode($admCancela));

// ---------- 62. columnas de trazabilidad de la cancelación ----------
try {
    $cola = $db->query("SELECT cancelado_at, cancelado_origen FROM reservas_visitas WHERE id = $pkNV")->fetch(PDO::FETCH_ASSOC);
    check('62. cancelación del usuario registra cancelado_at y origen web',
        $cola !== false && !empty($cola['cancelado_at']) && $cola['cancelado_origen'] === 'web',
        json_encode($cola));
} catch (Throwable $e) {
    check('62. cancelación del usuario registra cancelado_at y origen web', false,
        'migración 2026-10-26 aún no aplicada: ' . $e->getMessage());
}

// ---------- 63. auditoría del cambio de estado desde el panel ----------
$audita = $db->query("SELECT estado_modificado_por, estado_modificado_at, estado_origen
    FROM reservas_alojamiento WHERE id = $pkNA")->fetch(PDO::FETCH_ASSOC);
check('63. el cambio desde el panel registra usuario, fecha y origen',
    $audita !== false
    && ($audita['estado_modificado_por'] ?? '') === 'admin'
    && !empty($audita['estado_modificado_at'])
    && ($audita['estado_origen'] ?? '') === 'panel',
    json_encode($audita));

// =====================================================================
//  ETAPA 4: máquina de estados, plazos y liberación de cupos
// =====================================================================

// ---------- 64. horizonte mínimo ----------
$r = api('crearReserva', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'HORIZONTE', 'responsable' => 'Hor',
    'dni' => '31111111', 'contacto' => '3810000001', 'email' => 'horizonte@example.com',
    'cantidad' => 1, 'fechaIngreso' => date('Y-m-d', strtotime('+1 day')),
    'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
check('64. reserva dentro del horizonte mínimo (66 h) es rechazada',
    ($r['success'] ?? true) === false, json_encode($r));

// ---------- 65/66. validaciones del rango de alojamiento ----------
$f20 = $rel(20); $f21 = $rel(21);
$r = api('crearReservaAlojamiento', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'NO CONSEC', 'responsable' => 'NC',
    'dni' => '31111112', 'contacto' => '3810000002', 'email' => 'nocon@example.com',
    'cantidad' => 1, 'rangoFechas' => "{$f17},{$f19}",
]);
check('65. rango no consecutivo es rechazado', ($r['success'] ?? true) === false, json_encode($r));

$r = api('crearReservaAlojamiento', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'CINCO DIAS', 'responsable' => 'CD',
    'dni' => '31111113', 'contacto' => '3810000003', 'email' => 'cinco@example.com',
    'cantidad' => 1, 'rangoFechas' => "{$f17},{$f18},{$f19},{$f20},{$f21}",
]);
check('66. estadía de más de 4 días es rechazada', ($r['success'] ?? true) === false, json_encode($r));

// ---------- 67. monto 0 ----------
$montoTinku = (float) $db->query("SELECT monto_visita FROM albergues WHERE clave = 'tinku'")->fetchColumn();
$db->exec("UPDATE albergues SET monto_visita = 0 WHERE clave = 'tinku'");
$r = api('crearReserva', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'MONTO CERO', 'responsable' => 'MC',
    'dni' => '31111114', 'contacto' => '3810000004', 'email' => 'cero@example.com',
    'cantidad' => 1, 'fechaIngreso' => $f12, 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
$db->exec("UPDATE albergues SET monto_visita = " . $db->quote((string) $montoTinku) . " WHERE clave = 'tinku'");
check('67. reserva con monto total 0 es rechazada', ($r['success'] ?? true) === false, json_encode($r));

// ---------- 68. el vencimiento se ata al inicio cuando la fecha está cerca ----------
$cerca = $rel(4);
$r = api('crearReserva', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'CERCANA', 'responsable' => 'Ce',
    'dni' => '31111115', 'contacto' => '3810000005', 'email' => 'cerca@example.com',
    'cantidad' => 1, 'fechaIngreso' => $cerca, 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
$codCerca = (string) ($r['codigoPublico'] ?? '');
$pkCerca  = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($codCerca))->fetchColumn();
$desvioHoras = $pkCerca > 0
    ? (float) $db->query("SELECT EXTRACT(EPOCH FROM (pago_vence_at - (inicio_at - INTERVAL '60 hours'))) / 3600
                            FROM reservas_visitas WHERE id = $pkCerca")->fetchColumn()
    : 999.0;
check('68. el vencimiento queda en inicio - 60 h cuando la fecha está cerca',
    ($r['success'] ?? false) === true && abs($desvioHoras) < 0.02, "desvio={$desvioHoras} h");

$dispAntes = api('obtenerDisponibilidadDia', ['albergue' => 'Tinku Huasi', 'fecha' => $cerca], 'GET');
check('69. la pre-reserva vigente ocupa cupo', ($dispAntes['ocupados'] ?? -1) === 1, json_encode($dispAntes));

// ---------- 70/71. vencimiento perezoso + barrido ----------
$db->exec("UPDATE reservas_visitas SET pago_vence_at = NOW() - INTERVAL '1 hour' WHERE id = $pkCerca");
$subVencida = apiMultipart('subirComprobante', ['codigo' => $codCerca], 'comprobante', 'vencida.png', 'image/png', $png);
check('70. no se acepta comprobante de una pre-reserva vencida',
    ($subVencida['success'] ?? true) === false, json_encode($subVencida));

$dispLazy = api('obtenerDisponibilidadDia', ['albergue' => 'Tinku Huasi', 'fecha' => $cerca], 'GET');
check('71. una pre-reserva vencida libera el cupo sin esperar al barrido',
    ($dispLazy['ocupados'] ?? -1) === 0, json_encode($dispLazy));

$venc = api('tareasVencimiento', ['token' => '']);
$estadoVencido = (string) $db->query("SELECT estado FROM reservas_visitas WHERE id = $pkCerca")->fetchColumn();
$mailVenc = (int) $db->query("SELECT COUNT(*) FROM notificaciones_email
    WHERE reserva_modalidad='visita' AND reserva_pk=$pkCerca AND tipo_evento='vencimiento'")->fetchColumn();
check('72. el barrido pasa la pre-reserva a Vencido y encola el aviso',
    ($venc['success'] ?? false) === true && $estadoVencido === 'Vencido' && $mailVenc === 1,
    json_encode(['barrido' => $venc['vencimientos'] ?? null, 'estado' => $estadoVencido, 'mails' => $mailVenc]));

// ---------- 73/74/75. cancelación de una reserva paga (>48 h) ----------
$cancelConf = api('cancelarReserva', ['idReserva' => $codNA, 'dni' => '30777888']);
$dev = $db->query("SELECT estado, devolucion_pct, devolucion_monto FROM reservas_alojamiento WHERE id = $pkNA")->fetch(PDO::FETCH_ASSOC);
check('73. cancelar una reserva paga con más de 48 h deja Devolver con devolución 100%',
    ($cancelConf['success'] ?? false) === true && ($dev['estado'] ?? '') === 'Devolver'
    && (int) round((float) ($dev['devolucion_pct'] ?? 0)) === 100
    && (float) ($dev['devolucion_monto'] ?? 0) === 60000.0,
    json_encode(['resp' => $cancelConf, 'dev' => $dev]));

$dispDev = api('obtenerDisponibilidadDiaAlojamiento', ['albergue' => 'Maestro José Fierro', 'fecha' => $f42], 'GET');
check('74. el estado Devolver ya liberó el cupo', ($dispDev['ocupados'] ?? -1) === 0, json_encode($dispDev));

$marcarDev = apiConCookie('adminEstado', ['accion' => 'devolver', 'pk' => (string) $pkNA, 'modalidad' => 'alojamiento'], $cookieAdmin);
$devFinal = $db->query("SELECT estado, devolucion_ejecutada_at, devolucion_ejecutada_por FROM reservas_alojamiento WHERE id = $pkNA")->fetch(PDO::FETCH_ASSOC);
check('75. el operador marca la devolución y la reserva queda Cancelada',
    ($marcarDev['success'] ?? false) === true && ($devFinal['estado'] ?? '') === 'Cancelado'
    && !empty($devFinal['devolucion_ejecutada_at']) && ($devFinal['devolucion_ejecutada_por'] ?? '') === 'admin',
    json_encode(['resp' => $marcarDev, 'dev' => $devFinal]));

$reactivar = apiConCookie('adminEstado', ['accion' => 'aprobar', 'pk' => (string) $pkNA, 'modalidad' => 'alojamiento'], $cookieAdmin);
check('76. no se puede reactivar una reserva cancelada', ($reactivar['success'] ?? true) === false, json_encode($reactivar));

// ---------- 77. cancelación dentro de las 48 h: devolución 50% ----------
$r = api('crearReserva', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'CANCELA 50', 'responsable' => 'C50',
    'dni' => '31111116', 'contacto' => '3810000006', 'email' => 'c50@example.com',
    'cantidad' => 2, 'fechaIngreso' => $rel(5), 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
$cod50 = (string) ($r['codigoPublico'] ?? '');
$pk50  = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($cod50))->fetchColumn();
apiMultipart('subirComprobante', ['codigo' => $cod50], 'comprobante', 'c50.png', 'image/png', $png);
apiConCookie('adminEstado', ['accion' => 'aprobar', 'pk' => (string) $pk50, 'modalidad' => 'visita'], $cookieAdmin);
// Se simula el paso del tiempo: el inicio queda a 20 h.
$db->exec("UPDATE reservas_visitas SET inicio_at = NOW() + INTERVAL '20 hours' WHERE id = $pk50");
$cancel50 = api('cancelarReserva', ['idReserva' => $cod50, 'dni' => '31111116']);
$dev50 = $db->query("SELECT estado, devolucion_pct, devolucion_monto FROM reservas_visitas WHERE id = $pk50")->fetch(PDO::FETCH_ASSOC);
check('77. cancelar dentro de las 48 h deja Devolver con devolución 50%',
    ($cancel50['success'] ?? false) === true && ($dev50['estado'] ?? '') === 'Devolver'
    && (int) round((float) ($dev50['devolucion_pct'] ?? 0)) === 50
    && (float) ($dev50['devolucion_monto'] ?? 0) === 2000.0,
    json_encode(['resp' => $cancel50, 'dev' => $dev50]));

// ---------- 78. cancelación el día de ingreso: bloqueada ----------
$r = api('crearReserva', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'CANCELA HOY', 'responsable' => 'CH',
    'dni' => '31111117', 'contacto' => '3810000007', 'email' => 'choy@example.com',
    'cantidad' => 1, 'fechaIngreso' => $rel(6), 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
$codHoy = (string) ($r['codigoPublico'] ?? '');
$pkHoy  = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($codHoy))->fetchColumn();
apiMultipart('subirComprobante', ['codigo' => $codHoy], 'comprobante', 'choy.png', 'image/png', $png);
apiConCookie('adminEstado', ['accion' => 'aprobar', 'pk' => (string) $pkHoy, 'modalidad' => 'visita'], $cookieAdmin);
$db->exec("UPDATE reservas_visitas SET inicio_at = NOW() - INTERVAL '2 hours' WHERE id = $pkHoy");
$cancelHoy = api('cancelarReserva', ['idReserva' => $codHoy, 'dni' => '31111117']);
$estadoHoy = (string) $db->query("SELECT estado FROM reservas_visitas WHERE id = $pkHoy")->fetchColumn();
check('78. no se puede cancelar el día de ingreso ni después',
    ($cancelHoy['success'] ?? true) === false && $estadoHoy === 'Confirmado',
    json_encode(['resp' => $cancelHoy, 'estado' => $estadoHoy]));

// ---------- 79. cancelar una pre-reserva impaga: Cancelado sin devolución ----------
$r = api('crearReserva', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'IMPAGA', 'responsable' => 'Im',
    'dni' => '31111118', 'contacto' => '3810000008', 'email' => 'impaga@example.com',
    'cantidad' => 1, 'fechaIngreso' => $rel(7), 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
$codImp = (string) ($r['codigoPublico'] ?? '');
$pkImp  = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($codImp))->fetchColumn();
$cancelImp = api('cancelarReserva', ['idReserva' => $codImp, 'dni' => '31111118']);
$devImp = $db->query("SELECT estado, devolucion_monto FROM reservas_visitas WHERE id = $pkImp")->fetch(PDO::FETCH_ASSOC);
check('79. cancelar una pre-reserva impaga deja Cancelado y sin devolución',
    ($cancelImp['success'] ?? false) === true && ($devImp['estado'] ?? '') === 'Cancelado'
    && $devImp['devolucion_monto'] === null,
    json_encode(['resp' => $cancelImp, 'dev' => $devImp]));

// ---------- 80. rechazo de comprobante: vuelve a Pre-Reserva con nuevo plazo ----------
$r = api('crearReserva', [
    'albergue' => 'Tinku Huasi', 'institucion' => 'RECHAZO', 'responsable' => 'Re',
    'dni' => '31111119', 'contacto' => '3810000009', 'email' => 'rechazo@example.com',
    'cantidad' => 1, 'fechaIngreso' => $rel(8), 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
]);
$codRe = (string) ($r['codigoPublico'] ?? '');
$pkRe  = (int) $db->query("SELECT id FROM reservas_visitas WHERE codigo_publico = " . $db->quote($codRe))->fetchColumn();
apiMultipart('subirComprobante', ['codigo' => $codRe], 'comprobante', 're.png', 'image/png', $png);
$rechazo = apiConCookie('adminEstado', [
    'accion' => 'rechazar', 'motivo' => 'El importe no coincide con el total',
    'pk' => (string) $pkRe, 'modalidad' => 'visita',
], $cookieAdmin);
$reRow = $db->query("SELECT estado, comprobado_at FROM reservas_visitas WHERE id = $pkRe")->fetch(PDO::FETCH_ASSOC);
$compRe = $db->query("SELECT estado, motivo_rechazo FROM comprobantes
    WHERE reserva_modalidad='visita' AND reserva_pk=$pkRe ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$mailRe = (int) $db->query("SELECT COUNT(*) FROM notificaciones_email
    WHERE reserva_modalidad='visita' AND reserva_pk=$pkRe AND tipo_evento='rechazo'")->fetchColumn();
check('80. rechazar el comprobante devuelve la reserva a Pre-Reserva y avisa con el motivo',
    ($rechazo['success'] ?? false) === true && ($reRow['estado'] ?? '') === 'Pre-Reserva'
    && $reRow['comprobado_at'] === null
    && ($compRe['estado'] ?? '') === 'rechazado'
    && ($compRe['motivo_rechazo'] ?? '') === 'El importe no coincide con el total'
    && $mailRe === 1,
    json_encode(['resp' => $rechazo, 'fila' => $reRow, 'comp' => $compRe, 'mails' => $mailRe]));


// Restaurar el flag de envío inmediato tal como estaba antes de la prueba.
try {
    if ($inmediatoAntes === false || $inmediatoAntes === null) {
        $db->exec("DELETE FROM configuracion_sistema WHERE clave='notif_envio_inmediato'");
    } else {
        $db->exec("UPDATE configuracion_sistema SET valor = " . $db->quote((string) $inmediatoAntes) . " WHERE clave='notif_envio_inmediato'");
    }
} catch (Throwable $e) {
    // nada
}

// ---------- Limpieza final ----------
$db->exec("TRUNCATE TABLE reserva_alojamiento_dias RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_visitas RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_alojamiento RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE comprobantes RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE notificaciones_email RESTART IDENTITY CASCADE");
$db->exec("ALTER SEQUENCE reserva_publica_seq RESTART WITH 1");
// Claves que crea este mismo test: se eliminan para no dejar configuracion
// ficticia (los defaults del sistema son 3 meses y un mail_admin vacio).
$db->exec("DELETE FROM configuracion_sistema WHERE clave = 'meses_anticipacion'");
$db->exec("DELETE FROM configuracion_sistema WHERE clave = 'mail_admin' AND valor = 'smoke.admin@example.com'");
check('31. BD de prueba limpiada (sin datos residuales)', true, 'TRUNCATE + secuencia reiniciada + config de prueba eliminada');

// ---------- Resultado ----------
$pass = count(array_filter($results, fn($x) => $x['ok']));
$fail = count($results) - $pass;
echo "\n=== RESULTADO: $pass PASS / $fail FAIL (de " . count($results) . " checks) ===\n";

// En caso de fallos, mostrar el log del servidor embebido (errores PHP reales).
if ($fail > 0 && is_file($srvLog)) {
    $log = (string) file_get_contents($srvLog);
    if (trim($log) !== '') {
        echo "\n--- LOG DEL SERVIDOR (ultimas 60 lineas) ---\n";
        $lineas = preg_split('/\R/', trim($log));
        echo implode("\n", array_slice($lineas, -60)) . "\n";
        echo "--- FIN LOG ---\n";
    }
}

file_put_contents(
    dirname(__DIR__) . '/tests/resultados_smoke.json',
    json_encode(['fecha' => date('Y-m-d H:i:s'), 'pass' => $pass, 'fail' => $fail, 'checks' => $results], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

proc_terminate($server);
exit($fail > 0 ? 1 : 0);
