// Configuración global
const CONFIG = {
  secretKey: "cristiano1988",

  // googleScriptUrl: "https://script.google.com/macros/s/AKfycbwUo0ouoBIxBhYl89tEy1NartJHSg-HIknuwN4Vc0YRnb601c5BDrq9-CHLNIEG1Y_L/exec",
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbxgWWIc13CwraIF2d1ZZCTf8xdsHpjG36Fh0qmVySlvDLT_OOzmWdbc8L72dSIaONcLhg/exec",
  googleScriptUrlAlo: "https://script.google.com/macros/s/AKfycbxvskDSMkR5mqtGoqal4Tfuls001kyAlSu9QVE3Q9hORer0s3-aNCyjmPgAotk1wAQb/exec",

  meses: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  diasSemana: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  diasSemanaCortos: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
};

function toFullName(albergueKey) {
  switch (albergueKey) {
    case 'maestro':  return 'Maestro José Fierro';
    case 'tinku':    return 'Tinku Huasi';
    case 'aquilina': return 'Aquilina Soldati';
    default:         return albergueKey; // fallback por si ya viene el nombre completo
  }
}


// Estado del calendario para cada albergue
const estadoCalendario = {
  maestro: { mes: new Date().getMonth(), año: new Date().getFullYear() },
  tinku: { mes: new Date().getMonth(), año: new Date().getFullYear() },
  aquilina: { mes: new Date().getMonth(), año: new Date().getFullYear() }
};

// Cache de fechas ocupadas (se actualizará desde Google Sheets)
let fechasOcupadas = {
  maestro: [],
  tinku: [],
  aquilina: []
};

// Capacidades de los albergues
const capacidades = {
  maestro: 92,
  tinku: 49,
  aquilina: 58
};

// Ocupación actual (se actualizará desde Google Sheets)
let ocupacionActual = {
  maestro: 0,
  tinku: 0,
  aquilina: 0
};

// Estado para prevenir envíos dobles
const formSubmissionState = {
  maestro: { isSubmitting: false },
  tinku: { isSubmitting: false },
  aquilina: { isSubmitting: false }
};

// Inicialización cuando se carga la página
document.addEventListener('DOMContentLoaded', function() {


const notice = document.getElementById('site-notice');
  if (!notice) return;

  const closeBtn = notice.querySelector('.notice-close');
  const backdrop = notice.querySelector('.notice-backdrop');

  // Mostrar al iniciar
  notice.classList.add('show');
  document.body.style.overflow = 'hidden'; // evita scroll del fondo

  function hideNotice(){
    notice.classList.remove('show');
    document.body.style.overflow = '';    
  }

  closeBtn.addEventListener('click', hideNotice);
  backdrop.addEventListener('click', hideNotice);




  document.querySelectorAll('.glide').forEach(el => {
    if (!window.Glide) {
      console.warn('Glide.js no está cargado');
      return;
    }
    new Glide(el, {
      type: 'carousel',
      perView: 1,
      autoplay: 4000,     // 4s
      hoverpause: true,   // pausa al pasar el mouse (mejor UX)
      animationDuration: 5000,
      gap: 0
    }).mount();

    
  });

  lockFechaInputs();
  populateHourSelects();

  setMinDates();
  setupDateListeners();
  setupFormListeners();
  setupHospedajeBinding();

});

// Funciones para manejar modales
function openModal(albergue) {
    resetOcupacionUI(albergue);

  console.log(`Abriendo modal para ${albergue}`);
  document.getElementById(`modal-${albergue}`).classList.add('active');
  document.body.style.overflow = 'hidden';
  resetForm(albergue); // Reset form when opening modal
    resetCalendarToToday(albergue);                      

  generarCalendario(albergue);
}

function closeModal(albergue) {
  console.log(`Cerrando modal para ${albergue}`);
  document.getElementById(`modal-${albergue}`).classList.remove('active');
  document.body.style.overflow = 'auto';
  resetForm(albergue); // Reset form when closing modal
}

// Cerrar al click fuera (extendido para ambos tipos de modales)
window.onclick = function(event) {
  if (event.target.classList.contains('modal') && event.target.classList.contains('active')) {
    const idParts = event.target.id.split('-');
    if (idParts[1] === 'alojamiento') {
      // Modal de alojamiento: modal-alojamiento-{albergue}
      const albergue = idParts[2]; // e.g., 'maestro'
      if (albergue) closeAlojamientoModal(albergue);
    } else {
      // Modal regular: modal-{albergue}
      const albergue = idParts[1]; // e.g., 'maestro'
      if (albergue) closeModal(albergue);
    }
  }
};

// Configuración de listeners de formularios
function setupFormListeners() {
  ['maestro', 'tinku', 'aquilina'].forEach(albergue => {
    const form = document.getElementById(`reservaForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
    if (form) {
      // Remove existing listeners to prevent duplicates
      form.removeEventListener('submit', handleFormSubmit);
      form.addEventListener('submit', handleFormSubmit);
    }
  });
}

// Helper function to handle form submission
function handleFormSubmit(e) {
  e.preventDefault();
  e.stopPropagation(); // Prevent event bubbling
  const albergue = e.target.id.replace('reservaForm', '').toLowerCase();
  if (formSubmissionState[albergue].isSubmitting) {
    console.log(`Envío duplicado bloqueado para ${albergue}`);
    return;
  }
  formSubmissionState[albergue].isSubmitting = true;
  submitForm(albergue).finally(() => {
    formSubmissionState[albergue].isSubmitting = false;
  });
}

async function submitForm(albergue) {
  console.log(`Iniciando envío de formulario para ${albergue}`);

  const formData = getFormData(albergue);
  if (!formData.institucion || !formData.responsable || !formData.contacto ||
      !formData.cantidad || !formData.fechaIngreso || !formData.horaIngreso|| !formData.horaEgreso) {
    alert("Por favor complete todos los campos del formulario");
    return;
  }

  const btn = getSubmitButton(albergue);
  setBtnLoading(btn);

  try {
    const resultado = await enviarReservaAGoogleSheets(formData);

    if (resultado.success) {
      mostrarConfirmacion(albergue, formData, resultado.idReserva);
      setBtnSuccess(btn);

showSnackbar(
  `PRE-Reserva Realizada \n Nro: ${resultado.idReserva}.\n Para su confirmación, llamar al:\n (0381)452-6408.`,
  'success',
  55000
);



      setTimeout(() => {
        resetForm(albergue);
        closeModal(albergue);
        resetBtn(btn);
      }, 900);
    } else {
      setBtnError(btn, 'Error');
showSnackbar(`Error al guardar la reserva: ${resultado.message || 'Intente nuevamente'}`, 'error', 2200);
      setTimeout(() => resetBtn(btn), 1200);
      return;
    }
  } catch (err) {
    console.error(err);
    setBtnError(btn, 'Error');
    alert('Ocurrió un error al enviar la reserva.');
    setTimeout(() => resetBtn(btn), 1200);
  }
}




// Helper functions
function getFormData(albergue) {
  const pernoctaCheckbox = document.getElementById(`pernocta-${albergue}`);
  const pernoctaValue = pernoctaCheckbox ? pernoctaCheckbox.checked : false;
  console.log(`Pernocta para ${albergue}: ${pernoctaValue}`);
  return {
    albergue,
    institucion: document.getElementById(`institucion-${albergue}`).value,
    responsable: document.getElementById(`responsable-${albergue}`).value,
    contacto: document.getElementById(`contacto-${albergue}`).value,
    cantidad: document.getElementById(`cantidad-${albergue}`).value,
    fechaIngreso: document.getElementById(`fechaIngreso-${albergue}`).value,
    horaIngreso: document.getElementById(`horaIngreso-${albergue}`).value,

    horaEgreso: document.getElementById(`horaEgreso-${albergue}`).value,
    
    pernocta: true //siempre en true para guardar la visita


  };
}

function mostrarConfirmacion(albergue, formData, idReserva) {
  console.log(`Mostrando confirmación para ${albergue}, ID: ${idReserva}, Pernocta: ${formData.pernocta}`);
  const nombresAlbergues = {
    maestro: 'Albergue Maestro José Fierro',
    tinku: 'Albergue Tinku Huasi',
    aquilina: 'Albergue Aquilina Soldati'
  };

  // alert(`¡Reserva #${idReserva} realizada con éxito!\n\n` +
  //       `Institución: ${formData.institucion}\n` +
  //       `Responsable: ${formData.responsable}\n` +
  //       `Contacto: ${formData.contacto}\n` +
  //       `Cantidad: ${formData.cantidad} personas\n` +
  //       `Albergue: ${nombresAlbergues[albergue]}\n` +
  //       `Ingreso: ${formData.fechaIngreso} a las ${formData.horaIngreso}\n` +
  //       `Pernocta: ${formData.pernocta ? 'Sí' : 'No'}`);
}

function resetForm(albergue) {
  const form = document.getElementById(`reservaForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
  form.reset();
  // No hay checkbox para resetear (pernocta siempre true)
  console.log(`Formulario reseteado para ${albergue}, Pernocta: true (siempre activado)`);
}


// Funciones para fechas
function setMinDates() {
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.min = today;
  });
}

function setupDateListeners() {
  ['maestro', 'tinku', 'aquilina'].forEach(albergue => {
    const ingresoInput = document.getElementById(`fechaIngreso-${albergue}`);
    if (ingresoInput) {
      ingresoInput.addEventListener('change', function() {
        
      });
    }
  });
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function isoFromYMD(año, mes0, dia) {
  return `${año}-${String(mes0 + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
}

function setSelectedDate(albergue, iso, cell) {
  estadoCalendario[albergue].selectedISO = iso;

  // quitar selección anterior en este calendario
  const grid = document.getElementById(`calendario-${albergue}`);
  const prev = grid.querySelector('.dia.seleccionado');
  if (prev) prev.classList.remove('seleccionado');

  // marcar la nueva
  cell.classList.add('seleccionado');

  // (opcional) reflejar en el input fecha del formulario
  const inputFecha = document.getElementById(`fechaIngreso-${albergue}`);
  if (inputFecha) inputFecha.value = iso;
}


function getAlbergueKey(albergueNombre) {
  if (albergueNombre.includes('Maestro')) return 'maestro';
  if (albergueNombre.includes('Tinku')) return 'tinku';
  if (albergueNombre.includes('Aquilina')) return 'aquilina';
  return null;
}

// Funciones para el calendario

function generarCalendario(albergue) {
  const estado = estadoCalendario[albergue];
  const { mes, año } = estado;

  const primerDia = new Date(año, mes, 1);
  const ultimoDia = new Date(año, mes + 1, 0);
  const primerDiaSemana = primerDia.getDay(); // 0=Dom, 1=Lun, ...
  const diasEnMes = ultimoDia.getDate();

  const contenedor = document.getElementById(`calendario-${albergue}`);
  if (!contenedor) return;
  contenedor.innerHTML = '';

  // Encabezados
  CONFIG.diasSemanaCortos.forEach(dia => {
    const diaHeader = document.createElement('div');
    diaHeader.className = 'dia-header';
    diaHeader.textContent = dia;
    contenedor.appendChild(diaHeader);
  });

  // Offset inicial: celdas del mes anterior (vacías/grises)
  for (let k = 0; k < primerDiaSemana; k++) {
    contenedor.appendChild(crearDiaElemento('', 'otro-mes'));
  }

  // Días del mes actual
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  for (let i = 1; i <= diasEnMes; i++) {
    const fechaActual = new Date(año, mes, i); 
    fechaActual.setHours(0,0,0,0);

    const iso = isoFromYMD(año, mes, i);

    const estaOcupado = Array.isArray(fechasOcupadas[albergue])
      ? fechasOcupadas[albergue].some(f => f.toDateString() === fechaActual.toDateString())
      : false;

    const esPasado = fechaActual < hoy;

    // Clases
    let clases = [];
    if (estaOcupado) clases.push('ocupado');
    if (esPasado)    clases.push('inactiva');

    const dia = crearDiaElemento(i, clases.join(' '));
    dia.dataset.iso = iso;

    // Hoy
    if (fechaActual.getTime() === hoy.getTime()) {
      dia.classList.add('hoy');
    }
    // Seleccionado persistente
    if (estadoCalendario[albergue].selectedISO === iso) {
      dia.classList.add('seleccionado');
    }

    // Click SOLO si no es pasado ni ocupado
    if (!esPasado && !estaOcupado) {
      dia.addEventListener('click', () => {
        setSelectedDate(albergue, iso, dia);
        mostrarInfoDia(albergue, año, mes, i);
      });
    } else {
      // Accesibilidad: sin foco ni click
      dia.tabIndex = -1;
      dia.setAttribute('aria-disabled', 'true');
    }

    contenedor.appendChild(dia);
  }
  // Relleno del mes siguiente hasta completar 6 filas (42 celdas)
  const totalCeldas = 42;
  const usados = primerDiaSemana + diasEnMes;
  const faltan = totalCeldas - usados;
  for (let i = 0; i < faltan; i++) {
    contenedor.appendChild(crearDiaElemento('', 'otro-mes'));
  }

  // Título del mes
  const titulo = document.getElementById(`mes-actual-${albergue}`);
  if (titulo) titulo.textContent = `${CONFIG.meses[mes]} ${año}`;
  console.log(`Calendario generado para ${albergue}, mes: ${CONFIG.meses[mes]} ${año}`);
}

function crearDiaElemento(numero, claseExtra = '') {
  const dia = document.createElement('div');
  dia.className = `dia ${claseExtra}`;
  dia.textContent = numero;
  return dia;
}





async function mostrarInfoDia(albergue, año, mes0, dia) {
  const fecha = new Date(año, mes0, dia);
  const fechaISO = `${año}-${String(mes0 + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const diaSemana = CONFIG.diasSemana[fecha.getDay()];
  const mesNombre = CONFIG.meses[mes0];

  console.log(`mostrarInfoDia llamado para albergue: ${albergue}, fecha: ${fechaISO}`);

  // ⬇️ Mostrar loader y bloquear interacción
  showCalendarLoading(albergue);

  try {
  // 1) Pedir disponibilidad real al GS
  const disponibilidad = await obtenerDisponibilidadDia(albergue, fechaISO);

  // 2) Tomar capacidad/disponibles y derivar ocupados = capacidad - disponibles
  const capBase = Number(capacidades[albergue]) || 0;
  const capacidad   = Number(disponibilidad?.capacidad ?? capBase) || 0;
  const disponibles = Number(disponibilidad?.disponibles ?? capacidad) || 0;
  const ocupados    = Math.max(0, Math.min(capacidad, capacidad - disponibles));
// al final de mostrarInfoDia(...)
setCantidadMaxFor(albergue);

  // Mantener cache local si lo usás
  ocupacionActual[albergue] = ocupados;

  // 3) Actualizar el modal con ids genéricos
  const spanDisp = document.getElementById(`disponibles-${albergue}`);
  if (spanDisp) spanDisp.textContent = disponibles;
  const spanCap = document.getElementById(`capacidad-${albergue}`);
  if (spanCap) spanCap.textContent = capacidad;

  // // 4) (Opcional) Cartel informativo
  // const estaOcupado = fechasOcupadas[albergue].some(f => f.toDateString() === fecha.toDateString());
  // const mensaje = `Fecha seleccionada: ${diaSemana}, ${dia} de ${mesNombre} de ${año}\n` +
  //                 `Estado: ${estaOcupado ? 'No disponible' : 'Disponible'}\n` +
  //                 `Capacidad total: ${capacidad} personas\n` +
  //                 `Personas ocupadas: ${ocupados} personas\n` +
  //                 `Disponibles: ${disponibles} personas`;
  // alert(mensaje);

  // 5) Actualizar barra y texto "X/Cap personas ocupadas"
  updateOcupacionUI(albergue, ocupados, capacidad);

  // (opcional) tu alert informativo
    // ...
  } catch (e) {
    console.error('Error al obtener disponibilidad:', e);
    // Podés mostrar un mensaje inline si querés
  } finally {
    // ⬇️ Siempre ocultar loader y habilitar interacción
    hideCalendarLoading(albergue);
  }
}


function cambiarMes(albergue, direccion) {
  estadoCalendario[albergue].mes += direccion;

  // Ajustar año si es necesario
  if (estadoCalendario[albergue].mes < 0) {
    estadoCalendario[albergue].mes = 11;
    estadoCalendario[albergue].año--;
  } else if (estadoCalendario[albergue].mes > 11) {
    estadoCalendario[albergue].mes = 0;
    estadoCalendario[albergue].año++;
  }

  // const estadoCalendario = {
  // maestro:  { mes: new Date().getMonth(), año: new Date().getFullYear(), selectedISO: null },
  // tinku:    { mes: new Date().getMonth(), año: new Date().getFullYear(), selectedISO: null },
  // aquilina: { mes: new Date().getMonth(), año: new Date().getFullYear(), selectedISO: null }
//};


  generarCalendario(albergue);
}

// Funciones para interactuar con Google Sheets
async function enviarReservaAGoogleSheets(data) {
  try {
    const payload = {
      secret: CONFIG.secretKey,
      action: "crearReserva",
      albergue: data.albergue === 'maestro' ? 'Maestro José Fierro' : 
               data.albergue === 'tinku' ? 'Tinku Huasi' : 'Aquilina Soldati',
      institucion: data.institucion,
      responsable: data.responsable,
      contacto: data.contacto,
      cantidad: parseInt(data.cantidad),
      fechaIngreso: data.fechaIngreso,
      horaIngreso: data.horaIngreso,
      horaEgreso: data.horaEgreso,
      pernocta: data.pernocta // Send boolean value
    };

    console.log(`Enviando datos a Google Sheets: ${JSON.stringify(payload)}`);
    const response = await fetch(CONFIG.googleScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload)
    });

    const result = await response.json();
    console.log(`Respuesta de Google Sheets: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error(`Error al enviar reserva para ${data.albergue}: ${error}`);
    return { success: false, message: "Error de conexión" };
  }
}




//DIARIA
function toISODateYMD(dateObj) {
  // dateObj es un Date del día cliqueado
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
async function fetchDisponiblesMaestro(fechaISO) {
  const payload = new URLSearchParams({
    secret: CONFIG.secretKey,
    action: 'obtenerDisponibilidadDia',
    fecha: fechaISO
  });

  const resp = await fetch(CONFIG.googleScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload
  });

  const json = await resp.json();
  if (!json.success) throw new Error(json.message || 'Error en servidor');
  return json; // {fecha, albergue, capacidad, ocupados, disponibles}
}


// Llamalo cuando el usuario hace click en un día del calendario del modal "Maestro José Fierro"
async function onCalendarDayClickMaestro(dateObj) {
  try {
    const fechaISO = toISODateYMD(dateObj);
    const res = await fetchDisponiblesMaestro(fechaISO);

    // Actualizar el modal (ejemplo: <span id="disponibles-maestro"></span>)
    const spanDisp = document.getElementById('disponibles-maestro');
    if (spanDisp) spanDisp.textContent = res.disponibles;

    // Si además querés mostrar la capacidad:
    const spanCap = document.getElementById('capacidad-maestro'); // opcional
    if (spanCap) spanCap.textContent = res.capacidad;

    // También podés guardar la fecha seleccionada en tu form:
    const inputFecha = document.getElementById('fechaIngreso-maestro');
    if (inputFecha) inputFecha.value = fechaISO;

  } catch (e) {
    console.error(e);
    alert('No se pudo obtener la disponibilidad. Intenta de nuevo.');
  }
}


async function obtenerDisponibilidadDia(albergueKey, fechaISO) {
  const payload = new URLSearchParams({
    secret: CONFIG.secretKey,
    action: 'obtenerDisponibilidadDia',
    albergue: toFullName(albergueKey), // nombre completo que matchea las hojas
    fecha: fechaISO
  });

  const resp = await fetch(CONFIG.googleScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload
  });

  const json = await resp.json();
  if (!json.success) throw new Error(json.message || 'Error en servidor');
  return {
    ocupados: json.ocupados,
    disponibles: json.disponibles,
    capacidad: json.capacidad
  };
}


function updateOcupacionUI(albergue, ocupados, capacidad) {
  const percent = capacidad > 0 ? Math.max(0, Math.min(100, Math.round((ocupados / capacidad) * 100))) : 0;

  const fill = document.getElementById(`ocupacion-fill-${albergue}`);
  if (fill) fill.style.width = `${percent}%`;

  const info = document.getElementById(`ocupacion-info-${albergue}`);
  if (info) info.textContent = `${ocupados}/${capacidad} De ocupacion`;
}


const isLoading = { maestro: false, tinku: false, aquilina: false };

function showCalendarLoading(albergue) {
  isLoading[albergue] = true;

  const overlay = document.getElementById(`cal-loader-${albergue}`);
  if (overlay) {
    overlay.hidden = false;
    overlay.setAttribute('aria-busy', 'true');
  }

  // Bloquear interacción en header y grid
  const grid = document.getElementById(`calendario-${albergue}`);
  if (grid) grid.classList.add('cal-block');

  const header = document.querySelector(`#modal-${albergue} .calendario-header`);
  if (header) header.classList.add('cal-block');
}

function hideCalendarLoading(albergue) {
  isLoading[albergue] = false;

  const overlay = document.getElementById(`cal-loader-${albergue}`);
  if (overlay) {
    overlay.hidden = true;
    overlay.setAttribute('aria-busy', 'false');
  }

  const grid = document.getElementById(`calendario-${albergue}`);
  if (grid) grid.classList.remove('cal-block');

  const header = document.querySelector(`#modal-${albergue} .calendario-header`);
  if (header) header.classList.remove('cal-block');
}
// para boton reserva vERDE
function getSubmitButton(albergue){
  const form = document.getElementById(`reservaForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
  return form ? form.querySelector('.btn-submit') : null;
}

function setBtnLoading(btn, texto = 'Guardando...') { // texto por default, custom para Alojamiento
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `
    <span class="btn-icon spinner" aria-hidden="true"></span>
    <span class="btn-label">${texto}</span>
  `;
  console.log(`Botón en loading: ${texto}`); // DEBUG opcional
}

function setBtnSuccess(btn, text='Reservado'){
  if(!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  btn.classList.remove('is-loading','is-error'); // <- importante
  btn.classList.add('is-success');
  btn.disabled = true;
}

function setBtnError(btn, text='Error'){
  if(!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  btn.classList.remove('is-loading','is-success'); // <- importante
  btn.classList.add('is-error');
  btn.disabled = false; // permitir reintentar
}

function resetBtn(btn, text='Confirmar Reserva'){
  if(!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  // quitar TODOS los estados
  btn.classList.remove('is-loading','is-success','is-error'); // <- agrega is-error
  btn.disabled = false;
}
//Cartel verde con numero PRERESERVA
function ensureSnackbar() {
  let bar = document.getElementById('app-snackbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'app-snackbar';
    document.body.appendChild(bar);
  }
  return bar;
}


function showSnackbar(message, type = 'success', duration = 10000) {
  const bar = ensureSnackbar();
  bar.classList.remove('success','error','show');
  bar.classList.add(type === 'error' ? 'error' : 'success');

  // Contenido: texto + botón X
  bar.innerHTML = '';
  const msg = document.createElement('span');
  msg.className = 'snackbar-message';
  msg.textContent = message;
  bar.appendChild(msg);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'snackbar-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => {
    clearTimeout(bar._hideTimer);
    bar.classList.remove('show');
  });
  bar.appendChild(closeBtn);

  // mostrar (forzamos reflow para reiniciar la transición si ya estaba visible)
  void bar.offsetWidth;
  bar.classList.add('show');

  // ocultar automático
  clearTimeout(bar._hideTimer);
  bar._hideTimer = setTimeout(() => {
    bar.classList.remove('show');
  }, duration);
}

// Llama a esta función una vez (p. ej. al cargar la página)
function lockFechaInputs() {
  const keys = ['maestro','tinku','aquilina']; // agregá más albergues si sumás
  keys.forEach(key => {
    const el = document.getElementById(`fechaIngreso-${key}`);
    if (!el) return;

    el.readOnly = true;                          // evita edición
    el.classList.add('locked-date');             // para el look + ocultar icono
    el.setAttribute('aria-readonly', 'true');
    el.tabIndex = -1;                            // saca del tab order

    // Evita abrir el picker o escribir con teclado/ratón
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('keydown',  e => e.preventDefault());
    el.addEventListener('focus',    e => e.target.blur());
  });
}

function populateHourSelects() {
  const keys = (typeof ALBERGUES !== 'undefined' && Array.isArray(ALBERGUES))
    ? ALBERGUES.map(a => a.key)
    : ['maestro','tinku','aquilina'];

  // 08:00 … 20:00
  const options = [];
  for (let h = 8; h <= 20; h++) {
    const hh = String(h).padStart(2, '0');
    options.push(`${hh}:00`);
  }

  const htmlIngreso =
    '<option value="" disabled selected>Seleccione hora</option>' +
    options.map(val => `<option value="${val}">${val}</option>`).join('');

  // Egreso: mismas horas + “Hospedarse” al final
  const htmlEgreso =
    htmlIngreso ;

  keys.forEach(key => {
    const selIng = document.getElementById(`horaIngreso-${key}`);
    const selEgr = document.getElementById(`horaEgreso-${key}`);
    if (selIng) selIng.innerHTML = htmlIngreso;
    if (selEgr) selEgr.innerHTML = htmlEgreso;
  });
}


//Control en formularios

// --- Sanitizadores ---
function sanitizeNombre(v){
  // solo letras (incluye tildes/ñ) y espacios
  return v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]/g, '')
          .replace(/\s+/g, ' ')
          .trimStart();
}
function sanitizeTelefono(v){
  // solo dígitos
  return v.replace(/\D/g, '');
}

// --- Instalación de validaciones para todos los formularios ---
function setupFieldGuards(){
  // Nombre del responsable: solo letras y espacios
  document.querySelectorAll('input[id^="responsable-"]').forEach(el => {
    el.addEventListener('input', () => {
      const clean = sanitizeNombre(el.value);
      if (clean !== el.value) el.value = clean;
      // borra error si ya es válido
      el.setCustomValidity('');
    });
    el.addEventListener('blur', () => {
      // Al menos dos palabras de letras (nombre y apellido)
      const ok = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)+$/.test(el.value.trim());
      el.setCustomValidity(ok ? '' : 'Ingrese nombre y apellido solo con letras.');
    });
  });

  // Contacto: solo números (7 a 15 dígitos)
  document.querySelectorAll('input[id^="contacto-"]').forEach(el => {
    el.setAttribute('inputmode','numeric');
    el.setAttribute('pattern','\\d{7,15}');
    el.setAttribute('maxlength','15');

    el.addEventListener('input', () => {
      const clean = sanitizeTelefono(el.value);
      if (clean !== el.value) el.value = clean;
      el.setCustomValidity('');
    });

    el.addEventListener('blur', () => {
      const ok = /^\d{7,15}$/.test(el.value);
      el.setCustomValidity(ok ? '' : 'Ingrese solo números (7 a 15 dígitos).');
    });

    // Limpia el portapapeles al pegar (solo números)
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const clean = sanitizeTelefono(text);
      // inserta el texto saneado
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0,start) + clean + el.value.slice(end);
      el.dispatchEvent(new Event('input', {bubbles:true}));
    });
  });
}

// Llamalo junto con tus otros inits
document.addEventListener('DOMContentLoaded', () => {
  // ... tus otras inicializaciones ...
  setupFieldGuards();


});

//Contro en los campos Cantidad de personsa-LIMITES por albergue

const LIMITES_SIN_PERNOCTA = { maestro: 300, tinku: 100, aquilina: 100 };
const LIMITES_PERNOCTA     = { maestro: 92,  tinku: 49,  aquilina: 58  };

// si ya tenés un registro ALBERGUES, podés derivar de ahí; si no:
const ALBERGUE_KEYS = ['maestro','tinku','aquilina'];

function setCantidadMaxFor(albergue){
  const input = document.getElementById(`cantidad-${albergue}`);
  if (!input) return;

  // límites base (definir si no existen)
  //const LIMITES_PERNOCTA = { maestro: 92, tinku: 49, aquilina: 58 };

  // Tomar la disponibilidad del día (si existe). Si no hay, caer a la capacidad.
  const disp = getDisponiblesValue(albergue); // leído del <span id="disponibles-...">
  let max;

  if (Number.isFinite(disp)) {
    max = disp;
  } else {
    max = disp;
  }

  // atributos del input
  input.min = '1';
  input.max = String(max);
  input.step = '1';
  input.inputMode = 'numeric';
  input.placeholder = ''; // No mostrar nada en el placeholder

  // clamp + mensaje
  let v = parseInt(input.value, 10);
  if (Number.isNaN(v)) {
    input.setCustomValidity('');
    return;
  }
  if (v < 1) v = 1;
  if (v > max) {
    v = max;
    input.setCustomValidity(`El máximo permitido es ${max} (disponibles: ${disp || max}).`);
  } else {
    input.setCustomValidity('');
  }
  input.value = String(v);
}


function setupCantidadLimits(){
  ALBERGUE_KEYS.forEach(albergue => {
    const input = document.getElementById(`cantidad-${albergue}`);
    if (!input) return;

    // inicial
    setCantidadMaxFor(albergue);

    // al escribir / salir del campo
    input.addEventListener('input', () => setCantidadMaxFor(albergue));
    input.addEventListener('blur',  () => setCantidadMaxFor(albergue));

    // al pegar solo números
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text') || '';
      const onlyDigits = text.replace(/\D/g, '');
      const start = input.selectionStart ?? input.value.length;
      const end   = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + onlyDigits + input.value.slice(end);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // reaccionar al tildar/destildar "Reserva camas"
    const chk = document.getElementById(`pernocta-${albergue}`);
    if (chk) chk.addEventListener('change', () => setCantidadMaxFor(albergue));
  });
}

// Llamalo con tus otros inits
document.addEventListener('DOMContentLoaded', () => {
  setupCantidadLimits();
});
function getDisponiblesValue(albergue){
  const el = document.getElementById(`disponibles-${albergue}`);
  if (!el) return NaN;
  const n = parseInt(String(el.textContent).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : NaN;
}


function applyHospedajeState(albergue){
  const chk   = document.getElementById(`pernocta-${albergue}`);
  const selEg = document.getElementById(`horaEgreso-${albergue}`);
  if (!selEg) return;

  // Asegura que exista la opción "Hospedarse"
  if (!selEg.querySelector('option[value="Hospedarse"]')) {
    selEg.insertAdjacentHTML('beforeend','<option value="Hospedarse">Hospedarse</option>');
  }

  const isHospedaje = !!(chk && chk.checked);

  if (isHospedaje) {
    // guardo la última hora elegida (si no era "Hospedarse")
    if (selEg.value && selEg.value !== 'Hospedarse') {
      selEg.dataset.prevValue = selEg.value;
    }
    // selEg.value = 'Hospedarse';
    // selEg.disabled = true;              // bloquea interacción
    // selEg.classList.add('locked-select');
  } else {
    selEg.disabled = false;
    selEg.classList.remove('locked-select');
    // restauro la anterior o vuelvo al placeholder
    const prev = selEg.dataset.prevValue;
    if (prev && prev !== 'Hospedarse') {
      selEg.value = prev;
    } else {
      selEg.selectedIndex = 0;          // "Seleccione hora"
    }
  }
}

function setupHospedajeBinding(){
  const keys = ['maestro','tinku','aquilina'];
  keys.forEach(key => {
    const chk = document.getElementById(`pernocta-${key}`);
    if (!chk) return;
    // estado inicial
    applyHospedajeState(key);
    // reaccionar al cambio
    chk.addEventListener('change', () => {
      applyHospedajeState(key);
      // si ya actualizás topes con pernocta, mantenelo:
      if (typeof setCantidadMaxFor === 'function') setCantidadMaxFor(key);
    });
  });
}

function resetOcupacionUI(albergue){
  const fill = document.getElementById(`ocupacion-fill-${albergue}`);
  const info = document.getElementById(`ocupacion-info-${albergue}`);

  // reset sin animación “hacia atrás”
  if (fill){
    const prevTransition = fill.style.transition;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    // forzar reflow y restaurar transición
    requestAnimationFrame(() => {
      // opcional: ajusta a tu transición original si la tenías distinta
      fill.style.transition = prevTransition || 'width .6s ease';
    });
  }
  if (info) info.textContent = '—';

  // (opcional) también limpio el número de disponibles mostrado
  const disp = document.getElementById(`disponibles-${albergue}`);
  if (disp) disp.textContent = '—';
}


function resetCalendarToToday(albergue) {
  const now = new Date();
  now.setHours(0,0,0,0);

  const iso = isoFromYMD(now.getFullYear(), now.getMonth(), now.getDate());

  // forzamos mes/año y día seleccionado = HOY
  const est = estadoCalendario[albergue];
  est.mes = now.getMonth();
  est.año = now.getFullYear();
  est.selectedISO = iso;

  // reflejar en el input deshabilitado
  const inputFecha = document.getElementById(`fechaIngreso-${albergue}`);
  if (inputFecha) inputFecha.value = iso;
}


// =================== Cancelación de reservas (FRONT) ===================
function openCancelModal(){
  const m = document.getElementById('modal-cancelar');
  if (!m) return;
  // limpia input y botón
  const inp = document.getElementById('cancel-id');
  if (inp) inp.value = '';
  const btn = document.getElementById('btn-cancelar-enviar');
  if (btn) resetBtn(btn, 'Confirmar cancelación');

  m.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeCancelModal(){
  const m = document.getElementById('modal-cancelar');
  if (!m) return;
  m.classList.remove('active');
  document.body.style.overflow = 'auto';
}

// Eventos del botón y modal de cancelar
document.addEventListener('DOMContentLoaded', () => {
  const openBtn  = document.getElementById('open-cancel-modal');
  const closeBtn = document.getElementById('close-cancel-modal');
  const cancelForm = document.getElementById('cancelForm');

const btnAlo = document.querySelector('.btn-alo');
if (btnAlo) {
  btnAlo.addEventListener('click', function() {
    const albergue = this.dataset.albergue || 'maestro'; // Usa data o fallback
    openAlojamientoModal(albergue);
  });
}


  if (openBtn)  openBtn.addEventListener('click', openCancelModal);
  if (closeBtn) closeBtn.addEventListener('click', closeCancelModal);

  // Cerrar al clickear fuera del contenido (como el resto de modales)
  const modal = document.getElementById('modal-cancelar');
  if (modal){
    modal.addEventListener('click', (e)=>{
      if (e.target === modal) closeCancelModal();
    });
  }

  if (cancelForm){
    cancelForm.addEventListener('submit', async (e)=>{
      e.preventDefault();

      const idVal = document.getElementById('cancel-id')?.value?.trim();
      if (!idVal){
        showSnackbar('Ingrese un ID válido', 'error', 2500);
        return;
      }

      const btn = document.getElementById('btn-cancelar-enviar');
      setBtnLoading(btn);

      try{
        const result = await cancelarReservaEnGoogleSheets(idVal);
        if (result.success){
          setBtnSuccess(btn, 'Cancelada');
          showSnackbar(`Reserva ${idVal} cancelada correctamente.`, 'success', 8200);
          setTimeout(() => {
            closeCancelModal();
            resetBtn(btn, 'Confirmar cancelación');
          }, 900);
        }else{
          setBtnError(btn, 'Error');
          showSnackbar(result.message || 'No se pudo cancelar la reserva', 'error', 8200);
          setTimeout(() => resetBtn(btn, 'Confirmar cancelación'), 1200);
        }
      }catch(err){
        console.error(err);
        setBtnError(btn, 'Error');
        showSnackbar('Error de conexión al cancelar', 'error', 3200);
        setTimeout(() => resetBtn(btn, 'Confirmar cancelación'), 1200);
      }
    });
  }
});

// Llamada al Apps Script para cancelar
async function cancelarReservaEnGoogleSheets(idReserva){
  const payload = new URLSearchParams({
    secret: CONFIG.secretKey,
    action: 'cancelarReserva',
    idReserva: String(idReserva)
  });

  const resp = await fetch(CONFIG.googleScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload
  });

  return resp.json();
}

document.getElementById("cancel-id").addEventListener("input", function() {
  if (this.value.length > 4) {
    this.value = this.value.slice(0, 4); // limita a 4 dígitos
  }
});



/*//////////////////////// II parte //////////////////////////////////////////////////*/

// Estado para calendario de alojamiento (solo maestro por ahora)
const estadoCalendarioAlo = {
  maestro: { mes: new Date().getMonth(), año: new Date().getFullYear(), startISO: null, endISO: null, range: [], diasValidos: [] }
};

// Estado global para pasos (por albergue)
const pasoEstadoAlo = { maestro: { current: 1, completed: [] } };

// Cache para fechas ocupadas en alojamiento (se actualizará desde GS, similar)
let fechasOcupadasAlo = { maestro: [] };

// Ocupación actual para alojamiento
let ocupacionActualAlo = { maestro: 0 };

// Estado de envío para alojamiento
const formSubmissionStateAlo = { maestro: { isSubmitting: false } };

// Funciones para modales de alojamiento
function openAlojamientoModal(albergue) {
  console.log(`Abriendo modal de alojamiento para ${albergue}`); // DEBUG: Confirm albergue value
  const modalId = `modal-alojamiento-${albergue}`;
  const modalEl = document.getElementById(modalId);
  console.log(`Looking for modal ID: ${modalId}, found:`, modalEl); // DEBUG: Check if element exists
  
  if (!modalEl) {
    console.error(`Modal element '${modalId}' not found in DOM. Check HTML ID.`);
    alert(`Error: Modal para ${albergue} no encontrado. Recarga la página.`);
    return; // Exit early to prevent crash
  }
  
  modalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
  resetFormAlo(albergue);
  resetCalendarAloToToday(albergue);
  resetOcupacionUIAlo(albergue); // Limpia barra
  fechasOcupadasAlo[albergue] = []; // Reset cache al abrir
  generarCalendarioAlo(albergue);

  // Always init steps - con try-catch mínimo para no romper el modal
  try {
    initPasoFlujoAlo(albergue);
    setupPasoListenersAlo(albergue);
    console.log('Pasos inicializados exitosamente para', albergue); // DEBUG éxito en pasos
  } catch (error) {
    console.error('Error en inits de pasos:', error);
    // No revertir el modal: solo log y continúa (pasos opcionales por ahora)
  }
}

// Inicializar pasos
function initPasoFlujoAlo(albergue) {
  pasoEstadoAlo[albergue] = { current: 1, completed: [] };
  updateProgresoAlo(albergue);
  // Deshabilita submit inicialmente
  const btnSubmit = document.getElementById('btn-submit-alo-maestro');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.setAttribute('disabled', 'disabled');
    btnSubmit.classList.add('disabled');
    btnSubmit.classList.remove('enabled');
  }
}

function closeAlojamientoModal(albergue) {
  console.log(`Cerrando modal de alojamiento para ${albergue}`);
  document.getElementById(`modal-alojamiento-${albergue}`).classList.remove('active');
  document.body.style.overflow = 'auto';
  resetAllAlo(albergue); // Limpia al cerrar
}

// Cerrar al click fuera (igual)
window.onclick = (function(original) {
  return function(event) {
    original.call(this, event);
    if (event.target.classList.contains('modal') && event.target.id.startsWith('modal-alojamiento-')) {
      const albergue = event.target.id.split('-')[2];
      closeAlojamientoModal(albergue);
    }
  };
})(window.onclick || function(){});

// Setup listeners (igual, pero asegúrate de que esté en DOMContentLoaded)
document.addEventListener('DOMContentLoaded', function() {
  const aloForm = document.getElementById('aloFormMaestro');
  if (aloForm) {
    aloForm.addEventListener('submit', handleFormSubmitAlo);
  }
  setupCantidadLimitsAlo();
  setupDelegacionListenerAlo();
  setupCantidadListenerAlo(); // Asegura que se llame
});

// En handleFormSubmitAlo: Refuerza check para prevenir submit si Paso 4 no completo
function handleFormSubmitAlo(e) {
  e.preventDefault();
  const albergue = 'maestro'; // Fijo por ahora
  if (formSubmissionStateAlo[albergue].isSubmitting) return;
  // NUEVO: Check explícito para todos los pasos completos (incluyendo Paso 4)
  if (pasoEstadoAlo[albergue].completed.length < 4) {
    showSnackbar('Complete todos los pasos antes de confirmar.', 'error', 3000);
    return;
  }
  formSubmissionStateAlo[albergue].isSubmitting = true;
  submitFormAlo(albergue).finally(() => {
    formSubmissionStateAlo[albergue].isSubmitting = false;
  });
}

// En completePasoAlo: Toggle clases visuales al habilitar
function completePasoAlo(albergue, pasoNum) {
  if (!pasoEstadoAlo[albergue].completed.includes(pasoNum)) {
    pasoEstadoAlo[albergue].completed.push(pasoNum);
    pasoEstadoAlo[albergue].current = Math.min(4, pasoNum + 1);
    updateProgresoAlo(albergue);
  }
  // Habilita submit SOLO si todos completos (4 pasos, Paso 4 incluido)
  if (pasoEstadoAlo[albergue].completed.length === 4) {
    const btnSubmit = document.getElementById('btn-submit-alo-maestro');
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.classList.remove('disabled'); // Remueve gris/prohibido
      btnSubmit.classList.add('enabled'); // Agrega azul/activo
      console.log('Botón submit habilitado: Paso 4 completo'); // DEBUG
    }
  }
}

// En setupPasoListenersAlo: Deshabilita visual si no todos llenos (Paso 4)
['institucion-alo-maestro', 'responsable-alo-maestro', 'dni-alo-maestro', 'contacto-alo-maestro'].forEach(id => {
  const input = document.getElementById(id);
  if (input) {
    input.addEventListener('blur', () => {
      // Completa Paso 4 solo si TODOS los campos tienen valor
      const todosLlenos = ['institucion-alo-maestro', 'responsable-alo-maestro', 'dni-alo-maestro', 'contacto-alo-maestro'].every(idCheck => {
        const el = document.getElementById(idCheck);
        return el && el.value.trim();
      });
      const btnSubmit = document.getElementById('btn-submit-alo-maestro');
      if (todosLlenos) {
        completePasoAlo(albergue, 4);
        console.log('Paso 4 completado: Todos los campos llenos'); // DEBUG
      } else if (btnSubmit) {
        // Deshabilita visual si no todos llenos
        btnSubmit.disabled = true;
        btnSubmit.classList.add('disabled');
        btnSubmit.classList.remove('enabled');
        console.log('Botón submit deshabilitado: Falta campo en Paso 4'); // DEBUG
      }
    });
  }
});

async function submitFormAlo(albergue) {
  const formData = getFormDataAlo(albergue);
  if (!formData || formData.range.length === 0 || formData.cantidad === 0) {
    alert("Complete cantidad, institución y seleccione un rango válido");
    return;
  }
  
  const btn = getSubmitButtonAlo(albergue);
  if (!btn) {
    console.error('Botón submit no encontrado');
    return;
  }
  
  // Loader custom: "Guardando Reserva..."
  setBtnLoading(btn, 'Guardando Reserva...');
  
  try {
    // OPTIMIZACIÓN: Saltar re-verificación (ya hecha en coloreo calendario)
    // Directo al envío (confiamos en validación previa)
    
    // Envío a GS Alo (nueva BD)
    const resultado = await enviarReservaAlojamientoAGoogleSheets(formData);
    
    if (resultado.success) {
      mostrarConfirmacionAlo(albergue, formData, resultado.idReserva);
      setBtnSuccess(btn);
      // Snackbar ajustado: matching exacto con el otro modal
      showSnackbar(
        `PRE-Reserva Realizada \n Nro: ${resultado.idReserva}.\n Para su confirmación, llamar al:\n (0381)452-6408.`,
        'success',
        15000
      );
      setTimeout(() => {
        resetFormAlo(albergue);
        closeAlojamientoModal(albergue);
        resetBtn(btn);
      }, 900);
    } else {
      setBtnError(btn, 'Error');
      showSnackbar(`Error en reserva: ${resultado.message || 'Intente nuevamente'}`, 'error', 2200);
      setTimeout(() => resetBtn(btn), 1200);
    }
  } catch (err) {
    console.error('Error submit Alo:', err);
    setBtnError(btn, 'Error');
    showSnackbar(`Error de conexión: ${err.message || 'Revisa red/BD'}`, 'error', 2200);
    setTimeout(() => resetBtn(btn), 1200);
  }
}

function getFormDataAlo(albergue) {
  if (!estadoCalendarioAlo || !estadoCalendarioAlo[albergue]) {
    console.error(`Estado Alo no definido para ${albergue}`);
    return null; // Early return
  }
  const estado = estadoCalendarioAlo[albergue];
  const cantidad = parseInt(document.getElementById(`cantidad-alo-${albergue}`).value, 10) || 0;

  const delegacion = document.getElementById('delegacion-alo-maestro').value;
  if (!delegacion) {
    alert('Seleccione tipo de delegación');
    return null;
  }

  return {
    albergue,
    institucion: document.getElementById(`institucion-alo-${albergue}`).value.trim(),
    responsable: document.getElementById(`responsable-alo-${albergue}`).value.trim(), // NUEVO: Responsable
    dni: document.getElementById('dni-alo-maestro').value.trim(), // NUEVO: DNI
    cantidad,
    range: estado.range // Array correcto para BD
    //delegacion
  };
}

function mostrarConfirmacionAlo(albergue, formData, idReserva) {
  console.log(`Confirmación alojamiento ${albergue}, ID: ${idReserva}, Rango: ${formData.range.join(', ')}`);
  // Opcional: alert similar al existente, pero con rango
}

async function mostrarInfoDiaAlo(albergue, iso) {
  showCalendarLoadingAlo(albergue);

  try {
    const disp = await obtenerDisponibilidadDiaAlo(albergue, iso);
    const cap = capacidades[albergue];
    const ocupados = cap - disp.disponibles;

    updateOcupacionUIAlo(albergue, ocupados, cap);

    const spanDisp = document.getElementById(`disponibles-alo-${albergue}`);
    if (spanDisp) spanDisp.textContent = disp.disponibles;

    // ✅ Guardar resultado de disponibilidad
    const estado = estadoCalendarioAlo[albergue];
    if (!estado.diasValidos) estado.diasValidos = [];

    // Si el día tiene disponibilidad, lo agregamos a los válidos
    if (disp.disponibles > 0 && !estado.diasValidos.includes(iso)) {
      estado.diasValidos.push(iso);
    }

    // Si no tiene disponibilidad, lo quitamos de válidos
    if (disp.disponibles <= 0) {
      estado.diasValidos = estado.diasValidos.filter(d => d !== iso);
    }

    // Marcar que ya se verificó disponibilidad para actualizar colores
    estado.disponibilidadConfirmada = true;

    // 🔄 Regenerar calendario → pinta verde o rojo
    generarCalendarioAlo(albergue);

  } catch (e) {
    console.error("Error al obtener disponibilidad:", e);
  } finally {
    hideCalendarLoadingAlo(albergue);
  }
}


function resetFormAlo(albergue) {
  const form = document.getElementById('aloFormMaestro');
  if (form) form.reset();
  document.getElementById(`cantidad-alo-${albergue}`).value = ''; // Limpia cantidad arriba
  const estado = estadoCalendarioAlo[albergue];
  resetRangoAlo(albergue); // Usa reset extendido
}

// Listener para cantidad: Re-valida rango si existe
function setupCantidadListenerAlo() {
  const input = document.getElementById('cantidad-alo-maestro');
  if (!input) return;
  input.addEventListener('input', () => {
    const cantidad = parseInt(input.value, 10) || 0;
    const estado = estadoCalendarioAlo.maestro;
    if (estado.range.length > 0 && cantidad > 0) {
      // Re-chequea y recolorea
      mostrarInfoRangoAlo(maestro, estado.range);
    }
  });
}

// Helpers para botones (igual)
function getSubmitButtonAlo(albergue) {
  const form = document.getElementById('aloFormMaestro');
  return form ? form.querySelector('.btn-submit') : null;
}

// Funciones para calendario de alojamiento
function generarCalendarioAlo(albergue) {
  const estado = estadoCalendarioAlo[albergue];
  const { mes, año } = estado;

  const primerDia = new Date(año, mes, 1);
  const ultimoDia = new Date(año, mes + 1, 0);
  const primerDiaSemana = primerDia.getDay();
  const diasEnMes = ultimoDia.getDate();

  const contenedor = document.getElementById(`calendario-alo-${albergue}`);
  if (!contenedor) return;
  contenedor.innerHTML = '';

  // Encabezados
  CONFIG.diasSemanaCortos.forEach(dia => {
    const diaHeader = document.createElement('div');
    diaHeader.className = 'dia-header';
    diaHeader.textContent = dia;
    contenedor.appendChild(diaHeader);
  });

  // Espacios iniciales
  for (let k = 0; k < primerDiaSemana; k++) {
    contenedor.appendChild(crearDiaElementoAlo('', 'otro-mes'));
  }

  const hoy = new Date(); hoy.setHours(0,0,0,0);

  for (let i = 1; i <= diasEnMes; i++) {
    const fechaActual = new Date(año, mes, i);
    fechaActual.setHours(0,0,0,0);
    const iso = isoFromYMD(año, mes, i);

    const estaOcupado = fechasOcupadasAlo[albergue].some(f => f.toDateString() === fechaActual.toDateString());
    const esPasado = fechaActual < hoy;

    let clases = [];
    if (estaOcupado) clases.push('ocupado');
    if (esPasado) clases.push('inactiva');

    
    // Rango activo
if (estado.range.includes(iso)) {
  clases.push('en-rango');
  if (estado.startISO === iso) clases.push('inicio-rango');
  if (estado.endISO === iso) clases.push('fin-rango');

  // 🔹 Solo aplicar verde/rojo si ya se obtuvo la disponibilidad
  if (estado.disponibilidadConfirmada) {
    if (estado.diasValidos.includes(iso)) {
      clases.push('verde');
    } else {
      clases.push('rojo');
    }
  } else {
    // 🔹 Antes de confirmar disponibilidad, mantener azul
    clases.push('azul-seleccion');
  }
}


    const dia = crearDiaElementoAlo(i, clases.join(' '));
    dia.dataset.iso = iso;

    if (fechaActual.getTime() === hoy.getTime()) dia.classList.add('hoy');

    if (!esPasado && !estaOcupado) {
      dia.addEventListener('click', () => handleClickDiaAlo(albergue, iso, dia));
    } else {
      dia.tabIndex = -1;
      dia.setAttribute('aria-disabled', 'true');
    }

    contenedor.appendChild(dia);
  }

  // Rellenar hasta 42 celdas
  const totalCeldas = 42;
  const usados = primerDiaSemana + diasEnMes;
  const faltan = totalCeldas - usados;
  for (let i = 0; i < faltan; i++) {
    contenedor.appendChild(crearDiaElementoAlo('', 'otro-mes'));
  }

  const titulo = document.getElementById(`mes-actual-alo-${albergue}`);
  if (titulo) titulo.textContent = `${CONFIG.meses[mes]} ${año}`;

  console.log(`Calendario regenerado para ${albergue}. Rango actual:`, estado.range);
}

function handleClickDiaAlo(albergue, iso, dia) {
  const estadoAlo = estadoCalendarioAlo[albergue];
  const contenedor = document.getElementById(`calendario-alo-${albergue}`);

  // 1️⃣ Primer clic → seleccionar inicio provisional
  if (!estadoAlo.startISO) {
    estadoAlo.startISO = iso;
    estadoAlo.endISO = null;
    estadoAlo.range = [iso];

    // Limpiar selección previa
    contenedor.querySelectorAll('.seleccionado-inicial, .inicio-rango, .fin-rango, .en-rango')
              .forEach(el => el.classList.remove('seleccionado-inicial', 'inicio-rango', 'fin-rango', 'en-rango'));

    dia.classList.add('seleccionado-inicial');
    console.log(`Inicio de rango provisional: ${iso}`);
    return;
  }

  
  

  // 2️⃣ Segundo clic → definir fin y generar rango
if (!estadoAlo.endISO) {
  const startDate = new Date(estadoAlo.startISO + 'T00:00:00');
  const endDate = new Date(iso + 'T00:00:00');

  if (endDate < startDate) {
    estadoAlo.startISO = iso;
    estadoAlo.endISO = toISODateYMD(startDate);
  } else {
    estadoAlo.endISO = iso;
  }

  // Generar rango corrigiendo desfase horario
  const rango = [];
  for (let d = new Date(estadoAlo.startISO + 'T00:00:00'); d <= new Date(estadoAlo.endISO + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    rango.push(d.toISOString().slice(0, 10));
  }
  estadoAlo.range = rango;

  // 🔹 Reiniciar disponibilidad del rango actual
  estadoAlo.disponibilidadConfirmada = false;
  estadoAlo.diasValidos = [];

  // 🔹 Quitar marcas temporales o previas del calendario
  const prev = contenedor.querySelectorAll('.seleccionado-inicial, .inicio-rango, .fin-rango, .en-rango, .rojo, .verde, .azul-seleccion');
  prev.forEach(el => el.classList.remove('seleccionado-inicial', 'inicio-rango', 'fin-rango', 'en-rango', 'rojo', 'verde', 'azul-seleccion'));

  // 🔹 Importante: el rango ya está definido en el estado
  console.log(`Rango confirmado: ${estadoAlo.startISO} → ${estadoAlo.endISO}`);
  console.log(`Nuevo rango generado:`, estadoAlo.range);

  // 🔹 Ejecutar la consulta de disponibilidad
  if (typeof mostrarInfoRangoAlo === 'function') {
    mostrarInfoRangoAlo(albergue, estadoAlo.startISO, estadoAlo.endISO);
  }

  // 🔄 Recién ahora regenerar calendario (para que se pinte azul correctamente)
  generarCalendarioAlo(albergue);

  return;
}



  // 3️⃣ Tercer clic → reiniciar selección
  estadoAlo.startISO = null;
  estadoAlo.endISO = null;
  estadoAlo.range = [];
  generarCalendarioAlo(albergue);
}



function crearDiaElementoAlo(numero, claseExtra = '') {
  const dia = document.createElement('div');
  dia.className = `dia ${claseExtra}`;
  dia.textContent = numero;
  return dia;
}

function updateCalendarHighlightsAlo(albergue) {
  generarCalendarioAlo(albergue);
}

function updateRangeDisplay(albergue, range) {
  const display = document.getElementById(`fecha-range-display-alo-${albergue}`);
  if (!display) return;
  
  if (range.length === 0) {
    display.innerHTML = `
      Estadia de hasta 4 días y 3 noches consecutivos.
      <br>
      <span class="leyenda-color">
        <span class="cuadrado rojo">■</span> <span class="texto-rojo">Rojo:</span> Día sin camas disponibles.
      </span>
      <span class="leyenda-color">
        <span class="cuadrado verde">■</span> <span class="texto-verde">Verde:</span> Día con camas disponibles.
      </span>
    `;
  } else {
    const start = new Date(range[0]);
    const end = new Date(range[range.length - 1]);
    const estado = estadoCalendarioAlo[albergue];
    const invalidos = range.length - estado.diasValidos.length;
    let extra = '';
    // if (invalidos > 0) {
    //   extra = ` <span style="color: #f44336;">(¡${invalidos} días en rojo: insuficientes camas!)</span>`;
    // }
    display.innerHTML = `
       Su seleccion es: ${range.length} días${extra} y ${range.length - 1} ${extra} noches.
       <br>
      <span class="leyenda-color">
        <span class="cuadrado rojo">■</span> <span class="texto-rojo">Rojo:</span> Día sin camas disponibles.
      </span>
      <br>
      <span class="leyenda-color">
        <span class="cuadrado verde">■</span> <span class="texto-verde">Verde:</span> Día con camas disponibles.
      </span>
      
    `;
  }
}

// En handleClickDiaAlo: Completa paso 3 solo si todos los días son verdes (disponibles)
async function handleClickDiaAlo(albergue, iso, cell) {
  const estado = estadoCalendarioAlo[albergue];
  const [year, month, day] = iso.split('-').map(Number); // FIX: Parsea local
  const fechaClick = new Date(year, month - 1, day); // Local explícito
  const startDate = estado.startISO ? (() => {
    const [sYear, sMonth, sDay] = estado.startISO.split('-').map(Number);
    return new Date(sYear, sMonth - 1, sDay); // Local
  })() : null;
  
  console.log(`Click en ${iso}. Start actual: ${estado.startISO}, End: ${estado.endISO}`); // DEBUG
  
  if (!estado.startISO) {
    // Primer click: Solo highlight visual (sin fetch/loader – optimización)
    estado.startISO = iso;
    estado.endISO = null;
    estado.range = [iso];
    console.log(`Nuevo start: ${iso}, range: [${iso}]`); // DEBUG
    updateCalendarHighlightsAlo(albergue);
    updateRangeDisplay(albergue, estado.range);
    // QUITADO: mostrarInfoDiaAlo(albergue, iso); // Ya no fetch individual
  } else if (!estado.endISO) {
    const diffDias = Math.floor((fechaClick - startDate) / (1000 * 60 * 60 * 24));
    
    console.log(`Diff días: ${diffDias} (start: ${estado.startISO}, click: ${iso})`); // DEBUG
    
    if (diffDias < 0) {
      // Mueve start: Solo highlight (sin fetch)
      estado.startISO = iso;
      estado.endISO = null;
      estado.range = [iso];
      console.log(`Start movido a ${iso}`); // DEBUG
      updateCalendarHighlightsAlo(albergue);
      updateRangeDisplay(albergue, estado.range);
      // QUITADO: mostrarInfoDiaAlo(albergue, iso); // Ya no fetch individual
    } else if (diffDias > 3) {
      // Excede
      console.log(`Alerta: Excede 4 días (diff=${diffDias})`); // DEBUG
      alert("El rango no puede exceder 4 días consecutivos");
      return;
    } else {
      // NUEVO: Antes de set end, chequea límite por tipo
      const select = document.getElementById('delegacion-alo-maestro');
      const tipo = select.value;
      const maxDias = tipo === 'escuelas' ? 4 : (tipo === 'otra' ? 3 : 4); // Default 4
      if (diffDias + 1 > maxDias) { // +1 porque diff es días intermedios
        alert(`Límite excedido según tipo de delegación (${tipo || 'no seleccionado'}): hasta ${maxDias} días.`);
        return;
      }

      // Set end y llena rango (loop igual, ya funciona)
      estado.endISO = iso;
      estado.range = [];
      let current = new Date(startDate);
      while (current <= fechaClick) {
        const currentIso = current.toISOString().split('T')[0];
        estado.range.push(currentIso);
        current.setDate(current.getDate() + 1);
      }
      console.log(`Rango final: [${estado.range.join(', ')}], length=${estado.range.length}`); // DEBUG
      if (estado.range.length !== diffDias + 1) {
        alert("Error en selección de rango. Intente de nuevo.");
        resetRangoAlo(albergue);
        return;
      }
      // TEMPORAL: Highlight celeste antes de check
      updateCalendarHighlightsAlo(albergue);
      updateRangeDisplay(albergue, estado.range);
      // UNA SOLA BÚSQUEDA: Solo aquí, después del segundo click (rango completo)
      try {
        await mostrarInfoRangoAlo(albergue, estado.range);
        // OPTIMIZACIÓN: Completa paso 3 SOLO si todos los días son verdes (diasValidos.length === range.length)
        const todosVerdes = estado.diasValidos.length === estado.range.length;
        if (todosVerdes && validarLimiteRangoAlo(albergue, estado.range)) {
          // Bloquea clics futuros en calendario
          const grid = document.getElementById(`calendario-alo-${albergue}`);
          if (grid) grid.classList.add('step-completed');
          const navPrev = document.getElementById(`nav-prev-alo-${albergue}`);
          const navNext = document.getElementById(`nav-next-alo-${albergue}`);
          if (navPrev) navPrev.disabled = true;
          if (navNext) navNext.disabled = true;
          completePasoAlo(albergue, 3); // Completa paso → Activa paso 4
          console.log('Paso 3 completado: Todos los días verdes'); // DEBUG
        } else if (!todosVerdes) {
          console.log('Paso 3 no completado: Algunos días rojos (insuficientes camas)'); // DEBUG
          showSnackbar('Algunos días no tienen suficientes camas. Revise colores rojos.', 'error', 4000);
        }
      } catch (error) {
        console.error('Error al verificar rango:', error);
        // No deshabilita si falla la verificación
      }
    }
  } else {
    // Reinicia
    console.log('Reiniciando rango completo'); // DEBUG
    resetRangoAlo(albergue);
    handleClickDiaAlo(albergue, iso, cell);
  }
}


function resetRangoAlo(albergue) {
  const estado = estadoCalendarioAlo[albergue];
  estado.startISO = null;
  estado.endISO = null;
  estado.range = [];
  estado.diasValidos = []; // Nuevo: Limpia validación

  estado.disponibilidadConfirmada = false; // FIX: Resetear para que nuevos rangos inicien en azul hasta verificar disponibilidad
  updateRangeDisplay(albergue, []);
  updateCalendarHighlightsAlo(albergue); // Regenera sin highlights
}


async function mostrarInfoRangoAlo(albergue, range) {
  const cap = capacidades[albergue];
  const cantidad = parseInt(document.getElementById(`cantidad-alo-${albergue}`).value, 10) || 0;
  if (cantidad === 0) return; // No valida si cantidad no ingresada
  
  if (!validarLimiteRangoAlo(albergue, range)) {
    return; // Sale si excede (ya alertado y reseteado)
  }

  let minDisp = cap;
  const diasValidos = [];
  const fullDays = [];

  // Muestra "Buscando..." SOLO durante el loop de fetches (delay backend)
  showCalendarLoadingAlo(albergue);
  
  // OPTIMIZACIÓN: Paralleliza fetches con Promise.all (todos simultáneos)
  const fetchPromises = range.map(async (iso) => {
    try {
      const disp = await obtenerDisponibilidadDiaAlo(albergue, iso); // FIX: Usa Alo
      const disponibles = disp.disponibles || cap;
      minDisp = Math.min(minDisp, disponibles);
      
      if (disponibles >= cantidad) {
        diasValidos.push(iso);
      }
      if (disponibles <= 0) {
        fullDays.push(new Date(iso + 'T00:00:00'));
      }
      return { iso, disponibles }; // Retorna para manejo
    } catch (e) {
      console.warn(`Error en disp Alo para ${iso}:`, e);
      // Fallback: Asume full para mock
      const disponibles = cap;
      if (disponibles >= cantidad) diasValidos.push(iso);
      return { iso, disponibles };
    }
  });
  
  await Promise.all(fetchPromises); // Espera todos en paralelo (más rápido)
  
  // Oculta loader ANTES de setear estado y regenerar (para que colores se vean limpios)
  hideCalendarLoadingAlo(albergue);
  
  /*const estado = estadoCalendarioAlo[albergue];
  estado.diasValidos = diasValidos;
  
  // if (fullDays.length > 0) {
  //   fechasOcupadasAlo[albergue] = [...new Set([...fechasOcupadasAlo[albergue], ...fullDays])];
  //   generarCalendarioAlo(albergue);
  // } else {
  //   generarCalendarioAlo(albergue);
  // }*/
  
const estado = estadoCalendarioAlo[albergue];
estado.diasValidos = diasValidos;

// 🔹 NUEVO: marcar que ya se confirmó disponibilidad
estado.disponibilidadConfirmada = true;

// 🔄 Regenerar calendario con colores verde/rojo
generarCalendarioAlo(albergue);


  const maxOcupados = cap - minDisp;
  updateOcupacionUIAlo(albergue, maxOcupados, cap);
  const spanDisp = document.getElementById(`disponibles-alo-${albergue}`);
  if (spanDisp) spanDisp.textContent = minDisp;
  
  if (diasValidos.length < range.length) {
    showSnackbar(`Advertencia: ${range.length - diasValidos.length} días no tienen suficientes camas para ${cantidad} personas.`, 'error', 5000);
  }
}

// Listeners para avance de pasos
function setupPasoListenersAlo(albergue) {
  // Paso 1: Cantidad (bloqueo fijo al valor ingresado)
  const qtyInput = document.getElementById('cantidad-alo-maestro');
  if (qtyInput) {
    qtyInput.addEventListener('blur', () => {
      console.log('Blur en cantidad:', qtyInput.value); // DEBUG
      const valor = parseInt(qtyInput.value, 10);
      if (valor && valor >= 1) {
        qtyInput.readonly = true;
        qtyInput.value = valor;
        const step1 = qtyInput.closest('.step-container');
        if (step1) step1.classList.add('step-completed');
        completePasoAlo(albergue, 1);
        const estado = estadoCalendarioAlo[albergue];
        if (estado.range.length > 0) mostrarInfoRangoAlo(albergue, estado.range);
      }
    });
  }

  // Paso 2: Delegación
  const delSelect = document.getElementById('delegacion-alo-maestro');
  if (delSelect) {
    delSelect.addEventListener('change', () => {
      if (delSelect.value) {
        delSelect.disabled = true;
        const step2 = delSelect.closest('.step-container');
        if (step2) step2.classList.add('step-completed');
        completePasoAlo(albergue, 2);
        document.getElementById('delegacion-hidden-alo-maestro').value = delSelect.value;
        const estado = estadoCalendarioAlo[albergue];
        if (estado.range.length > 0) {
          validarLimiteRangoAlo(albergue, estado.range);
          mostrarInfoRangoAlo(albergue, estado.range);
        }
      }
    });
  }

  // Paso 3: Ya se maneja en handleClickDiaAlo

  // Paso 4: Campos adicionales (usa 'input' + 'blur' para check inmediato al tipear)
  const camposPaso4 = ['institucion-alo-maestro', 'responsable-alo-maestro', 'dni-alo-maestro', 'contacto-alo-maestro'];
  camposPaso4.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      // Evento 'input' para check al tipear (inmediato)
      input.addEventListener('input', () => checkPaso4(albergue));
      // Evento 'blur' para check final (redundante, pero seguro)
      input.addEventListener('blur', () => checkPaso4(albergue));
    }
  });

  // Función helper para check Paso 4 (llamada desde input/blur)
  function checkPaso4(albergue) {
    const todosLlenos = camposPaso4.every(idCheck => {
      const el = document.getElementById(idCheck);
      return el && el.value.trim().length > 0;
    });
    const btnSubmit = document.getElementById('btn-submit-alo-maestro');
    if (todosLlenos) {
      completePasoAlo(albergue, 4);
      console.log('Paso 4 completado: Todos llenos (al input)'); // DEBUG
    } else if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.setAttribute('disabled', 'disabled');
      btnSubmit.classList.add('disabled');
      btnSubmit.classList.remove('enabled');
      console.log('Botón deshabilitado: Falta campo (al input)'); // DEBUG
    }
  }

  const dniInput = document.getElementById('dni-alo-maestro');
  if (dniInput) {
    dniInput.placeholder = 'Ej: 12345678';
    dniInput.min = '0';
    dniInput.max = '99999999'; // Límite superior para 8 dígitos
    dniInput.addEventListener('input', () => {
      let v = dniInput.value.replace(/\D/g, ''); // Solo números (quita no-dígitos)
      if (v.length > 8) v = v.slice(0, 8); // Corta a 8 dígitos
      dniInput.value = v;
      // Trigger check Paso 4 al cambiar
      checkPaso4(albergue);
    });
    dniInput.addEventListener('blur', () => {
      const v = parseInt(dniInput.value, 10);
      if (isNaN(v) || v.toString().length !== 8) {
        dniInput.value = ''; // Limpia si no es 8 dígitos válidos
        showSnackbar('DNI debe ser exactamente 8 números.', 'error', 3000);
      }
      checkPaso4(albergue);
    });
}
}
// En completePasoAlo: Habilita al llegar a 3 pasos (ignora Paso 4 para botón)
function completePasoAlo(albergue, pasoNum) {
  if (!pasoEstadoAlo[albergue].completed.includes(pasoNum)) {
    pasoEstadoAlo[albergue].completed.push(pasoNum);
    pasoEstadoAlo[albergue].current = Math.min(4, pasoNum + 1);
    updateProgresoAlo(albergue);
  }
  // Habilita submit SOLO si Paso 3 completado (3 pasos, ignora Paso 4)
  if (pasoEstadoAlo[albergue].completed.length >= 3) {
    const btnSubmit = document.getElementById('btn-submit-alo-maestro');
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.removeAttribute('disabled');
      btnSubmit.classList.remove('disabled');
      btnSubmit.classList.add('enabled');
      console.log('Botón submit habilitado: Paso 3 completado'); // DEBUG
    }
  }
}

// Actualizar progreso visual
function updateProgresoAlo(albergue) {
  // Highlights en steps
  document.querySelectorAll('.step-container').forEach((step, index) => {
    const pasoNum = index + 1;
    if (pasoEstadoAlo[albergue].completed.includes(pasoNum)) {
      step.classList.add('step-completed');
    } else if (pasoEstadoAlo[albergue].current === pasoNum) {
      step.classList.add('step-active');
    } else {
      step.classList.remove('step-completed', 'step-active');
    }
  });

  // Indicadores circulares
  document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
    const pasoNum = index + 1;
    indicator.classList.remove('completed', 'active');
    if (pasoEstadoAlo[albergue].completed.includes(pasoNum)) {
      indicator.classList.add('completed');
    } else if (pasoEstadoAlo[albergue].current === pasoNum) {
      indicator.classList.add('active');
    }
  });

  // Barra de progreso
  const progress = (pasoEstadoAlo[albergue].completed.length / 4) * 100;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${progress}%`;
}

// Función Reset Global
function resetAllAlo(albergue) {
  console.log('Reset all para', albergue); // DEBUG
  // Reset inputs y select
  const qtyInput = document.getElementById('cantidad-alo-maestro');
  if (qtyInput) {
    qtyInput.value = '';
    qtyInput.readonly = false; // Desbloquea
  }
  const delSelect = document.getElementById('delegacion-alo-maestro');
  if (delSelect) {
    delSelect.value = '';
    delSelect.disabled = false; // Desbloquea
  }
  document.getElementById('delegacion-hidden-alo-maestro').value = '';
  ['institucion-alo-maestro', 'responsable-alo-maestro', 'contacto-alo-maestro'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });

  // Reset form
  const form = document.getElementById('aloFormMaestro');
  if (form) form.reset();

  // Reset calendario
  resetRangoAlo(albergue);
  fechasOcupadasAlo[albergue] = [];
  generarCalendarioAlo(albergue);
  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) grid.classList.remove('step-completed');
  const navPrev = document.getElementById(`nav-prev-alo-${albergue}`);
  const navNext = document.getElementById(`nav-next-alo-${albergue}`);
  if (navPrev) navPrev.disabled = false;
  if (navNext) navNext.disabled = false;

  // Reset pasos y visual
  initPasoFlujoAlo(albergue);
  const btnSubmit = document.getElementById('btn-submit-alo-maestro');
  if (btnSubmit) btnSubmit.disabled = true;

  //showSnackbar('Todos los campos han sido limpiados. Puede comenzar de nuevo.', 'success', 3000);
}

function cambiarMesAlo(albergue, direccion) {
  const estado = estadoCalendarioAlo[albergue];
  estado.mes += direccion;
  if (estado.mes < 0) {
    estado.mes = 11;
    estado.año--;
  } else if (estado.mes > 11) {
    estado.mes = 0;
    estado.año++;
  }
  generarCalendarioAlo(albergue);
}

function resetCalendarAloToToday(albergue) {
  const now = new Date();
  now.setHours(0,0,0,0);
  const iso = formatDate(now);
  const estado = estadoCalendarioAlo[albergue];
  estado.mes = now.getMonth();
  estado.año = now.getFullYear();
  resetRangoAlo(albergue);
}

// Funciones de loading (CARGA)
function showCalendarLoadingAlo(albergue) {
  const overlay = document.getElementById(`cal-loader-alo-${albergue}`);
  if (overlay) {
    overlay.hidden = false;
    const textEl = document.getElementById(`loader-text-alo-${albergue}`);
    if (textEl) textEl.textContent = 'Buscando...'; // Texto custom
  }
  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) grid.classList.add('cal-block');
}

function hideCalendarLoadingAlo(albergue) {
  const overlay = document.getElementById(`cal-loader-alo-${albergue}`);
  if (overlay) overlay.hidden = true;
  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) grid.classList.remove('cal-block');
}

function updateOcupacionUIAlo(albergue, ocupados, capacidad) {
  const percent = capacidad > 0 ? Math.round((ocupados / capacidad) * 100) : 0;
  const fill = document.getElementById(`ocupacion-fill-alo-${albergue}`);
  if (fill) fill.style.width = `${percent}%`;
  const info = document.getElementById(`ocupacion-info-alo-${albergue}`);
  if (info) info.textContent = `${ocupados}/${capacidad} Camas ocupadas`;
}

function resetOcupacionUIAlo(albergue) {
  const fill = document.getElementById(`ocupacion-fill-alo-${albergue}`);
  if (fill) fill.style.width = '0%';
  const info = document.getElementById(`ocupacion-info-alo-${albergue}`);
  if (info) info.textContent = '—';
  const disp = document.getElementById(`disponibles-alo-${albergue}`);
  if (disp) disp.textContent = '—';
}

// Interacción con GS para alojamiento (nueva action)

async function enviarReservaAlojamientoAGoogleSheets(data) {
  if (!CONFIG.googleScriptUrlAlo || CONFIG.googleScriptUrlAlo.includes('undefined')) {
    console.warn('URL Alo no configurada. Simulando éxito para test.');
    return { success: true, idReserva: Math.floor(Math.random() * 10000) }; // Mock submit
  }
  
  const payload = new URLSearchParams({
    secret: CONFIG.secretKey,
    action: "crearReservaAlojamiento",
    albergue: toFullName(data.albergue),
    institucion: data.institucion,
    cantidad: data.cantidad,
    responsable: data.responsable || '', // NUEVO: Responsable
    dni: data.dni || '', // NUEVO: DNI
    rangoFechas: data.range.join(','),
  });
  
  // Genera ID client-side (ya que no-cors no lee respuesta)
  const clientId = Math.floor(Math.random() * 10000);
  
  try {
    await fetch(CONFIG.googleScriptUrlAlo, {
      method: "POST",
      mode: 'no-cors', // Ignora CORS, ejecuta pero no lee respuesta
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload
    });
    // Asume éxito (ya que datos se guardan)
    console.log(`Reserva enviada con ID client-side: ${clientId}`);
    return { success: true, idReserva: clientId };
  } catch (err) {
    console.error('Envío Alo falló:', err);
    throw err; // Propaga para manejo en submit
  }
}
/*
async function obtenerDisponibilidadDiaAlo(albergueKey, fechaISO) {
  if (!CONFIG.googleScriptUrlAlo || CONFIG.googleScriptUrlAlo.includes('undefined')) {
    console.warn(`URL Alo no configurada. Usando mock para ${fechaISO}.`);
    return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] }; // Mock full
  }
  
  const payload = new URLSearchParams({
    secret: CONFIG.secretKey,
    action: 'obtenerDisponibilidadDiaAlojamiento',
    albergue: toFullName(albergueKey),
    fecha: fechaISO
  });
  
  try {
    const resp = await fetch(CONFIG.googleScriptUrlAlo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });
    
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    
    const text = await resp.text(); // FIX: Lee text primero para debug
    if (!text.trim()) {
      throw new Error('Respuesta vacía de GS Alo');
    }
    
    const json = JSON.parse(text);
    if (!json.success) {
      console.warn(`GS Alo error para ${fechaISO}: ${json.message || 'No success'}. Usando mock.`);
      return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] };
    }
    return { disponibles: json.disponibles, capacidad: json.capacidad };
  } catch (err) {
    console.error(`Fetch Alo falló para ${fechaISO}:`, err);
    return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] }; // Mock fallback
  }
}
*/
async function obtenerDisponibilidadDiaAlo(albergueKey, fechaISO) {
  if (!CONFIG.googleScriptUrlAlo || CONFIG.googleScriptUrlAlo.includes('undefined')) {
    console.warn(`URL Alo no configurada. Usando mock para ${fechaISO}.`);
    return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] }; // Mock full
  }
  
  // Usa GET con query params (no preflight)
  const url = new URL(CONFIG.googleScriptUrlAlo);
  url.searchParams.append('secret', CONFIG.secretKey);
  url.searchParams.append('action', 'obtenerDisponibilidadDiaAlojamiento');
  url.searchParams.append('albergue', toFullName(albergueKey));
  url.searchParams.append('fecha', fechaISO);
  
  try {
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    
    const text = await resp.text(); // Lee como text (MIME TEXT)
    if (!text.trim()) {
      throw new Error('Respuesta vacía de GS Alo');
    }
    
    const json = JSON.parse(text);
    if (!json.success) {
      console.warn(`GS Alo error para ${fechaISO}: ${json.message || 'No success'}. Usando mock.`);
      return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] };
    }
    return { disponibles: json.disponibles, capacidad: json.capacidad };
  } catch (err) {
    console.error(`Fetch Alo falló para ${fechaISO}:`, err);
    return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] }; // Mock fallback
  }
}

// Límites para cantidad en alojamiento (similar a setupCantidadLimits)
function setupCantidadLimitsAlo() {
  const albergue = 'maestro';
  const input = document.getElementById(`cantidad-alo-${albergue}`);
  if (!input) return;
  
  input.min = '1';
  input.max = capacidades[albergue]; // 92 para maestro
  input.placeholder = `máx ${capacidades[albergue]}`;
  
  input.addEventListener('input', () => {
    let v = parseInt(input.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > capacidades[albergue]) v = capacidades[albergue];
    input.value = v;
  });
}

function lockFechaInputsAlo() {
  // No aplica por ahora, pero placeholder para expansión
}

function setupDelegacionListenerAlo() {
  const select = document.getElementById('delegacion-alo-maestro');
  if (!select) return;
  
  select.addEventListener('change', () => {
    const albergue = 'maestro'; // Fijo
    const hidden = document.getElementById('delegacion-hidden-alo-maestro');
    if (hidden) hidden.value = select.value; // Sincroniza para envío
    
    const estado = estadoCalendarioAlo[albergue];
    if (estado.range.length > 0) {
      // Re-valida límite y colores
      validarLimiteRangoAlo(albergue, estado.range);
      mostrarInfoRangoAlo(albergue, estado.range); // Recolorea
    }
  });
}

// NUEVO: Función helper para validar límite (reutilizable)
function validarLimiteRangoAlo(albergue, range) {
  const select = document.getElementById('delegacion-alo-maestro');
  const tipo = select.value;
  if (!tipo) return true; // No valida si no elegido
  
  const maxDias = tipo === 'escuelas' ? 4 : 3;
  if (range.length > maxDias) {
    alert(`Límite excedido para ${tipo === 'escuelas' ? 'Escuelas' : 'Otra Institución'}: hasta ${maxDias} días. El rango se ha reseteado.`);
    resetRangoAlo(albergue);
    return false;
  }
  return true;
}