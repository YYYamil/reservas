#!/usr/bin/env php
<?php
declare(strict_types=1);

/*
 * Migración de datos desde Google Sheets (CSV exportados) hacia SQLite.
 *
 * Uso (CLI):
 *   php api/migrar.php
 *
 * Archivos esperados en /migracion (exportados desde Google Sheets):
 *   Configuraciones.csv            hoja "Configuraciones"        (libro de Visitas)
 *   Reservas.csv                   hoja "Reservas"               (libro de Visitas)
 *   Disponibilidad.csv             hoja "Disponibilidad"         (libro de Visitas)
 *   ConfiguracionesAlojamiento.csv hoja "ConfiguracionesAlojamiento"
 *   ReservasAlojamiento.csv        hoja "ReservasAlojamiento"
 *   DisponibilidadAlojamiento.csv  hoja "DisponibilidadAlojamiento"
 *
 * Columnas esperadas (orden posicional, igual que leían los .gs):
 *   Configuraciones*.csv:  [1]=capacidad, [2]=nombre_albergue. [0] no se usa.
 *   Reservas.csv:          0=ID 1=creación 2=albergue 3=institución 4=responsable
 *                          5=DNI 6=contacto 7=cantidad 8=fecha_ingreso
 *                          9=hora_ingreso 10=hora_egreso 11=estado
 *   Disponibilidad*.csv:   0=fecha 1=albergue 2=ocupados 3=cantidad_reservada
 *                          4=disponibles 5=ID_reserva
 *   ReservasAlojamiento.csv: 0=ID 1=creación 2=albergue 3=institución 4=responsable
 *                          5=DNI 6=contacto 7=cantidad 8=rango_fechas(CSV) 9=estado
 *
 * La primera fila de cada CSV (encabezado) se descarta.
 *
 * Nota de migración (pernocta de visitas):
 *   La hoja "Reservas" actual NO guarda la columna pernocta. Solo las reservas
 *   que registraron consumo de capacidad figuran en "Disponibilidad". Por eso,
 *   una visita se marca pernocta='Sí' si su (fecha, albergue, cantidad, ID)
 *   aparece en "Disponibilidad"; caso contrario pernocta='No'.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Este script solo debe ejecutarse por CLI (php api/migrar.php)\n");
    exit(1);
}

require __DIR__ . '/db.php';

$CSV_DIR = dirname(__DIR__) . '/migracion/';

$archivos = [
    'config'    => $CSV_DIR . 'Configuraciones.csv',
    'reservas'  => $CSV_DIR . 'Reservas.csv',
    'disp'      => $CSV_DIR . 'Disponibilidad.csv',
    'configAlo' => $CSV_DIR . 'ConfiguracionesAlojamiento.csv',
    'reservasAlo' => $CSV_DIR . 'ReservasAlojamiento.csv',
    'dispAlo'   => $CSV_DIR . 'DisponibilidadAlojamiento.csv',
];

$clavesConocidas = [
    'Maestro José Fierro' => 'maestro',
    'Tinku Huasi'        => 'tinku',
    'Aquilina Soldati'   => 'aquilina',
];

$errores = [];
$avisos  = [];
$omitidos = [];

/**
 * Lee un CSV descartando la primera fila (encabezado).
 */
function leerCsv(string $ruta): array
{
    global $errores;
    if (!is_file($ruta)) {
        $errores[] = "Archivo no encontrado: {$ruta}";
        return [];
    }
    $filas = [];
    if (($fh = fopen($ruta, 'r')) === false) {
        $errores[] = "No se pudo abrir: {$ruta}";
        return [];
    }
    $esPrimera = true;
    while (($campos = fgetcsv($fh)) !== false) {
        if ($esPrimera) {
            $esPrimera = false;
            continue;
        }
        $filas[] = $campos;
    }
    fclose($fh);
    return $filas;
}

$pdo = db();

// ==================== 1) ALBERGUES (capacidades) ====================
$capsPorNombre = [];
foreach (['config', 'configAlo'] as $cfg) {
    foreach (leerCsv($archivos[$cfg]) as $fila) {
        $nombre = trim((string) ($fila[2] ?? ''));
        $capacidad = (int) trim((string) ($fila[1] ?? ''));
        if ($nombre === '') {
            continue;
        }
        if (!isset($capsPorNombre[$nombre])) {
            $capsPorNombre[$nombre] = $capacidad;
        } elseif ($capsPorNombre[$nombre] !== $capacidad) {
            $avisos[] = "Capacidad distinta para '{$nombre}' entre libros: {$capsPorNombre[$nombre]} vs {$capacidad}. Se usa {$capacidad}.";
            $capsPorNombre[$nombre] = $capacidad;
        }
    }
}

$desconocidos = array_diff(array_keys($capsPorNombre), array_keys($clavesConocidas));
if ($desconocidos) {
    $errores[] = 'Albergues en CSVs sin clave conocida (no se inventan): ' . implode(', ', $desconocidos);
}

$pdo->exec('BEGIN IMMEDIATE');
try {
    $qUpd = $pdo->prepare('UPDATE albergues SET capacidad = ? WHERE nombre = ?');
    foreach ($capsPorNombre as $nombre => $capacidad) {
        if (!isset($clavesConocidas[$nombre])) {
            continue;
        }
        if ($capacidad <= 0) {
            $avisos[] = "Capacidad inválida (<= 0) para '{$nombre}'; se conserva la existente.";
            continue;
        }
        $qUpd->execute([$capacidad, $nombre]);
        if ($qUpd->rowCount() > 0) {
            $avisos[] = "Capacidad de '{$nombre}' ajustada a {$capacidad} (según CSVs).";
        }
    }
    $pdo->exec('COMMIT');
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->exec('ROLLBACK');
    }
    throw $e;
}

$idPorNombre = [];
foreach ($pdo->query('SELECT id, nombre FROM albergues')->fetchAll() as $a) {
    $idPorNombre[$a['nombre']] = (int) $a['id'];
}
$nomPorClave = array_flip($clavesConocidas);

// ==================== 2) REGISTROS DE DISPONIBILIDAD (referencia) ====================
// Se usan para deducir pernocta de visitas y para la verificación final.
$dispVisit = leerCsv($archivos['disp']);
$idsDispVisit = [];
foreach ($dispVisit as $fila) {
    $id = trim((string) ($fila[5] ?? ''));
    if ($id !== '') {
        $idsDispVisit[$id] = true;
    }
}

// ==================== 3) RESERVAS DE VISITA ====================
$cntVisitas = 0;
$cntPernocta = 0;

if (is_file($archivos['reservas'])) {
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $qIns = $pdo->prepare(
            'INSERT INTO reservas_visitas
                (id_reserva, albergue_id, institucion, responsable, dni, contacto,
                 cantidad, fecha_ingreso, hora_ingreso, hora_egreso, pernocta, estado, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach (leerCsv($archivos['reservas']) as $i => $fila) {
            $id       = trim((string) ($fila[0] ?? ''));
            $created  = trim((string) ($fila[1] ?? ''));
            $albergue = trim((string) ($fila[2] ?? ''));
            $institucion = trim((string) ($fila[3] ?? ''));
            $responsable = trim((string) ($fila[4] ?? ''));
            $dni      = trim((string) ($fila[5] ?? ''));
            $contacto = trim((string) ($fila[6] ?? ''));
            $cantidad = (int) trim((string) ($fila[7] ?? ''));
            $fechaIng = trim((string) ($fila[8] ?? ''));
            $horaIng  = trim((string) ($fila[9] ?? ''));
            $horaEgr  = trim((string) ($fila[10] ?? ''));
            $estado   = trim((string) ($fila[11] ?? 'Pre-Reserva'));

            if ($id === '' || $albergue === '' || $fechaIng === '' || $cantidad <= 0) {
                $omitidos[] = "Visita fila #" . ($i + 2) . ": datos incompletos (id='{$id}', albergue='{$albergue}', fecha='{$fechaIng}', cantidad={$cantidad}).";
                continue;
            }
            if (!isset($idPorNombre[$albergue])) {
                $omitidos[] = "Visita fila #" . ($i + 2) . ": albergue desconocido '{$albergue}'.";
                continue;
            }

            $pernocta = isset($idsDispVisit[$id]) ? 'Sí' : 'No';
            if ($pernocta === 'Sí') {
                $cntPernocta++;
            }

            $qIns->execute([
                (int) $id,
                $idPorNombre[$albergue],
                $institucion,
                $responsable,
                $dni,
                $contacto,
                $cantidad,
                $fechaIng,
                $horaIng,
                $horaEgr,
                $pernocta,
                $estado === '' ? 'Pre-Reserva' : $estado,
                $created === '' ? null : $created,
            ]);
            $cntVisitas++;
        }
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->exec('ROLLBACK');
        }
        throw $e;
    }
} else {
    $errores[] = 'Falta ' . $archivos['reservas'] . ' para migrar visitas.';
}

// ==================== 4) RESERVAS DE ALOJAMIENTO ====================
$cntAlo = 0;
$cntDias = 0;

if (is_file($archivos['reservasAlo'])) {
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $qInsAlo = $pdo->prepare(
            'INSERT INTO reservas_alojamiento
                (id_reserva, albergue_id, institucion, responsable, dni, contacto,
                 cantidad, rango_fechas, estado, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $qInsDia = $pdo->prepare(
            'INSERT INTO reserva_alojamiento_dias (reserva_id, fecha, cantidad) VALUES (?, ?, ?)'
        );

        foreach (leerCsv($archivos['reservasAlo']) as $i => $fila) {
            $id       = trim((string) ($fila[0] ?? ''));
            $created  = trim((string) ($fila[1] ?? ''));
            $albergue = trim((string) ($fila[2] ?? ''));
            $institucion = trim((string) ($fila[3] ?? ''));
            $responsable = trim((string) ($fila[4] ?? ''));
            $dni      = trim((string) ($fila[5] ?? ''));
            $contacto = trim((string) ($fila[6] ?? ''));
            $cantidad = (int) trim((string) ($fila[7] ?? ''));
            $rangoRaw = trim((string) ($fila[8] ?? ''));
            $estado   = trim((string) ($fila[9] ?? 'Pre-Reserva'));

            if ($id === '' || $albergue === '' || $cantidad <= 0 || $rangoRaw === '') {
                $omitidos[] = "Alojamiento fila #" . ($i + 2) . ": datos incompletos (id='{$id}', albergue='{$albergue}', cantidad={$cantidad}).";
                continue;
            }
            if (!isset($idPorNombre[$albergue])) {
                $omitidos[] = "Alojamiento fila #" . ($i + 2) . ": albergue desconocido '{$albergue}'.";
                continue;
            }

            $rango = array_values(array_unique(array_filter(
                array_map('trim', explode(',', $rangoRaw)),
                static fn (string $f): bool => $f !== ''
            )));

            if (count($rango) === 0) {
                $omitidos[] = "Alojamiento fila #" . ($i + 2) . ": rango de fechas vacío (id={$id}).";
                continue;
            }

            $qInsAlo->execute([
                (int) $id,
                $idPorNombre[$albergue],
                $institucion,
                $responsable,
                $dni,
                $contacto,
                $cantidad,
                $rangoRaw,
                $estado === '' ? 'Pre-Reserva' : $estado,
                $created === '' ? null : $created,
            ]);
            $reservaPk = (int) $pdo->lastInsertId();

            foreach ($rango as $fecha) {
                $qInsDia->execute([$reservaPk, $fecha, $cantidad]);
                $cntDias++;
            }
            $cntAlo++;
        }
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->exec('ROLLBACK');
        }
        throw $e;
    }
} else {
    $errores[] = 'Falta ' . $archivos['reservasAlo'] . ' para migrar alojamiento.';
}

// ==================== 5) VERIFICACIÓN ====================
// Verificación visitas
$difVisitas = [];
$sumVis = [];
foreach ($pdo->query(
    'SELECT al.nombre AS albergue, r.fecha_ingreso AS fecha, SUM(r.cantidad) AS tot
     FROM reservas_visitas r JOIN albergues al ON al.id = r.albergue_id
     WHERE r.pernocta = \'Sí\'
     GROUP BY al.nombre, r.fecha_ingreso'
)->fetchAll() as $row) {
    $sumVis[$row['albergue'] . '|' . $row['fecha']] = (int) $row['tot'];
}
$capVis = [];
foreach ($pdo->query('SELECT nombre, capacidad FROM albergues')->fetchAll() as $a) {
    $capVis[$a['nombre']] = (int) $a['capacidad'];
}
foreach ($dispVisit as $i => $fila) {
    $fecha = trim((string) ($fila[0] ?? ''));
    $albergue = trim((string) ($fila[1] ?? ''));
    $dispSheet = (int) ($fila[4] ?? -1);
    if ($albergue === '' || $fecha === '') {
        continue;
    }
    $ocupados = $sumVis[$albergue . '|' . $fecha] ?? 0;
    $esperado = max(0, ($capVis[$albergue] ?? 0) - $ocupados);
    if ($esperado !== $dispSheet) {
        $difVisitas[] = "{$albergue} {$fecha}: hoja={$dispSheet}, derivado={$esperado}";
    }
}

// Verificación alojamiento
$difAlo = [];
$sumAlo = [];
foreach ($pdo->query(
    'SELECT al.nombre AS albergue, d.fecha AS fecha, SUM(d.cantidad) AS tot
     FROM reserva_alojamiento_dias d
     JOIN reservas_alojamiento r ON r.id = d.reserva_id
     JOIN albergues al ON al.id = r.albergue_id
     GROUP BY al.nombre, d.fecha'
)->fetchAll() as $row) {
    $sumAlo[$row['albergue'] . '|' . $row['fecha']] = (int) $row['tot'];
}
foreach (leerCsv($archivos['dispAlo']) as $i => $fila) {
    $fecha = trim((string) ($fila[0] ?? ''));
    $albergue = trim((string) ($fila[1] ?? ''));
    $dispSheet = (int) ($fila[4] ?? -1);
    if ($albergue === '' || $fecha === '') {
        continue;
    }
    $ocupados = $sumAlo[$albergue . '|' . $fecha] ?? 0;
    $esperado = max(0, ($capVis[$albergue] ?? 0) - $ocupados);
    if ($esperado !== $dispSheet) {
        $difAlo[] = "{$albergue} {$fecha}: hoja={$dispSheet}, derivado={$esperado}";
    }
}

// ==================== 6) REPORTE ====================
$dbFile = '';
foreach ($pdo->query('PRAGMA database_list')->fetchAll() as $r) {
    if (($r['name'] ?? '') === 'main') {
        $dbFile = (string) ($r['file'] ?? '');
    }
}
echo "=== MIGRACIÓN A SQLITE ===\n";
echo "BD objetivo: {$dbFile}\n";
echo "Albergues: " . count($idPorNombre) . "\n";
echo "Reservas de visita migradas: {$cntVisitas} (con pernocta='Sí': {$cntPernocta})\n";
echo "Reservas de alojamiento migradas: {$cntAlo} (días normalizados: {$cntDias})\n";

if ($avisos) {
    echo "\n— Avisos (" . count($avisos) . "):\n";
    foreach ($avisos as $a) {
        echo "  • {$a}\n";
    }
}

if ($omitidos) {
    echo "\n— Filas omitidas por datos incompletos/ambigüedad (" . count($omitidos) . "):\n";
    foreach (array_slice($omitidos, 0, 30) as $o) {
        echo "  • {$o}\n";
    }
    if (count($omitidos) > 30) {
        echo "  … y " . (count($omitidos) - 30) . " más.\n";
    }
    echo "  NOTA: NO se inventaron valores. Revise las filas y repórtelas para una decisión.\n";
}

if ($difVisitas || $difAlo) {
    echo "\n— Discrepancias disponibilidad hoja vs. derivada:\n";
    if ($difVisitas) {
        echo "  Visitas (" . count($difVisitas) . "):\n";
        foreach (array_slice($difVisitas, 0, 20) as $d) {
            echo "    • {$d}\n";
        }
    }
    if ($difAlo) {
        echo "  Alojamiento (" . count($difAlo) . "):\n";
        foreach (array_slice($difAlo, 0, 20) as $d) {
            echo "    • {$d}\n";
        }
    }
    echo "  NOTA: son cálculos derivados; revisar si representan datos históricos o errores del sheet.\n";
} else {
    echo "\n✓ Disponibilidad verificada: coincide con las hojas exportadas.\n";
}

if ($errores) {
    echo "\n— ERRORES (" . count($errores) . "):\n";
    foreach ($errores as $e) {
        echo "  ✗ {$e}\n";
    }
    exit(1);
}

echo "\nMigración finalizada correctamente.\n";
exit(0);