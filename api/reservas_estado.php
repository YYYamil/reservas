<?php
declare(strict_types=1);

/**
 * Dominio de la máquina de estados de reservas.
 *
 * Una sola definición para las dos modalidades (visita diaria y alojamiento):
 * los estados, las transiciones y los invariantes son idénticos; lo único que
 * cambia es el ancla temporal (`inicio_at`) y la unidad de cupo.
 *
 * Regla de oro: el cupo se adquiere SOLO al crear la reserva (bajo el lock de la
 * fila del albergue). Todo lo demás libera. Por eso un estado que ocupa es
 * siempre uno de RESERVA_ESTADOS_OCUPA, y el resto nunca ocupa.
 *
 * El vencimiento de una Pre-Reserva se evalúa contra:
 *
 *     limite = min(pago_vence_at, inicio_at - anticipacion_horas)
 *
 * usando LEAST() en SQL. Así las reservas viejas (que tienen 7 días grabados)
 * también quedan protegidas sin necesidad de backfill.
 */

const RESERVA_ESTADOS = [
    'Pre-Reserva',
    'Comprobar',
    'Confirmado',
    'Cancelado',
    'Vencido',
    'Devolver',
    'Finalizado',
];

/** Estados que consumen cupo. Lista blanca: lo que no está acá, libera. */
const RESERVA_ESTADOS_OCUPA = ['Pre-Reserva', 'Comprobar', 'Confirmado'];

/** Estados de cierre: no admiten ninguna transición posterior. */
const RESERVA_ESTADOS_TERMINALES = ['Cancelado', 'Vencido', 'Finalizado'];

/** Acciones del panel y su estado destino, por estado de origen. */
function reservaTransicion(string $desde, string $accion): ?string
{
    $mapa = [
        'Pre-Reserva' => ['anular' => 'Cancelado'],
        'Comprobar'   => ['aprobar' => 'Confirmado', 'rechazar' => 'Pre-Reserva'],
        'Devolver'    => ['devolver' => 'Cancelado'],
    ];
    return $mapa[$desde][$accion] ?? null;
}

/**
 * Política de tiempos vigente (configuracion_sistema, con defaults).
 * Devuelve enteros ya validados.
 */
function reservaPolitica(PDO $pdo): array
{
    static $cache = null;
    if (is_array($cache)) {
        return $cache;
    }

    $pol = [
        'anticipacion_horas'      => 60,
        'ventana_pago_horas'      => 48,
        'ventana_pago_min_horas'  => 6,
        'cancelacion_horas'       => 48,
        'devolucion_temprana_pct' => 100,
        'devolucion_tardia_pct'   => 50,
        'validacion_horas'        => 24,
    ];

    try {
        $in = implode(',', array_fill(0, count($pol), '?'));
        $stmt = $pdo->prepare(
            "SELECT clave, valor FROM configuracion_sistema WHERE clave IN ({$in})"
        );
        $stmt->execute(array_keys($pol));
        foreach ($stmt->fetchAll(PDO::FETCH_KEY_PAIR) as $clave => $valor) {
            if (!array_key_exists($clave, $pol)) {
                continue;
            }
            $valor = trim((string) $valor);
            if ($valor !== '' && preg_match('/^-?\d+$/', $valor) === 1) {
                $pol[$clave] = (int) $valor;
            }
        }
    } catch (Throwable $e) {
        // Sin tabla de configuración: se usan los defaults.
    }

    // Saneamiento: ningún plazo puede ser negativo ni la ventana mínima 0.
    $pol['anticipacion_horas']     = max(0, $pol['anticipacion_horas']);
    $pol['ventana_pago_horas']     = max(1, $pol['ventana_pago_horas']);
    $pol['ventana_pago_min_horas'] = max(1, $pol['ventana_pago_min_horas']);
    $pol['cancelacion_horas']      = max(0, $pol['cancelacion_horas']);
    $pol['devolucion_temprana_pct'] = min(100, max(0, $pol['devolucion_temprana_pct']));
    $pol['devolucion_tardia_pct']   = min(100, max(0, $pol['devolucion_tardia_pct']));
    $pol['validacion_horas']        = max(1, $pol['validacion_horas']);

    $cache = $pol;
    return $pol;
}

function reservaZona(array $config): DateTimeZone
{
    return new DateTimeZone((string) ($config['timezone'] ?? 'America/Argentina/Tucuman'));
}

function reservaAhora(array $config): DateTimeImmutable
{
    return new DateTimeImmutable('now', reservaZona($config));
}

/** Inicio de una reserva a partir de una fecha ISO (00:00 local). */
function reservaInicioDesdeFecha(string $fechaISO, array $config): ?DateTimeImmutable
{
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaISO) !== 1) {
        return null;
    }
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $fechaISO, reservaZona($config));
    return $d === false ? null : $d;
}

/** Inicio de una reserva de alojamiento a partir del rango (la fecha menor). */
function reservaInicioDesdeRango(array $rango, array $config): ?DateTimeImmutable
{
    $fechas = array_values(array_filter($rango, static fn ($f) => is_string($f) && $f !== ''));
    sort($fechas, SORT_STRING);
    if ($fechas === []) {
        return null;
    }
    return reservaInicioDesdeFecha((string) $fechas[0], $config);
}

/** Horas mínimas entre "ahora" y el inicio para aceptar una reserva nueva. */
function reservaHorizonteHoras(array $pol): int
{
    return (int) $pol['anticipacion_horas'] + (int) $pol['ventana_pago_min_horas'];
}

/**
 * Vencimiento del pago: el menor entre la ventana del cliente y el tope por
 * fecha de ingreso. Nunca posterior a `inicio_at - anticipacion_horas`.
 */
function reservaVencimiento(DateTimeImmutable $ahora, DateTimeImmutable $inicio, array $pol): DateTimeImmutable
{
    $ventana = $ahora->modify('+' . (int) $pol['ventana_pago_horas'] . ' hours');
    $tope    = $inicio->modify('-' . (int) $pol['anticipacion_horas'] . ' hours');
    return $ventana < $tope ? $ventana : $tope;
}

/**
 * Fecha límite para que el operador valide el comprobante: la ventana de
 * validación, sin pasarse del inicio de la reserva.
 */
function reservaVencimientoValidacion(DateTimeImmutable $ahora, DateTimeImmutable $inicio, array $pol): DateTimeImmutable
{
    $limite = $ahora->modify('+' . (int) $pol['validacion_horas'] . ' hours');
    return $limite < $inicio ? $limite : $inicio;
}

/** Expresión SQL con el límite efectivo de una Pre-Reserva. */
function reservaSqlLimite(string $a, array $pol): string
{
    $h = max(1, (int) $pol['anticipacion_horas']);
    $tope = "({$a}inicio_at - INTERVAL '{$h} hours')";
    // LEAST() de PostgreSQL ignora NULL, por eso no hace falta COALESCE por pago_vence_at.
    return "COALESCE(LEAST({$a}pago_vence_at, {$tope}), {$tope})";
}

/** Expresión SQL booleana: la reserva ocupa cupo en este instante. */
function reservaSqlOcupa(string $a, array $pol): string
{
    return "({$a}estado IN ('Pre-Reserva','Comprobar','Confirmado')"
        . " AND ({$a}estado <> 'Pre-Reserva'"
        . ' OR ' . reservaSqlLimite($a, $pol) . ' > NOW()))';
}

/** Estado efectivo (sin escribir): una Pre-Reserva vencida se lee como Vencido. */
function reservaEstadoEfectivo(string $estado, ?string $pagoVenceAt, ?string $inicioAt, array $pol): string
{
    if ($estado !== 'Pre-Reserva') {
        return $estado;
    }
    $tope = null;
    if ($inicioAt !== null && $inicioAt !== '') {
        $tope = strtotime($inicioAt) - ((int) $pol['anticipacion_horas'] * 3600);
    }
    if ($pagoVenceAt !== null && $pagoVenceAt !== '') {
        $v = strtotime($pagoVenceAt);
        $tope = $tope === null ? $v : min($tope, $v);
    }
    if ($tope === null) {
        return $estado;
    }
    return $tope <= time() ? 'Vencido' : 'Pre-Reserva';
}

/**
 * Porcentaje de devolución según el momento de la cancelación.
 *
 * @return array{pct:?int, horas:float} pct = null cuando ya no se puede cancelar.
 */
function reservaDevolucion(DateTimeImmutable $ahora, DateTimeImmutable $inicio, array $pol): array
{
    $horas = ($inicio->getTimestamp() - $ahora->getTimestamp()) / 3600;
    if ($horas <= 0) {
        return ['pct' => null, 'horas' => $horas];
    }
    $pct = $horas > (int) $pol['cancelacion_horas']
        ? (int) $pol['devolucion_temprana_pct']
        : (int) $pol['devolucion_tardia_pct'];
    return ['pct' => $pct, 'horas' => $horas];
}

/**
 * Barrido periódico (idempotente y seguro ante ejecuciones solapadas).
 *
 *  - Vence las Pre-Reservas que llegaron a su límite (libera el cupo).
 *  - Encola el recordatorio de pago de las que están por vencer.
 *  - Cierra como Finalizado las reservas cuya estadía ya terminó.
 *  - Deja la marca de última ejecución (heartbeat) para el panel.
 */
function reservaBarrido(PDO $pdo, array $config, ?DateTimeImmutable $ahora = null): array
{
    $pol = reservaPolitica($pdo);
    $out = ['recordatorios' => 0, 'vencidas' => 0, 'finalizadas' => 0, 'omitido' => false];

    $lock = $pdo->query('SELECT pg_try_advisory_lock(2026102901)')->fetchColumn();
    if (!in_array($lock, [true, 't', '1', 1], true)) {
        $out['omitido'] = true;
        return $out;
    }

    try {
        foreach ([['visita', 'reservas_visitas'], ['alojamiento', 'reservas_alojamiento']] as [$modalidad, $tabla]) {
            // 1) Pre-Reservas vencidas: liberan el cupo.
            $sql = "UPDATE {$tabla} r
                       SET estado = 'Vencido',
                           motivo_cierre = 'vencido_sin_pago',
                           estado_origen = 'auto-vencimiento',
                           estado_modificado_at = NOW(),
                           cancelado_at = COALESCE(r.cancelado_at, NOW()),
                           cancelado_origen = COALESCE(r.cancelado_origen, 'auto-vencimiento')
                     WHERE r.estado = 'Pre-Reserva'
                       AND " . reservaSqlLimite('r.', $pol) . " <= NOW()
                 RETURNING r.id, r.email";
            foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $fila) {
                $out['vencidas']++;
                if (function_exists('encolarNotificacion') && !empty($fila['email'])) {
                    encolarNotificacion($pdo, $modalidad, (int) $fila['id'], 'vencimiento', (string) $fila['email'], 'cliente', null, $config);
                }
            }

            // 2) Recordatorio: vence dentro de las próximas 12 h y todavía no se avisó.
            $limite = reservaSqlLimite('r.', $pol);
            $sql = "SELECT r.id, r.email
                      FROM {$tabla} r
                     WHERE r.estado = 'Pre-Reserva'
                       AND {$limite} > NOW()
                       AND {$limite} <= NOW() + INTERVAL '12 hours'
                       AND r.created_at <= NOW() - INTERVAL '1 hour'
                       AND NOT EXISTS (
                           SELECT 1 FROM notificaciones_email n
                            WHERE n.reserva_modalidad = " . $pdo->quote($modalidad) . "
                              AND n.reserva_pk = r.id
                              AND n.tipo_evento = 'recordatorio'
                       )";
            foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $fila) {
                $out['recordatorios']++;
                if (function_exists('encolarNotificacion') && !empty($fila['email'])) {
                    encolarNotificacion($pdo, $modalidad, (int) $fila['id'], 'recordatorio', (string) $fila['email'], 'cliente', null, $config);
                }
            }

            // 3) Reservas cuya estadía ya terminó: cierre administrativo.
            if ($modalidad === 'visita') {
                $cond = "r.fecha_ingreso::date < CURRENT_DATE";
            } else {
                $cond = "NOT EXISTS (SELECT 1 FROM reserva_alojamiento_dias d
                                      WHERE d.reserva_id = r.id AND d.fecha::date >= CURRENT_DATE)";
            }
            $sql = "UPDATE {$tabla} r
                       SET estado = 'Finalizado',
                           motivo_cierre = COALESCE(r.motivo_cierre, 'cumplida'),
                           estado_origen = 'auto-cierre',
                           estado_modificado_at = NOW(),
                           finalizado_at = NOW()
                     WHERE r.estado IN ('Comprobar', 'Confirmado')
                       AND {$cond}
                 RETURNING r.id";
            $out['finalizadas'] += count($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC));
        }

        // 4) Heartbeat visible en el panel.
        $pdo->prepare(
            "INSERT INTO configuracion_sistema (clave, valor, updated_at)
             VALUES ('ultimo_barrido_at', ?, NOW())
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()"
        )->execute([(new DateTimeImmutable('now', reservaZona($config)))->format('Y-m-d H:i:sP')]);
    } finally {
        $pdo->query('SELECT pg_advisory_unlock(2026102901)');
    }

    return $out;
}
