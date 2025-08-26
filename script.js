// Configuración global
const CONFIG = {
  secretKey: "cristiano1988",
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbwUo0ouoBIxBhYl89tEy1NartJHSg-HIknuwN4Vc0YRnb601c5BDrq9-CHLNIEG1Y_L/exec",
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
    // Opcional: recordá que ya se mostró (para no mostrarlo de nuevo)
    // localStorage.setItem('siteNoticeSeen','1');
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
      animationDuration: 6600,
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
    resetCalendarToToday(albergue);                      // ⬅️ NUEVO

  generarCalendario(albergue);
}

function closeModal(albergue) {
  console.log(`Cerrando modal para ${albergue}`);
  document.getElementById(`modal-${albergue}`).classList.remove('active');
  document.body.style.overflow = 'auto';
  resetForm(albergue); // Reset form when closing modal
}

window.onclick = function(event) {
  if (event.target.classList.contains('modal') && event.target.classList.contains('active')) {
    const albergue = event.target.id.split('-')[1];
    closeModal(albergue);
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
// showSnackbar('PRE-Reserva Realizada: Para su confirmación, llamar al (0381)452-6408.', 'success', 10000);
showSnackbar(
  `PRE-Reserva Realizada \n Nro: ${resultado.idReserva}.\n Para su confirmación, llamar al:\n (0381)452-6408.`,
  'success',
  15000
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
    //pernocta: document.getElementById('pernocta-maestro').checked // <-- BOOLEANO nativo
    pernocta: pernoctaValue

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
  // Ensure checkbox is unchecked
  const pernoctaCheckbox = document.getElementById(`pernocta-${albergue}`);
  if (pernoctaCheckbox) {
    pernoctaCheckbox.checked = false;
  }
  console.log(`Formulario reseteado para ${albergue}, Pernocta: ${pernoctaCheckbox ? pernoctaCheckbox.checked : 'No checkbox'}`);
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
        // No need to set min for salidaInput since it's removed
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
  if (info) info.textContent = `${ocupados}/${capacidad} Camas ocupadas`;
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
function setBtnLoading(btn){
  if(!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = 'Confirmar Reserva';
  // limpiar otros estados
  btn.classList.remove('is-success','is-error');
  // activar loading
  btn.classList.add('is-loading');
  btn.disabled = true;
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

// function showSnackbar(message, type = 'success', duration = 1800) {
//   const bar = ensureSnackbar();
//   bar.classList.remove('success','error','show');
//   bar.classList.add(type === 'error' ? 'error' : 'success');
//   bar.textContent = message;

//   // mostrar
//   // (forzamos reflow para reiniciar la transición si ya estaba visible)
//   void bar.offsetWidth;
//   bar.classList.add('show');

//   // ocultar
//   clearTimeout(bar._hideTimer);
//   bar._hideTimer = setTimeout(() => {
//     bar.classList.remove('show');
//   }, duration);
// }

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
    htmlIngreso +
    '<option value="Hospedarse">Pasar la noche</option>';

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
  const chk   = document.getElementById(`pernocta-${albergue}`);
  if (!input) return;

  const pernocta = !!(chk && chk.checked);

  // límites base
  const maxSinPernocta = LIMITES_SIN_PERNOCTA[albergue];  // 300/100/100
  const maxPernoctaCap = LIMITES_PERNOCTA[albergue];      // 92/49/58

  let max, placeholderText;

  if (pernocta) {
    // Tomar la disponibilidad del día (si existe). Si no hay, caer a la capacidad por pernocta.
    const disp = getDisponiblesValue(albergue); // leído del <span id="disponibles-...">
    if (Number.isFinite(disp)) {
      max = Math.max(0, Math.min(maxPernoctaCap, disp));
      placeholderText = `disponibles: ${disp}`;
    } else {
      max = maxPernoctaCap;
      placeholderText = `máx ${maxPernoctaCap}`;
    }
  } else {
    max = maxSinPernocta;
    placeholderText = `máx ${maxSinPernocta}`;
  }

  // atributos del input
  input.min = '1';
  input.max = String(max);
  input.step = '1';
  input.inputMode = 'numeric';
  input.placeholder = placeholderText;

  // clamp + mensaje
  let v = parseInt(input.value, 10);
  if (Number.isNaN(v)) {
    input.setCustomValidity('');
    return;
  }
  if (v < 1) v = 1;
  if (v > max) {
    v = max;
    input.setCustomValidity(`El máximo permitido es ${max}.`);
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
    selEg.value = 'Hospedarse';
    selEg.disabled = true;              // bloquea interacción
    selEg.classList.add('locked-select');
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
