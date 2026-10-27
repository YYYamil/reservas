// =====================================================================
//  Landing dinámico de albergues
//  Las tarjetas, modales y calendarios se generan desde la API
//  (acción pública listarAlbergues). Cada albergue usa su clave (clave)
//  como identificador en el DOM; reservas y disponibilidad se envían a
//  api/index.php (PostgreSQL). Albergues con habilitado=false no se
//  muestran en el landing.
// =====================================================================

const anio = new Date().getFullYear();
const today = new Date();
const minTotalMonths = today.getFullYear() * 12 + today.getMonth();
// Meses seleccionables totales (incluye el actual). Lo gobierna la
// configuración 'meses_anticipacion' del panel de administración.
let maxTotalMonths = minTotalMonths + 2; // por defecto 3 meses: actual + 2

document.getElementById('anioActual').textContent = anio;

// Configuración global
const CONFIG = {
  googleScriptUrl: 'api/index.php',
  googleScriptUrlAlo: 'api/index.php',

  meses: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  diasSemana: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  diasSemanaCortos: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
};

// =====================================================================
//  Datos de albergues (se cargan desde listarAlbergues)
// =====================================================================
let ALBERGUES = [];
let ALBERGUE_KEYS = [];
const capacidades = {};
const capacidadesVisitas = {};

// Estado por albergue (se inicializa al cargar los datos)
const estadoCalendario = {};     // visita: { mes, año, selectedISO }
const estadoCalendarioAlo = {};  // alojamiento: { mes, año, startISO, endISO, range, diasValidos, disponibilidadConfirmada }
const pasoEstadoAlo = {};
const showStepErrorsAlo = {};
const formSubmissionState = {};
const formSubmissionStateAlo = {};
let fechasOcupadas = {};
let fechasOcupadasAlo = {};
let ocupacionActual = {};
let ocupacionActualAlo = {};

function claveMayuscula(clave) {
  return clave.charAt(0).toUpperCase() + clave.slice(1);
}

function alberguePorClave(clave) {
  return ALBERGUES.find(a => a.clave === clave) || null;
}

function toFullName(clave) {
  const a = alberguePorClave(clave);
  return a ? a.nombre : clave;
}

function setAlbergues(lista) {
  ALBERGUES = Array.isArray(lista) ? lista : [];
  ALBERGUE_KEYS = ALBERGUES.map(a => a.clave);

  ALBERGUES.forEach(a => {
    const cap = Number(a.capacidad) || 0;
    capacidades[a.clave] = cap;
    capacidadesVisitas[a.clave] = Number(a.capacidad_visitas) || 0;

    const now = new Date();
    const hm = now.getMonth();
    const hy = now.getFullYear();

    estadoCalendario[a.clave] = { mes: hm, año: hy, selectedISO: null };
    estadoCalendarioAlo[a.clave] = {
      mes: hm,
      año: hy,
      startISO: null,
      endISO: null,
      range: [],
      diasValidos: [],
      disponibilidadConfirmada: false
    };
    pasoEstadoAlo[a.clave] = { current: 1, completed: [] };
    showStepErrorsAlo[a.clave] = false;
    formSubmissionState[a.clave] = { isSubmitting: false };
    formSubmissionStateAlo[a.clave] = { isSubmitting: false };
    fechasOcupadas[a.clave] = [];
    fechasOcupadasAlo[a.clave] = [];
    ocupacionActual[a.clave] = 0;
    ocupacionActualAlo[a.clave] = 0;
  });
}

// =====================================================================
//  Helpers de montos
// =====================================================================
const MONTO_VISITA_DEFAULT = 2000;
const MONTO_CAMA_DEFAULT = 5000;

function formatoMoneda(n) {
  const v = Number(n);
  if (!isFinite(v)) return '$0';
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function montoVisitaDe(a) {
  if (!a) return MONTO_VISITA_DEFAULT;
  const v = Number(a.monto_visita);
  return isFinite(v) && v >= 0 ? v : MONTO_VISITA_DEFAULT;
}

function montoCamaDe(a) {
  if (!a) return MONTO_CAMA_DEFAULT;
  const v = Number(a.monto_cama);
  return isFinite(v) && v >= 0 ? v : MONTO_CAMA_DEFAULT;
}

// =====================================================================
//  Helpers de renderizado
// =====================================================================
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function iconoClass(icono) {
  const s = String(icono || '').trim();
  if (s === '') return '';
  if (/^(fas|far|fab|fa-solid|fa-regular|fa-brands)\s/.test(s)) return s;
  return 'fas ' + s;
}

function shadeColor(hex, factor) {
  let c = String(hex || '').replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(c)) return hex;
  let r = parseInt(c.slice(0, 2), 16);
  let g = parseInt(c.slice(2, 4), 16);
  let b = parseInt(c.slice(4, 6), 16);
  if (factor > 0) {
    r = Math.round(r + (255 - r) * factor);
    g = Math.round(g + (255 - g) * factor);
    b = Math.round(b + (255 - b) * factor);
  } else {
    const f = 1 + factor;
    r = Math.round(r * f);
    g = Math.round(g * f);
    b = Math.round(b * f);
  }
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Devuelve las clases/estilos de acento para un albergue.
//  - maestro: estilo por defecto (azul del sitio, sin inline).
//  - tinku/aquilina: clases de tema existentes en styles.css (fidelidad total).
//  - cualquier otro: variable CSS --acc derivada del campo `color` de la BD.
function accentInfo(a) {
  if (a.clave === 'tinku' || a.clave === 'aquilina') {
    return { cls: a.clave, dyn: '', inline: '' };
  }
  if (a.clave === 'maestro') {
    return { cls: '', dyn: '', inline: '' };
  }
  const c = String(a.color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    return {
      cls: '',
      dyn: 'dyn',
      inline: `style="--acc:${c};--acc-dark:${shadeColor(c, -0.25)};--acc-light:${shadeColor(c, 0.85)}"`
    };
  }
  return { cls: '', dyn: 'dyn', inline: 'style="--acc:#005ca2;--acc-dark:#004a8c;--acc-light:#d6ecfa"' };
}

function htmlSlides(imagenes, acc) {
  const imgs = Array.isArray(imagenes) && imagenes.length ? imagenes : [''];
  return imgs.map(src => {
    if (src === '') return '<li class="glide__slide"></li>';
    return `<li class="glide__slide"><img src="${esc(src)}" alt="..."></li>`;
  }).join('');
}

function htmlPdfFeature(a, acc) {
  if (!a.pdf) return '';
  return `
    <div class="feature-item">
      <div class="feature-icon ${acc.cls}">
        <i class="fa-solid fa-file-pdf"></i>
      </div>
      <a href="${esc(a.pdf)}" target="_blank" rel="noopener noreferrer">Más información…</a>
    </div>`;
}

function mapaEmbedUrl(mapa) {
  if (!mapa) return '';
  const m = String(mapa).trim();
  const at = m.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
  if (at) {
    const zoom = at[3] || 15;
    return `https://maps.google.com/maps?q=${at[1]},${at[2]}&z=${zoom}&output=embed`;
  }
  const qll = m.match(/(?:[?&](?:q|ll))=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (qll) {
    return `https://maps.google.com/maps?q=${qll[1]},${qll[2]}&output=embed`;
  }
  if (/google\.(?:com|[a-z]{2})\/maps\/embed/.test(m) || m.includes('output=embed')) {
    return m;
  }
  if (/^https?:\/\/maps\.app\.goo\.gl\//i.test(m)) {
    return m;
  }
  return m;
}

function htmlMapa(a) {
  if (!a.mapa) return '';
  return `
    <div class="map-container">
      <iframe src="${esc(mapaEmbedUrl(a.mapa))}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>
    <a class="map-link" href="${esc(a.mapa)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-location-dot"></i> Abrir en Google Maps</a>`;
}

function htmlTarjeta(a) {
  const acc = accentInfo(a);
  const features = (Array.isArray(a.caracteristicas) ? a.caracteristicas : [])
    .map(f => `
        <div class="feature-item">
          <div class="feature-icon ${acc.cls}">
            <i class="${iconoClass(f.icono)}"></i>
          </div>
          <span>${esc(f.texto)}</span>
        </div>`)
    .join('');

  return `
           <div class="albergue-card ${[acc.cls, acc.dyn].filter(Boolean).join(' ')}" ${acc.inline}>

                <div class="card-image">
                    <div class="glide">
                        <div class="glide__track" data-glide-el="track">
                          <ul class="glide__slides">
                            ${htmlSlides(a.imagenes, acc)}
                          </ul>
                        </div>
                        <div class="glide__arrows" data-glide-el="controls">
                          <button class="glide__arrow glide__arrow--left" data-glide-dir="&lt;">&#139;</button>
                          <button class="glide__arrow glide__arrow--right" data-glide-dir="&gt;">&#155;</button>
                        </div>
                      </div>
                </div>

                <div class="card-header">
                    <div class="albergue-header">
                        <h3 class="albergue-title">${esc(a.nombre)}</h3>
                        <div class="capacity ${acc.cls}">
                            <i class="fas fa-users"></i>
                            ${a.capacidad} personas
                        </div>
                    </div>
                    ${a.descripcion ? `<p class="albergue-description">${esc(a.descripcion)}</p>` : ''}
                </div>
                <div class="card-body">
                    <div class="features">
                        ${features}
                        ${htmlPdfFeature(a, acc)}
                    </div>
                    <button class="btn-reservar ${acc.cls}" onclick="openModal('${a.clave}')">Reservar Visita</button>

                    <button class="btn-alo ${acc.cls}" onclick="openAlojamientoModal('${a.clave}')">Reservar Alojamiento</button>

                    ${htmlMapa(a)}
                </div>
            </div>`;
}

function htmlModalVisita(a) {
  const acc = accentInfo(a);
  const k = a.clave;
  const cap = claveMayuscula(k);

  return `
<!-- VISITA Modal -->
<div id="modal-${k}" class="modal modal-visita ${acc.dyn}" ${acc.inline}>
  <div class="modal-content">
    <div class="modal-header ${acc.cls}">
      <h3 class="modal-title">Reserva - Albergue ${esc(a.nombre)}</h3>
      <button class="close-modal" onclick="closeModal('${k}')">&times;</button>
    </div>
    <div class="modal-body">
      <div class="disponibilidad-section">
        <div class="disponibilidad-title">
          <i class="fas fa-chart-bar"></i>
          Seleccione el dia para realizar su visita:
        </div>

        <div class="ocupacion-container">
          <div class="ocupacion-bar">
            <div class="ocupacion-fill" id="ocupacion-fill-${k}" style="width: 0%;"></div>
          </div>
          <div class="ocupacion-info ${acc.cls}" id="ocupacion-info-${k}">—</div>
        </div>

        <div class="disponibilidad" style="display: flex; align-items: center; gap: 10px;">
    <i class="fas fa-users"></i>
    <span style="color: #005ca2; font-weight: bold;">
        Espacio disponible para: <span id="disponibles-${k}"> — </span> personas.
    </span>
</div>

        <div class="calendario-container">
          <div class="calendario-header">
            <button class="nav-mes" onclick="cambiarMes('${k}', -1)"><i class="fas fa-chevron-left"></i></button>
            <div class="mes-title" id="mes-actual-${k}"></div>
            <button class="nav-mes" onclick="cambiarMes('${k}', 1)"><i class="fas fa-chevron-right"></i></button>
          </div>
          <div class="calendario-grid" id="calendario-${k}">
            <!-- Calendario generado dinámicamente -->
          </div>

          <div class="cal-loader" id="cal-loader-${k}" aria-live="polite" aria-busy="false" hidden>
            <div class="spinner" role="status" aria-label="Cargando disponibilidad"></div>
          </div>

        </div>
      </div>
      <!-- Formulario de reserva -->
      <form id="reservaForm${cap}">
        <div class="form-grid">

          <div class="form-group full-width">
            <label for="institucion-${k}">Institución/Delegación</label>
            <input type="text" id="institucion-${k}" class="form-control" required>
          </div>

          <div class="form-group">
            <label for="responsable-${k}">Nombre Completo del Responsable</label>
            <input type="text" id="responsable-${k}" class="form-control" required>
          </div>

          <div class="form-group">
            <label for="dni-${k}">DNI (solo números)</label>
            <input type="text" id="dni-${k}" class="form-control" required pattern="\\d{8}" placeholder="Ej: 30300600">
          </div>

          <div class="form-group">
            <label>Celular (cod. area sin 0 y nro. sin 15)</label>
            <div class="phone-input-group">
              <span class="phone-prefix">0</span>
          <input type="text" id="prefijo-visita-${k}"
                class="form-control phone-part prefijo"
                maxlength="4" placeholder="381">
              <span class="phone-prefix">15</span>
          <input type="text" id="numero-visita-${k}"
                class="form-control phone-part numero"
                maxlength="7" placeholder="500600">
              <input type="hidden" id="contacto-${k}">
            </div>
          </div>

          <div class="form-group">
            <label for="email-${k}">Correo electrónico</label>
            <input type="email" id="email-${k}" class="form-control" required placeholder="Ej: nombre@correo.com">
          </div>

          <div class="form-group">
            <label for="cantidad-${k}">Cantidad de Personas</label>
            <input type="number" id="cantidad-${k}" class="form-control" min="1" required>
          </div>

          <div class="form-group full-width monto-resumen" id="monto-box-${k}">
            <div class="monto-linea">
              <span class="monto-etiqueta"><i class="fas fa-tag"></i> Monto por persona:</span>
              <span class="monto-valor" id="monto-unitario-${k}">${formatoMoneda(montoVisitaDe(a))}</span>
            </div>
            <div class="monto-linea monto-linea-total">
              <span class="monto-etiqueta"><i class="fas fa-calculator"></i> Monto total:</span>
              <span class="monto-valor monto-total" id="monto-total-${k}">—</span>
            </div>
            <p class="monto-ayuda" id="monto-ayuda-${k}">El monto total se calcula según la cantidad de personas indicada.</p>
          </div>

          <div style="display: none;">
            <input type="hidden" id="fechaIngreso-${k}" required>
          </div>

          <div class="form-group">
            <label for="horaIngreso-${k}">Hora de Ingreso</label>
            <select id="horaIngreso-${k}" class="form-control hour-select" required></select>
          </div>

<div class="form-group">
  <label for="horaEgreso-${k}">Hora de Egreso</label>
  <select id="horaEgreso-${k}" class="form-control hour-select" required></select>
</div>

<div class="form-group full-width terms-group">

  <div class="terms-box">

    <label class="terms-check">
      <input
        type="checkbox"
        id="acepta-terminos-${k}"
        name="acepta-terminos-${k}"
        required>

      <span>
        He leído y acepto
        <a href="reglamento.html"
           target="_blank"
           rel="noopener noreferrer">
          el Uso y Reglamento
        </a>
        del albergue.
      </span>
    </label>

    <p class="terms-description">
      Al marcar esta casilla, usted declara haber leído,
      comprendido y aceptado las condiciones establecidas en el uso y reglamento de cada albergue.
      El correo electrónico ingresado se utilizará para enviarle las notificaciones de su reserva.
    </p>

  </div>

</div>

        </div>

        <button type="submit" class="btn-submit ${acc.cls}" id="btn-submit-${k}">
          <span class="btn-icon" aria-hidden="true"></span>
          <span class="btn-label">Confirmar Reserva</span>
        </button>

      </form>

    </div>
  </div>
</div>`;
}

function htmlModalAlojamiento(a) {
  const acc = accentInfo(a);
  const k = a.clave;
  const cap = claveMayuscula(k);
  const maxCap = a.capacidad;

  return `
<!-- NUEVO Modal para Reserva Alojamiento -->
<div id="modal-alojamiento-${k}" class="modal modal-alojamiento ${acc.dyn}" ${acc.inline}>
    <div class="modal-content">
        <div class="modal-header">
            <h3 class="modal-title">Reserva Alojamiento - Albergue ${esc(a.nombre)}</h3>
            <button class="close-modal" onclick="closeAlojamientoModal('${k}')">&times;</button>
        </div>

        <div class="modal-body">

            <!-- Indicador de Progreso -->
            <div class="progress-steps">
              <label for="cantidad-alo-${k}">
                  <i class="fas fa-tasks"></i>  Complete los siguientes pasos:
              </label>
                <div class="step-indicator" id="step-1-${k}"><span>1</span></div>
                <div class="step-indicator" id="step-2-${k}"><span>2</span></div>
                <div class="step-indicator" id="step-3-${k}"><span>3</span></div>
                <div class="step-indicator" id="step-4-${k}"><span>4</span></div>
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill-${k}" style="width: 0%;"></div>
                </div>
            </div>

            <!-- Paso 1: Cantidad -->
              <div class="step-container paso-box" id="paso-box-1-${k}">

                <div class="form-row form-row-alo-p1">
                    <label for="cantidad-alo-${k}">
                        <i class="fas fa-bed"></i>
                        1. Cantidad de camas a reservar:
                    </label>
                    <input type="number" id="cantidad-alo-${k}" name="cantidad" min="1" max="${maxCap}" required placeholder="máx. ${maxCap}" class="form-control">
                </div>

                <div class="monto-resumen" id="monto-box-alo-${k}">
                    <div class="monto-linea">
                        <span class="monto-etiqueta"><i class="fas fa-tag"></i> Monto por cama / noche:</span>
                        <span class="monto-valor" id="monto-unitario-alo-${k}">${formatoMoneda(montoCamaDe(a))}</span>
                    </div>
                    <div class="monto-linea monto-linea-total">
                        <span class="monto-etiqueta"><i class="fas fa-calculator"></i> Monto total:</span>
                        <span class="monto-valor monto-total" id="monto-total-alo-${k}">—</span>
                    </div>
                    <p class="monto-ayuda" id="monto-ayuda-alo-${k}">El monto total se calcula como camas × noches × monto por cama.</p>
                </div>
            </div>

            <!-- Paso 2: Tipo de Delegación -->
              <div class="step-container paso-box" id="paso-box-2-${k}">

                <div class="form-row form-row-alo-p2">
                    <label for="delegacion-alo-${k}">
                        <i class="fas fa-users"></i>
                        2. Tipo de Delegación:
                    </label>
                    <select id="delegacion-alo-${k}" name="delegacion" required class="form-control">
                        <option value="">Seleccione tipo</option>
                        <option value="escuelas">Escuelas (hasta 4 días)</option>
                        <option value="otra">Otra Institución (hasta 3 días)</option>
                    </select>
                </div>
            </div>

  <div class="step-container paso-box" id="paso-box-3-${k}">

      <div class="form-row">
      <label for="delegacion-alo-${k}">
                <i class="fa-solid fa-calendar-days"></i>
                        3. Seleccione fecha de entrada y fecha de salida:
        </label>

          </div>

            <!-- Calendario header -->
<div class="calendario-header">
    <button class="nav-mes" id="nav-prev-alo-${k}" onclick="cambiarMesAlo('${k}', -1)"><i class="fas fa-chevron-left"></i></button>
    <span id="mes-actual-alo-${k}"></span>
    <button class="nav-mes" id="nav-next-alo-${k}" onclick="cambiarMesAlo('${k}', 1)"><i class="fas fa-chevron-right"></i></button>
</div>

<div id="cal-loader-alo-${k}" class="cal-loader" hidden aria-busy="false">
    <div class="spinner" role="status" aria-label="Cargando disponibilidad"></div>
    <span id="loader-text-alo-${k}" class="loader-text">Buscando...</span>
</div>

<div id="calendario-alo-${k}" class="calendario-grid"></div>

            <div class="monto-resumen monto-resumen-alo-p3" id="monto-box-alo-p3-${k}">
                <div class="monto-linea">
                    <span class="monto-etiqueta"><i class="fas fa-tag"></i> Monto por cama / noche:</span>
                    <span class="monto-valor" id="monto-unitario-alo-p3-${k}">${formatoMoneda(montoCamaDe(a))}</span>
                </div>
                <div class="monto-linea monto-linea-total">
                    <span class="monto-etiqueta"><i class="fas fa-calculator"></i> Monto total:</span>
                    <span class="monto-valor monto-total" id="monto-total-alo-p3-${k}">—</span>
                </div>
                <p class="monto-ayuda" id="monto-ayuda-alo-p3-${k}">Seleccione el rango de fechas para ver el monto total.</p>
            </div>

            <div class="fecha-range-info step-3" id="fecha-range-display-alo-${k}">
                <span class="leyenda-color">
                    <span class="cuadrado rojo">■</span> <span class="texto-rojo">Rojo:</span> Día sin camas disponibles para la cantidad solicitada.
                </span>
                <span class="leyenda-color">
                    <span class="cuadrado verde">■</span> <span class="texto-verde">Verde:</span> Camas libres del día.
                </span>
                <span class="leyenda-color">
                </span>
            </div>

<div class="horarios-resaltados">

<i class="fa-solid fa-clock"></i>
  <span>Recuerde los horarios: </span>

        <span>Ingreso a 09:00 hs</span>
        <i class="fas fa-sign-out-alt"></i>
        <span>Salida a 18:00 hs</span>
      </div>
</div>

            <!-- Paso 4: Datos Adicionales -->
              <div class="step-container paso-box" id="paso-box-4-${k}">

                <form id="aloForm${cap}">
                    <input type="hidden" id="delegacion-hidden-alo-${k}" name="delegacion" value="">
                    <div class="form-group">
                        <label for="institucion-alo-${k}">4. Nombre de Institución/Delegación</label>
                        <input type="text" id="institucion-alo-${k}" class="form-control" required>
                    </div>
                    <div class="form-group">
                        <label for="responsable-alo-${k}">Nombre completo del responsable</label>
                        <input type="text" id="responsable-alo-${k}" class="form-control" required>
                    </div>
                    <div class="form-group">
                        <label for="dni-alo-${k}">DNI (Solo números)</label>
                        <input type="tel" id="dni-alo-${k}" class="form-control" required>
                    </div>

                    <div class="form-group">
                      <label>Celular (cod. area sin 0 y nro. sin 15)</label>
                      <div class="phone-input-group">
                        <span class="phone-prefix">0</span>
                        <input type="text" id="prefijo-alo-${k}" class="form-control phone-part prefijo" maxlength="4" placeholder="381" required pattern="\\d{3,4}">
                        <span class="phone-prefix">15</span>
                        <input type="text" id="numero-alo-${k}" class="form-control phone-part numero" maxlength="7" placeholder="500600" required pattern="\\d{6,7}">
                        <input type="hidden" id="contacto-alo-${k}">
                      </div>
                    </div>

                    <div class="form-group">
                      <label for="email-alo-${k}">Correo electrónico</label>
                      <input type="email" id="email-alo-${k}" class="form-control" required placeholder="Ej: nombre@correo.com">
                    </div>

                    <!-- Aceptación de Uso y Reglamento -->
                    <div class="form-group full-width terms-group">

                      <div class="terms-box">

                        <label class="terms-check">
                          <input
                            type="checkbox"
                            id="acepta-terminos-alo-${k}"
                            name="acepta-terminos-alo-${k}"
                            required>

                          <span>
                            He leído y acepto
                            <a href="reglamento.html"
                              target="_blank"
                              rel="noopener noreferrer">
                              el Uso y Reglamento
                            </a>
                            del albergue.
                          </span>
                        </label>

                        <p class="terms-description">
                          Al marcar esta casilla, usted declara haber leído,
                          comprendido y aceptado las condiciones establecidas en el uso y reglamento de cada albergue.
                        </p>

                      </div>

                    </div>

                    <button type="submit" class="btn-submit ${acc.cls}" id="btn-submit-alo-${k}" disabled>
                        <span class="btn-label">Confirmar Reserva</span>
                    </button>

                    <!-- Botón Reset -->
                    <button type="button" class="btn-reset" id="btn-reset-alo-${k}" onclick="resetAllAlo('${k}')">
                        <i class="fas fa-undo"></i> Limpiar Todo
                    </button>

          </form>
        </div>
    </div>
  </div>
    </div>`;
}

// =====================================================================
//  Renderizado inicial
// =====================================================================
async function cargarAlbergues() {
  const contenedor = document.getElementById('albergues-container');
  try {
    const resp = await fetch(CONFIG.googleScriptUrl + '?action=listarAlbergues', {
      method: 'GET'
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.message || 'Error al cargar albergues');

    const meses = parseInt(json.meses_anticipacion, 10);
    if (meses >= 1 && meses <= 24) {
      maxTotalMonths = minTotalMonths + meses - 1;
    }

    setAlbergues(json.albergues);
    if (ALBERGUE_KEYS.length === 0) {
      contenedor.innerHTML = '<p>No hay albergues disponibles por el momento.</p>';
      return;
    }

    // Tarjetas
    contenedor.innerHTML = ALBERGUES.map(htmlTarjeta).join('');

    // Modales (visita + alojamiento por albergue)
    const modalesHost = document.createElement('div');
    modalesHost.id = 'modales-host';
    modalesHost.innerHTML = ALBERGUES.map(a => htmlModalVisita(a) + htmlModalAlojamiento(a)).join('');
    document.body.appendChild(modalesHost);

    wireAll();
    initGlides();
  } catch (err) {
    console.error('[ALBERGUES] No se pudieron cargar:', err);
    contenedor.innerHTML = '<p>No se pudieron cargar los albergues. Intente nuevamente en unos minutos.</p>';
  }
}

function initGlides() {
  if (typeof window.Glide !== 'undefined') {
    // evita duplicar instancias si se inicializa más de una vez
    document.querySelectorAll('.glide.initialized').forEach(el => {
      try { el._glide && el._glide.destroy(); } catch (e) {}
      el.classList.remove('initialized');
    });
  }

  document.querySelectorAll('.glide').forEach(el => {
    if (!window.Glide) {
      console.warn('Glide.js no está cargado');
      return;
    }
    try {
      const glide = new Glide(el, {
        type: 'carousel',
        perView: 1,
        autoplay: 4000,
        hoverpause: true,
        animationDuration: 1500,
        gap: 0
      });

      const arrows = el.querySelectorAll('.glide__arrow');
      arrows.forEach(btn => {
        btn.addEventListener('click', () => {
          glide.update({ animationDuration: 400 });
          setTimeout(() => glide.update({ animationDuration: 1500 }), 500);
        });
      });

      glide.mount();
      el._glide = glide;
      el.classList.add('initialized');
    } catch (err) {
      console.error('Error inicializando Glide:', err);
    }
  });
}

// =====================================================================
//  Aviso con video (elementos estáticos)
// =====================================================================
document.addEventListener('DOMContentLoaded', function () {
  const notice = document.getElementById('site-notice');
  if (!notice) return;

  const video = document.getElementById('aviso-video');
  const closeBtn = notice.querySelector('.notice-close');
  const soundBtn = document.getElementById('sound-toggle');
  const iconMute = document.getElementById('icon-mute');
  const iconSound = document.getElementById('icon-sound');

  notice.classList.add('show');
  document.body.style.overflow = 'hidden';

  if (video) {
    video.muted = true;
    video.play();
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
      notice.classList.remove('show');
      document.body.style.overflow = '';
    });
  }

  if (soundBtn) {
    soundBtn.addEventListener('click', function (e) {
      if (!e.isTrusted) return;
      if (video) {
        video.muted = false;
        video.volume = 1;
        video.play();
      }
      if (iconMute) iconMute.style.display = 'none';
      if (iconSound) iconSound.style.display = 'block';
      setTimeout(() => {
        soundBtn.classList.add('hidden');
      }, 400);
    });
  }
});

// =====================================================================
//  Funciones para manejar modales (VISITA)
// =====================================================================
function openModal(albergue) {
  resetOcupacionUI(albergue);

  const modal = document.getElementById(`modal-${albergue}`);
  if (!modal) return;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  resetForm(albergue);
  resetCalendarToToday(albergue);
  generarCalendario(albergue);
  actualizarMontoVisita(albergue);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeModal(albergue) {
  const modal = document.getElementById(`modal-${albergue}`);
  if (!modal) return;
  modal.classList.remove('active');
  document.body.style.overflow = 'auto';
  resetForm(albergue);
}

// Configuración de listeners de formularios (visita)
function setupFormListeners() {
  ALBERGUE_KEYS.forEach(albergue => {
    const form = document.getElementById(`reservaForm${claveMayuscula(albergue)}`);
    if (form) {
      form.removeEventListener('submit', handleFormSubmit);
      form.addEventListener('submit', handleFormSubmit);
    }
  });
}

function handleFormSubmit(e) {
  e.preventDefault();
  e.stopPropagation();
  const albergue = e.target.id.replace('reservaForm', '').toLowerCase();
  if (formSubmissionState[albergue] && formSubmissionState[albergue].isSubmitting) {
    return;
  }
  formSubmissionState[albergue].isSubmitting = true;
  submitForm(albergue).finally(() => {
    formSubmissionState[albergue].isSubmitting = false;
  });
}

async function submitForm(albergue) {
  const formData = getFormData(albergue);
  if (!formData.institucion || !formData.responsable || !formData.dni || !formData.contacto ||
      !formData.email || !formData.cantidad || !formData.fechaIngreso || !formData.horaIngreso || !formData.horaEgreso) {
    alert("Por favor, complete todos los campos del formulario.");
    return;
  }
  if (!esEmailValido(formData.email)) {
    alert("Por favor, ingrese un correo electrónico válido.");
    return;
  }

  const btn = getSubmitButton(albergue);
  setBtnLoading(btn);

  try {
    const resultado = await enviarReservaAGoogleSheets(formData);

    if (resultado && resultado.success) {
      mostrarConfirmacion(albergue, formData, resultado.idReserva, resultado.codigoPublico, resultado.montoTotal);
      setBtnSuccess(btn);

      setTimeout(() => {
        resetForm(albergue);
        closeModal(albergue);
        resetBtn(btn);
      }, 900);
    } else {
      setBtnError(btn, 'Error');
      showSnackbar(`Error al guardar la reserva: ${resultado.message || 'Inténtelo nuevamente.'}`, 'error', 2200);
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

function getFormData(albergue) {
  return {
    albergue,
    institucion: document.getElementById(`institucion-${albergue}`).value.trim(),
    responsable: document.getElementById(`responsable-${albergue}`).value.trim(),
    dni: document.getElementById(`dni-${albergue}`).value.trim(),
    contacto: document.getElementById(`contacto-${albergue}`).value.trim(),
    email: document.getElementById(`email-${albergue}`).value.trim().toLowerCase(),
    cantidad: document.getElementById(`cantidad-${albergue}`).value,
    fechaIngreso: document.getElementById(`fechaIngreso-${albergue}`).value,
    horaIngreso: document.getElementById(`horaIngreso-${albergue}`).value,
    horaEgreso: document.getElementById(`horaEgreso-${albergue}`).value
  };
}

function mostrarConfirmacion(albergue, formData, idReserva, codigoPublico, montoTotal) {
  const nombre = toFullName(albergue);
  const codigo = codigoPublico || String(idReserva);
  const montoTxt = (montoTotal !== undefined && montoTotal !== null && montoTotal !== '')
    ? formatoMoneda(montoTotal)
    : '';
  const unitarioVisita = montoVisitaDe(alberguePorClave(albergue));
  const detalleMonto = montoTxt
    ? `${formData.cantidad} ${String(formData.cantidad) === '1' ? 'persona' : 'personas'} × ${formatoMoneda(unitarioVisita)}`
    : '';
  const html = `
    <p><strong>Código de reserva:</strong> <span style="color:var(--azul);font-weight:700">${esc(codigo)}</span></p>
    <p><strong>Albergue:</strong> ${esc(nombre)}</p>
    <p><strong>Institución:</strong> ${esc(formData.institucion)}</p>
    <p><strong>Responsable:</strong> ${esc(formData.responsable)}</p>
    <p><strong>DNI:</strong> ${esc(formData.dni)}</p>
    <p><strong>Contacto:</strong> ${esc(formData.contacto)}</p>
    <p><strong>Email:</strong> ${esc(formData.email)}</p>
    <p><strong>Cantidad de personas:</strong> ${esc(formData.cantidad)}</p>
    ${montoTxt ? `<p><strong>Monto a abonar:</strong> <span style="color:#b30000;font-weight:600">${esc(montoTxt)}</span><br><small>${esc(detalleMonto)}</small></p>` : ''}
    <p><strong>Fecha de ingreso:</strong> ${esc(formData.fechaIngreso)}</p>
    <p><strong>Hora de ingreso:</strong> ${esc(formData.horaIngreso)}</p>
    <p><strong>Hora de egreso:</strong> ${esc(formData.horaEgreso)}</p>
    <div class="confirmacion-alerta"><strong>Tenés 7 días para abonar y subir el comprobante.</strong><br>
      Podés subirlo desde <a href="pago.html">Pago y comprobante</a> con tu código de reserva.<br>
      Ante dudas, llamar al: <span style="color:#b30000;font-weight:600">(0381)452-6408</span></div>
  `;
  const modal = document.getElementById('modal-confirmacion');
  const datosDiv = document.getElementById('datos-reserva-confirmacion');
  if (modal && datosDiv) {
    const titulo = modal.querySelector('.modal-confirmacion-title');
    if (titulo) titulo.textContent = 'Prereserva realizada';
    datosDiv.innerHTML = html;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const modal = document.getElementById('modal-confirmacion');
  if (!modal) return;
  const closeBtn = modal.querySelector('.close-modal-confirmacion');
  const aceptarBtn = modal.querySelector('.btn-aceptar-modal-confirmacion');
  function cerrarModalConfirmacion() {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
  if (closeBtn) closeBtn.addEventListener('click', cerrarModalConfirmacion);
  if (aceptarBtn) aceptarBtn.addEventListener('click', cerrarModalConfirmacion);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) cerrarModalConfirmacion();
  });
});

function resetForm(albergue) {
  const form = document.getElementById(`reservaForm${claveMayuscula(albergue)}`);
  if (form) form.reset();
}

// =====================================================================
//  Funciones para fechas / calendario (VISITA)
// =====================================================================
function setMinDates() {
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.min = today;
  });
}

function setupDateListeners() {
  ALBERGUE_KEYS.forEach(albergue => {
    const ingresoInput = document.getElementById(`fechaIngreso-${albergue}`);
    if (ingresoInput) {
      ingresoInput.addEventListener('change', function () {});
    }
  });
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function isoFromYMD(año, mes0, dia) {
  return `${año}-${String(mes0 + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function setSelectedDate(albergue, iso, cell) {
  estadoCalendario[albergue].selectedISO = iso;

  const grid = document.getElementById(`calendario-${albergue}`);
  if (grid) {
    const prev = grid.querySelector('.dia.seleccionado');
    if (prev) prev.classList.remove('seleccionado');
  }

  cell.classList.add('seleccionado');

  const inputFecha = document.getElementById(`fechaIngreso-${albergue}`);
  if (inputFecha) inputFecha.value = iso;
}

function generarCalendario(albergue) {
  const estado = estadoCalendario[albergue];
  if (!estado) return;
  const { mes, año } = estado;

  const primerDia = new Date(año, mes, 1);
  const ultimoDia = new Date(año, mes + 1, 0);
  const primerDiaSemana = primerDia.getDay();
  const diasEnMes = ultimoDia.getDate();

  const contenedor = document.getElementById(`calendario-${albergue}`);
  if (!contenedor) return;
  contenedor.innerHTML = '';

  CONFIG.diasSemanaCortos.forEach(dia => {
    const diaHeader = document.createElement('div');
    diaHeader.className = 'dia-header';
    diaHeader.textContent = dia;
    contenedor.appendChild(diaHeader);
  });

  for (let k = 0; k < primerDiaSemana; k++) {
    contenedor.appendChild(crearDiaElemento('', 'otro-mes'));
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  for (let i = 1; i <= diasEnMes; i++) {
    const fechaActual = new Date(año, mes, i);
    fechaActual.setHours(0, 0, 0, 0);

    const iso = isoFromYMD(año, mes, i);

    const estaOcupado = Array.isArray(fechasOcupadas[albergue])
      ? fechasOcupadas[albergue].some(f => f.toDateString() === fechaActual.toDateString())
      : false;

    const esPasado = fechaActual < hoy;
    const esHoy = fechaActual.getTime() === hoy.getTime();

    let clases = [];
    if (estaOcupado) clases.push('ocupado');
    if (esPasado || esHoy) clases.push('inactiva');

    const dia = crearDiaElemento(i, clases.join(' '));
    dia.dataset.iso = iso;

    if (esHoy) dia.classList.add('hoy');

    if (estadoCalendario[albergue].selectedISO === iso) {
      dia.classList.add('seleccionado');
    }

    if (!esPasado && !esHoy && !estaOcupado) {
      dia.addEventListener('click', () => {
        setSelectedDate(albergue, iso, dia);
        mostrarInfoDia(albergue, año, mes, i);
      });
    } else {
      dia.tabIndex = -1;
      dia.setAttribute('aria-disabled', 'true');
    }

    contenedor.appendChild(dia);
  }

  const totalCeldas = 42;
  const usados = primerDiaSemana + diasEnMes;
  const faltan = totalCeldas - usados;
  for (let i = 0; i < faltan; i++) {
    contenedor.appendChild(crearDiaElemento('', 'otro-mes'));
  }

  const titulo = document.getElementById(`mes-actual-${albergue}`);
  if (titulo) titulo.textContent = `${CONFIG.meses[mes]} ${año}`;

  const header = document.querySelector(`#modal-${albergue} .calendario-header`);
  if (header) {
    const navBtns = header.querySelectorAll('.nav-mes');
    if (navBtns.length === 2) {
      const nextBtn = navBtns[1];
      if (nextBtn) {
        const currentTotal = año * 12 + mes;
        const shouldDisable = (currentTotal >= maxTotalMonths);
        nextBtn.disabled = shouldDisable;
        if (shouldDisable) {
          nextBtn.classList.add('disabled');
        } else {
          nextBtn.classList.remove('disabled');
        }
      }
    }
  }
}

function crearDiaElemento(numero, claseExtra = '') {
  const dia = document.createElement('div');
  dia.className = `dia ${claseExtra}`;
  dia.textContent = numero;
  return dia;
}

async function mostrarInfoDia(albergue, año, mes0, dia) {
  const fechaISO = `${año}-${String(mes0 + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

  const cachedDisp = getDisponiblesValue(albergue);
  if (!isNaN(cachedDisp)) {
    const spanDisp = document.getElementById(`disponibles-${albergue}`);
    if (spanDisp) spanDisp.textContent = cachedDisp;
  }

  showCalendarLoading(albergue);
  const start = performance.now();

  try {
    const disponibilidad = await obtenerDisponibilidadDia(albergue, fechaISO);
    const capBase = Number(capacidadesVisitas[albergue]) || 0;
    const capacidad = Number(disponibilidad?.capacidad ?? capBase) || 0;
    const disponibles = Number(disponibilidad?.disponibles ?? capacidad) || 0;
    const ocupados = Math.max(0, capacidad - disponibles);

    const spanDisp = document.getElementById(`disponibles-${albergue}`);
    const spanCap = document.getElementById(`capacidad-${albergue}`);

    if (spanDisp) spanDisp.textContent = disponibles;
    if (spanCap) spanCap.textContent = capacidad;

    setCantidadMaxFor(albergue);
    ocupacionActual[albergue] = ocupados;

    updateOcupacionUI(albergue, ocupados, capacidad);
  } catch (e) {
    console.error('Error al obtener disponibilidad:', e);
  } finally {
    const elapsed = performance.now() - start;
    const minDelay = 400;
    setTimeout(() => hideCalendarLoading(albergue), Math.max(0, minDelay - elapsed));
  }
}

function cambiarMes(albergue, direccion) {
  const estado = estadoCalendario[albergue];
  if (!estado) return;
  estado.mes += direccion;

  if (estado.mes < 0) {
    estado.mes = 11;
    estado.año--;
  } else if (estado.mes > 11) {
    estado.mes = 0;
    estado.año++;
  }

  generarCalendario(albergue);
}

// =====================================================================
//  Backend: disponibilidad y reservas
// =====================================================================
async function enviarReservaAGoogleSheets(data) {
  try {
    const payload = {
      action: 'crearReserva',
      albergue: toFullName(data.albergue),
      institucion: data.institucion,
      responsable: data.responsable,
      dni: data.dni,
      contacto: data.contacto,
      email: data.email,
      cantidad: parseInt(data.cantidad, 10),
      fechaIngreso: data.fechaIngreso,
      horaIngreso: data.horaIngreso,
      horaEgreso: data.horaEgreso
    };

    const response = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload)
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Error al enviar reserva para ${data.albergue}: ${error}`);
    return { success: false, message: 'Error de conexión' };
  }
}

async function obtenerDisponibilidadDia(albergueKey, fechaISO) {
  const payload = new URLSearchParams({
    action: 'obtenerDisponibilidadDia',
    albergue: toFullName(albergueKey),
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

const isLoading = {};

function showCalendarLoading(albergue) {
  isLoading[albergue] = true;

  const overlay = document.getElementById(`cal-loader-${albergue}`);
  if (overlay) {
    overlay.hidden = false;
    overlay.setAttribute('aria-busy', 'true');
  }

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

// Botones
function getSubmitButton(albergue) {
  const form = document.getElementById(`reservaForm${claveMayuscula(albergue)}`);
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

function setBtnSuccess(btn, text = 'Reservado') {
  if (!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  btn.classList.remove('is-loading', 'is-error');
  btn.classList.add('is-success');
  btn.disabled = true;
}

function setBtnError(btn, text = 'Error') {
  if (!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  btn.classList.remove('is-loading', 'is-success');
  btn.classList.add('is-error');
  btn.disabled = false;
}

function resetBtn(btn, text = 'Confirmar Reserva') {
  if (!btn) return;
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  btn.classList.remove('is-loading', 'is-success', 'is-error');
  btn.disabled = false;
}

// Snackbar
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
  bar.classList.remove('success', 'error', 'show');
  bar.classList.add(type === 'error' ? 'error' : 'success');

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

  void bar.offsetWidth;
  bar.classList.add('show');

  clearTimeout(bar._hideTimer);
  bar._hideTimer = setTimeout(() => {
    bar.classList.remove('show');
  }, duration);
}

function lockFechaInputs() {
  ALBERGUE_KEYS.forEach(key => {
    const el = document.getElementById(`fechaIngreso-${key}`);
    if (!el) return;

    el.readOnly = true;
    el.classList.add('locked-date');
    el.setAttribute('aria-readonly', 'true');
    el.tabIndex = -1;

    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('keydown', e => e.preventDefault());
    el.addEventListener('focus', e => e.target.blur());
  });
}

function populateHourSelects() {
  const keys = ALBERGUE_KEYS;

  const options = [];
  for (let h = 9; h <= 18; h++) {
    const hh = String(h).padStart(2, '0');
    options.push(`${hh}:00`);
  }

  const htmlIngreso =
    '<option value="" disabled selected>Seleccione hora</option>' +
    options.map(val => `<option value="${val}">${val}</option>`).join('');

  const htmlEgreso = htmlIngreso;

  keys.forEach(key => {
    const selIng = document.getElementById(`horaIngreso-${key}`);
    const selEgr = document.getElementById(`horaEgreso-${key}`);
    if (selIng) selIng.innerHTML = htmlIngreso;
    if (selEgr) selEgr.innerHTML = htmlEgreso;
  });
}

// =====================================================================
//  Validación de formularios (asesorías y campos)
// =====================================================================
function sanitizeNombre(v) {
  return v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart();
}

function sanitizeTelefono(v) {
  return v.replace(/\D/g, '');
}

function esEmailValido(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
}

function setupFieldGuards() {
  // Responsable: solo letras y espacios
  document.querySelectorAll('input[id^="responsable-"]').forEach(el => {
    el.addEventListener('input', () => {
      let clean = sanitizeNombre(el.value);
      if (clean.length > 50) clean = clean.slice(0, 50);
      if (clean !== el.value) el.value = clean;
      el.setCustomValidity('');
    });
    el.addEventListener('blur', () => {
      const ok = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)+$/.test(el.value.trim());
      el.setCustomValidity(ok ? '' : 'Ingrese nombre y apellido solo con letras.');
    });
  });

  // Email: normaliza a minúsculas y valida estructura
  document.querySelectorAll('input[id^="email-"]').forEach(el => {
    el.addEventListener('input', () => {
      el.setCustomValidity('');
    });
    el.addEventListener('blur', () => {
      const v = el.value.trim().toLowerCase();
      el.value = v;
      el.setCustomValidity(v === '' || esEmailValido(v) ? '' : 'Ingrese un correo electrónico válido.');
    });
  });

  // === TELÉFONO VISITAS: Prefijo 3-4 + Número 6-7 = Total 9 o 10 ===
  document.querySelectorAll('.modal-visita').forEach(modal => {
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
    el.max = '99999999';
    el.addEventListener('input', () => {
      let v = el.value.replace(/\D/g, '');
      if (v.length > 8) v = v.slice(0, 8);
      el.value = v;
    });
    el.addEventListener('blur', () => {
      const v = parseInt(el.value, 10);
      if (isNaN(v) || v.toString().length !== 8) {
        el.value = '';
      }
    });
  });

  // NUEVO: Institución: limita caracteres
  document.querySelectorAll('input[id^="institucion-"]').forEach(el => {
    el.addEventListener('input', () => {
      let v = el.value;
      if (v.length > 30) v = v.slice(0, 50);
      if (v !== el.value) el.value = v;
    });
  });
}

// =====================================================================
//  Límites de cantidad (VISITA)
// =====================================================================
function setCantidadMaxFor(albergue) {
  const input = document.getElementById(`cantidad-${albergue}`);
  if (!input) return;

  const disp = getDisponiblesValue(albergue);
  const capVisitas = Number(capacidadesVisitas[albergue]) || 0;
  let max = Number.isFinite(disp) ? disp : capVisitas;

  input.min = '1';
  input.max = String(max);
  input.step = '1';
  input.inputMode = 'numeric';
  input.placeholder = '';

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

function actualizarMontoVisita(albergue) {
  const input = document.getElementById(`cantidad-${albergue}`);
  const totalEl = document.getElementById(`monto-total-${albergue}`);
  const unitEl = document.getElementById(`monto-unitario-${albergue}`);
  const ayudaEl = document.getElementById(`monto-ayuda-${albergue}`);
  if (!input || !totalEl) return;

  const alb = alberguePorClave(albergue);
  const unitario = montoVisitaDe(alb);
  if (unitEl) unitEl.textContent = formatoMoneda(unitario);

  const cantidad = parseInt(input.value, 10);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    totalEl.textContent = '—';
    if (ayudaEl) ayudaEl.textContent = 'El monto total se calcula según la cantidad de personas indicada.';
    return;
  }

  totalEl.textContent = formatoMoneda(cantidad * unitario);
  if (ayudaEl) {
    ayudaEl.textContent = `${cantidad} ${cantidad === 1 ? 'persona' : 'personas'} × ${formatoMoneda(unitario)}`;
  }
}

function setupCantidadLimits() {
  ALBERGUE_KEYS.forEach(albergue => {
    const input = document.getElementById(`cantidad-${albergue}`);
    if (!input) return;

    setCantidadMaxFor(albergue);
    actualizarMontoVisita(albergue);

    input.addEventListener('input', () => {
      setCantidadMaxFor(albergue);
      actualizarMontoVisita(albergue);
    });
    input.addEventListener('blur', () => {
      setCantidadMaxFor(albergue);
      actualizarMontoVisita(albergue);
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text') || '';
      const onlyDigits = text.replace(/\D/g, '');
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + onlyDigits + input.value.slice(end);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

function getDisponiblesValue(albergue) {
  const el = document.getElementById(`disponibles-${albergue}`);
  if (!el) return NaN;
  const n = parseInt(String(el.textContent).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : NaN;
}

function resetOcupacionUI(albergue) {
  const fill = document.getElementById(`ocupacion-fill-${albergue}`);
  const info = document.getElementById(`ocupacion-info-${albergue}`);

  if (fill) {
    const prevTransition = fill.style.transition;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    requestAnimationFrame(() => {
      fill.style.transition = prevTransition || 'width .6s ease';
    });
  }
  if (info) info.textContent = '—';

  const disp = document.getElementById(`disponibles-${albergue}`);
  if (disp) disp.textContent = '—';
}

function resetCalendarToToday(albergue) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const iso = isoFromYMD(now.getFullYear(), now.getMonth(), now.getDate());

  const est = estadoCalendario[albergue];
  if (!est) return;
  est.mes = now.getMonth();
  est.año = now.getFullYear();
  est.selectedISO = iso;

  const inputFecha = document.getElementById(`fechaIngreso-${albergue}`);
  if (inputFecha) inputFecha.value = iso;
}

// =====================================================================
//  Cancelación de reservas (FRONT)
// =====================================================================
function openCancelModal() {
  const m = document.getElementById('modal-cancelar');
  if (!m) return;
  const inp = document.getElementById('cancel-id');
  const dni = document.getElementById('cancel-dni');
  if (inp) inp.value = '';
  if (dni) dni.value = '';
  const btn = document.getElementById('btn-cancelar-enviar');
  if (btn) resetBtn(btn, 'Confirmar cancelación');

  m.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCancelModal() {
  const m = document.getElementById('modal-cancelar');
  if (!m) return;
  m.classList.remove('active');
  document.body.style.overflow = 'auto';
}

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('open-cancel-modal');
  const closeBtn = document.getElementById('close-cancel-modal');
  const cancelForm = document.getElementById('cancelForm');

  if (openBtn) openBtn.addEventListener('click', openCancelModal);
  if (closeBtn) closeBtn.addEventListener('click', closeCancelModal);

  const modal = document.getElementById('modal-cancelar');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCancelModal();
    });
  }

  if (cancelForm) {
    cancelForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const idVal = document.getElementById('cancel-id')?.value?.trim();
      const dniVal = document.getElementById('cancel-dni')?.value?.trim();

      if (!idVal) {
        showSnackbar('Ingrese un código de reserva válido', 'error', 2500);
        return;
      }
      if (!dniVal) {
        showSnackbar('Ingrese el DNI del responsable', 'error', 2500);
        return;
      }

      const btn = document.getElementById('btn-cancelar-enviar');
      setBtnLoading(btn);

      try {
        const result = await cancelarReservaEnGoogleSheets(idVal, dniVal);
        if (result && result.success) {
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
      } catch (err) {
        console.error(err);
        setBtnError(btn, 'Error');
        showSnackbar('Error de conexión al cancelar', 'error', 3200);
        setTimeout(() => resetBtn(btn, 'Confirmar cancelación'), 1200);
      }
    });
  }
});

async function cancelarReservaEnGoogleSheets(idReserva, dni) {
  const payload = new URLSearchParams({
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

// =====================================================================
//  II parte: ALOJAMIENTO
// =====================================================================

function getSubmitButtonAlo(albergue) {
  const form = document.getElementById(`aloForm${claveMayuscula(albergue)}`);
  return form ? form.querySelector('.btn-submit') : null;
}

function handleFormSubmitAlo(e, albergue) {
  if (e && e.preventDefault) e.preventDefault();
  if (!albergue) albergue = ALBERGUE_KEYS[0] || 'maestro';
  if (formSubmissionStateAlo[albergue] && formSubmissionStateAlo[albergue].isSubmitting) return;

  formSubmissionStateAlo[albergue].isSubmitting = true;
  submitFormAlo(albergue).finally(() => {
    formSubmissionStateAlo[albergue].isSubmitting = false;
  });
}

async function submitFormAlo(albergue) {
  try {
    const formData = getFormDataAlo(albergue);
    if (!formData || formData.range.length === 0 || formData.cantidad <= 0) {
      showSnackbar?.("Complete cantidad, institución y seleccione un rango válido.", 'error', 4000);
      return;
    }
    if (!formData.email || !esEmailValido(formData.email)) {
      showSnackbar?.("Ingrese un correo electrónico válido.", 'error', 4000);
      return;
    }

    const btn = getSubmitButtonAlo(albergue);
    if (!btn) {
      console.error(`[ERROR] Botón submit no encontrado para ${albergue}`);
      return;
    }

    if (btn.disabled) {
      console.warn(`[BLOCK] Botón submit de ${albergue} ya está en proceso.`);
      return;
    }

    btn.disabled = true;
    setBtnLoading(btn, 'Guardando Reserva...');

    const resultado = await enviarReservaAlojamientoAGoogleSheets(formData);

    if (resultado?.success) {
      setBtnSuccess(btn);
      mostrarConfirmacionAlo?.(albergue, formData, resultado.idReserva, resultado.codigoPublico, resultado.montoTotal);

      setTimeout(() => {
        resetFormAlo?.(albergue);
        closeAlojamientoModal?.(albergue);
        resetBtn?.(btn);
        btn.disabled = false;
      }, 1000);
    } else {
      console.error(`[ERROR] Fallo en reserva ${albergue}:`, resultado);
      setBtnError(btn, 'Error');
      showSnackbar?.(`Error: ${resultado?.message || 'No se pudo registrar la reserva.'}`, 'error', 4000);
      setTimeout(() => {
        resetBtn?.(btn);
        btn.disabled = false;
      }, 1500);
    }
  } catch (err) {
    console.error(`[EXCEPCIÓN] submitFormAlo(${albergue}):`, err);
    showSnackbar?.(`Error de conexión o sistema: ${err.message || 'Desconocido'}`, 'error', 4000);

    const btn = getSubmitButtonAlo(albergue);
    if (btn) {
      setBtnError(btn, 'Error');
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
    email: ((document.getElementById(`email-alo-${albergue}`) || {}).value || '').trim().toLowerCase(),
    cantidad,
    range: estado.range || []
  };
}

function mostrarConfirmacionAlo(albergue, formData, idReserva, codigoPublico, montoTotal) {
  const nombre = toFullName(albergue);
  const codigo = codigoPublico || String(idReserva);
  const montoTxt = (montoTotal !== undefined && montoTotal !== null && montoTotal !== '')
    ? formatoMoneda(montoTotal)
    : '';
  const noches = Array.isArray(formData.range) ? formData.range.length : 0;
  const unitarioCama = montoCamaDe(alberguePorClave(albergue));
  const detalleMonto = montoTxt
    ? `${formData.cantidad} ${String(formData.cantidad) === '1' ? 'cama' : 'camas'} × ${noches} ${noches === 1 ? 'noche' : 'noches'} × ${formatoMoneda(unitarioCama)}`
    : '';
  const html = `
    <p><strong>Código de reserva:</strong> <span style="color:var(--azul);font-weight:700">${esc(codigo)}</span></p>
    <p><strong>Albergue:</strong> ${esc(nombre)}</p>
    <p><strong>Institución:</strong> ${esc(formData.institucion)}</p>
    <p><strong>Responsable:</strong> ${esc(formData.responsable)}</p>
    <p><strong>DNI:</strong> ${esc(formData.dni)}</p>
    <p><strong>Contacto:</strong> ${esc(formData.contacto)}</p>
    <p><strong>Email:</strong> ${esc(formData.email)}</p>
    <p><strong>Cantidad de camas:</strong> ${esc(String(formData.cantidad))}</p>
    <p><strong>Fechas reservadas:</strong> ${esc(formData.range.map(r => r).join(', '))}</p>
    ${montoTxt ? `<p><strong>Monto a abonar:</strong> <span style="color:#b30000;font-weight:600">${esc(montoTxt)}</span><br><small>${esc(detalleMonto)}</small></p>` : ''}
    <div class="confirmacion-alerta"><strong>Tenés 7 días para abonar y subir el comprobante.</strong><br>
      Podés subirlo desde <a href="pago.html">Pago y comprobante</a> con tu código de reserva.<br>
      Ante dudas, llamar al: <span style="color:#b30000;font-weight:600">(0381)452-6408</span></div>
  `;
  const modal = document.getElementById('modal-confirmacion');
  const datosDiv = document.getElementById('datos-reserva-confirmacion');
  if (modal && datosDiv) {
    const titulo = modal.querySelector('.modal-confirmacion-title');
    if (titulo) titulo.textContent = 'Prereserva realizada';
    datosDiv.innerHTML = html;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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

  estado.disponibilidadConfirmada = false;
  estado.diasValidos = [];

  showCalendarLoadingAlo(albergue);

  const resultados = await Promise.all(range.map(async iso => {
    try {
      const resp = await obtenerDisponibilidadDiaAlo(albergue, iso);
      const disponibles = (resp && typeof resp.disponibles === 'number') ? resp.disponibles : 0;
      return { iso, disponibles };
    } catch (err) {
      console.warn(`[DISP] Error al pedir ${iso} para ${albergue}:`, err);
      return { iso, disponibles: 0 };
    }
  }));

  hideCalendarLoadingAlo(albergue);

  let minDisp = Infinity;
  resultados.forEach(r => {
    if (typeof r.disponibles === 'number' && r.disponibles < minDisp) minDisp = r.disponibles;
    if (r.disponibles >= cantidad) estado.diasValidos.push(r.iso);
  });
  if (!isFinite(minDisp)) minDisp = 0;

  estado.disponibilidadConfirmada = true;

  updateOcupacionUIAlo?.(albergue, (cap - minDisp) >= 0 ? (cap - minDisp) : 0, cap);
  const span = document.getElementById(`disponibles-alo-${albergue}`);
  if (span) span.textContent = minDisp;

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

  // PRIMER CLICK → Selecciona inicio
  if (!estado.startISO) {
    estado.startISO = iso;
    estado.endISO = null;
    estado.range = [iso];
    estado.disponibilidadConfirmada = false;
    estado.diasValidos = [];

    cont.querySelectorAll('.inicio-rango, .fin-rango, .en-rango, .azul-seleccion, .verde, .rojo')
      .forEach(el => el.classList.remove('inicio-rango', 'fin-rango', 'en-rango', 'azul-seleccion', 'verde', 'rojo'));

    celda.classList.add('inicio-rango', 'en-rango', 'azul-seleccion');
    updateRangeDisplay?.(albergue, estado.range);
    return;
  }

  // SEGUNDO CLICK → Define fin y crea rango
  if (!estado.endISO) {
    const [sy, sm, sd] = estado.startISO.split('-').map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const [ey, em, ed] = iso.split('-').map(Number);
    const endDate = new Date(ey, em - 1, ed);

    if (endDate < startDate) {
      estado.startISO = iso;
      estado.endISO = null;
      estado.range = [iso];
      generarCalendarioAlo(albergue);
      return;
    }

    const range = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      range.push(d.toISOString().split('T')[0]);
    }

    if (!validarLimiteRangoAlo(albergue, range)) {
      showSnackbar?.(
        `No puede seleccionar tantos dias para su delegación.`,
        'error',
        6000
      );
      return;
    }

    estado.endISO = iso;
    estado.range = range;
    estado.disponibilidadConfirmada = false;
    estado.diasValidos = [];

    range.forEach(f => {
      const c = cont.querySelector(`[data-date="${f}"]`);
      if (c) c.classList.add('en-rango', 'azul-seleccion');
    });

    updateRangeDisplay?.(albergue, estado.range);

    try {
      showCalendarLoadingAlo?.(albergue);
      await mostrarInfoRangoAlo(albergue, range);
    } catch (err) {
      console.error('Error en mostrarInfoRangoAlo:', err);
    } finally {
      hideCalendarLoadingAlo?.(albergue);
    }

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

    const todosVerdes = estado.diasValidos && estado.diasValidos.length === range.length;
    if (todosVerdes && validarLimiteRangoAlo(albergue, range)) {
      const grid = document.getElementById(`calendario-alo-${albergue}`);
      if (grid) grid.classList.add('step-completed');

      completePasoAlo?.(albergue, 3);

      const btn = document.getElementById(`btn-submit-alo-${albergue}`);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('disabled');
        btn.classList.add('enabled');
      }
    } else {
      showSnackbar?.('El rango seleccionado no tiene disponibilidad completa.', 'error', 6000);
    }

    return;
  }

  // TERCER CLICK → Reinicio
  estado.startISO = null;
  estado.endISO = null;
  estado.range = [];
  estado.diasValidos = [];
  estado.disponibilidadConfirmada = false;
  generarCalendarioAlo(albergue);
}

function generarCalendarioAlo(albergue) {
  const estado = estadoCalendarioAlo[albergue];
  if (!estado) return;
  const { mes, año } = estado;

  const primerDia = new Date(año, mes, 1);
  const ultimoDia = new Date(año, mes + 1, 0);
  const primerDiaSemana = primerDia.getDay();
  const diasEnMes = ultimoDia.getDate();

  const contenedor = document.getElementById(`calendario-alo-${albergue}`);
  if (!contenedor) return;
  contenedor.innerHTML = '';

  CONFIG.diasSemanaCortos.forEach(dia => {
    const head = document.createElement('div');
    head.className = 'dia-header';
    head.textContent = dia;
    contenedor.appendChild(head);
  });

  for (let k = 0; k < primerDiaSemana; k++) {
    contenedor.appendChild(crearDiaElementoAlo('', 'otro-mes'));
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  for (let i = 1; i <= diasEnMes; i++) {
    const fechaActual = new Date(año, mes, i);
    fechaActual.setHours(0, 0, 0, 0);
    const iso = fechaActual.toISOString().split('T')[0];

    const dispMes = estadoLibresMesAlo(albergue, mes, año);
    const libres = dispMes && Object.prototype.hasOwnProperty.call(dispMes, iso)
      ? Number(dispMes[iso])
      : null;

    const estaOcupado = (libres !== null && libres <= 0) ||
      (Array.isArray(fechasOcupadasAlo[albergue]) &&
        fechasOcupadasAlo[albergue].some(f => f.toDateString() === fechaActual.toDateString()));

    const esPasado = fechaActual < hoy;
    const clases = [];

    if (estaOcupado) clases.push('ocupado');
    if (esPasado) clases.push('inactiva');

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
    celda.dataset.date = iso;
    celda.textContent = i;

    if (!esPasado && libres !== null) {
      const ddmmyyyy = iso.split('-').reverse().join('/');
      celda.title = libres > 0
        ? `${ddmmyyyy} · ${libres} cama${libres === 1 ? '' : 's'} libre${libres === 1 ? '' : 's'}`
        : `${ddmmyyyy} · sin camas disponibles`;
    }

    if (!esPasado && libres !== null && libres > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge-libre';
      badge.textContent = String(libres);
      celda.appendChild(badge);
    }

    if (!esPasado && !estaOcupado) {
      celda.onclick = () => handleClickDiaAlo(albergue, iso, celda);
    }

    contenedor.appendChild(celda);
  }

  const total = 42 - (primerDiaSemana + diasEnMes);
  for (let i = 0; i < total; i++) {
    contenedor.appendChild(crearDiaElementoAlo('', 'otro-mes'));
  }

  const titulo = document.getElementById(`mes-actual-alo-${albergue}`);
  if (titulo) titulo.textContent = `${CONFIG.meses[mes]} ${año}`;

  asegurarLibresMesAlo(albergue, mes, año);

  const nextBtnAlo = document.getElementById(`nav-next-alo-${albergue}`);
  if (nextBtnAlo) {
    const currentTotal = estado.año * 12 + estado.mes;
    const shouldDisable = (currentTotal >= maxTotalMonths);
    nextBtnAlo.disabled = shouldDisable;
    if (shouldDisable) {
      nextBtnAlo.classList.add('disabled');
    } else {
      nextBtnAlo.classList.remove('disabled');
    }
  }
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

    const estado = estadoCalendarioAlo[albergue];
    if (estado.diasValidos) estado.diasValidos = [];

    if (disp.disponibles > 0 && !estado.diasValidos.includes(iso)) {
      estado.diasValidos.push(iso);
    }

    if (disp.disponibles <= 0) {
      estado.diasValidos = estado.diasValidos.filter(d => d !== iso);
    }

    estado.disponibilidadConfirmada = true;
    generarCalendarioAlo(albergue);

  } catch (e) {
    console.error('Error al obtener disponibilidad:', e);
  } finally {
    hideCalendarLoadingAlo(albergue);
  }
}

function resetFormAlo(albergue) {
  const form = document.getElementById(`aloForm${albergue.charAt(0).toUpperCase() + albergue.slice(1)}`);
  if (form) form.reset();
  const qtyEl = document.getElementById(`cantidad-alo-${albergue}`);
  if (qtyEl) { qtyEl.value = ''; qtyEl.disabled = false; qtyEl.classList.remove('disabled'); }

  const hidden = document.getElementById(`delegacion-hidden-alo-${albergue}`);
  if (hidden) hidden.value = '';

  ['institucion', 'responsable', 'dni', 'contacto', 'email'].forEach(c => {
    const el = document.getElementById(`${c}-alo-${albergue}`);
    if (el) { el.value = ''; el.disabled = false; el.classList.remove('disabled'); }
  });

  resetRangoAlo(albergue);
}

function actualizarMontoAlo(albergue) {
  // El resumen existe dos veces: en el Paso 1 (cantidad) y en el Paso 3 (fechas).
  const variantes = ['', '-p3'];
  const alb = alberguePorClave(albergue);
  const unitario = montoCamaDe(alb);

  const input = document.getElementById(`cantidad-alo-${albergue}`);
  const cantidad = parseInt((input || {}).value, 10) || 0;
  const estado = estadoCalendarioAlo[albergue];
  const noches = (estado && Array.isArray(estado.range)) ? estado.range.length : 0;

  variantes.forEach(sufijo => {
    const unitEl = document.getElementById(`monto-unitario-alo${sufijo}-${albergue}`) ||
                   document.getElementById(`monto-unitario-alo-${albergue}`);
    const totalEl = document.getElementById(`monto-total-alo${sufijo}-${albergue}`) ||
                    document.getElementById(`monto-total-alo-${albergue}`);
    const ayudaEl = document.getElementById(`monto-ayuda-alo${sufijo}-${albergue}`) ||
                    document.getElementById(`monto-ayuda-alo-${albergue}`);
    if (!totalEl) return;

    if (unitEl) unitEl.textContent = formatoMoneda(unitario);

    if (cantidad <= 0 || noches <= 0) {
      totalEl.textContent = '—';
      if (ayudaEl) {
        ayudaEl.textContent = sufijo === '-p3'
          ? 'Seleccione el rango de fechas para ver el monto total.'
          : 'Indique la cantidad de camas y seleccione el rango de fechas para ver el monto total.';
      }
      return;
    }

    totalEl.textContent = formatoMoneda(cantidad * noches * unitario);
    if (ayudaEl) {
      ayudaEl.textContent = `${cantidad} ${cantidad === 1 ? 'cama' : 'camas'} × ${noches} ${noches === 1 ? 'noche' : 'noches'} × ${formatoMoneda(unitario)}`;
    }
  });
}

function setupCantidadListenerAlo() {
  ALBERGUE_KEYS.forEach(albergue => {
    const input = document.getElementById(`cantidad-alo-${albergue}`);
    if (!input) return;
    actualizarMontoAlo(albergue);
    input.addEventListener('input', () => {
      const cantidad = parseInt(input.value, 10) || 0;
      actualizarMontoAlo(albergue);
      const estado = estadoCalendarioAlo[albergue];
      if (estado && estado.range && estado.range.length > 0 && cantidad > 0) {
        mostrarInfoRangoAlo(albergue, estado.range);
      }
    });
  });
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
  actualizarMontoAlo(albergue);
  if (!display) return;

  if (range.length === 0) {
    display.innerHTML = `
      Estadia de hasta 4 días y 3 noches consecutivos.
      <br>
      <span class="leyenda-color">
        <span class="cuadrado rojo">■</span> <span class="texto-rojo">Rojo:</span> Día SIN camas disponibles.
      </span>
      <span class="leyenda-color">
        <span class="cuadrado verde">■</span> <span class="texto-verde">Verde:</span> Nro. CAMAS disponibles.
      </span>
    `;
  } else {
    const start = new Date(range[0]);
    const end = new Date(range[range.length - 1]);
    const estado = estadoCalendarioAlo[albergue];
    const invalidos = range.length - estado.diasValidos.length;
    display.innerHTML = `
       Su reserva sera para: ${range.length} días y ${range.length - 1} noches.
       <br>
      <span class="leyenda-color">
        <span class="cuadrado rojo">■</span> <span class="texto-rojo">Rojo:</span> Día SIN camas disponibles.
      </span>
      <br>
      <span class="leyenda-color">
        <span class="cuadrado verde">■</span> <span class="texto-verde">Verde:</span> CAMAS disponibles.
      </span>

    `;
  }

  
}

function resetRangoAlo(albergue) {
  const estado = estadoCalendarioAlo[albergue];
  if (!estado) return;
  estado.startISO = null;
  estado.endISO = null;
  estado.range = [];
  estado.diasValidos = [];

  estado.disponibilidadConfirmada = false;
  actualizarMontoAlo(albergue);
  updateRangeDisplay(albergue, []);
  updateCalendarHighlightsAlo(albergue);
}

function updateProgresoAlo(albergue) {
  const modal = document.getElementById(`modal-alojamiento-${albergue}`);
  if (!modal) return;

  const paso = pasoEstadoAlo[albergue] || { current: 1, completed: [] };

  const steps = modal.querySelectorAll('.step-container');
  steps.forEach((step, index) => {
    const pasoNum = index + 1;
    step.classList.remove('step-completed', 'step-active', 'step-error');
    if (paso.completed.includes(pasoNum)) {
      step.classList.add('step-completed');
    } else if (paso.current === pasoNum) {
      step.classList.add('step-active');
    } else if (showStepErrorsAlo[albergue]) {
      step.classList.add('step-error');
    }
  });

  const indicators = modal.querySelectorAll('.step-indicator');
  indicators.forEach((indicator, index) => {
    const pasoNum = index + 1;
    indicator.classList.remove('completed', 'active', 'error');
    if (paso.completed.includes(pasoNum)) indicator.classList.add('completed');
    else if (paso.current === pasoNum) indicator.classList.add('active');
    else if (showStepErrorsAlo[albergue]) indicator.classList.add('error');
  });

  const fill = modal.querySelector('.progress-fill');
  if (fill) {
    const progress = (paso.completed.length / 4) * 100;
    fill.style.width = `${progress}%`;
  }
}

function resetAllAlo(albergue) {
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

  const now = new Date();
  estadoCalendarioAlo[albergue] = {
    mes: now.getMonth(),
    año: now.getFullYear(),
    startISO: null,
    endISO: null,
    range: [],
    diasValidos: [],
    disponibilidadConfirmada: false
  };

  resetOcupacionUIAlo?.(albergue);
  pasoEstadoAlo[albergue] = { current: 1, completed: [] };
  updateProgresoAlo?.(albergue);

  const grid = document.getElementById(`calendario-alo-${albergue}`);
  if (grid) {
    grid.classList.remove('disabled', 'step-completed');
    grid.querySelectorAll('.seleccionado-inicial, .en-rango, .inicio-rango, .fin-rango, .rojo, .verde, .azul-seleccion')
      .forEach(el => el.classList.remove('seleccionado-inicial', 'en-rango', 'inicio-rango', 'fin-rango', 'rojo', 'verde', 'azul-seleccion'));
  }
  const navPrev = document.getElementById(`nav-prev-alo-${albergue}`);
  const navNext = document.getElementById(`nav-next-alo-${albergue}`);
  if (navPrev) navPrev.disabled = false;
  if (navNext) navNext.disabled = false;

  generarCalendarioAlo(albergue);

  const newCalendario = document.getElementById(`calendario-alo-${albergue}`);
  if (newCalendario) {
    newCalendario.querySelectorAll('.dia').forEach(dia => {
      if (!dia.classList.contains('inactiva') && !dia.classList.contains('ocupado')) {
        dia.addEventListener('click', () => handleClickDiaAlo(albergue, dia.dataset.iso, dia));
        dia.tabIndex = 0;
        dia.removeAttribute('aria-disabled');
      } else {
        dia.tabIndex = -1;
        dia.setAttribute('aria-disabled', 'true');
      }
    });
  }

  disableStepAlo(albergue, 2);
  disableStepAlo(albergue, 3);
  disableStepAlo(albergue, 4);
  enableStepAlo(albergue, 1);

  const btnSubmit = document.getElementById(`btn-submit-alo-${albergue}`);
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.classList.add('disabled');
    btnSubmit.classList.remove('enabled');
  }
}

function cambiarMesAlo(albergue, direccion) {
  const estado = estadoCalendarioAlo[albergue];
  if (!estado) return;
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
  now.setHours(0, 0, 0, 0);
  const iso = formatDate(now);
  const estado = estadoCalendarioAlo[albergue];
  if (!estado) return;
  estado.mes = now.getMonth();
  estado.año = now.getFullYear();
  resetRangoAlo(albergue);
}

function showCalendarLoadingAlo(albergue) {
  const loader = document.getElementById(`cal-loader-alo-${albergue}`);
  if (!loader) return;
  loader.hidden = false;
  loader.setAttribute('aria-busy', 'true');
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

  const clave = formData.albergue;
  const nombreParaServer = toFullName(clave);

  const params = new URLSearchParams();
  params.append('action', 'crearReservaAlojamiento');
  params.append('albergue', nombreParaServer);
  params.append('institucion', formData.institucion);
  params.append('responsable', formData.responsable);
  params.append('dni', formData.dni);
  params.append('contacto', formData.contacto);
  params.append('email', formData.email);
  params.append('cantidad', formData.cantidad);
  params.append('rangoFechas', formData.range.join(','));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const text = await response.text();
    const result = JSON.parse(text);
    if (!result.success) {
      console.error('Error del servidor:', result.message);
      showSnackbar(`Error: ${result.message || 'Intente nuevamente'}`, 'error', 5000);
      return result;
    }
    return result;
  } catch (err) {
    console.error('Error en fetch:', err);
    return { success: false, message: 'Error de conexión' };
  }
}

async function obtenerDisponibilidadDiaAlo(albergueKey, fechaISO) {
  if (!CONFIG.googleScriptUrlAlo || CONFIG.googleScriptUrlAlo.includes('undefined')) {
    console.warn(`URL Alo no configurada. Usando mock para ${fechaISO}.`);
    return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] };
  }

  const url = new URL(CONFIG.googleScriptUrlAlo, window.location.origin);
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

    const text = await resp.text();
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
    return { disponibles: capacidades[albergueKey], capacidad: capacidades[albergueKey] };
  }
}

const cacheLibresMesAlo = {};
const enCursoLibresMesAlo = {};

function estadoLibresMesAlo(albergue, mes, año) {
  return cacheLibresMesAlo[`${albergue}|${año}|${mes}`] || null;
}

function asegurarLibresMesAlo(albergue, mes, año) {
  const key = `${albergue}|${año}|${mes}`;
  if (cacheLibresMesAlo[key] || enCursoLibresMesAlo[key]) return;
  if (!CONFIG.googleScriptUrlAlo || CONFIG.googleScriptUrlAlo.includes('undefined')) return;

  enCursoLibresMesAlo[key] = true;
  const url = new URL(CONFIG.googleScriptUrlAlo, window.location.origin);
  url.searchParams.append('action', 'disponibilidadAlojamientoMes');
  url.searchParams.append('albergue', toFullName(albergue));
  url.searchParams.append('anio', String(año));
  url.searchParams.append('mes', String(mes + 1));

  fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  })
    .then(resp => resp.text())
    .then(texto => {
      delete enCursoLibresMesAlo[key];
      const json = JSON.parse(texto);
      if (!json.success) throw new Error(json.message || 'Sin datos de disponibilidad');
      cacheLibresMesAlo[key] = json.dias || {};
      const e = estadoCalendarioAlo[albergue];
      if (e && e.año === año && e.mes === mes) {
        generarCalendarioAlo(albergue);
      }
    })
    .catch(err => {
      delete enCursoLibresMesAlo[key];
      console.error(`Disponibilidad de alojamiento ${albergue} ${mes + 1}/${año}:`, err);
    });
}

function setupCantidadLimitsAlo() {
  ALBERGUE_KEYS.forEach(albergue => {
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
  ALBERGUE_KEYS.forEach(albergue => {
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
      if (select.value && select.value.trim() !== '') {
        completePasoAlo(albergue, 2);
      }
    });
  });
}

function validarLimiteRangoAlo(albergue, range) {
  const select = document.getElementById(`delegacion-alo-${albergue}`);
  if (!select) return true;

  const tipo = select.value;
  if (!tipo) return true;

  const maxDias = tipo === 'escuelas' ? 4 : 3;
  if (range.length > maxDias) {
    resetRangoAlo(albergue);
    return false;
  }
  return true;
}

// ========================== ESTADO DE PASOS ALOJAMIENTO ==========================

function openAlojamientoModal(albergue) {
  pasoEstadoAlo[albergue] = { current: 1, completed: [] };

  const modal = document.getElementById(`modal-alojamiento-${albergue}`);
  if (!modal) {
    console.error(`[ERROR] No se encontró modal-alojamiento-${albergue}`);
    return;
  }

  document.querySelectorAll('[id^="modal-alojamiento-"]').forEach(m => {
    m.classList.remove('active');
    m.style.display = 'none';
  });

  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('active'), 10);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.style.overflow = 'hidden';

  try {
    resetAllAlo(albergue);
    resetRangoAlo(albergue);
    resetFormAlo(albergue);
    resetCalendarAloToToday(albergue);
    resetOcupacionUIAlo(albergue);
    fechasOcupadasAlo[albergue] = [];
    generarCalendarioAlo(albergue);
    initPasoFlujoAlo(albergue);
    actualizarMontoAlo(albergue);
  } catch (err) {
    console.error(`[ERROR] Al inicializar modal alojamiento ${albergue}:`, err);
  }
}

function closeAlojamientoModal(albergue) {
  const modal = document.getElementById(`modal-alojamiento-${albergue}`);
  if (!modal) return;

  modal.classList.remove('active');
  setTimeout(() => {
    modal.style.display = 'none';
    document.body.style.overflow = '';

    try {
      resetAllAlo(albergue);
      fechasOcupadasAlo[albergue] = [];
    } catch (err) {
      console.warn(`[WARN] Error limpiando modal ${albergue}:`, err);
    }
  }, 200);
}

function initPasoFlujoAlo(albergue) {
  pasoEstadoAlo[albergue] = { current: 1, completed: [] };
  showStepErrorsAlo[albergue] = false;
  updateProgresoAlo(albergue);

  for (let n = 1; n <= 4; n++) {
    const c = document.getElementById(`step-${n}-${albergue}`);
    const b = document.getElementById(`paso-box-${n}-${albergue}`);

    if (c) c.classList.remove('completed');
    if (b) {
      b.classList.remove('completed');
      b.classList.remove('enabled');
    }
  }
  enableStepAlo(albergue, 1);
  disableStepAlo(albergue, 2);
  disableStepAlo(albergue, 3);
  disableStepAlo(albergue, 4);

  const btnSubmit = document.getElementById(`btn-submit-alo-${albergue}`);
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.classList.add('disabled');
    btnSubmit.classList.remove('enabled');
  }
}

function completePasoAlo(albergue, pasoNum) {
  if (!pasoEstadoAlo[albergue]) pasoEstadoAlo[albergue] = { current: 1, completed: [] };

  if (!pasoEstadoAlo[albergue].completed.includes(pasoNum)) {
    pasoEstadoAlo[albergue].completed.push(pasoNum);
  }

  const circle = document.getElementById(`step-${pasoNum}-${albergue}`);
  if (circle) circle.classList.add('completed');

  const box = document.getElementById(`paso-box-${pasoNum}-${albergue}`);
  if (box) box.classList.add('completed');

  disableStepAlo(albergue, 1);
  disableStepAlo(albergue, 2);
  disableStepAlo(albergue, 3);
  disableStepAlo(albergue, 4);

  switch (pasoNum) {
    case 1:
      enableStepAlo(albergue, 2);
      pasoEstadoAlo[albergue].current = 2;
      break;

    case 2:
      enableStepAlo(albergue, 3);
      pasoEstadoAlo[albergue].current = 3;
      break;

    case 3:
      if (!todasFechasVerdes(albergue)) {
        console.warn(`Paso 3 incompleto en ${albergue}: días no verdes`);
        enableStepAlo(albergue, 3);
        break;
      }
      enableStepAlo(albergue, 4);
      pasoEstadoAlo[albergue].current = 4;
      break;

    case 4:
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
    box.classList.remove('enabled');
    box.classList.remove('completed');
    box.classList.add('disabled-step');
  }

  const circle = document.getElementById(`step-${pasoNum}-${albergue}`);
  if (circle) circle.classList.remove('completed');

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

      if (grid) grid.classList.add('disabled');
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      break;

    case 4:
      ['institucion', 'responsable', 'dni', 'contacto', 'email'].forEach(campo => {
        const el = document.getElementById(`${campo}-alo-${albergue}`);
        if (el) el.disabled = true;
      });
      break;
  }
}

function enableStepAlo(albergue, pasoNum) {
  const box = document.getElementById(`paso-box-${pasoNum}-${albergue}`);
  if (box) {
    box.classList.add('enabled');
    box.classList.remove('disabled-step');
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

      if (grid) grid.classList.remove('disabled');
      if (prev) prev.disabled = false;
      if (next) next.disabled = false;
      break;

    case 4:
      ['institucion', 'responsable', 'dni', 'contacto', 'email'].forEach(campo => {
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
  // Paso 1: cantidad (blur confirma)
  const cantidadEl = document.getElementById(`cantidad-alo-${albergue}`);
  if (cantidadEl && !cantidadEl.dataset.pasoBound) {
    cantidadEl.dataset.pasoBound = '1';
    cantidadEl.addEventListener('blur', () => {
      const v = parseInt(cantidadEl.value, 10);
      if (Number.isFinite(v) && v > 0) {
        cantidadEl.disabled = true;
        cantidadEl.classList.add('disabled');
        completePasoAlo(albergue, 1);
      }
    });
  }

  // Paso 2: delegación
  const delEl = document.getElementById(`delegacion-alo-${albergue}`);
  if (delEl && !delEl.dataset.pasoBound) {
    delEl.dataset.pasoBound = '1';
    delEl.addEventListener('change', () => {
      if (delEl.value && delEl.value.trim() !== '') {
        delEl.disabled = true;
        delEl.classList.add('disabled');
        const hidden = document.getElementById(`delegacion-hidden-alo-${albergue}`);
        if (hidden) hidden.value = delEl.value;
        completePasoAlo(albergue, 2);
      }
    });
  }

  // Paso 4: submit del form de datos
  const form = document.getElementById(`aloForm${claveMayuscula(albergue)}`);
  if (form && !form.dataset.pasoBound) {
    form.dataset.pasoBound = '1';
    form.addEventListener('submit', (e) => {
      const inst = document.getElementById(`institucion-alo-${albergue}`)?.value.trim();
      const resp = document.getElementById(`responsable-alo-${albergue}`)?.value.trim();
      const dni = document.getElementById(`dni-alo-${albergue}`)?.value.trim();
      const cont = document.getElementById(`contacto-alo-${albergue}`)?.value.trim();
      const mail = document.getElementById(`email-alo-${albergue}`)?.value.trim();

      if (inst && resp && dni && cont && mail) {
        completePasoAlo(albergue, 4);
      }

      handleFormSubmitAlo(e, albergue);
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
}

// === TELÉFONO ALOJAMIENTO: Prefijo 3-4 + Número 6-7 = Total 9 o 10 ===
function setupTelefonoAlojamiento() {
  document.querySelectorAll('.modal-alojamiento').forEach(modal => {
    const albergue = modal.id.replace('modal-alojamiento-', '');

    const prefijoInput = document.getElementById(`prefijo-alo-${albergue}`);
    const numeroInput = document.getElementById(`numero-alo-${albergue}`);
    const hiddenInput = document.getElementById(`contacto-alo-${albergue}`);

    if (!prefijoInput || !numeroInput || !hiddenInput) return;
    if (prefijoInput.dataset.telBound) return;
    prefijoInput.dataset.telBound = '1';

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

    const form = document.getElementById(`aloForm${claveMayuscula(albergue)}`);
    if (form && !form.dataset.telBound) {
      form.dataset.telBound = '1';
      form.addEventListener('submit', (e) => {
        updateHidden();
        const total = hiddenInput.value;

        if (!/^\d{9,10}$/.test(total)) {
          e.preventDefault();
          alert('Error en el contacto:\n\n• Prefijo: 3 o 4 dígitos\n• Número: 6 o 7 dígitos\n• Total: debe ser 9 o 10 dígitos\n\nEjemplos válidos:\n3815600700 (9)\n3811500600 (10)\n3815006000 (10)\n38115006000 (11 → no)\n\nCombinaciones válidas:\n3+6=9 | 4+6=10 | 3+7=10');
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
}

// Cerrar modales con Escape
function cerrarModal() {
  const modalActivo = document.querySelector('.modal.active');
  if (!modalActivo) return;

  modalActivo.classList.remove('active');
  document.body.style.overflow = '';
  modalActivo.style.pointerEvents = 'none';

  setTimeout(() => {
    modalActivo.style.pointerEvents = '';
  }, 0);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cerrarModal();
});

// =====================================================================
//  Wiring general (se ejecuta luego del render dinámico)
// =====================================================================
function wireAll() {
  lockFechaInputs();
  populateHourSelects();
  setMinDates();
  setupDateListeners();
  setupFormListeners();
  setupCantidadLimits();
  setupFieldGuards();

  setupCantidadLimitsAlo();
  setupDelegacionListenerAlo();
  setupCantidadListenerAlo();
  ALBERGUE_KEYS.forEach(albergue => setupPasoListenersAlo(albergue));
  setupTelefonoAlojamiento();
}

// =====================================================================
//  Inicio
// =====================================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cargarAlbergues);
} else {
  cargarAlbergues();
}