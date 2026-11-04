/* ==========================================================================
   Runtime de la v2 — utilidades compartidas
   --------------------------------------------------------------------------
   La v2 no carga script.js. Estas páginas hablan con la misma API
   (api/index.php) usando los endpoints públicos que ya existen:
   listarAlbergues, obtenerDisponibilidadDia, obtenerDisponibilidadDiaAlojamiento,
   disponibilidadAlojamientoMes, crearReserva, crearReservaAlojamiento,
   subirComprobante y cancelarReserva.

   La base de la API se resuelve según dónde esté la página: en local la v2 se
   sirve desde /v2/, así que la API queda en ../api/index.php. Si más adelante
   la v2 se mueve a la raíz del sitio, la misma función usa api/index.php.
   ========================================================================== */
(function () {
  'use strict';

  const EN_V2 = /\/v2(\/|$)/.test(window.location.pathname);
  const API_URL = EN_V2 ? '../api/index.php' : 'api/index.php';
  const SITE_PREFIX = EN_V2 ? '../' : '';

  const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const MESES_CORTOS = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
  ];
  const DIAS = [
    'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'
  ];

  /* ------------------------------------------------------------------ API */

  async function apiGet(action, params = {}) {
    const url = new URL(API_URL, window.location.href);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    return leerJson(response);
  }

  async function apiPost(action, params = {}) {
    const body = new URLSearchParams();
    body.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) body.set(k, v);
    });

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: body.toString()
    });
    return leerJson(response);
  }

  async function leerJson(response) {
    const texto = await response.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch (error) {
      throw new Error('El servidor devolvió una respuesta inesperada.');
    }
    if (!response.ok) {
      throw new Error(json && json.message ? json.message : 'Error del servidor.');
    }
    return json;
  }

  /* ------------------------------------------------------------ albergues */

  let alberguesCache = null;

  async function cargarAlbergues() {
    if (alberguesCache) return alberguesCache;
    const json = await apiGet('listarAlbergues');
    if (!json.success) {
      throw new Error(json.message || 'No se pudieron cargar los albergues.');
    }
    alberguesCache = {
      lista: Array.isArray(json.albergues) ? json.albergues : [],
      mesesAnticipacion: Number(json.meses_anticipacion) || 3,
      horizonteHoras: Number(json.horizonte_horas) || 0,
      fechaMinima: String(json.fecha_minima_reserva || ''),
      cancelacionHoras: Number(json.cancelacion_horas) || 48,
      ventanaPagoHoras: Number(json.ventana_pago_horas) || 48,
      ventanaPagoMinHoras: Number(json.ventana_pago_min_horas) || 6
    };
    return alberguesCache;
  }

  function claveDePagina() {
    const params = new URLSearchParams(window.location.search);
    const deUrl = params.get('albergue');
    if (deUrl) return deUrl;
    const nodo = document.querySelector('[data-albergue]');
    return nodo ? nodo.getAttribute('data-albergue') : '';
  }

  function buscarAlbergue(meta, clave) {
    const lista = meta.lista;
    if (!lista.length) return null;
    return lista.find((a) => a.clave === clave) || lista[0];
  }

  function resolverRutaSitio(ruta) {
    if (!ruta) return '';
    if (/^(https?:)?\/\//i.test(ruta) || ruta.startsWith('/')) return ruta;
    return SITE_PREFIX + ruta.replace(/^\.?\//, '');
  }

  /* --------------------------------------------------------------- fechas */

  function hoyLocal() {
    const ahora = new Date();
    return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  }

  function parseISO(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const partes = iso.slice(0, 10).split('-').map(Number);
    if (partes.length !== 3 || partes.some(Number.isNaN)) return null;
    return new Date(partes[0], partes[1] - 1, partes[2]);
  }

  function aISO(fecha) {
    return [
      fecha.getFullYear(),
      String(fecha.getMonth() + 1).padStart(2, '0'),
      String(fecha.getDate()).padStart(2, '0')
    ].join('-');
  }

  function sumarDias(fecha, dias) {
    const copia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    copia.setDate(copia.getDate() + dias);
    return copia;
  }

  function mismoDia(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function rangoISO(desdeISO, hastaISO) {
    const desde = parseISO(desdeISO);
    const hasta = parseISO(hastaISO);
    if (!desde || !hasta) return [];
    const salida = [];
    for (let d = desde; d <= hasta; d = sumarDias(d, 1)) salida.push(aISO(d));
    return salida;
  }

  function fechaCorta(iso) {
    const fecha = parseISO(iso);
    if (!fecha) return '—';
    return `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}`;
  }

  function fechaLarga(iso) {
    const fecha = parseISO(iso);
    if (!fecha) return '';
    return `${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()].toLowerCase()}`;
  }

  function nombreMes(anio, mes) {
    return `${MESES[mes]} ${anio}`;
  }

  function fechaHoraLegible(valor) {
    if (!valor) return '';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '';
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const hh = String(fecha.getHours()).padStart(2, '0');
    const mi = String(fecha.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
  }

  function mesActual() {
    const hoy = hoyLocal();
    return { anio: hoy.getFullYear(), mes: hoy.getMonth() };
  }

  function indiceMes(anio, mes) {
    return anio * 12 + mes;
  }

  function primerDiaSemanaLunes(anio, mes) {
    const domingo = new Date(anio, mes, 1).getDay();
    return (domingo + 6) % 7;
  }

  function diasEnMes(anio, mes) {
    return new Date(anio, mes + 1, 0).getDate();
  }

  /* -------------------------------------------------------------- formato */

  const formatoMoneda = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  });

  function dinero(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return '—';
    return formatoMoneda.format(numero);
  }

  function escaparHtml(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function soloDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  function emailValido(valor) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(valor || '').trim());
  }

  function tamanoLegible(bytes) {
    const numero = Number(bytes) || 0;
    if (numero < 1024) return `${numero} B`;
    if (numero < 1024 * 1024) return `${(numero / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(numero / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  /* --------------------------------------------------------- componentes */

  function mostrar(elemento, visible) {
    if (!elemento) return;
    if (visible) elemento.removeAttribute('hidden');
    else elemento.setAttribute('hidden', '');
  }

  function activarSeccion(id) {
    if (!id) return;
    if (window.location.hash === `#${id}`) {
      // Fuerza el repintado de :target cuando se repite el mismo estado.
      window.location.hash = '';
    }
    window.location.hash = id;
  }

  function estadoDeHash(valido) {
    const hash = window.location.hash.replace(/^#/, '');
    return valido.includes(hash) ? hash : valido[0];
  }

  function textoNodo(id, texto) {
    const nodo = document.getElementById(id);
    if (nodo) nodo.textContent = texto;
  }

  /* ------------------------------------------------------------- WhatsApp */

  function prepararStepper(input) {
    if (!input) return () => {};
    const control = input.closest('.stepper__control');
    if (!control) return () => {};
    const botones = control.querySelectorAll('.stepper__btn');
    if (botones.length < 2) return () => {};
    const menos = botones[0];
    const mas = botones[1];

    const leer = () => {
      const numero = parseInt(input.value, 10);
      const min = parseInt(input.min, 10) || 1;
      const max = parseInt(input.max, 10) || Number.MAX_SAFE_INTEGER;
      return Math.min(max, Math.max(min, Number.isFinite(numero) ? numero : min));
    };

    const fijar = (valor) => {
      input.value = String(valor);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    menos.addEventListener('click', () => fijar(Math.max(parseInt(input.min, 10) || 1, leer() - 1)));
    mas.addEventListener('click', () => {
      const max = parseInt(input.max, 10) || Number.MAX_SAFE_INTEGER;
      fijar(Math.min(max, leer() + 1));
    });

    input.addEventListener('change', () => fijar(leer()));

    return () => fijar(leer());
  }

  window.V2 = {
    API_URL,
    SITE_PREFIX,
    MESES,
    MESES_CORTOS,
    DIAS,
    apiGet,
    apiPost,
    cargarAlbergues,
    claveDePagina,
    buscarAlbergue,
    resolverRutaSitio,
    hoyLocal,
    parseISO,
    aISO,
    sumarDias,
    mismoDia,
    rangoISO,
    fechaCorta,
    fechaLarga,
    nombreMes,
    fechaHoraLegible,
    mesActual,
    indiceMes,
    primerDiaSemanaLunes,
    diasEnMes,
    dinero,
    escaparHtml,
    soloDigitos,
    emailValido,
    tamanoLegible,
    mostrar,
    activarSeccion,
    estadoDeHash,
    textoNodo,
    prepararStepper
  };
})();
