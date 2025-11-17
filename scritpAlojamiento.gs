function doPost(e) {
  try {
    const data = (e && e.parameter) ? e.parameter : {};
    if ((data.secret || "") !== "cristiano1988") {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Acceso denegado" }))
        .setMimeType(ContentService.MimeType.TEXT);
    }

    if (data.action === "crearReservaAlojamiento") {
      const ss = SpreadsheetApp.openById("1WnkUA0wMXlsamLUtMtHSPG2GeHcagQLJcdbvIrnG4U4");  // Confirma este ID
      //const hojaReservas = ss.getSheetByName("ReservasAlojamiento");
      const hojaReservas = ss.getSheets().find(sh => sh.getName().trim().toLowerCase() === "reservasalojamiento");
if (!hojaReservas) throw new Error("No se encontró la hoja 'ReservasAlojamiento'");

      const hojaDisponibilidad = ss.getSheetByName("DisponibilidadAlojamiento");
      const hojaConfig = ss.getSheetByName("ConfiguracionesAlojamiento");

      if (!hojaReservas || !hojaDisponibilidad || !hojaConfig) {
        throw new Error("Faltan hojas en el spreadsheet");
      }

      const albergue = (data.albergue || "").trim();
      Logger.log(`Albergue recibido: ${albergue}`);  // Log para depurar mismatch

      const cantidad = Math.max(0, parseInt(data.cantidad, 10) || 0);
      const rangoStr = (data.rangoFechas || "").trim();
      const rango = rangoStr.split(',').map(f => f.trim()).filter(f => f);

      const cfg = hojaConfig.getDataRange().getValues();
      //const fila = cfg.find(r => (r[2] || "").trim() === albergue);
      const fila = cfg.find(r => (r[2] || "").trim().toLowerCase() === albergue.toLowerCase());

      if (!fila) {
        throw new Error(`Albergue no encontrado en config: ${albergue}`);
      }
      const capacidadMax = parseInt(fila[1], 10) || 0;

      if (capacidadMax <= 0 || cantidad > capacidadMax) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Capacidad inválida" }))
          .setMimeType(ContentService.MimeType.TEXT);
      }

      const nuevoId = (new Date().getTime() % 10000);

      let ok = true;
      for (let fecha of rango) {
        const disp = hojaDisponibilidad.getDataRange().getValues();
        let totalPrevio = 0;
        for (let i = 1; i < disp.length; i++) {
          const rowFecha = (disp[i][0] instanceof Date)
            ? Utilities.formatDate(disp[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd")
            : (disp[i][0] || "").trim();
          const rowA = (disp[i][1] || "").trim();
          if (rowFecha === fecha && rowA === albergue) {
            totalPrevio += parseInt(disp[i][3], 10) || 0;
          }
        }
        const nuevoTotal = totalPrevio + cantidad;
        const nuevosDisp = capacidadMax - nuevoTotal;
        if (nuevosDisp < 0) { ok = false; break; }
        hojaDisponibilidad.appendRow([fecha, albergue, nuevoTotal, cantidad, nuevosDisp, nuevoId]);
      }

      if (!ok) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Sin disponibilidad" }))
          .setMimeType(ContentService.MimeType.TEXT);
      }

      hojaReservas.appendRow([
        nuevoId,
        new Date(),
        albergue,
        data.institucion || '',
        data.responsable || '',
        data.dni || '',
        data.contacto || '',
        cantidad,
        rangoStr,
        "Pre-Reserva"
      ]);

      Logger.log(`Intentando escribir reserva en hojaReservas: ${albergue}, ${data.institucion}, ${rangoStr}`);
      Logger.log(`✅ Reserva guardada correctamente en hojaReservas`);



      Logger.log(`Reserva guardada: ID ${nuevoId}, Albergue ${albergue}`);  // Log éxito

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        idReserva: nuevoId
      })).setMimeType(ContentService.MimeType.TEXT);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Acción inválida" }))
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    Logger.log("Error: " + err.message + " | Stack: " + err.stack);
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: err.message }))
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
  //const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ss = SpreadsheetApp.openById("1WnkUA0wMXlsamLUtMtHSPG2GeHcagQLJcdbvIrnG4U4");

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