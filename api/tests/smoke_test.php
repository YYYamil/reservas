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
            'timeout' => 20,
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

// Limpieza inicial (BD debe arrancar vacia)
$db->exec("TRUNCATE TABLE reserva_alojamiento_dias RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE notificaciones_email RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_visitas RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_alojamiento RESTART IDENTITY CASCADE");
$db->exec("ALTER SEQUENCE reserva_publica_seq RESTART WITH 1");

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

// ---------- 3. crear visita con email valido ----------
$visita = api('crearReserva', [
    'albergue'    => 'Maestro José Fierro',
    'institucion' => 'SMOKE TEST ESCUELA',
    'responsable' => 'Tester Smoke',
    'dni'         => '30111222',
    'contacto'    => '3811234567',
    'email'       => 'smoke.visita@example.com',
    'cantidad'    => 5,
    'fechaIngreso'=> '2026-11-10',
    'horaIngreso' => '09:00',
    'horaEgreso'  => '17:00',
    'pernocta'    => 'true',
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
    'cantidad' => 1, 'fechaIngreso' => '2026-11-11', 'horaIngreso' => '09:00', 'horaEgreso' => '17:00',
    'pernocta' => 'true',
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
    'rangoFechas' => '2026-11-15,2026-11-16,2026-11-17',
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
$disp = api('obtenerDisponibilidadDia', ['albergue' => 'Maestro José Fierro', 'fecha' => '2026-11-10'], 'GET');
check('14. disponibilidad visitas usa capacidad_visitas=150', ($disp['capacidad'] ?? 0) == 150, json_encode($disp));
check('15. ocupados visitas refleja la reserva activa (5)', ($disp['ocupados'] ?? -1) == 5, json_encode($disp));

$dispAlo = api('obtenerDisponibilidadDiaAlojamiento', ['albergue' => 'Maestro José Fierro', 'fecha' => '2026-11-15'], 'GET');
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
$disp2 = api('obtenerDisponibilidadDia', ['albergue' => 'Maestro José Fierro', 'fecha' => '2026-11-10'], 'GET');
check('24. cancelada -> cupo de visitas liberado (0)', ($disp2['ocupados'] ?? -1) == 0, json_encode($disp2));
$disp2Alo = api('obtenerDisponibilidadDiaAlojamiento', ['albergue' => 'Maestro José Fierro', 'fecha' => '2026-11-15'], 'GET');
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

// ---------- 29. form de cancelar NO alterado ----------
$html = file_get_contents($DIR . '/index.html');
$tieneCampos = str_contains($html, 'id="cancel-id"') && str_contains($html, 'id="cancel-dni"');
check('29. form de cancelar conserva Nro de reserva + DNI', $tieneCampos, 'index.html sin cambios en el modal de cancelacion');

// ---------- 30. sin espejo google (ya eliminado) ----------
$espejo = api('espejoVisitas', [], 'GET');
check('30. espejo de Google Sheets ya no existe', isset($espejo['success']) && $espejo['success'] === false, json_encode($espejo));

// ---------- Limpieza final ----------
$db->exec("TRUNCATE TABLE reserva_alojamiento_dias RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_visitas RESTART IDENTITY CASCADE");
$db->exec("TRUNCATE TABLE reservas_alojamiento RESTART IDENTITY CASCADE");
$db->exec("ALTER SEQUENCE reserva_publica_seq RESTART WITH 1");
check('31. BD de prueba limpiada (sin datos residuales)', true, 'TRUNCATE + secuencia reiniciada');

// ---------- Resultado ----------
$pass = count(array_filter($results, fn($x) => $x['ok']));
$fail = count($results) - $pass;
echo "\n=== RESULTADO: $pass PASS / $fail FAIL (de " . count($results) . " checks) ===\n";

file_put_contents(
    dirname(__DIR__) . '/tests/resultados_smoke.json',
    json_encode(['fecha' => date('Y-m-d H:i:s'), 'pass' => $pass, 'fail' => $fail, 'checks' => $results], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

proc_terminate($server);
exit($fail > 0 ? 1 : 0);
