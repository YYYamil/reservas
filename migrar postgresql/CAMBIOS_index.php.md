# Cambios necesarios en index.php (transacciones)

PostgreSQL no soporta `BEGIN IMMEDIATE`.  
Hay que reemplazar las transacciones por los métodos nativos de PDO.

## Reemplazos globales

Buscar y reemplazar en todo el archivo:

| Antes (SQLite)                      | Después (PostgreSQL / PDO)          |
|-------------------------------------|-------------------------------------|
| `$pdo->exec('BEGIN IMMEDIATE');`    | `$pdo->beginTransaction();`         |
| `$pdo->exec('COMMIT');`             | `$pdo->commit();`                   |
| `$pdo->exec('ROLLBACK');`           | `$pdo->rollBack();`                 |

Los `if ($pdo->inTransaction())` se mantienen igual (funcionan en ambos motores).

## Ejemplo concreto (bloque de crearReserva)

**Antes:**
```php
$pdo->exec('BEGIN IMMEDIATE');
try {
    // ...
    if (...) {
        $pdo->exec('ROLLBACK');
        responder(...);
    }
    // ...
    $pdo->exec('COMMIT');
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->exec('ROLLBACK');
    }
    throw $e;
}
```

**Después:**
```php
$pdo->beginTransaction();
try {
    // ...
    if (...) {
        $pdo->rollBack();
        responder(...);
    }
    // ...
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}
```

Hacer el mismo cambio en los tres bloques que usan transacciones:
1. `crearReserva`
2. `cancelarReserva`
3. `crearReservaAlojamiento`
