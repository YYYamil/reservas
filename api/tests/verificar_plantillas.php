<?php
declare(strict_types=1);

/**
 * Verificación de las plantillas de correo (sin SMTP ni BD).
 * Uso: php api/tests/verificar_plantillas.php
 *
 * Genera los correos de cada evento y comprueba que incluyan el detalle
 * completo de la reserva. Guarda el HTML de muestra en
 * api/tests/muestras/ para inspección visual en el navegador.
 */

require __DIR__ . '/../notificaciones.php';

$dir = __DIR__ . '/muestras';
if (!is_dir($dir)) {
    mkdir($dir, 0777, true);
}

$visita = [
    'modalidad'     => 'visita',
    'codigo_publico'=> 'R-000123',
    'albergue'      => 'Maestro José Fierro',
    'institucion'   => 'Escuela N° 12 "General San Martín"',
    'responsable'   => 'Ana Pérez',
    'dni'           => '30111222',
    'contacto'      => '3811234567',
    'email'         => 'ana.perez@example.com',
    'cantidad'      => 5,
    'fecha_ingreso' => '2026-12-01',
    'hora_ingreso'  => '08:30',
    'hora_egreso'   => '18:00',
    'estado'        => 'Pre-Reserva',
    'monto_total'   => 10000,
    'pago_vence_at' => date('Y-m-d H:i:s', strtotime('+7 days')),
    'created_at'    => date('Y-m-d H:i:s'),
    'rango_fechas'  => null,
];

$alojamiento = $visita;
$alojamiento['modalidad']     = 'alojamiento';
$alojamiento['codigo_publico']= 'R-000124';
$alojamiento['cantidad']      = 4;
$alojamiento['monto_total']   = 60000;
$alojamiento['rango_fechas']  = '2026-12-10,2026-12-11,2026-12-12';
$alojamiento['estado']        = 'Confirmado';
unset($alojamiento['fecha_ingreso'], $alojamiento['hora_ingreso'], $alojamiento['hora_egreso']);

$eventos = ['creacion', 'recordatorio', 'confirmacion', 'cancelacion', 'cancelacion_cliente',
    'pago_recibido', 'aviso_admin', 'vencimiento', 'rechazo', 'devolucion',
    'comprobante_recibido', 'validacion_admin'];

$fallos = 0;
$revisar = static function (string $nombre, array $r, array $esperados) use ($dir, &$fallos): void {
    [$asunto, $html] = plantillaCorreo($nombre, $r, 'https://reservas.yamy.fun');

    $faltan = [];
    foreach ($esperados as $texto) {
        // El HTML del correo escapa los caracteres especiales (comillas, acentos
        // ya vienen en UTF-8), por lo que se acepta el texto tal cual o escapado.
        if (!str_contains($html, $texto) && !str_contains($html, h($texto))) {
            $faltan[] = $texto;
        }
    }
    $ok = $faltan === [];
    if (!$ok) {
        $fallos++;
    }
    printf("[%s] %-20s asunto: %s\n", $ok ? 'PASS' : 'FAIL', $nombre, $asunto);
    if (!$ok) {
        printf("       faltan: %s\n", implode(' | ', $faltan));
    }
    file_put_contents($dir . '/correo_' . $nombre . '.html', $html);
};

$baseVisita = [
    'Código de reserva', 'R-000123', 'Maestro José Fierro', 'Visita diaria',
    'Escuela N° 12 "General San Martín"', 'Ana Pérez', '30111222',
    '3811234567', 'ana.perez@example.com', 'Cantidad de personas',
    '01/12/2026', '08:30', '18:00', 'Monto total', '$10.000',
    'Vence el', 'Pre-Reserva', 'Pre-reserva registrada',
];

$revisar('creacion', $visita, array_merge($baseVisita, ['pago.html', 'R-000123']));
$revisar('recordatorio', $visita, array_merge($baseVisita, ['pago.html']));
$revisar('cancelacion_cliente', $visita, array_merge($baseVisita, ['cupo fue liberado']));
$revisar('cancelacion', $visita, array_merge($baseVisita, ['cupo fue liberado']));
$revisar('aviso_admin', $visita, $baseVisita);

// ---- Comprobante recibido: acuse al cliente y aviso al admin con plazo ------
$comprobante = $visita;
$comprobante['estado']              = 'Comprobar';
$comprobante['comprobado_at']       = date('Y-m-d H:i:s');
$comprobante['validacion_vence_at'] = date('Y-m-d H:i:s', strtotime('+24 hours'));

$limiteLargo = date('d/m/Y H:i', strtotime('+24 hours'));
$limiteCorto = date('d/m/Y', strtotime('+24 hours'));

$revisar('pago_recibido', $comprobante, [
    'Código de reserva', 'R-000123', 'Maestro José Fierro', 'Comprobante para validar',
    'Fecha límite para aprobar o rechazar', $limiteLargo, 'Comprobar',
]);

$revisar('comprobante_recibido', $comprobante, [
    'Código de reserva', 'R-000123', 'Maestro José Fierro', 'Comprobante recibido',
    'La revisión está prevista antes del ' . $limiteCorto,
]);

// ---- Aviso de validación al administrador ----------------------------------
$validada = $comprobante;
$validada['estado']                 = 'Confirmado';
$validada['validado_por_nombre']    = 'Ana Pérez';
$validada['estado_modificado_por']  = 'aperez';
$validada['estado_modificado_at']   = date('Y-m-d H:i:s');

$revisar('validacion_admin', $validada, [
    'Código de reserva', 'R-000123', 'Maestro José Fierro', 'Reserva validada',
    'por Ana Pérez', 'La reserva quedó confirmada',
]);

$revisar('confirmacion', $alojamiento, [
    'Código de reserva', 'R-000124', 'Alojamiento con estadía',
    'Fechas de alojamiento', '10/12/2026 / 11/12/2026 / 12/12/2026', 'Noches',
    'Monto total', '$60.000', '>Confirmado<',
]);

// ---- Eventos nuevos de la máquina de estados -------------------------------
$vencida = $visita;
$vencida['estado'] = 'Vencido';
$revisar('vencimiento', $vencida, [
    'Código de reserva', 'R-000123', 'Maestro José Fierro', 'Vencido', 'cupo fue liberado',
]);

$rechazada = $visita;
$rechazada['motivo_rechazo'] = 'El importe no coincide con el total';
$revisar('rechazo', $rechazada, [
    'Código de reserva', 'R-000123', 'Comprobante rechazado',
    'El importe no coincide con el total', 'pago.html', 'Vence el',
]);

$devuelta = $visita;
$devuelta['estado'] = 'Devolver';
$devuelta['devolucion_pct'] = 100;
$devuelta['devolucion_monto'] = 10000;
$revisar('devolucion', $devuelta, [
    'Código de reserva', 'R-000123', 'Devolución', '100%', '$10.000',
]);

// El texto plano debe derivarse sin etiquetas ni entidades.
[, $html] = plantillaCorreo('creacion', $visita, 'https://reservas.yamy.fun');
$texto = textoDesdeHtml($html);
$okTexto = !str_contains($texto, '<') && str_contains($texto, 'Código de reserva') && str_contains($texto, 'Ana Pérez');
echo '[' . ($okTexto ? 'PASS' : 'FAIL') . "] texto plano derivado del HTML\n";
if (!$okTexto) {
    $fallos++;
}

echo "\nMuestras guardadas en api/tests/muestras/\n";
echo $fallos === 0 ? "OK: todas las plantillas incluyen el detalle de la reserva\n" : "FALLOS: {$fallos}\n";
exit($fallos === 0 ? 0 : 1);
