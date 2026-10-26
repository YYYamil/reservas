<?php
declare(strict_types=1);

/**
 * Mailer mínimo por SMTP con STARTTLS, sin dependencias externas.
 * Compatible con Resend (smtp.resend.com:587).
 *
 * Uso:
 *   $mailer = new Mailer($config);
 *   $mailer->enviar('dest@dominio.com', 'Asunto', '<html>...</html>');
 */
class Mailer
{
    private array $cfg;

    public function __construct(array $config)
    {
        $this->cfg = $config;
    }

    /**
     * Envía un correo HTML (con fallback de texto plano).
     * Devuelve el ID de mensaje del proveedor (SMTP 250 response) o lanza excepción.
     */
    public function enviar(string $para, string $asunto, string $html, string $textoPlano = ''): string
    {
        $host = (string) ($this->cfg['smtp_host'] ?? '');
        $port = (int) ($this->cfg['smtp_port'] ?? 587);
        $user = (string) ($this->cfg['smtp_user'] ?? '');
        $pass = (string) ($this->cfg['smtp_pass'] ?? '');
        $from = (string) ($this->cfg['mail_from'] ?? '');
        $fromName = (string) ($this->cfg['mail_from_name'] ?? '');

        if ($host === '' || $user === '' || $pass === '' || $from === '') {
            throw new RuntimeException('Configuración SMTP incompleta');
        }
        if (filter_var($para, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('Destinatario inválido: ' . $para);
        }

        $fp = @stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 20);
        if ($fp === false) {
            throw new RuntimeException("No se pudo conectar a SMTP {$host}:{$port} ({$errstr})");
        }
        stream_set_timeout($fp, 20);

        try {
            $this->esperar($fp, '220');
            $this->cmd($fp, 'EHLO ' . ($_SERVER['SERVER_NAME'] ?? 'localhost'), '250');

            // STARTTLS
            $this->cmd($fp, 'STARTTLS', '220');
            $ok = @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if ($ok !== true) {
                throw new RuntimeException('No se pudo iniciar TLS con el servidor SMTP');
            }
            $this->cmd($fp, 'EHLO ' . ($_SERVER['SERVER_NAME'] ?? 'localhost'), '250');

            // AUTH LOGIN
            $this->cmd($fp, 'AUTH LOGIN', '334');
            $this->cmd($fp, base64_encode($user), '334');
            $this->cmd($fp, base64_encode($pass), '235');

            $this->cmd($fp, "MAIL FROM:<{$from}>", '250');
            $this->cmd($fp, "RCPT TO:<{$para}>", '250');
            $this->cmd($fp, 'DATA', '354');

            $cuerpo = $this->construirMensaje($para, $asunto, $html, $textoPlano, $from, $fromName);
            $cuerpo = preg_replace('/^\./m', '..', $cuerpo); // dot-stuffing
            fwrite($fp, $cuerpo . "\r\n.\r\n");
            $respuesta = $this->esperar($fp, '250');

            $this->cmd($fp, 'QUIT', '221');
            fclose($fp);

            // Extraer id de mensaje del proveedor (Resend lo incluye en la respuesta)
            if (preg_match('/250[ -](.+)/', $respuesta, $m)) {
                return trim($m[1]);
            }
            return '';
        } catch (Throwable $e) {
            @fclose($fp);
            throw $e;
        }
    }

    private function construirMensaje(string $para, string $asunto, string $html, string $texto, string $from, string $fromName): string
    {
        $boundary = 'b_' . bin2hex(random_bytes(8));
        $fecha = date('r');
        $encFrom = '=?UTF-8?B?' . base64_encode($fromName) . "?= <{$from}>";
        $encSubj = '=?UTF-8?B?' . base64_encode($asunto) . '?=';

        if ($texto === '') {
            $texto = trim(strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>'], "\n", $html)));
        }

        $h = [];
        $h[] = "From: {$encFrom}";
        $h[] = "To: <{$para}>";
        $h[] = "Subject: {$encSubj}";
        $h[] = "Date: {$fecha}";
        $h[] = 'MIME-Version: 1.0';
        $h[] = "Content-Type: multipart/alternative; boundary=\"{$boundary}\"";
        $h[] = '';
        $h[] = "--{$boundary}";
        $h[] = 'Content-Type: text/plain; charset=UTF-8';
        $h[] = 'Content-Transfer-Encoding: base64';
        $h[] = '';
        $h[] = chunk_split(base64_encode($texto));
        $h[] = "--{$boundary}";
        $h[] = 'Content-Type: text/html; charset=UTF-8';
        $h[] = 'Content-Transfer-Encoding: base64';
        $h[] = '';
        $h[] = chunk_split(base64_encode($html));
        $h[] = "--{$boundary}--";

        return implode("\r\n", $h);
    }

    private function cmd($fp, string $comando, string $esperado): string
    {
        fwrite($fp, $comando . "\r\n");
        return $this->esperar($fp, $esperado);
    }

    private function esperar($fp, string $codigo): string
    {
        $linea = '';
        $inicio = microtime(true);
        while (($l = fgets($fp, 2048)) !== false) {
            $linea .= $l;
            // Línea final: código + espacio (no guion)
            if (isset($l[3]) && $l[3] === ' ') {
                break;
            }
            if (microtime(true) - $inicio > 20) {
                throw new RuntimeException('Timeout esperando respuesta SMTP');
            }
        }
        if (!str_starts_with(trim($linea), $codigo)) {
            throw new RuntimeException('SMTP esperaba ' . $codigo . ', recibió: ' . trim($linea));
        }
        return trim($linea);
    }
}
