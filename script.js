// Configuración global
const CONFIG = {
  secretKey: "cristiano1988",

  
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbwv0h1ykWG65v5ePsH56OVS46paor0p8xBWf_Ub4W6jcjvLzBTdJvwouCEvi26Sg1m3/exec",
  
  googleScriptUrlAlo: "https://script.google.com/macros/s/AKfycbyaIwL2dUIckcTVDpuJhGX7mSYsgQRlQ4V3EESqDklt5Qb5J7RdfIEio2RbWH_pBqJG/exec",

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

  //console.log(`Abriendo modal para ${albergue}`);
  document.getElementById(`modal-${albergue}`).classList.add('active');
  document.body.style.overflow = 'hidden';
  resetForm(albergue); // Reset form when opening modal
    resetCalendarToToday(albergue);                      

  generarCalendario(albergue);
}

function closeModal(albergue) {
  //console.log(`Cerrando modal para ${albergue}`);
  document.getElementById(`modal-${albergue}`).classList.remove('active');
  document.body.style.overflow = 'auto';
  resetForm(albergue); // Reset form when closing modal
}

// Cerrar al click fuera (extendido para ambos tipos de modales)
// window.onclick = function(event) {
//   if (event.target.classList.contains('modal') && event.target.classList.contains('active')) {
//     const idParts = event.target.id.split('-');
//     if (idParts[1] === 'alojamiento') {
//       // Modal de alojamiento: modal-alojamiento-{albergue}
//       const albergue = idParts[2]; // e.g., 'maestro'
//       if (albergue) closeAlojamientoModal(albergue);
//     } else {
//       // Modal regular: modal-{albergue}
//       const albergue = idParts[1]; // e.g., 'maestro'
//       if (albergue) closeModal(albergue);
//     }
//   }
// };

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
  //console.log(`Iniciando envío de formulario para ${albergue}`);

  const formData = getFormData(albergue);
  if (!formData.institucion || !formData.responsable || !formData.dni || !formData.contacto ||
      !formData.cantidad || !formData.fechaIngreso || !formData.horaIngreso|| !formData.horaEgreso) {
    alert("Por favor complete todos los campos del formulario");
    return;
  }

  const btn = getSubmitButton(albergue);
  setBtnLoading(btn);

  try {
    const resultado = await enviarReservaAGoogleSheets(formData);
    
    console.log('📤 Datos enviados a Google Sheets:', formData);
    console.log('📥 Respuesta recibida:', resultado);


    //if (resultado.success) {
    if (resultado && resultado.success) {

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
  //console.log(`Pernocta para ${albergue}: ${pernoctaValue}`);
  return {
    albergue,
    institucion: document.getElementById(`institucion-${albergue}`).value,
    responsable: document.getElementById(`responsable-${albergue}`).value,
    dni: document.getElementById(`dni-${albergue}`).value,
    contacto: document.getElementById(`contacto-${albergue}`).value,
    cantidad: document.getElementById(`cantidad-${albergue}`).value,
    fechaIngreso: document.getElementById(`fechaIngreso-${albergue}`).value,
    horaIngreso: document.getElementById(`horaIngreso-${albergue}`).value,

    horaEgreso: document.getElementById(`horaEgreso-${albergue}`).value,
    
    pernocta: true //siempre en true para guardar la visita


  };
}

function mostrarConfirmacion(albergue, formData, idReserva) {
  //console.log(`Mostrando confirmación para ${albergue}, ID: ${idReserva}, Pernocta: ${formData.pernocta}`);
  const nombresAlbergues = {
    maestro: 'Albergue Maestro José Fierro',
    tinku: 'Albergue Tinku Huasi',
    aquilina: 'Albergue Aquilina Soldati'
  };

  
}

function resetForm(albergue) {
  const form = document.getElementById(`reservaForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
  form.reset();
  
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

    const esHoy = fechaActual.getTime() === hoy.getTime(); // NUEVO: Detecta hoy explícitamente

    // Clases
    let clases = [];
    if (estaOcupado) clases.push('ocupado');
    //if (esPasado)    clases.push('inactiva');

    if (esPasado || esHoy) clases.push('inactiva'); // NUEVO: Hoy también inactivo

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
   //f (!esPasado && !estaOcupado) {
   if (!esPasado && !esHoy && !estaOcupado) {
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
  //console.log(`Calendario generado para ${albergue}, mes: ${CONFIG.meses[mes]} ${año}`);
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

  // Mostrar info previa (si existe) mientras carga
  const cachedDisp = getDisponiblesValue(albergue);
  if (!isNaN(cachedDisp)) {
    const spanDisp = document.getElementById(`disponibles-${albergue}`);
    if (spanDisp) spanDisp.textContent = cachedDisp;
  }

  showCalendarLoading(albergue); // empieza animación
  const start = performance.now();

  try {
  const disponibilidad = await obtenerDisponibilidadDia(albergue, fechaISO);
  const capBase = Number(capacidades[albergue]) || 0;
  const capacidad   = Number(disponibilidad?.capacidad ?? capBase) || 0;
  const disponibles = Number(disponibilidad?.disponibles ?? capacidad) || 0;
  const ocupados    = Math.max(0, capacidad - disponibles);

  setCantidadMaxFor(albergue);
  ocupacionActual[albergue] = ocupados;

  // ✅ Actualizar UI solo si los elementos existen
  const spanDisp = document.getElementById(`disponibles-${albergue}`);
  const spanCap  = document.getElementById(`capacidad-${albergue}`);

  if (spanDisp) spanDisp.textContent = disponibles;
  if (spanCap)  spanCap.textContent  = capacidad;

  // Si usás barra de ocupación u otro indicador
  updateOcupacionUI?.(albergue, ocupados, capacidad);

} catch (e) {
  console.error('Error al obtener disponibilidad:', e);
} finally {
  const elapsed = performance.now() - start;
  const minDelay = 400;
  setTimeout(() => hideCalendarLoading(albergue), Math.max(0, minDelay - elapsed));
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
      dni: data.dni,
      contacto: data.contacto,
      cantidad: parseInt(data.cantidad),
      fechaIngreso: data.fechaIngreso,
      horaIngreso: data.horaIngreso,
      horaEgreso: data.horaEgreso,
      pernocta: data.pernocta // Send boolean value
    };

    //console.log(`Enviando datos a Google Sheets: ${JSON.stringify(payload)}`);
    const response = await fetch(CONFIG.googleScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload)
    });

    const result = await response.json();
    //console.log(`Respuesta de Google Sheets: ${JSON.stringify(result)}`);
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
  return json; 
}



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

function setBtnLoading(btn, texto = 'Guardando...') { 
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `
    <span class="btn-icon spinner" aria-hidden="true"></span>
    <span class="btn-label">${texto}</span>
  `;
  
}

function setBtnSuccess(btn, text='Reservado'){
  if(!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  btn.classList.remove('is-loading','is-error'); 
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
      let clean = sanitizeNombre(el.value);
      // NUEVO: Limita a 50 chars
      if (clean.length > 50) clean = clean.slice(0, 50);
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

  // === TELÉFONO VISITAS: Prefijo 3-4 + Número 6-7 = Total 9 o 10 ===
document.querySelectorAll('#modal-maestro, #modal-tinku, #modal-aquilina').forEach(modal => {
const albergue = modal.id.replace('modal-', '');
  
  const prefijoInput = document.getElementById(`prefijo-visita-${albergue}`);
  const numeroInput = document.getElementById(`numero-visita-${albergue}`);
  const hiddenInput = document.getElementById(`contacto-${albergue}`);

  if (!prefijoInput || !numeroInput || !hiddenInput) return;

  const updateHidden = () => {
    const prefijo = prefijoInput.value.replace(/\D/g, '').slice(0, 4);
    const numero = numeroInput.value.replace(/\D/g, '').slice(0, 7);

    prefijoInput.value = prefijo;
    numeroInput.value = numero;

    const prefijoOk = prefijo.length === 3 || prefijo.length === 4;
    const numeroOk = numero.length === 6 || numero.length === 7;
    const total = prefijo + numero;
    const totalOk = total.length === 9 || total.length === 10;

    if (prefijoOk && numeroOk && totalOk) {
      hiddenInput.value = total;
    } else {
      hiddenInput.value = '';
    }
  };

  prefijoInput.addEventListener('input', updateHidden);
  numeroInput.addEventListener('input', updateHidden);

  // Validación al enviar
  const form = modal.querySelector('form');
  if (form) {
    form.addEventListener('submit', (e) => {
      updateHidden();
      const total = hiddenInput.value;

      if (!/^\d{9,10}$/.test(total)) {
        e.preventDefault();
        alert('Error en el contacto:\n\n• Prefijo: 3 o 4 dígitos\n• Número: 6 o 7 dígitos\n• Total: debe ser 9 o 10 dígitos\n\nEjemplos válidos:\n381500600 (9)\n3811500600 (10)\n3815006000 (10)');
        return;
      }

      const is10Digits = total.length === 10;
      const numeroLength = is10Digits ? (total.slice(0, 4).length === 4 ? 6 : 7) : 6;
      const numero = total.slice(-numeroLength);
      const prefijo = total.slice(0, total.length - numeroLength);

      if (!/^\d{3,4}$/.test(prefijo) || !/^\d{6,7}$/.test(numero)) {
        e.preventDefault();
        alert('Formato inválido. Verifica:\n• Prefijo: 3 o 4 dígitos\n• Número: 6 o 7 dígitos');
      }
    });
  }
});
// DNI: solo números, exactamente 8 dígitos
document.querySelectorAll('input[id^="dni-"]').forEach(el => {
  el.placeholder = 'Ej: 22333444';
  el.min = '0';
  el.max = '99999999'; // Límite superior para 8 dígitos
  el.addEventListener('input', () => {
    let v = el.value.replace(/\D/g, ''); // Solo números
    if (v.length > 8) v = v.slice(0, 8); // Corta a 8 dígitos
    el.value = v;
  });
  el.addEventListener('blur', () => {
    const v = parseInt(el.value, 10);
    if (isNaN(v) || v.toString().length !== 8) {
      el.value = ''; // Limpia si no es 8 dígitos válidos
      
    }
  });
});

// NUEVO: Institución: limita a 50 chars (sin más restricciones)
document.querySelectorAll('input[id^="institucion-"]').forEach(el => {
  el.addEventListener('input', () => {
    let v = el.value;
    if (v.length > 30) v = v.slice(0, 50);
    if (v !== el.value) el.value = v;
  });
});

}


document.addEventListener('DOMContentLoaded', () => {  
  setupFieldGuards();
});


const LIMITES_SIN_PERNOCTA = { maestro: 300, tinku: 100, aquilina: 100 };
const LIMITES_PERNOCTA     = { maestro: 92,  tinku: 49,  aquilina: 58  };


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
  input.placeholder = '';

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
    
    if (selEg.value && selEg.value !== 'Hospedarse') {
      selEg.dataset.prevValue = selEg.value;
    }
   
  } else {
    selEg.disabled = false;
    selEg.classList.remove('locked-select');
    // restauro la anterior o vuelvo al placeholder
    const prev = selEg.dataset.prevValue;
    if (prev && prev !== 'Hospedarse') {
      selEg.value = prev;
    } else {
      selEg.selectedIndex = 0;          
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
  const dni = document.getElementById('cancel-dni');
  if (inp) inp.value = '';
  if (dni) dni.value = '';
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


document.querySelectorAll('.btn-alo').forEach(btn => {
  btn.addEventListener('click', function() {
    const albergue = this.dataset.albergue;
    if (albergue) openAlojamientoModal(albergue);
  });
});



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
    const dniVal = document.getElementById('cancel-dni')?.value?.trim();

    if (!idVal){
      showSnackbar('Ingrese un ID válido', 'error', 2500);
      return;
    }
    if (!dniVal){
      showSnackbar('Ingrese el DNI del responsable', 'error', 2500);
      return;
    }

    const btn = document.getElementById('btn-cancelar-enviar');
    setBtnLoading(btn);

    try{
      const result = await cancelarReservaEnGoogleSheets(idVal, dniVal);
      if (result && result.success){
        setBtnSuccess(btn, 'Cancelada');
        showSnackbar(result.message || `Reserva ${idVal} cancelada correctamente.`, 'success', 8200);
        setTimeout(() => {
          closeCancelModal();
          resetBtn(btn, 'Confirmar cancelación');
        }, 900);
      } else {
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

async function cancelarReservaEnGoogleSheets(idReserva, dni){
  const payload = new URLSearchParams({
    secret: CONFIG.secretKey,
    action: 'cancelarReserva',
    idReserva: String(idReserva),
    dni: String(dni)
  });

  const resp = await fetch(CONFIG.googleScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload
  });

  return resp.json();
}




/*//////////////////////// II parte Alojamiento//////////////////////////////////////////////////*/

// Estado para calendario de alojamiento
const estadoCalendarioAlo = {
  maestro: { mes: new Date().getMonth(), año: new Date().getFullYear(), startISO: null, endISO: null, range: [], diasValidos: [] },
  tinku: { mes: new Date().getMonth(), año: new Date().getFullYear(), startISO: null, endISO: null, range: [], diasValidos: [] },
  aquilina: { mes: new Date().getMonth(), año: new Date().getFullYear(), startISO: null, endISO: null, range: [], diasValidos: [] }

};

const showStepErrorsAlo = { maestro: false };

// Estado global para pasos (por albergue)
const pasoEstadoAlo = {
  maestro:  { current: 1, completed: [] },
  tinku:    { current: 1, completed: [] },
  aquilina: { current: 1, completed: [] }
};

let fechasOcupadasAlo = { maestro: [], tinku: [], aquilina: [] };
let ocupacionActualAlo = { maestro: 0, tinku: 0, aquilina: 0 };
const formSubmissionStateAlo = {
  maestro:  { isSubmitting: false },
  tinku:    { isSubmitting: false },
  aquilina: { isSubmitting: false }
};



function handleFormSubmitAlo(e, albergue) {
  if (e && e.preventDefault) e.preventDefault();
  if (!albergue) albergue = 'maestro';
  if (formSubmissionStateAlo[albergue].isSubmitting) return;

  console.log('[VALIDACIÓN]', albergue, 'pasos actuales', pasoEstadoAlo[albergue]);

  // if (!pasoEstadoAlo[albergue] || pasoEstadoAlo[albergue].completed.length < 4) {
  //   showStepErrorsAlo[albergue] = true;
  //   updateProgresoAlo(albergue);
  //   showSnackbar('Debe completar los 4 PASOS antes de confirmar.', 'error', 4000);
  //   return;
  // }

  formSubmissionStateAlo[albergue].isSubmitting = true;
  submitFormAlo(albergue).finally(() => {
    formSubmissionStateAlo[albergue].isSubmitting = false;
  });
}




// Cerrar al click fuera (igual)
// window.onclick = (function(original) {
//   return function(event) {
//     original.call(this, event);
//     if (event.target.classList.contains('modal') && event.target.id.startsWith('modal-alojamiento-')) {
//       const albergue = event.target.id.split('-')[2];
//       closeAlojamientoModal(albergue);
//     }
//   };
// })(window.onclick || function(){});

document.addEventListener('DOMContentLoaded', function() {
  ['maestro','tinku','aquilina'].forEach(albergue => {
    const form = document.getElementById(`aloForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
          setupPasoListenersAlo(albergue);

      // llama al handler general con albergue dinámico
      handleFormSubmitAlo(e, albergue);
    });
  });

  setupCantidadLimitsAlo();
  setupDelegacionListenerAlo();
  setupCantidadListenerAlo();
});

function closeAlojamientoModal(albergue) {
  const modal = document.getElementById(`modal-alojamiento-${albergue}`);
  if (!modal) return;

  modal.classList.remove('active');
  modal.style.display = 'none';
  document.body.style.overflow = '';

  // Limpiar todo estado residual
  resetRangoAlo(albergue);
  resetFormAlo(albergue);
  fechasOcupadasAlo[albergue] = [];
  console.log(`[CLOSE] Modal ALOJAMIENTO cerrado → ${albergue}`);
}



async function submitFormAlo(albergue) {
  try {
    const formData = getFormDataAlo(albergue);
    if (!formData || formData.range.length === 0 || formData.cantidad <= 0) {
      showSnackbar?.("Complete cantidad, institución y seleccione un rango válido.", "error", 4000);
      return;
    }

    const btn = getSubmitButtonAlo(albergue);
    if (!btn) {
      console.error(`[ERROR] Botón submit no encontrado para ${albergue}`);
      return;
    }

    // 🔒 Evitar clics múltiples
    if (btn.disabled) {
      console.warn(`[BLOCK] Botón submit de ${albergue} ya está en proceso.`);
      return;
    }

    btn.disabled = true;
    setBtnLoading(btn, "Guardando Reserva...");

    console.log(`[ENVÍO] Enviando datos de reserva para ${albergue}:`, formData);

    // 🔹 Llamada al backend/Sheets
    const resultado = await enviarReservaAlojamientoAGoogleSheets(formData);

    if (resultado?.success) {
      console.log(`[ÉXITO] Reserva registrada en ${albergue}: ID ${resultado.idReserva}`);

      setBtnSuccess(btn);
      mostrarConfirmacionAlo?.(albergue, formData, resultado.idReserva);

      showSnackbar?.(
        `✅ PRE-Reserva Realizada\nNro: ${resultado.idReserva}\nPara confirmar comuníquese al (0381) 452-6408.`,
        "success",
        15000
      );

      // 🔄 Limpiar e iniciar cierre
      setTimeout(() => {
        resetFormAlo?.(albergue);
        closeAlojamientoModal?.(albergue);
        resetBtn?.(btn);
        btn.disabled = false;
      }, 1000);
    } else {
      console.error(`[ERROR] Fallo en reserva ${albergue}:`, resultado);
      setBtnError(btn, "Error");
      showSnackbar?.(`Error: ${resultado?.message || "No se pudo registrar la reserva."}`, "error", 4000);
      setTimeout(() => {
        resetBtn?.(btn);
        btn.disabled = false;
      }, 1500);
    }
  } catch (err) {
    console.error(`[EXCEPCIÓN] submitFormAlo(${albergue}):`, err);
    showSnackbar?.(`Error de conexión o sistema: ${err.message || "Desconocido"}`, "error", 4000);

    const btn = getSubmitButtonAlo(albergue);
    if (btn) {
      setBtnError(btn, "Error");
      setTimeout(() => {
        resetBtn?.(btn);
        btn.disabled = false;
      }, 1500);
    }
  }
}


function getFormDataAlo(albergue) {
  if (!estadoCalendarioAlo || !estadoCalendarioAlo[albergue]) {
    console.error(`Estado Alo no definido para ${albergue}`);
    return null;
  }
  const estado = estadoCalendarioAlo[albergue];
  const cantidad = parseInt((document.getElementById(`cantidad-alo-${albergue}`) || {}).value, 10) || 0;
  const delegacionEl = document.getElementById(`delegacion-alo-${albergue}`);
  const delegacion = delegacionEl ? delegacionEl.value : '';
  if (!delegacion) {
    alert('Seleccione tipo de delegación');
    return null;
  }

  return {
    albergue,
    institucion: (document.getElementById(`institucion-alo-${albergue}`) || {}).value.trim() || '',
    responsable: (document.getElementById(`responsable-alo-${albergue}`) || {}).value.trim() || '',
    dni: (document.getElementById(`dni-alo-${albergue}`) || {}).value.trim() || '',
    contacto: (document.getElementById(`contacto-alo-${albergue}`) || {}).value.trim() || '',
    cantidad,
    range: estado.range || []
  };
}

function mostrarConfirmacionAlo(albergue, formData, idReserva) {
  console.log(`Confirmación alojamiento ${albergue}, ID: ${idReserva}, Rango: ${formData.range.join(', ')}`);
  
}


// ---------- mostrarInfoRangoAlo (con loader y retorno de diasValidos) ----------
async function mostrarInfoRangoAlo(albergue, range) {
  if (!Array.isArray(range) || range.length === 0) return [];

  const estado = estadoCalendarioAlo[albergue];
  const cap = capacidades[albergue];
  const cantidad = parseInt(document.getElementById(`cantidad-alo-${albergue}`).value, 10) || 0;

  if (cantidad <= 0) {
    showSnackbar('Ingrese la cantidad de personas antes de seleccionar fechas.', 'error', 4000);
    return [];
  }

  // marcar que estamos verificando
  estado.disponibilidadConfirmada = false;
  estado.diasValidos = [];

  // mostrar loader (blur) del calendario
  showCalendarLoadingAlo(albergue);

  // consultas en paralelo (seguro)
  const resultados = await Promise.all(range.map(async iso => {
    try {
      const resp = await obtenerDisponibilidadDiaAlo(albergue, iso);
      // resp puede venir { disponibles: N } o similar; fallback a 0 si undefined
      const disponibles = (resp && typeof resp.disponibles === 'number') ? resp.disponibles : 0;
      return { iso, disponibles };
    } catch (err) {
      console.warn(`[DISP] Error al pedir ${iso} para ${albergue}:`, err);
      // fallback conservador: 0 disponibles para no falsear el ok
      return { iso, disponibles: 0 };
    }
  }));

  // ocultar loader
  hideCalendarLoadingAlo(albergue);

  // calcular diasValidos y minDisp
  let minDisp = Infinity;
  resultados.forEach(r => {
    if (typeof r.disponibles === 'number' && r.disponibles < minDisp) minDisp = r.disponibles;
    if (r.disponibles >= cantidad) estado.diasValidos.push(r.iso);
  });
  if (!isFinite(minDisp)) minDisp = 0;

  estado.disponibilidadConfirmada = true;

  // actualizar ocupación y UI summary
  updateOcupacionUIAlo?.(albergue, (cap - minDisp) >= 0 ? (cap - minDisp) : 0, cap);
  const span = document.getElementById(`disponibles-alo-${albergue}`);
  if (span) span.textContent = minDisp;

  console.log(`[CHECK] ${albergue} diasValidos=`, estado.diasValidos, 'minDisp=', minDisp);

  return estado.diasValidos;
}

async function handleClickDiaAlo(albergue, iso, celda) {
  if (!iso || typeof iso !== 'string') {
    console.warn('handleClickDiaAlo ignorado: iso inválido', iso);
    return;
  }

  const estado = estadoCalendarioAlo[albergue];
  if (!estado) return;
  const cont = document.getElementById(`calendario-alo-${albergue}`);
  if (!cont) return;

  console.log(`[CLICK] ${albergue} → ISO=${iso}, start=${estado.startISO}, end=${estado.endISO}`);

  // 🔹 PRIMER CLICK → Selecciona inicio
  if (!estado.startISO) {
    estado.startISO = iso;
    estado.endISO = null;
    estado.range = [iso];
    estado.disponibilidadConfirmada = false;
    estado.diasValidos = [];

    cont.querySelectorAll('.inicio-rango, .fin-rango, .en-rango, .azul-seleccion, .verde, .rojo')
      .forEach(el => el.classList.remove('inicio-rango','fin-rango','en-rango','azul-seleccion','verde','rojo'));

    celda.classList.add('inicio-rango', 'en-rango', 'azul-seleccion');
    updateRangeDisplay?.(albergue, estado.range);
    return;
  }

  // 🔹 SEGUNDO CLICK → Define fin y crea rango
  if (!estado.endISO) {
    const [sy, sm, sd] = estado.startISO.split('-').map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const [ey, em, ed] = iso.split('-').map(Number);
    const endDate = new Date(ey, em - 1, ed);

    if (endDate < startDate) {
      // Si clic anterior al start, se reinicia
      estado.startISO = iso;
      estado.endISO = null;
      estado.range = [iso];
      generarCalendarioAlo(albergue);
      return;
    }

    // Generar rango
    const range = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      range.push(d.toISOString().split('T')[0]);
    }

    // 🔍 Validación ANTES de consultar disponibilidad
if (!validarLimiteRangoAlo(albergue, range)) {
  showSnackbar?.(
    `No puede seleccionar tantos dias para su delegación.`,
    'error',
    6000
  );
  return; // detener flujo
}


    estado.endISO = iso;
    estado.range = range;
    estado.disponibilidadConfirmada = false;
    estado.diasValidos = [];

    // 🔵 Pintar rango azul mientras se consulta disponibilidad
    range.forEach(f => {
      const c = cont.querySelector(`[data-date="${f}"]`);
      if (c) c.classList.add('en-rango', 'azul-seleccion');
    });

    updateRangeDisplay?.(albergue, estado.range);

    // ✅ VERIFICAR DISPONIBILIDAD
    try {
      // Muestra loader y espera disponibilidad
      showCalendarLoadingAlo?.(albergue);
      await mostrarInfoRangoAlo(albergue, range);
    } catch (err) {
      console.error('Error en mostrarInfoRangoAlo:', err);
    } finally {
      hideCalendarLoadingAlo?.(albergue);
    }

    // 🔁 Colorear días según disponibilidad
    cont.querySelectorAll('.azul-seleccion').forEach(el => el.classList.remove('azul-seleccion'));
    range.forEach(f => {
      const c = cont.querySelector(`[data-date="${f}"]`);
      if (!c) return;
      if (estado.diasValidos && estado.diasValidos.includes(f)) {
        c.classList.add('verde');
      } else {
        c.classList.add('rojo');
      }
    });

    // ✅ Si todos los días están verdes → avanzar al Paso 4
const todosVerdes = estado.diasValidos && estado.diasValidos.length === range.length;
if (todosVerdes && validarLimiteRangoAlo(albergue, range)) {
  console.log('✅ Todos los días verdes → habilitando paso 4');

  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) grid.classList.add('step-completed');

  // 🔹 Marca paso 3 completado y activa paso 4 (visual + lógica)
  completePasoAlo?.(albergue, 3);
  //enableStepAlo?.(albergue, 4);

 // 🔹 Asegurar estado de pasos lógico
//if (!pasoEstadoAlo[albergue]) pasoEstadoAlo[albergue] = { current: 0, completed: [] };
//pasoEstadoAlo[albergue].current = 4;
//if (!pasoEstadoAlo[albergue].completed.includes(4)) {
//  pasoEstadoAlo[albergue].completed.push(4);
//}



  // 🔹 Habilitar botón de envío
  const btn = document.getElementById(`btn-submit-alo-${albergue}`);
  if (btn) {
    btn.disabled = false;
    btn.classList.remove('disabled');
    btn.classList.add('enabled');
  }

  console.log(`[PASO4] ${albergue} marcado como completado → botón habilitado`);
} else {
  console.log('⚠️ Algunos días no tienen disponibilidad suficiente.');
  showSnackbar?.('El rango seleccionado no tiene disponibilidad completa.', 'error', 6000);
}


 
console.log('[PASOS GUARDADOS]', albergue, pasoEstadoAlo[albergue]);

    return;
  }

  // 🔁 TERCER CLICK → Reinicio
  estado.startISO = null;
  estado.endISO = null;
  estado.range = [];
  estado.diasValidos = [];
  estado.disponibilidadConfirmada = false;
  generarCalendarioAlo(albergue);
}



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

  // Encabezado de días
  CONFIG.diasSemanaCortos.forEach(dia => {
    const head = document.createElement('div');
    head.className = 'dia-header';
    head.textContent = dia;
    contenedor.appendChild(head);
  });

  // Espacios vacíos iniciales
  for (let k = 0; k < primerDiaSemana; k++) {
    contenedor.appendChild(crearDiaElementoAlo('', 'otro-mes'));
  }

  const hoy = new Date(); hoy.setHours(0,0,0,0);

  for (let i = 1; i <= diasEnMes; i++) {
    const fechaActual = new Date(año, mes, i);
    fechaActual.setHours(0,0,0,0);
    const iso = fechaActual.toISOString().split('T')[0];

    const estaOcupado = Array.isArray(fechasOcupadasAlo[albergue]) &&
      fechasOcupadasAlo[albergue].some(f => f.toDateString() === fechaActual.toDateString());

    const esPasado = fechaActual < hoy;
    const clases = [];

    if (estaOcupado) clases.push('ocupado');
    if (esPasado) clases.push('inactiva');

    // Colores según estado actual
    if (estado.range?.includes(iso)) {
      clases.push('en-rango');
      if (estado.startISO === iso) clases.push('inicio-rango');
      if (estado.endISO === iso) clases.push('fin-rango');

      if (estado.disponibilidadConfirmada) {
        if (estado.diasValidos?.includes(iso)) clases.push('verde');
        else clases.push('rojo');
      } else {
        clases.push('azul-seleccion');
      }
    }

    const celda = document.createElement('div');
    celda.className = `dia ${clases.join(' ')}`;
    celda.dataset.date = iso; // 👈 FIX: atributo correcto
    celda.textContent = i;

    // Vincular evento click (solo si válido)
    if (!esPasado && !estaOcupado) {
      celda.onclick = () => handleClickDiaAlo(albergue, iso, celda);
    }

    contenedor.appendChild(celda);
  }

  // Rellenar hasta 42 celdas
  const total = 42 - (primerDiaSemana + diasEnMes);
  for (let i = 0; i < total; i++) {
    contenedor.appendChild(crearDiaElementoAlo('', 'otro-mes'));
  }

  // Título del mes
  const titulo = document.getElementById(`mes-actual-alo-${albergue}`);
  if (titulo) titulo.textContent = `${CONFIG.meses[mes]} ${año}`;
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
  const form = document.getElementById(`aloForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
  if (form) form.reset();
  const qtyEl = document.getElementById(`cantidad-alo-${albergue}`);
  if (qtyEl) { qtyEl.value = ''; qtyEl.disabled = false; qtyEl.classList.remove('disabled'); }

  // reset hidden delegacion
  const hidden = document.getElementById(`delegacion-hidden-alo-${albergue}`);
  if (hidden) hidden.value = '';

  // reset inputs paso 4
  ['institucion','responsable','dni','contacto'].forEach(c => {
    const el = document.getElementById(`${c}-alo-${albergue}`);
    if (el) { el.value = ''; el.disabled = false; el.classList.remove('disabled'); }
  });

  resetRangoAlo(albergue);
}

function setupCantidadListenerAlo() {
  ['maestro','tinku','aquilina'].forEach(albergue => {
    const input = document.getElementById(`cantidad-alo-${albergue}`);
    if (!input) return;
    input.addEventListener('input', () => {
      const cantidad = parseInt(input.value, 10) || 0;
      const estado = estadoCalendarioAlo[albergue];
      if (estado && estado.range && estado.range.length > 0 && cantidad > 0) {
        mostrarInfoRangoAlo(albergue, estado.range);
      }
    });
  });
}



// Helpers para botones (igual)
function getSubmitButtonAlo(albergue) {
  const form = document.getElementById(`aloForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
  return form ? form.querySelector('.btn-submit') : null;
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
        <span class="cuadrado rojo">■</span> <span class="texto-rojo">Rojo:</span> Día SIN camas disponibles.
      </span>
      <span class="leyenda-color">
        <span class="cuadrado verde">■</span> <span class="texto-verde">Verde:</span> Día CON camas disponibles.
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
       Su reserva sera para: ${range.length} días${extra} y ${range.length - 1} ${extra} noches.
       <br>
      <span class="leyenda-color">
        <span class="cuadrado rojo">■</span> <span class="texto-rojo">Rojo:</span> Día SIN camas disponibles.
      </span>
      <br>
      <span class="leyenda-color">
        <span class="cuadrado verde">■</span> <span class="texto-verde">Verde:</span> Día CON camas disponibles.
      </span>
      
    `;
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









function updateProgresoAlo(albergue) {
  // scope: buscar dentro del modal específico para evitar afectar otros modales
  const modal = document.getElementById(`modal-alojamiento-${albergue}`);
  if (!modal) return;

  const steps = modal.querySelectorAll('.step-container');
  steps.forEach((step, index) => {
    const pasoNum = index + 1;
    step.classList.remove('step-completed', 'step-active', 'step-error');
    if (pasoEstadoAlo[albergue].completed.includes(pasoNum)) {
      step.classList.add('step-completed');
    } else if (pasoEstadoAlo[albergue].current === pasoNum) {
      step.classList.add('step-active');
    } else if (showStepErrorsAlo[albergue]) {
      step.classList.add('step-error');
    }
  });

  const indicators = modal.querySelectorAll('.step-indicator');
  indicators.forEach((indicator, index) => {
    const pasoNum = index + 1;
    indicator.classList.remove('completed', 'active', 'error');
    if (pasoEstadoAlo[albergue].completed.includes(pasoNum)) indicator.classList.add('completed');
    else if (pasoEstadoAlo[albergue].current === pasoNum) indicator.classList.add('active');
    else if (showStepErrorsAlo[albergue]) indicator.classList.add('error');
  });

  // Barra de progreso (usa progress-fill dentro del modal)
  const fill = modal.querySelector('.progress-fill');
  if (fill) {
    const progress = (pasoEstadoAlo[albergue].completed.length / 4) * 100;
    fill.style.width = `${progress}%`;
  }
}

function resetAllAlo(albergue) {
  console.log('🔄 Reset all para', albergue);

  // 1) Limpiar inputs y selects
  ['cantidad', 'institucion', 'responsable', 'dni', 'contacto'].forEach(prefix => {
    const el = document.getElementById(`${prefix}-alo-${albergue}`);
    if (el) {
      el.value = '';
      el.disabled = false;
      el.classList.remove('disabled');
    }
  });
  const select = document.getElementById(`delegacion-alo-${albergue}`);
  if (select) { select.value = ''; select.disabled = false; select.classList.remove('disabled'); }
  const hiddenDel = document.getElementById(`delegacion-hidden-alo-${albergue}`);
  if (hiddenDel) hiddenDel.value = '';

  // 2) Reiniciar estado interno del calendario
  estadoCalendarioAlo[albergue] = {
    mes: new Date().getMonth(),
    año: new Date().getFullYear(),
    startISO: null,
    endISO: null,
    range: [],
    diasValidos: [],
    disponibilidadConfirmada: false
  };

  // 3) limpiar ocupación y progreso
  resetOcupacionUIAlo?.(albergue);
  pasoEstadoAlo[albergue] = { current: 1, completed: [] };
  updateProgresoAlo?.(albergue);

  // 4) LIMPIAR clases del calendario y re-habilitar nav
  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) {
    grid.classList.remove('disabled', 'step-completed');
    // remove any selection classes
    grid.querySelectorAll('.seleccionado-inicial, .en-rango, .inicio-rango, .fin-rango, .rojo, .verde, .azul-seleccion')
        .forEach(el => el.classList.remove('seleccionado-inicial','en-rango','inicio-rango','fin-rango','rojo','verde','azul-seleccion'));
  }
  const navPrev = document.getElementById(`nav-prev-alo-${albergue}`);
  const navNext = document.getElementById(`nav-next-alo-${albergue}`);
  if (navPrev) navPrev.disabled = false;
  if (navNext) navNext.disabled = false;

  // 5) Regenerar calendario y reasignar listeners
generarCalendarioAlo(albergue);

const newCalendario = document.getElementById(`calendario-alo-${albergue}`);
if (newCalendario) {
  newCalendario.querySelectorAll('.dia').forEach(dia => {
    // asignar listener SOLO si el día es seleccionable
    if (!dia.classList.contains('inactiva') && !dia.classList.contains('ocupado')) {
      dia.addEventListener('click', () => handleClickDiaAlo(albergue, dia.dataset.iso, dia));
      dia.tabIndex = 0;
      dia.removeAttribute('aria-disabled');
    } else {
      dia.tabIndex = -1;
      dia.setAttribute('aria-disabled','true');
    }
  });
}


  // 6) Asegura que pasos vuelvan al inicio
  disableStepAlo(albergue, 2);
  disableStepAlo(albergue, 3);
  disableStepAlo(albergue, 4);

  

  enableStepAlo(albergue, 1);

  // 7) Reinicia botón submit
  const btnSubmit = document.getElementById(`btn-submit-alo-${albergue}`);
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.classList.add('disabled');
    btnSubmit.classList.remove('enabled');
  }
  

  console.log(`✅ ${albergue.toUpperCase()} reiniciado completamente`);
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

function showCalendarLoadingAlo(albergue) {
  const loader = document.getElementById(`cal-loader-alo-${albergue}`);
  if (!loader) return;
  loader.hidden = false;
  loader.setAttribute('aria-busy', 'true');
  // opcional: add a blur class to calendario container
  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) grid.classList.add('loading');
}



function hideCalendarLoadingAlo(albergue) {
  const loader = document.getElementById(`cal-loader-alo-${albergue}`);
  if (!loader) return;
  loader.hidden = true;
  loader.setAttribute('aria-busy', 'false');
  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) grid.classList.remove('loading');
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

async function enviarReservaAlojamientoAGoogleSheets(formData) {
  
  const url = CONFIG.googleScriptUrlAlo;  

  
  const nombresAlberguesServer = {
    maestro: "Maestro José Fierro",
    tinku: "Tinku Huasi",
    aquilina: "Aquilina Soldati"
  };
  const clave = formData.albergue;
  const nombreParaServer = nombresAlberguesServer[clave] || formData.albergue;

  const params = new URLSearchParams();
  params.append("secret", CONFIG.secretKey);  // Usa CONFIG.secretKey
  params.append("action", "crearReservaAlojamiento");
  params.append("albergue", nombreParaServer);
  params.append("institucion", formData.institucion);
  params.append("responsable", formData.responsable);
  params.append("dni", formData.dni);
  params.append("contacto", formData.contacto);
  params.append("cantidad", formData.cantidad);
  params.append("rangoFechas", formData.range.join(","));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const text = await response.text();
    console.log("Respuesta del servidor Alojamiento:", text);

    const result = JSON.parse(text);
    if (!result.success) {
      console.error("Error del servidor:", result.message);
      showSnackbar(`Error: ${result.message || 'Intente nuevamente'}`, 'error', 5000);
      return result;
    }
    return result;
  } catch (err) {
    console.error("Error en fetch:", err);
    return { success: false, message: "Error de conexión" };
  }
}




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
function setupCantidadLimitsAlo() {
  ['maestro','tinku','aquilina'].forEach(albergue => {
    const input = document.getElementById(`cantidad-alo-${albergue}`);
    if (!input) return;
    input.min = '1';
    input.max = capacidades[albergue];
    input.placeholder = `máx. ${capacidades[albergue]}`;

    input.addEventListener('input', () => {
      let v = input.value.trim();
      if (v === '') return;
      v = parseInt(v, 10);
      if (isNaN(v)) { input.value = ''; return; }
      if (v < 1) v = 1;
      if (v > capacidades[albergue]) v = capacidades[albergue];
      input.value = v;
    });
  });
}
function lockFechaInputsAlo() {
  // No aplica por ahora, pero placeholder para expansión
}

function setupDelegacionListenerAlo() {
  ['maestro','tinku','aquilina'].forEach(albergue => {
    const select = document.getElementById(`delegacion-alo-${albergue}`);
    if (!select) return;
    select.addEventListener('change', () => {
      const hidden = document.getElementById(`delegacion-hidden-alo-${albergue}`);
      if (hidden) hidden.value = select.value;
      const estado = estadoCalendarioAlo[albergue];
      if (estado && estado.range && estado.range.length > 0) {
        validarLimiteRangoAlo(albergue, estado.range);
        mostrarInfoRangoAlo(albergue, estado.range);
      }
      // marca el paso 2 completado si el select fue elegido
      if (select.value && select.value.trim() !== '') {
        completePasoAlo(albergue, 2);
      }
    });
  });
}


// NUEVO: Función helper para validar límite (reutilizable)
function validarLimiteRangoAlo(albergue, range) {
  const select = document.getElementById(`delegacion-alo-${albergue}`);

  const tipo = select.value;
  if (!tipo) return true; // No valida si no elegido
  
  const maxDias = tipo === 'escuelas' ? 4 : 3;
  if (range.length > maxDias) {
    //alert(`Límite excedido para ${tipo === 'escuelas' ? 'Escuelas' : 'Otra Institución'}: hasta ${maxDias} días. El rango se ha reseteado.`);
    resetRangoAlo(albergue);
    return false;
  }
  return true;
}


// ========================== ESTADO DE PASOS ALOJAMIENTO ==========================
const estadoPasosAlo = {
  maestro: { current: 1, completed: [] },
  tinku: { current: 1, completed: [] },
  aquilina: { current: 1, completed: [] }
};


function openAlojamientoModal(albergue) {

  pasoEstadoAlo[albergue] = { current: 1, completed: [] };

  const modal = document.getElementById(`modal-alojamiento-${albergue}`);
  if (!modal) {
    console.error(`[ERROR] No se encontró modal-alojamiento-${albergue}`);
    return;
  }

  console.log(`[OPEN] Modal de ALOJAMIENTO → ${albergue}`);

  // 🔹 Cierra SOLO otros modales de alojamiento
  document.querySelectorAll('[id^="modal-alojamiento-"]').forEach(m => {
    m.classList.remove('active');
    m.style.display = 'none';
  });

  // 🔹 Mostrar modal actual
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
  document.body.style.overflow = 'hidden';

  // 🔄 Reinicializar su estado
  try {
    resetAllAlo(albergue);
    resetRangoAlo(albergue);
    resetFormAlo(albergue);
    resetCalendarAloToToday(albergue);
    resetOcupacionUIAlo(albergue);
    fechasOcupadasAlo[albergue] = [];
    generarCalendarioAlo(albergue);
    initPasoFlujoAlo(albergue);
    setupPasoListenersAlo(albergue);
  } catch (err) {
    console.error(`[ERROR] Al inicializar modal alojamiento ${albergue}:`, err);
  }
}

function closeAlojamientoModal(albergue) {
  const modal = document.getElementById(`modal-alojamiento-${albergue}`);
  if (!modal) return;

  console.log(`[CLOSE] Modal ALOJAMIENTO cerrado → ${albergue}`);

  // 🔹 Transición suave y limpieza final
  modal.classList.remove('active');
  setTimeout(() => {
    modal.style.display = 'none';
    document.body.style.overflow = '';

    // Reset limpio (opcional)
    try {
      resetAllAlo(albergue);
      fechasOcupadasAlo[albergue] = [];
    } catch (err) {
      console.warn(`[WARN] Error limpiando modal ${albergue}:`, err);
    }
  }, 200); // coincide con la animación CSS
}




// Inicializa los pasos al abrir el modal

function initPasoFlujoAlo(albergue) {
  pasoEstadoAlo[albergue] = { current: 1, completed: [] };
  showStepErrorsAlo[albergue] = false;
  updateProgresoAlo(albergue);

  // Al abrir: solo Paso 1 habilitado
  // Limpia pasos visuales (círculos y recuadros)
for (let n = 1; n <= 4; n++) {
  const c = document.getElementById(`step-${n}-${albergue}`);
  const b = document.getElementById(`paso-box-${n}-${albergue}`);

  if (c) c.classList.remove("completed");
  if (b) {
    b.classList.remove("completed");
    b.classList.remove("enabled");
  }
}
  enableStepAlo(albergue, 1);
  disableStepAlo(albergue, 2);
  disableStepAlo(albergue, 3);
  disableStepAlo(albergue, 4);

  // Asegura que el botón Submit del albergue esté deshabilitado al abrir
  const btnSubmit = document.getElementById(`btn-submit-alo-${albergue}`);
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.classList.add('disabled');
    btnSubmit.classList.remove('enabled');
  }
}



function completePasoAlo(albergue, pasoNum) {

  // Asegura estado
  if (!pasoEstadoAlo[albergue]) 
      pasoEstadoAlo[albergue] = { current: 1, completed: [] };

  // Guardar paso como completado
  if (!pasoEstadoAlo[albergue].completed.includes(pasoNum)) {
      pasoEstadoAlo[albergue].completed.push(pasoNum);
  }

  // Marcar círculo y recuadro en verde
  const circle = document.getElementById(`step-${pasoNum}-${albergue}`);
  if (circle) circle.classList.add("completed");

  const box = document.getElementById(`paso-box-${pasoNum}-${albergue}`);
  if (box) box.classList.add("completed");


  // 🚫 DESHABILITAR todos los pasos SIEMPRE antes de habilitar el que corresponde
  disableStepAlo(albergue, 1);
  disableStepAlo(albergue, 2);
  disableStepAlo(albergue, 3);
  disableStepAlo(albergue, 4);

  // 🔥 LOGICA DE FLUJO — SOLO UN PASO HABILITADO A LA VEZ
  switch (pasoNum) {

      case 1:
          // Habilitar SOLO paso 2
          enableStepAlo(albergue, 2);
          pasoEstadoAlo[albergue].current = 2;
          break;

      case 2:
          // Habilitar SOLO paso 3
          enableStepAlo(albergue, 3);
          pasoEstadoAlo[albergue].current = 3;
          break;

      case 3:
          // Requiere validar días verdes
          if (!todasFechasVerdes(albergue)) {
              console.warn(`Paso 3 incompleto en ${albergue}: días no verdes`);
              // Mantener paso 3 activo
              enableStepAlo(albergue, 3);
              break;
          }
          // Todo OK → habilitar solo paso 4
          enableStepAlo(albergue, 4);
          pasoEstadoAlo[albergue].current = 4;
          break;

      case 4:
          // Habilitar botón submit (solo visual)
          const btn = document.getElementById(`btn-submit-alo-${albergue}`);
          if (btn) {
              btn.disabled = false;
              btn.classList.remove('disabled');
              btn.classList.add('enabled');
          }
          break;
  }

  updateProgresoAlo(albergue);
}
function disableStepAlo(albergue, pasoNum) {

  const box = document.getElementById(`paso-box-${pasoNum}-${albergue}`);
  if (box) {
    box.classList.remove("enabled");
    box.classList.remove("completed");
    box.classList.add("disabled-step");   // 🔥 clase visual para grisado
  }

  const circle = document.getElementById(`step-${pasoNum}-${albergue}`);
  if (circle) circle.classList.remove("completed");

  switch (pasoNum) {

    case 1:
      const c = document.getElementById(`cantidad-alo-${albergue}`);
      if (c) c.disabled = true;
      break;

    case 2:
      const d = document.getElementById(`delegacion-alo-${albergue}`);
      if (d) d.disabled = true;
      break;

    case 3:
      const grid = document.getElementById(`calendario-alo-${albergue}`);
      const prev = document.getElementById(`nav-prev-alo-${albergue}`);
      const next = document.getElementById(`nav-next-alo-${albergue}`);

      if (grid) grid.classList.add("disabled");
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      break;

    case 4:
      ["institucion","responsable","dni","contacto"].forEach(campo => {
        const el = document.getElementById(`${campo}-alo-${albergue}`);
        if (el) el.disabled = true;
      });
      break;
  }
}
function enableStepAlo(albergue, pasoNum) {

  const box = document.getElementById(`paso-box-${pasoNum}-${albergue}`);
  if (box) {
    box.classList.add("enabled");
    box.classList.remove("disabled-step");
  }

  switch (pasoNum) {

    case 1:
      const c = document.getElementById(`cantidad-alo-${albergue}`);
      if (c) c.disabled = false;
      break;

    case 2:
      const d = document.getElementById(`delegacion-alo-${albergue}`);
      if (d) d.disabled = false;
      break;

    case 3:
      const grid = document.getElementById(`calendario-alo-${albergue}`);
      const prev = document.getElementById(`nav-prev-alo-${albergue}`);
      const next = document.getElementById(`nav-next-alo-${albergue}`);

      if (grid) grid.classList.remove("disabled");
      if (prev) prev.disabled = false;
      if (next) next.disabled = false;
      break;

    case 4:
      ["institucion","responsable","dni","contacto"].forEach(campo => {
        const el = document.getElementById(`${campo}-alo-${albergue}`);
        if (el) el.disabled = false;
      });
      break;
  }
}



function todasFechasVerdes(albergue) {
  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (!grid) return false;

  const diasEnRango = grid.querySelectorAll('.en-rango');
  if (diasEnRango.length === 0) return false;

  return Array.from(diasEnRango).every(d => d.classList.contains('verde'));
}

function setupPasoListenersAlo(albergue) {
  // Paso 1: cantidad
  const cantidadEl = document.getElementById(`cantidad-alo-${albergue}`);
  if (cantidadEl) {
    // use 'input' o 'blur' según UX (yo mantengo blur para que confirme)
    cantidadEl.addEventListener('blur', () => {
      const v = parseInt(cantidadEl.value, 10);
      if (Number.isFinite(v) && v > 0) {
        cantidadEl.disabled = true;
        cantidadEl.classList.add('disabled');
        completePasoAlo(albergue, 1);
      }
    });
  }

  // Paso 2: delegación (dinámico)
  const delEl = document.getElementById(`delegacion-alo-${albergue}`);
  if (delEl) {
    delEl.addEventListener('change', () => {
      if (delEl.value && delEl.value.trim() !== '') {
        delEl.disabled = true;
        delEl.classList.add('disabled');
        // sincroniza hidden
        const hidden = document.getElementById(`delegacion-hidden-alo-${albergue}`);
        if (hidden) hidden.value = delEl.value;
        completePasoAlo(albergue, 2);
      }
    });
  }

  // Paso 3: evento custom que indica que el rango fue confirmado
  // (ya en tu código se dispara 'rangoAloConfirmado' en otros lugares; se usa aquí)
  document.addEventListener('rangoAloConfirmado', (ev) => {
    const a = (ev && ev.detail && ev.detail.albergue) || albergue;
    if (a === albergue) {
      // si todas las fechas son verdes, completePasoAlo hará el resto
      completePasoAlo(albergue, 3);
    }
  });

  

  // Paso 4: form submit
const form = document.getElementById(`aloForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Validar campos obligatorios del paso 4
    const inst = document.getElementById(`institucion-alo-${albergue}`)?.value.trim();
    const resp = document.getElementById(`responsable-alo-${albergue}`)?.value.trim();
    const dni  = document.getElementById(`dni-alo-${albergue}`)?.value.trim();
    const cont = document.getElementById(`contacto-alo-${albergue}`)?.value.trim();

    if (inst && resp && dni && cont) {
      // 🔥 AQUÍ MARCAMOS EL PASO 4 COMO COMPLETO
      completePasoAlo(albergue, 4);
    }

    // Ejecuta tu lógica original
    if (typeof handleFormSubmitAlo === 'function') {
      handleFormSubmitAlo(e, albergue);
    } else {
      resetAllAlo(albergue);
      closeAlojamientoModal(albergue);
    }
  });
}

}


function habilitarBotonReservaAlo(albergue) {
  const btn = document.getElementById(`btn-submit-alo-${albergue}`);
  if (!btn) {
    console.warn(`No se encontró btn-submit-alo-${albergue}`);
    return;
  }
  btn.disabled = false;
  btn.removeAttribute('disabled');
  btn.classList.remove('disabled');
  btn.classList.add('enabled');
  btn.style.opacity = '1';
  btn.style.pointerEvents = 'auto';
  console.log(`✅ Botón de reserva habilitado para ${albergue}`);
}

// === TELÉFONO ALOJAMIENTO: Prefijo 3-4 + Número 6-7 = Total 9 o 10 ===
document.querySelectorAll('[id^="modal-alojamiento-"]').forEach(modal => {
  const albergue = modal.id.replace('modal-alojamiento-', '');
  
  const prefijoInput = document.getElementById(`prefijo-alo-${albergue}`);
  const numeroInput = document.getElementById(`numero-alo-${albergue}`);
  const hiddenInput = document.getElementById(`contacto-alo-${albergue}`);

  if (!prefijoInput || !numeroInput || !hiddenInput) return;

  const updateHidden = () => {
    // Limpiar: solo números
    const prefijo = prefijoInput.value.replace(/\D/g, '').slice(0, 4);
    const numero = numeroInput.value.replace(/\D/g, '').slice(0, 7);

    // Actualizar visualmente
    prefijoInput.value = prefijo;
    numeroInput.value = numero;

    // Validar longitudes
    const prefijoOk = prefijo.length === 3 || prefijo.length === 4;
    const numeroOk = numero.length === 6 || numero.length === 7;
    const total = prefijo + numero;
    const totalOk = total.length === 9 || total.length === 10;

    if (prefijoOk && numeroOk && totalOk) {
      hiddenInput.value = total;
    } else {
      hiddenInput.value = '';
    }
  };

  prefijoInput.addEventListener('input', updateHidden);
  numeroInput.addEventListener('input', updateHidden);

  // Validación al enviar
  const form = document.getElementById(`aloForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
  if (form) {
    form.addEventListener('submit', (e) => {
      updateHidden();
      const total = hiddenInput.value;

      if (!/^\d{9,10}$/.test(total)) {
        e.preventDefault();
        alert('Error en el contacto:\n\n• Prefijo: 3 o 4 dígitos\n• Número: 6 o 7 dígitos\n• Total: debe ser 9 o 10 dígitos\n\nEjemplos válidos:\n3815600700 (9)\n3811500600 (10)\n3815006000 (10)\n38115006000 (11 → no)\n\nCombinaciones válidas:\n3+6=9 | 4+6=10 | 3+7=10');
        return;
      }

      // Extraer partes según total
      const is10Digits = total.length === 10;
      const numeroLength = is10Digits ? (total.slice(0, 4).length === 4 ? 6 : 7) : 6;
      const numero = total.slice(-numeroLength);
      const prefijo = total.slice(0, total.length - numeroLength);

      if (!/^\d{3,4}$/.test(prefijo) || !/^\d{6,7}$/.test(numero)) {
        e.preventDefault();
        alert('Formato inválido. Verifica:\n• Prefijo: 3 o 4 dígitos\n• Número: 6 o 7 dígitos');
      }
    });
  }
});