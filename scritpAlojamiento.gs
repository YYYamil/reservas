function doPost(e) {
  try {
    const data = (e && e.parameter) ? e.parameter : {};

    if ((data.secret || "") !== "cristiano1988") {
      return ContentService.createTextOutput(JSON.stringify({ success: false }))
        .setMimeType(ContentService.MimeType.TEXT); // TEXT para menos CORS issues
    }

    // Action para crear reserva multi-día (POST only)
    if (data.action === "crearReservaAlojamiento") {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const hojaReservas = ss.getSheetByName("ReservasAlojamiento");
      const hojaDisponibilidad = ss.getSheetByName("DisponibilidadAlojamiento");
      const hojaConfig = ss.getSheetByName("ConfiguracionesAlojamiento");

      if (!hojaReservas || !hojaDisponibilidad || !hojaConfig) {
        return ContentService.createTextOutput(JSON.stringify({ success: false }))
          .setMimeType(ContentService.MimeType.TEXT);
      }

      const albergue = (data.albergue || "").trim();
      const cantidad = Math.max(0, parseInt(data.cantidad, 10) || 0);
      const rangoStr = (data.rangoFechas || "").trim();
      const rango = rangoStr.split(',').map(f => f.trim()).filter(f => f); // Array de ISOs

      if (rango.length === 0 || rango.length > 4) {
        return ContentService.createTextOutput(JSON.stringify({ success: false }))
          .setMimeType(ContentService.MimeType.TEXT);
      }

      // Capacidad desde Config
      const cfg = hojaConfig.getDataRange().getValues();
      const filaAlbergue = cfg.find(row => (row[2] || "").trim() === albergue);
      const capacidadMax = filaAlbergue ? parseInt(filaAlbergue[1], 10) || 0 : 0;

      if (capacidadMax <= 0 || cantidad > capacidadMax) {
        return ContentService.createTextOutput(JSON.stringify({ success: false }))
          .setMimeType(ContentService.MimeType.TEXT);
      }

      const nuevoId = (new Date().getTime() % 10000); // 0000-9999

      // Validar y actualizar disponibilidad para CADA día en rango
      let ok = true;
      for (let fechaISO of rango) {
        const datosDisp = hojaDisponibilidad.getDataRange().getValues();
        let totalReservadoPrevio = 0;
        for (let i = 1; i < datosDisp.length; i++) { // Saltea header
          const rowFecha = (datosDisp[i][0] instanceof Date) 
            ? Utilities.formatDate(datosDisp[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") 
            : (datosDisp[i][0] || "").trim();
          const rowAlbergue = (datosDisp[i][1] || "").trim();
          if (rowFecha === fechaISO && rowAlbergue === albergue) {
            totalReservadoPrevio += parseInt(datosDisp[i][3], 10) || 0; // Col 4: CantidadEstaReserva
          }
        }
        const nuevoTotal = totalReservadoPrevio + cantidad;
        const nuevosDisp = capacidadMax - nuevoTotal;
        if (nuevosDisp < 0) {
          ok = false;
          break;
        }
        // Append fila por día
        hojaDisponibilidad.appendRow([fechaISO, albergue, nuevoTotal, cantidad, nuevosDisp, nuevoId]);
      }

      if (!ok) {
        return ContentService.createTextOutput(JSON.stringify({ success: false }))
          .setMimeType(ContentService.MimeType.TEXT);
      }

      // Guardar reserva principal (con rango como string) - Agregado: responsable y dni después de institucion
      hojaReservas.appendRow([nuevoId, new Date(), albergue, data.institucion || '', data.responsable || '', data.dni || '', cantidad, rangoStr, "Pre-Reserva"]);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        idReserva: nuevoId
      })).setMimeType(ContentService.MimeType.TEXT);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false }))
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (error) {
    Logger.log("Error: " + error);
    return ContentService.createTextOutput(JSON.stringify({ success: false }))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function doGet(e) {
  try {
    const data = (e && e.parameter) ? e.parameter : {};

    if ((data.secret || "") !== "cristiano1988") {
      return ContentService.createTextOutput(JSON.stringify({ success: false }))
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // Action para disponibilidad por día (ahora en GET para evitar preflight)
    if (data.action === "obtenerDisponibilidadDiaAlojamiento") {
      const fechaISO = (data.fecha || "").trim();
      const albergue = (data.albergue || "").trim();
      const resultado = obtenerDisponibilidadDiaAlo_(fechaISO, albergue);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        fecha: fechaISO,
        albergue: albergue,
        capacidad: resultado.capacidad,
        ocupados: resultado.ocupados,
        disponibles: resultado.disponibles
      })).setMimeType(ContentService.MimeType.TEXT);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Use POST for create, GET for get" }))
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (error) {
    Logger.log("Error in doGet: " + error);
    return ContentService.createTextOutput(JSON.stringify({ success: false }))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

// Función helper (sin cambios)
function obtenerDisponibilidadDiaAlo_(fechaISO, albergueFullName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaDisp = ss.getSheetByName("DisponibilidadAlojamiento");
  const hojaConfig = ss.getSheetByName("ConfiguracionesAlojamiento");
  if (!hojaDisp || !hojaConfig) throw new Error("Faltan hojas");

  // Capacidad
  const cfg = hojaConfig.getDataRange().getValues();
  let capacidadMax = 0;
  for (let i = 1; i < cfg.length; i++) {
    if ((cfg[i][2] || "").trim() === albergueFullName) {
      capacidadMax = parseInt(cfg[i][1], 10) || 0;
      break;
    }
  }

  // Total reservado (suma col 4 por fecha/albergue)
  const datos = hojaDisp.getDataRange().getValues();
  let totalReservado = 0;
  for (let i = 1; i < datos.length; i++) {
    const rowFecha = (datos[i][0] instanceof Date) 
      ? Utilities.formatDate(datos[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") 
      : (datos[i][0] || "").trim();
    const rowAlbergue = (datos[i][1] || "").trim();
    if (rowFecha === fechaISO && rowAlbergue === albergueFullName) {
      totalReservado += parseInt(datos[i][3], 10) || 0;
    }
  }

  const ocupados = totalReservado;
  const disponibles = Math.max(0, capacidadMax - totalReservado);
  return { capacidad: capacidadMax, ocupados, disponibles };
}