function doPost(e) {
  try {
    const data = (e?.parameter) || {};

    if ((data.secret || "") !== "cristiano1988") {
      return respuesta({ success: false, message: "Acceso denegado" });
    }

    if (data.action === "crearReservaAlojamiento") {

      const ss = SpreadsheetApp.openById("1WnkUA0wMXlsamLUtMtHSPG2GeHcagQLJcdbvIrnG4U4");
      const hojaReservas = ss.getSheets().find(sh => sh.getName().trim().toLowerCase() === "reservasalojamiento");
      const hojaDisp = ss.getSheetByName("DisponibilidadAlojamiento");
      const hojaConfig = ss.getSheetByName("ConfiguracionesAlojamiento");

      if (!hojaReservas || !hojaDisp || !hojaConfig) {
        throw new Error("Faltan hojas en el spreadsheet");
      }

      const albergue = (data.albergue || "").trim();
      const cantidad = Math.max(0, parseInt(data.cantidad, 10) || 0);

      const rangoStr = (data.rangoFechas || "").trim();
      const rango = rangoStr.split(',').map(f => f.trim()).filter(f => f);

      // Cargar configuración una sola vez
      const cfg = hojaConfig.getDataRange().getValues();
      const fila = cfg.find(r => (r[2] || "").trim().toLowerCase() === albergue.toLowerCase());

      if (!fila) throw new Error(`Albergue no encontrado: ${albergue}`);

      const capacidadMax = parseInt(fila[1], 10) || 0;

      if (capacidadMax <= 0 || cantidad > capacidadMax) {
        return respuesta({ success: false, message: "Capacidad inválida" });
      }

      const nuevoId = Date.now() % 10000;

      // Cargar DISPONIBILIDAD UNA SOLA VEZ
      const datosDisp = hojaDisp.getDataRange().getValues();

      let ok = true;

      for (const fecha of rango) {

        let totalPrevio = 0;

        for (let i = 1; i < datosDisp.length; i++) {
          const row = datosDisp[i];

          const rowFecha = (row[0] instanceof Date)
            ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy-MM-dd")
            : (row[0] || "").trim();

          const rowA = (row[1] || "").trim();

          if (rowFecha === fecha && rowA === albergue) {
            totalPrevio += parseInt(row[3], 10) || 0;
          }
        }

        const nuevoTotal = totalPrevio + cantidad;
        const nuevosDisp = capacidadMax - nuevoTotal;

        if (nuevosDisp < 0) {
          ok = false;
          break;
        }

        // Se escribe una sola vez por fecha
        hojaDisp.appendRow([fecha, albergue, nuevoTotal, cantidad, nuevosDisp, nuevoId]);
      }

      if (!ok) return respuesta({ success: false, message: "Sin disponibilidad" });

      // Registrar reserva
      hojaReservas.appendRow([
        nuevoId,
        new Date(),
        albergue,
        data.institucion || "",
        data.responsable || "",
        data.dni || "",
        data.contacto || "",
        cantidad,
        rangoStr,
        "Pre-Reserva"
      ]);

      // 🧹 limpiar disponibilidad vieja (más de 2 meses)
      limpiarDisponibilidadVieja_(hojaDisp);

      return respuesta({ success: true, idReserva: nuevoId });
    }

    return respuesta({ success: false, message: "Acción inválida" });

  } catch (err) {
    Logger.log("Error: " + err.message + " | Stack: " + err.stack);
    return respuesta({ success: false, message: err.message });
  }
}

function doGet(e) {
  try {
    const data = e?.parameter || {};

    if ((data.secret || "") !== "cristiano1988") {
      return respuesta({ success: false });
    }

    if (data.action === "obtenerDisponibilidadDiaAlojamiento") {

      const fechaISO = (data.fecha || "").trim();
      const albergue = (data.albergue || "").trim();

      const r = obtenerDisponibilidadDiaAlo_(fechaISO, albergue);

      return respuesta({
        success: true,
        fecha: fechaISO,
        albergue,
        capacidad: r.capacidad,
        ocupados: r.ocupados,
        disponibles: r.disponibles
      });
    }

    return respuesta({ success: false, message: "Use POST para crear y GET para consultar" });

  } catch (err) {
    return respuesta({ success: false, message: err.message });
  }
}
function obtenerDisponibilidadDiaAlo_(fechaISO, albergue) {

  const ss = SpreadsheetApp.openById("1WnkUA0wMXlsamLUtMtHSPG2GeHcagQLJcdbvIrnG4U4");

  const hojaDisp = ss.getSheetByName("DisponibilidadAlojamiento");
  const hojaConfig = ss.getSheetByName("ConfiguracionesAlojamiento");

  const cfg = hojaConfig.getDataRange().getValues();
  let capacidad = 0;

  for (let i = 1; i < cfg.length; i++) {
    if ((cfg[i][2] || "").trim() === albergue) {
      capacidad = parseInt(cfg[i][1], 10) || 0;
      break;
    }
  }

  const datos = hojaDisp.getDataRange().getValues();
  let total = 0;

  for (let i = 1; i < datos.length; i++) {

    const row = datos[i];
    const rowFecha = row[0] instanceof Date
      ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy-MM-dd")
      : (row[0] || "").trim();

    if (rowFecha === fechaISO && (row[1] || "").trim() === albergue) {
      total += parseInt(row[3], 10) || 0;
    }
  }

  return {
    capacidad,
    ocupados: total,
    disponibles: Math.max(0, capacidad - total)
  };
}
function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.TEXT);
}

function limpiarDisponibilidadVieja_(hojaDisp) {
  try {
    const hoy = new Date();
    const limite = new Date(hoy.getFullYear(), hoy.getMonth() - 2, hoy.getDate());
    const data = hojaDisp.getDataRange().getValues();

    // Comenzar desde abajo para evitar conflictos al eliminar filas
    for (let i = data.length - 1; i >= 1; i--) {

      const fechaRaw = data[i][0];

      let fechaFila = null;

      if (fechaRaw instanceof Date) {
        fechaFila = fechaRaw;
      } else if (typeof fechaRaw === "string" && fechaRaw.includes("-")) {
        fechaFila = new Date(fechaRaw);
      }

      if (!fechaFila || isNaN(fechaFila)) continue;

      // si es más vieja que el límite = borrar
      if (fechaFila < limite) {
        hojaDisp.deleteRow(i + 1);  
      }
    }
  } catch (err) {
    Logger.log("Error al limpiar disponibilidad vieja: " + err);
  }
}
