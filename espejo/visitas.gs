const API_URL = 'https://refund-pulse-kebab.ngrok-free.dev';
const API_TOKEN = '';
const NOMBRE_PESTANA = 'Espejo';

function onOpen() {
  try {
    actualizarEspejo();
  } catch (e) {
    Logger.log('onOpen espejo visitas: ' + e);
  }
  SpreadsheetApp.getUi()
    .createMenu('Espejo')
    .addItem('Actualizar ahora', 'actualizarEspejo')
    .addToUi();
}

function alAbrir() {
  actualizarEspejo();
}

function configurarDisparador() {
  ScriptApp.newTrigger('actualizarEspejo')
    .timeBased()
    .everyMinutes(5)
    .create();
}

function actualizarEspejo() {
  const url =
    API_URL +
    '/api/index.php?action=espejoVisitas' +
    (API_TOKEN ? '&token=' + encodeURIComponent(API_TOKEN) : '');

  const respuesta = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { 'ngrok-skip-browser-warning': 'true' }
  });

  const codigo = respuesta.getResponseCode();
  const contenido = respuesta.getContentText();

  if (codigo !== 200) {
    throw new Error('La API respondió HTTP ' + codigo + ':\n' + contenido);
  }

  let datos;
  try {
    datos = JSON.parse(contenido);
  } catch (e) {
    throw new Error('Respuesta no JSON:\n' + contenido.substring(0, 120));
  }

  if (!datos.success) {
    throw new Error(datos.mensaje || datos.message || 'La API devolvió success=false');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(NOMBRE_PESTANA) || ss.insertSheet(NOMBRE_PESTANA);

  if (!hoja.getRange(1, 1).getValue()) {
    hoja.getRange(1, 1, 1, datos.columnas.length).setValues([datos.columnas]);
  }

  hoja.getRange(2, 1, hoja.getMaxRows() - 1, hoja.getMaxColumns()).clearContent();

  if (datos.filas.length > 0) {
    hoja.getRange(2, 1, datos.filas.length, datos.columnas.length).setValues(datos.filas);
  }

  ss.toast('Espejo actualizado: ' + datos.filas.length + ' reservas', 'Espejo', 5);
}