# Migración de Google Sheets → SQLite

Para migrar los datos existentes hacia SQLite:

## 1) Exportar los CSVs desde Google Sheets

En cada spreadsheet: `Archivo → Descargar → Valores separados por comas (.csv)`,
guardar en esta carpeta (`/migracion`) con estos nombres exactos:

| Archivo                          | Hoja del spreadsheet        |
|----------------------------------|-----------------------------|
| `Configuraciones.csv`            | Configuraciones (Visitas)   |
| `Reservas.csv`                   | Reservas (Visitas)          |
| `Disponibilidad.csv`             | Disponibilidad (Visitas)    |
| `ConfiguracionesAlojamiento.csv` | ConfiguracionesAlojamiento  |
| `ReservasAlojamiento.csv`        | ReservasAlojamiento         |
| `DisponibilidadAlojamiento.csv`  | DisponibilidadAlojamiento   |

**Importante:** la primera fila de cada CSV (encabezado) se descarta automáticamente.
No renombre ni reordene las columnas: el script lee por posición (igual que hacían los `.gs`).

## 2) Columnas esperadas (orden posicional)

- `Configuraciones*.csv`: `[1]=capacidad`, `[2]=nombre_albergue`. `[0]` no se usa.
- `Reservas.csv`:
  `0=ID, 1=fecha_creación, 2=albergue, 3=institución, 4=responsable, 5=DNI, 6=contacto, 7=cantidad, 8=fecha_ingreso, 9=hora_ingreso, 10=hora_egreso, 11=estado`
- `Disponibilidad*.csv`:
  `0=fecha, 1=albergue, 2=ocupados, 3=cantidad_reservada, 4=disponibles, 5=ID_reserva`
- `ReservasAlojamiento.csv`:
  `0=ID, 1=fecha_creación, 2=albergue, 3=institución, 4=responsable, 5=DNI, 6=contacto, 7=cantidad, 8=rango_fechas(CSV), 9=estado`

## 3) Ejecutar la migración

```
php api/migrar.php
```

El script:
- Crea/actualiza los albergues con las capacidades de los CSVs.
- Migra visitas; deduce `pernocta='Sí'` si la reserva figura en `Disponibilidad`
  (la hoja `Reservas` no guarda esa columna).
- Migra alojamiento y **normaliza** cada fecha del rango como una fila en
  `reserva_alojamiento_dias`.
- Verifica la disponibilidad derivada contra las hojas e informa discrepancias.

Cualquier fila con datos incompletos, ambigua o con albergue desconocido se
**omite y se reporta** (no se inventa): revísela y repórtela para decidir.