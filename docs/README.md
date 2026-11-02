# Rediseño de la landing — empezar acá

Índice del paquete de trabajo para rehacer el sitio de reservas de albergues con
Kombai, sin tocar la lógica de reservas.

Si llegaste sin contexto: el objetivo es pasar de "catálogo institucional con
formularios en modales" a un flujo de reserva en páginas propias, con un sistema
visual nuevo. La lógica (`api/`, reglas de negocio, `admin/`) no se modifica.

## Qué leer, según lo que necesites

| Archivo | Para qué | Cuándo |
|---|---|---|
| [PROPUESTA-LANDING-V2.md](PROPUESTA-LANDING-V2.md) | Por qué se cambia la estructura y qué se descartó | Antes de decidir |
| [BRIEF-KOMBAI.md](BRIEF-KOMBAI.md) | **El contrato.** Páginas, componentes, tokens, reglas | Siempre, antes de cada prompt |
| [datos-mock.md](datos-mock.md) | Datos reales y escenarios para los mockups | En cada prompt |
| [CONTRATO-INTEGRACION.md](CONTRATO-INTEGRACION.md) | IDs y clases que el JS espera; bootstrap por página | Al conectar, y en cada revisión |
| [CHECKLIST-SECCION.md](CHECKLIST-SECCION.md) | Qué verificar antes de cada commit | En cada entrega |
| [PROMPTS/README.md](PROMPTS/README.md) | Los 12 pedidos, en orden | Para arrancar |
| [PROMPTS/01..12](PROMPTS/) | Los textos a pegarle a Kombai | Uno por vez |
| [../v2/README.md](../v2/README.md) | Cómo aislar el workspace del agente | Al abrir VS Code |
| [FLUJO-GIT.md](FLUJO-GIT.md) | Ramas, deploy, entornos | Para publicar |
| [MAQUINA-ESTADOS-RESERVAS.md](MAQUINA-ESTADOS-RESERVAS.md) | Estados de una reserva | Si tocás el flujo |

## Puesta en marcha (una sola vez)

1. **Congelar el estado actual**: tag `landing-v1` y rama `feature/landing-v2`.
2. **Completar los datos**: pegar el JSON completo de
   `api/index.php?action=listarAlbergues` en `datos-mock.md` (hecho: 5 albergues
   al 2026-10-30).
3. **Definir la marca**: ¿el azul `#005CA2` sigue como acento o se reemplaza? Tres
   referencias visuales de alojamiento, no de gobierno.
4. **Aislar el workspace**: abrir VS Code con `v2/` como raíz, en una ventana
   aparte.
5. **Correr el prompt 01** con el brief y los datos adjuntos.

## Ciclo por sección

```
prompt 0N  ->  Kombai escribe en v2/  ->  revisar con CHECKLIST-SECCION
                                          |
                                          +--> si falla: corregir en el mismo pedido
                                          +--> si pasa: commit + prompt siguiente
```

Regla de avance: **no se pasa al siguiente hasta que el anterior pase el
checklist**. La tentación de pedir "las cuatro páginas juntas" es lo que produce
resultados que no se pueden integrar.

## Después del diseño

1. Conectar los `data-*` con `script.js` (trabajo de integración, no de Kombai).
2. Ajustar el bootstrap de cada página (ver sección 7 del contrato).
3. Probar el flujo completo contra `reserva_albergue_dev`.
4. Mergear a `main` y deployar.

## Lo que no cambia nunca

- Endpoints y reglas de negocio.
- Claves `maestro`, `aquilina`, `tinku`.
- Textos del reglamento.
- La cantidad de pasos del wizard (4).

## Estado al último cierre

- Prompts: 12 de 12 escritos.
- Brief, datos mock, contrato y checklist: listos (datos al 2026-10-30).
- Línea base: smoke test 90/90 PASS contra `reserva_albergue_dev` (2026-10-30).
- Páginas: pendientes (las genera Kombai).
- Datos reales de los albergues: 5 de 5 (capturados el 2026-10-30).
