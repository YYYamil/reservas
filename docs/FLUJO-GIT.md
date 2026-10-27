# Flujo de trabajo Git (Windows local -> GitHub -> Oracle produccion)

Este documento define el unico flujo soportado para desarrollar y desplegar.
La regla base es simple: **el codigo se escribe en la PC con Windows, viaja por
GitHub y el servidor solo lo descarga. Nunca se edita codigo en el servidor.**

## Resumen

```
PC Windows (desarrollo)            GitHub                 Oracle (produccion)
  rama main / feature  --push-->  origin/main  --fetch-->  main (checkout limpio)
        |                                                         |
        +-- BD: reserva_albergue_dev (via tunel SSH)              +-- BD: reserva_albergue
        +-- archivos: disco local                                 +-- archivos: disco servidor
```

- `main` es la **unica rama de despliegue**. Todo lo que esta en `main` esta
  probado en local.
- `mailv1` quedo como rama historica. Ya no se usa para desplegar.
- `.gitlab-ci.yml` es legado del repositorio anterior. GitHub no lo ejecuta:
  el unico deploy valido es `scripts/deploy-reservas.sh` en Oracle.
- Produccion **no** tiene base de desarrollo: usa `reserva_albergue`.
- Desarrollo local usa `reserva_albergue_dev`, aislada de produccion.

## Entornos

| Entorno | URL | Base de datos | Codigo |
|---|---|---|---|
| Local | `http://127.0.0.1:8000` | `reserva_albergue_dev` (tunel SSH, puerto 15432) | tu copia de `main` |
| Produccion | `https://reservas.yamy.fun` | `reserva_albergue` | `/var/www/reservas-albergues` (rama `main`) |

## Preparar el entorno local (una sola vez)

1. Abrir el tunel SSH a PostgreSQL:

   ```powershell
   .\iniciar-tunel-oracle.ps1
   ```

2. Verificar que `api/config.local.php` apunte a la base de desarrollo:

   ```php
   'db_host' => '127.0.0.1',
   'db_port' => '15432',
   'db_name' => 'reserva_albergue_dev',
   'db_user' => 'usr_dev',
   'notif_envio_inmediato' => false,
   ```

3. Levantar el servidor local:

   ```powershell
   C:\php\php.exe -S 127.0.0.1:8000
   ```

4. Abrir `http://127.0.0.1:8000`.

> `api/config.local.php` esta en `.gitignore`: cada entorno tiene el suyo y
> nunca se sube al repositorio.

## Ciclo de desarrollo

### 1. Actualizar tu copia antes de empezar

```powershell
git checkout main
git pull origin main
```

### 2. Desarrollar y probar en local

- Trabaja sobre `main` (flujo simple) o crea una rama corta si el cambio es
  grande:

  ```powershell
  git checkout -b feature/mi-cambio
  ```

- Proba en `http://127.0.0.1:8000` contra `reserva_albergue_dev`.
- Recorda que las fotos, PDFs y comprobantes que subas en local quedan en
  **tu disco**, no en el servidor.

### 3. Confirmar y subir

```powershell
git add -A
git commit -m "feat: descripcion del cambio"
git push origin main
```

Si trabajaste en una rama:

```powershell
git checkout main
git merge --no-ff feature/mi-cambio
git push origin main
git branch -d feature/mi-cambio
```

### 4. Desplegar en produccion

Desde tu PC:

```powershell
& "C:\msys64\usr\bin\ssh.exe" -i "$HOME\Downloads\ssh-key-2026-10-13.key" ubuntu@155.181.131.152 "/home/ubuntu/deploy-reservas.sh"
```

O entrando por SSH:

```bash
ssh -i ~/Downloads/ssh-key-2026-10-13.key ubuntu@155.181.131.152
/home/ubuntu/deploy-reservas.sh
```

El script:

1. Hace `git fetch` de `origin/main`.
2. Descarta cualquier cambio hecho a mano en el servidor y deja el arbol
   exactamente en `origin/main`.
3. Aplica solo las migraciones nuevas (`schema_migrations`).
4. Ajusta permisos de `comprobantes/`, `Img/albergues/` y
   `api/config.local.php` (sin tocar su contenido).
5. Recarga Nginx y PHP-FPM.

### 5. Verificar

```powershell
curl.exe -I https://reservas.yamy.fun/
curl.exe -I https://reservas.yamy.fun/pago.html
```

En el panel, `Ctrl + Shift + R` para descartar cache si cambiaste CSS/JS.
Cuando toques `admin.css` o `admin.js`, subi tambien el `?v=` en
`admin/index.html` para forzar la recarga.

## Que se versiona y que no

| Elemento | En Git | Viaja entre entornos |
|---|---|---|
| Codigo (`api/`, `admin/`, HTML, JS, CSS) | Si | Si |
| Migraciones (`api/migrations/`) | Si | Si |
| `api/config.local.php` | No | No (credenciales por entorno) |
| `api/config.php` | No | No (se genera en el servidor) |
| `comprobantes/` | No | No (datos personales) |
| `Img/albergues/` | No | No (archivos subidos) |
| Scripts del servidor (`deploy-reservas.sh`) | Si (`scripts/`) | Se instalan una vez |
| Nginx, TLS, cron, backups | No | Configuracion del servidor |

Consecuencia practica: si subis una imagen o un PDF en produccion, no aparece
en tu local (y al reves). Para probar cargas usá la base y el disco locales.

## Instalacion inicial del deploy en el servidor

Solo la primera vez (o si se reinstala el servidor), dejar
`/home/ubuntu/deploy-reservas.sh` como lanzador del script versionado:

```bash
sudo tee /home/ubuntu/deploy-reservas.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec /var/www/reservas-albergues/scripts/deploy-reservas.sh
EOF
sudo chmod 755 /home/ubuntu/deploy-reservas.sh
```

A partir de ahi, cualquier cambio en `scripts/deploy-reservas.sh` llega solo
con el deploy.

## Re-clonar la base de desarrollo

Si produccion cambio mucho (nuevos albergues, imagenes, usuarios de prueba),
podes volver a copiar produccion sobre la base dev. **Cerrá el servidor local
y las conexiones del tunel antes de ejecutarlo.**

```bash
sudo /home/ubuntu/reset-dev-db.sh
```

O directamente:

```bash
sudo bash /var/www/reservas-albergues/scripts/reset-dev-db.sh
```

## Problemas comunes

### `git pull` en el servidor falla por cambios locales

No edites archivos en el servidor. El deploy ya resuelve esto con
`git reset --hard origin/main`, pero si el script falla:

```bash
cd /var/www/reservas-albergues
git status
git fetch origin main
git reset --hard origin/main
```

Los archivos ignorados (`api/config.local.php`, `comprobantes/`,
`Img/albergues/`) no se tocan.

### Faltan imagenes o PDFs en local

Es esperable: no estan versionados. Copialos desde el servidor:

```powershell
& "C:\msys64\usr\bin\scp.exe" -i "$HOME\Downloads\ssh-key-2026-10-13.key" `
  "ubuntu@155.181.131.152:/var/www/reservas-albergues/Img/albergues/altoverde/*" `
  "D:\yamil\med_albergues\Img\albergues\altoverde\"
```

### Un comprobante subido en local no se ve en produccion

El archivo quedo en tu disco y la fila en la base dev. Para produccion, subilo
desde el panel de produccion (o copia el archivo al servidor y la fila a la
base de produccion).

### Cambios de CSS/JS no se ven

Subi la version de los assets en `admin/index.html` (`?v=AAAAMMDDx`) o hace
`Ctrl + Shift + R`.

### El servidor muestra una version vieja

```bash
cd /var/www/reservas-albergues
git log --oneline -1
git status -sb
```

Debe coincidir con `origin/main`. Si no, corré el deploy de nuevo.

## Rollback

El deploy es un checkout exacto de `origin/main`, asi que volver atras es
revertir en Git y desplegar:

```powershell
git revert <commit>
git push origin main
```

Luego corré el deploy en el servidor. Evita `git reset --hard` sobre `main`
publicado: deja el historial roto para el resto.

## Referencia rapida

```powershell
# Local
.\iniciar-tunel-oracle.ps1
git checkout main
git pull origin main
C:\php\php.exe -S 127.0.0.1:8000

# Subir
git add -A
git commit -m "..."
git push origin main

# Deploy
& "C:\msys64\usr\bin\ssh.exe" -i "$HOME\Downloads\ssh-key-2026-10-13.key" `
  ubuntu@155.181.131.152 "/home/ubuntu/deploy-reservas.sh"
```
