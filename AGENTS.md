# AGENTS.md — instrucciones para agentes en este repositorio

Este archivo lo leen los agentes que trabajan en el repo. Si sos un agente:
leelo completo antes de ejecutar cualquier comando.

## Qué es este proyecto

Sistema de reservas de los albergues del Ministerio de Educación de Tucumán.
Sitio estático (HTML/CSS/JS) + API en PHP + PostgreSQL.

- Páginas actuales: `index.html`, `pago.html`, `reglamento.html`, `admin/`.
- Lógica de reservas: `script.js` (3.100 líneas) + `api/index.php`.
- Las tarjetas y modales se generan por JavaScript a partir de `listarAlbergues`.

Hay un rediseño en curso (Propuesta 2) que **no debe romper nada de lo anterior**.

## Reglas duras

Estas reglas no se negocian sin instrucción explícita del humano:

1. **No modificar `api/`** durante el rediseño. Ni endpoints, ni validaciones, ni
   migraciones, ni esquema.
2. **No tocar `admin/`**. Es otro producto, con otro público.
3. **No desplegar.** El deploy corre en el servidor Oracle y lo dispara una
   persona. Nunca ejecutar `deploy-reservas.sh`.
4. **No ejecutar migraciones ni seeds.**
5. **No hacer `push --force`** ni reescribir historia.
6. **Probar siempre contra `reserva_albergue_dev`**, nunca contra producción.
7. Trabar en la rama `feature/landing-v2`. `main` es la única rama de deploy.

## El rediseño, en dos oraciones

El sitio pasa de "catálogo institucional con formularios en modales" a un flujo de
reserva en páginas propias (`index`, `reservar`, `mi-reserva`, `pago`), con un
sistema visual nuevo. La lógica de negocio, las claves de albergue y los textos
legales no cambian.

## Dónde está el contrato

| Documento | Qué contiene |
|---|---|
| `docs/README.md` | Índice y puesta en marcha |
| `docs/BRIEF-KOMBAI.md` | Páginas, componentes, estados, tokens, reglas. **Manda sobre todo** |
| `docs/CONTRATO-INTEGRACION.md` | IDs y clases que `script.js` espera. Obligatorio antes de tocar markup |
| `docs/datos-mock.md` | Datos reales y escenarios |
| `docs/CHECKLIST-SECCION.md` | Verificación por entrega |
| `docs/PROMPTS/` | Los 12 pedidos, en orden |
| `docs/FLUJO-GIT.md` | Entornos, ramas, deploy |
| `docs/MAQUINA-ESTADOS-RESERVAS.md` | Estados de una reserva |

`v2/` es el espacio de trabajo del rediseño. El sitio actual no se toca hasta que
`v2/` esté terminado, probado y aprobado.

## Entorno local

- Túnel SSH a PostgreSQL (ver `docs/FLUJO-GIT.md`).
- Servidor: `C:\php\php.exe -S 127.0.0.1:8000`.
- `api/config.local.php` apunta a `reserva_albergue_dev`.
- Smoke test: `api/tests/smoke_test.php` (inspeccionar antes de ejecutar: no
  asumir parámetros).
- URL de la API: `http://127.0.0.1:8000/api/index.php?action=listarAlbergues`.

## Protocolo de trabajo

1. Un pedido por vez, en el orden de `docs/PROMPTS/README.md`.
2. Antes de escribir markup: leer `CONTRATO-INTEGRACION.md` y respetar los IDs y
   las clases hook.
3. Después de cada sección: correr `docs/CHECKLIST-SECCION.md`.
4. Un commit por sección, con el nombre de la sección.
5. Reportar siempre: qué cambió, qué se verificó y cómo, qué quedó pendiente.

## Reparto entre herramientas

- **Kombai (VS Code)**: genera la capa visual dentro de `v2/`.
- **OpenCode (terminal)**: entorno, git, servidor, verificación, integración de
  datos (`data-*` ↔ `script.js`), smoke tests, commits.
- **Humano**: decide marca y alcance, aprueba merges.

Regla de convivencia: **un solo agente escribe un archivo a la vez**. Si Kombai
está generando una sección, no editarla en paralelo. El punto de handoff es un
commit.

## Parar y preguntar

- Si el cambio requiere tocar `script.js`, `api/` o la cantidad de pasos del
  wizard (son 4).
- Si hay que renombrar las claves `maestro`, `aquilina`, `tinku`.
- Si hay que renombrar una clase hook (`.dia`, `.step-container`, `.progress-fill`,
  `.btn-submit`, `.badge-libre`, `.en-rango`, etc.).
- Si un test de humo falla o el flujo de reserva deja de funcionar.
- Si aparece un endpoint que no existe (por ejemplo, consultar estado de reserva).

## Lo que ya está decidido (no reabrir)

- HTML/CSS vanilla, sin framework ni build step.
- Wizard de 4 pasos, en página propia, no en modal.
- La home no muestra dos CTA de reserva por tarjeta.
- El mapa no se embebe en la landing.
- `mi-reserva.html` solo cancela (no consulta estado).
- Las fotos son las que existen en `Img/`; no se inventan ni se usan de stock.
