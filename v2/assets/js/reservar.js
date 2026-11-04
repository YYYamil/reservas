/* ==========================================================================
   reservar.js — flujo de reserva de la v2
   --------------------------------------------------------------------------
   Dos modalidades sobre el mismo markup:

   - alojamiento: wizard de 4 pasos (grupo, delegación, fechas, datos) con
     rango de hasta 4 días; el total es cantidad × días × monto_cama.
   - visita: una sola página con día único y horario de ingreso/egreso; el
     total es cantidad × monto_visita.

   La API es la de siempre (api/index.php). No se toca script.js: este archivo
   arma los payloads y llama a los endpoints públicos.

   Los ids fijos -maestro son los hooks de la v2 para cualquier albergue; el
   albergue concreto se resuelve por `?albergue=` y viaja a la API por nombre
   completo, que es lo que espera `alberguePorNombre()`.
   ========================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const BAJAS_CAMAS = 5;

  const state = {
    meta: null,
    alb: null,
    modalidad: 'alojamiento',
    cantidadAlo: 3,
    cantidadVisita: 3,
    delegacion: 'escuelas',
    alo: {
      anio: 0,
      mes: 0,
      startISO: '',
      endISO: '',
      range: [],
      validando: false,
      valido: false,
      invalidos: [],
      libres: {}
    },
    visita: {
      anio: 0,
      mes: 0,
      fechaISO: '',
      capacidad: 0,
      disponibles: null,
      consultando: false,
      disponible: false
    },
    enviando: false
  };

  /* --------------------------------------------------------------- avisos */

  function mostrarAlerta(texto, tono) {
    const caja = $('wizard-alert');
    const cuerpo = $('wizard-alert-texto');
    if (!caja || !cuerpo) return;
    caja.classList.remove('notice--danger', 'notice--warning', 'notice--success');
    caja.classList.add(`notice--${tono || 'danger'}`);
    cuerpo.textContent = texto;
    caja.removeAttribute('hidden');
    caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function limpiarAlerta() {
    const caja = $('wizard-alert');
    if (caja) caja.setAttribute('hidden', '');
  }

  /* Mientras se consulta la base, el aviso cambia su ícono por el anillo de
     carga; al terminar vuelve el ícono que tenía en el markup. */
  function avisoCargando(caja, cargando) {
    if (!caja) return;
    const icono = qs('.notice__icon use', caja);
    if (!icono) return;
    if (!icono.dataset.base) icono.dataset.base = icono.getAttribute('href');
    caja.classList.toggle('is-loading', cargando);
    icono.setAttribute('href', cargando ? '#i-loading' : icono.dataset.base);
  }

  /* --------------------------------------------------------------- fechas */

  function fechaMinima() {
    const minima = state.meta && state.meta.fechaMinima;
    return minima || V2.aISO(V2.hoyLocal());
  }

  function indiceMesActual() {
    const hoy = V2.hoyLocal();
    return V2.indiceMes(hoy.getFullYear(), hoy.getMonth());
  }

  function indiceMesMaximo() {
    const meses = (state.meta && state.meta.mesesAnticipacion) || 3;
    return indiceMesActual() + Math.max(1, meses) - 1;
  }

  function fechaReservable(iso) {
    const fecha = V2.parseISO(iso);
    if (!fecha) return false;
    return iso >= fechaMinima()
      && V2.indiceMes(fecha.getFullYear(), fecha.getMonth()) <= indiceMesMaximo();
  }

  function maxDiasAlo() {
    return state.delegacion === 'escuelas' ? 4 : 3;
  }

  function noches(rango) {
    return Math.max(0, rango.length - 1);
  }

  function textoRango(rango) {
    if (!rango.length) return '';
    if (rango.length === 1) return V2.fechaCorta(rango[0]);
    return `${V2.fechaCorta(rango[0])} al ${V2.fechaCorta(rango[rango.length - 1])}`;
  }

  function claveMes(anio, mes) {
    return `${anio}-${mes}`;
  }

  function nombreDia(iso) {
    const fecha = V2.parseISO(iso);
    if (!fecha) return '';
    return `${V2.DIAS[fecha.getDay()]} ${fecha.getDate()} de ${V2.MESES[fecha.getMonth()].toLowerCase()}`;
  }

  /* ------------------------------------------------------------- albergue */

  /* Mientras la API no responde, el markup de ejemplo (maestro) no puede quedar
     a la vista: afirmaría datos de otro albergue. Se neutraliza y se rellena
     cuando aplicarAlbergue() corre. */
  const CAMPOS_ALBERGUE = ['meta-capacidad-alo', 'meta-capacidad-visita', 'meta-precio-alo', 'meta-precio-visita'];
  const MARCA_CARGA = 'wizard-cargando';
  const ROLES_ALBERGUE = ['[data-rol="precio-cama"]', '[data-rol="precio-visita"]', '[data-rol="disponibles"]', '[data-rol="capacidad-visita"]'];
  const MONTOS_RESUMEN = ['monto-unitario-alo-maestro', 'monto-unitario-maestro', 'monto-total-alo-maestro', 'monto-total-maestro', 'monto-ayuda-maestro', 'fecha-range-display-alo-maestro'];

  function albergueCargando(activo) {
    const wizard = qs('.wizard');
    if (wizard) {
      if (activo) wizard.setAttribute('aria-busy', 'true');
      else wizard.removeAttribute('aria-busy');
    }
    V2.mostrar($(MARCA_CARGA), activo);
    if (!activo) return;

    V2.textoNodo('wizard-titulo', 'Preparando tu reserva');
    document.title = 'Reserva — Albergues recreativos';
    CAMPOS_ALBERGUE.forEach((id) => V2.textoNodo(id, '—'));
    ROLES_ALBERGUE.forEach((sel) => qsa(sel).forEach((n) => { n.textContent = '—'; }));
    V2.textoNodo('resumen-albergue-maestro', 'Cargando…');
    MONTOS_RESUMEN.forEach((id) => V2.textoNodo(id, '—'));
    qsa('[data-rol="fecha-visita"]').forEach((n) => { n.textContent = '—'; });
    qsa('.wizard__summary-caption .wizard__modalidad--alojamiento, .wizard__summary-caption .wizard__modalidad--visita')
      .forEach((n) => { n.textContent = 'Cargando…'; });

    // Los avisos de cupo describen un día o un rango que todavía no existe. En
    // lugar de esconderlos (eso movía todo el panel) se los deja con el mismo
    // texto neutro que usa el wizard sin selección.
    const avisoAlo = $('aviso-alo-maestro');
    if (avisoAlo) {
      avisoAlo.classList.remove('notice--success', 'notice--danger');
      avisoAlo.classList.add('notice--warning');
      V2.textoNodo('aviso-alo-titulo', 'Disponibilidad por día');
      V2.textoNodo('aviso-alo-texto', 'Cargando el cupo de cada día del calendario.');
    }

    const avisoVisita = $('aviso-visita-maestro');
    if (avisoVisita) {
      avisoVisita.classList.remove('notice--success', 'notice--danger');
      avisoVisita.classList.add('notice--warning');
      V2.textoNodo('aviso-visita-texto', 'Cargando el cupo de la visita.');
    }

    V2.textoNodo('rango-alo-maestro', 'Elegí la fecha de entrada');
    V2.textoNodo('rango-visita-maestro', 'Elegí el día de la visita');
    V2.textoNodo('disponibles-maestro', '—');
    V2.textoNodo('capacidad-maestro', '—');
    // "Cupo del día" necesita un día elegido: lo decide actualizarAvisoVisita().
    V2.mostrar(qs('.cal__cupo'), false);
  }

  /* Si la consulta falla no hay datos: no se deja el ejemplo ni un "cargando"
     eterno. */
  function albergueSinDatos() {
    V2.textoNodo('wizard-titulo', 'Reserva sin datos del albergue');
    document.title = 'Reserva — Albergues recreativos';
    V2.textoNodo('resumen-albergue-maestro', 'Sin datos');
    CAMPOS_ALBERGUE.forEach((id) => V2.textoNodo(id, 'Sin datos'));
  }

  function aplicarAlbergue() {
    const alb = state.alb;
    if (!alb) return;

    const nombre = alb.nombre;
    const capCamas = Number(alb.capacidad) || 0;
    const capVisitas = Number(alb.capacidad_visitas) || capCamas;
    const montoCama = Number(alb.monto_cama) || 0;
    const montoVisita = Number(alb.monto_visita) || 0;

    const wizard = qs('.wizard');
    if (wizard) wizard.dataset.albergue = alb.clave;

    V2.textoNodo('wizard-titulo', `Reservá en ${nombre}`);
    document.title = `Reservar en ${nombre} — Albergues recreativos`;

    V2.textoNodo('meta-capacidad-alo', `${capCamas} camas en total`);
    V2.textoNodo('meta-capacidad-visita', `${capVisitas} personas en visita`);
    V2.textoNodo('meta-precio-alo', `${V2.dinero(montoCama)} por cama y noche`);
    V2.textoNodo('meta-precio-visita', `${V2.dinero(montoVisita)} por persona`);

    qsa('[data-rol="precio-cama"]').forEach((n) => { n.textContent = V2.dinero(montoCama); });
    qsa('[data-rol="precio-visita"]').forEach((n) => { n.textContent = V2.dinero(montoVisita); });
    qsa('[data-rol="disponibles"]').forEach((n) => { n.textContent = String(capCamas); });
    qsa('[data-rol="capacidad-visita"]').forEach((n) => { n.textContent = String(capVisitas); });

    V2.textoNodo('monto-unitario-alo-maestro', V2.dinero(montoCama));
    V2.textoNodo('monto-unitario-maestro', V2.dinero(montoVisita));
    V2.textoNodo('resumen-albergue-maestro', nombre);

    const cantidadAlo = $('cantidad-alo-maestro');
    if (cantidadAlo) {
      cantidadAlo.max = String(capCamas);
      if (Number(cantidadAlo.value) > capCamas) cantidadAlo.value = String(capCamas);
    }
    const cantidadVisita = $('cantidad-maestro');
    if (cantidadVisita) {
      cantidadVisita.max = String(capVisitas);
      if (Number(cantidadVisita.value) > capVisitas) cantidadVisita.value = String(capVisitas);
    }

    const calAlo = $('calendario-alo-maestro');
    if (calAlo) calAlo.setAttribute('aria-label', `Calendario de disponibilidad de ${nombre}`);

    const calVisita = $('calendario-maestro');
    if (calVisita) calVisita.setAttribute('aria-label', `Calendario de visitas de ${nombre}`);

    const pdf = V2.resolverRutaSitio(alb.pdf || '');
    if (pdf) {
      qsa('[data-placeholder="reglamento"]').forEach((a) => {
        a.setAttribute('href', pdf);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
      });
    }
  }

  /* --------------------------------------------------------------- pasos */

  function actualizarBarraPasos(pasoActual) {
    qsa('.steps .step').forEach((step) => {
      const numero = Number(step.dataset.paso);
      step.classList.toggle('step--done', numero < pasoActual);
      step.classList.toggle('step--current', numero === pasoActual);
      if (numero === pasoActual) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  }

  function irAPaso(numero, hashActual) {
    const destino = `#step-${numero}-maestro`;
    if (hashActual !== destino) {
      window.location.hash = destino;
    }
    actualizarBarraPasos(numero);
    limpiarAlerta();
  }

  function pasoDesdeHash() {
    const match = /^#step-([1-4])-maestro$/.exec(window.location.hash);
    return match ? Number(match[1]) : 1;
  }

  function prepararNavegacion() {
    const continuar1 = $('btn-continuar-1-maestro');
    if (continuar1) {
      continuar1.addEventListener('click', (e) => {
        e.preventDefault();
        if (!validarCantidadAlo()) return;
        irAPaso(2, window.location.hash);
      });
    }

    const continuar2 = $('btn-continuar-2-maestro');
    if (continuar2) {
      continuar2.addEventListener('click', (e) => {
        e.preventDefault();
        irAPaso(3, window.location.hash);
      });
    }

    const continuar3 = $('btn-continuar-3-maestro');
    if (continuar3) {
      continuar3.addEventListener('click', (e) => {
        e.preventDefault();
        if (!state.alo.range.length) {
          irAPaso(3, window.location.hash);
          mostrarAlerta('Elegí la fecha de entrada y la de salida en el calendario.', 'warning');
          return;
        }
        if (!state.alo.valido) {
          irAPaso(3, window.location.hash);
          mostrarAlerta('El rango elegido no tiene disponibilidad completa para esa cantidad de camas.', 'danger');
          return;
        }
        irAPaso(4, window.location.hash);
      });
    }

    window.addEventListener('hashchange', () => {
      actualizarBarraPasos(pasoDesdeHash());
    });
  }

  /* ------------------------------------------------------------- cantidad */

  function leerCantidad(input, minimo, maximo) {
    const valor = parseInt(input && input.value, 10) || minimo;
    return Math.min(Math.max(valor, minimo), Math.max(minimo, maximo));
  }

  function validarCantidadAlo() {
    if (!state.alb) {
      mostrarAlerta('Estamos cargando los datos del albergue. Probá de nuevo en unos segundos.', 'warning');
      return false;
    }
    const cap = Number(state.alb.capacidad) || 0;
    const cantidad = leerCantidad($('cantidad-alo-maestro'), 1, cap);
    if (cantidad < 1) {
      mostrarAlerta('Indicá cuántas camas necesitás.', 'warning');
      return false;
    }
    state.cantidadAlo = cantidad;
    return true;
  }

  function validarCantidadVisita() {
    if (!state.alb) {
      mostrarAlerta('Estamos cargando los datos del albergue. Probá de nuevo en unos segundos.', 'warning');
      return false;
    }
    const cap = Number(state.alb.capacidad_visitas || state.alb.capacidad) || 0;
    const cantidad = leerCantidad($('cantidad-maestro'), 1, cap);
    if (cantidad < 1) {
      mostrarAlerta('Indicá cuántas personas vienen en la visita.', 'warning');
      return false;
    }
    state.cantidadVisita = cantidad;
    return true;
  }

  function prepararCantidades() {
    const inputAlo = $('cantidad-alo-maestro');
    if (inputAlo) {
      V2.prepararStepper(inputAlo);
      inputAlo.addEventListener('input', () => {
        state.cantidadAlo = leerCantidad(inputAlo, 1, Number(state.alb.capacidad) || 1);
        actualizarResumen();
        if (state.alo.range.length > 1) programarValidacionAlo();
      });
    }

    const inputVisita = $('cantidad-maestro');
    if (inputVisita) {
      V2.prepararStepper(inputVisita);
      inputVisita.addEventListener('input', () => {
        state.cantidadVisita = leerCantidad(
          inputVisita,
          1,
          Number(state.alb.capacidad_visitas || state.alb.capacidad) || 1
        );
        actualizarResumen();
        actualizarAvisoVisita();
      });
    }
  }

  /* ------------------------------------------------------------ modalidad */

  function aplicarModalidad(modalidad) {
    state.modalidad = modalidad === 'visita' ? 'visita' : 'alojamiento';
    const wizard = qs('.wizard');
    if (wizard) wizard.dataset.modalidad = state.modalidad;

    const radio = qs(`[name="modalidad"][value="${state.modalidad}"]`);
    if (radio) radio.checked = true;

    limpiarAlerta();
    actualizarResumen();
  }

  /* La modalidad ya viaja en la URL: no depende de la API, así que se puede
     pintar antes de que llegue la respuesta. Sin esto la página mostraba el
     flujo de estadía durante toda la carga aunque se hubiera elegido visita. */
  function modalidadDeUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('modalidad') === 'visita' ? 'visita' : 'alojamiento';
  }

  function marcarModalidadInicial() {
    state.modalidad = modalidadDeUrl();
    const wizard = qs('.wizard');
    if (wizard) wizard.dataset.modalidad = state.modalidad;
  }

  function prepararModalidad() {
    qsa('[name="modalidad"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) aplicarModalidad(radio.value);
      });
    });

    aplicarModalidad(modalidadDeUrl());
  }

  /* ------------------------------------------------------ calendario alo */

  function irAMesAlo(anio, mes) {
    state.alo.anio = anio;
    state.alo.mes = mes;
  }

  function pintarCalendarioAlo() {
    const cal = $('calendario-alo-maestro');
    if (!cal) return;
    const { anio, mes } = state.alo;
    const grid = qs('.cal__grid', cal);
    if (!grid) return;

    calendarioCargando(cal, false);
    V2.textoNodo('mes-actual-alo-maestro', V2.nombreMes(anio, mes));

    const botones = qsa('.cal__nav-btn', cal);
    const indice = V2.indiceMes(anio, mes);
    if (botones[0]) botones[0].disabled = indice <= indiceMesActual();
    if (botones[1]) botones[1].disabled = indice >= indiceMesMaximo();

    grid.innerHTML = '';
    const huecos = V2.primerDiaSemanaLunes(anio, mes);
    for (let i = 0; i < huecos; i++) {
      const blanco = document.createElement('span');
      blanco.className = 'cal__blank';
      blanco.setAttribute('aria-hidden', 'true');
      grid.appendChild(blanco);
    }

    const libresMes = state.alo.libres[claveMes(anio, mes)] || {};
    const total = V2.diasEnMes(anio, mes);
    const enRango = new Set(state.alo.range);
    const invalidos = new Set(state.alo.invalidos);

    for (let dia = 1; dia <= total; dia++) {
      const fecha = new Date(anio, mes, dia);
      const iso = V2.aISO(fecha);
      const libres = Object.prototype.hasOwnProperty.call(libresMes, iso)
        ? Number(libresMes[iso])
        : null;

      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'cal__day';
      boton.dataset.fecha = iso;
      boton.dataset.date = iso;
      boton.textContent = String(dia);

      const reservable = fechaReservable(iso);
      let etiqueta = `${nombreDia(iso)}`;

      if (!reservable) {
        boton.classList.add('cal__day--past');
        boton.disabled = true;
        etiqueta += ', fuera de la ventana de reserva';
      } else if (libres !== null && libres <= 0) {
        boton.classList.add('cal__day--full');
        boton.disabled = true;
        etiqueta += ', sin cupo';
      } else if (libres !== null) {
        if (libres <= BAJAS_CAMAS) boton.classList.add('cal__day--low');
        const badge = document.createElement('span');
        badge.className = 'cal__beds';
        badge.textContent = String(libres);
        boton.appendChild(badge);
        etiqueta += `, ${libres} ${libres === 1 ? 'cama libre' : 'camas libres'}`;
      } else {
        etiqueta += ', disponibilidad a confirmar';
      }

      if (enRango.has(iso)) {
        boton.classList.add('cal__day--in-range');
        if (iso === state.alo.startISO) boton.classList.add('cal__day--range-start');
        if (iso === state.alo.endISO) boton.classList.add('cal__day--range-end');
        etiqueta += ', dentro de tu reserva';
      }

      if (invalidos.has(iso)) {
        boton.classList.add('cal__day--invalid');
        etiqueta += ', sin camas suficientes';
      }

      boton.setAttribute('aria-label', etiqueta);
      grid.appendChild(boton);
    }
  }

  /* Esqueleto de días mientras el mes viaja: mismos marcos, sin datos. */
  function calendarioCargando(cal, cargando) {
    if (!cal) return;
    if (cargando) cal.setAttribute('aria-busy', 'true');
    else cal.removeAttribute('aria-busy');

    const grid = qs('.cal__grid', cal);
    if (!grid) return;
    grid.classList.toggle('cal__grid--loading', cargando);
    if (!cargando) return;
    grid.innerHTML = new Array(35)
      .fill('<div class="skeleton skeleton--day" aria-hidden="true"></div>')
      .join('');
  }

  async function cargarMesAlo(anio, mes) {
    if (!state.alb) return;
    const clave = claveMes(anio, mes);
    try {
      const json = await V2.apiGet('disponibilidadAlojamientoMes', {
        albergue: state.alb.nombre,
        anio,
        mes: mes + 1
      });
      if (json.success && json.dias) {
        state.alo.libres[clave] = json.dias;
      }
    } catch (error) {
      // La disponibilidad del mes es una ayuda visual; el rango se valida
      // igual día por día al confirmarlo.
      console.warn('No se pudo cargar la disponibilidad del mes:', error);
    }
  }

  async function refrescarMesAlo() {
    calendarioCargando($('calendario-alo-maestro'), true);
    await cargarMesAlo(state.alo.anio, state.alo.mes);
    pintarCalendarioAlo();
  }

  function cambiarMesAlo(delta) {
    const actual = V2.indiceMes(state.alo.anio, state.alo.mes);
    const destino = actual + delta;
    if (destino < indiceMesActual() || destino > indiceMesMaximo()) return;
    irAMesAlo(Math.floor(destino / 12), destino % 12);
    refrescarMesAlo();
  }

  function prepararCalendarioAlo() {
    const cal = $('calendario-alo-maestro');
    if (!cal) return;

    const botones = qsa('.cal__nav-btn', cal);
    if (botones[0]) botones[0].addEventListener('click', () => cambiarMesAlo(-1));
    if (botones[1]) botones[1].addEventListener('click', () => cambiarMesAlo(1));

    const grid = qs('.cal__grid', cal);
    if (grid) {
      grid.addEventListener('click', (e) => {
        const boton = e.target.closest('.cal__day');
        if (!boton || boton.disabled) return;
        clickDiaAlo(boton.dataset.fecha);
      });
    }
  }

  function clickDiaAlo(iso) {
    if (!fechaReservable(iso)) {
      mostrarAlerta('Esa fecha queda fuera de la ventana de reserva.', 'warning');
      return;
    }
    if (!validarCantidadAlo()) return;

    const { startISO, endISO } = state.alo;

    if (!startISO || endISO) {
      state.alo.startISO = iso;
      state.alo.endISO = '';
      state.alo.range = [iso];
      state.alo.valido = false;
      state.alo.invalidos = [];
      actualizarResumen();
      pintarCalendarioAlo();
      actualizarAvisoAlo();
      return;
    }

    if (iso < startISO) {
      state.alo.startISO = iso;
      state.alo.endISO = '';
      state.alo.range = [iso];
      state.alo.valido = false;
      state.alo.invalidos = [];
      actualizarResumen();
      pintarCalendarioAlo();
      actualizarAvisoAlo();
      return;
    }

    const rango = V2.rangoISO(startISO, iso);
    const maximo = maxDiasAlo();
    if (rango.length > maximo) {
      mostrarAlerta(
        `La estadía admite como máximo ${maximo} días para este tipo de delegación. Elegí una salida más cercana.`,
        'warning'
      );
      return;
    }

    state.alo.endISO = iso;
    state.alo.range = rango;
    state.alo.valido = false;
    state.alo.invalidos = [];
    actualizarResumen();
    pintarCalendarioAlo();
    actualizarAvisoAlo();
    validarRangoAlo();
  }

  let timerValidacion = null;
  function programarValidacionAlo() {
    if (timerValidacion) window.clearTimeout(timerValidacion);
    timerValidacion = window.setTimeout(() => {
      timerValidacion = null;
      if (state.alo.range.length > 1) validarRangoAlo();
    }, 350);
  }

  async function validarRangoAlo() {
    if (!state.alb || state.alo.range.length === 0) return;
    const rango = state.alo.range.slice();
    const cantidad = state.cantidadAlo;
    state.alo.validando = true;
    actualizarAvisoAlo();
    avisoCargando($('aviso-alo-maestro'), true);

    const resultados = await Promise.all(rango.map(async (iso) => {
      try {
        const json = await V2.apiGet('obtenerDisponibilidadDiaAlojamiento', {
          albergue: state.alb.nombre,
          fecha: iso
        });
        return { iso, disponibles: json.success ? Number(json.disponibles) || 0 : 0 };
      } catch (error) {
        return { iso, disponibles: 0 };
      }
    }));

    // Si mientras se consultaba el usuario cambió el rango, se descarta.
    if (rango.join(',') !== state.alo.range.join(',')) return;

    resultados.forEach((r) => {
      const [anio, mesUno] = r.iso.split('-').map(Number);
      const clave = claveMes(anio, mesUno - 1);
      if (!state.alo.libres[clave]) state.alo.libres[clave] = {};
      state.alo.libres[clave][r.iso] = r.disponibles;
    });

    state.alo.invalidos = resultados.filter((r) => r.disponibles < cantidad).map((r) => r.iso);
    state.alo.valido = state.alo.invalidos.length === 0;
    state.alo.validando = false;
    avisoCargando($('aviso-alo-maestro'), false);

    pintarCalendarioAlo();
    actualizarAvisoAlo();
  }

  function actualizarAvisoAlo() {
    const caja = $('aviso-alo-maestro');
    const titulo = $('aviso-alo-titulo');
    const texto = $('aviso-alo-texto');
    const etiquetaRango = $('rango-alo-maestro');
    if (!caja || !titulo || !texto) return;

    // El aviso se oculta mientras carga el albergue; acá ya hay estado que
    // mostrar.
    V2.mostrar(caja, true);

    const rango = state.alo.range;
    caja.classList.remove('notice--success', 'notice--warning', 'notice--danger');

    if (etiquetaRango) {
      etiquetaRango.classList.remove('cal__range--awaiting', 'cal__range--warning', 'cal__range--danger');
      if (!rango.length) {
        etiquetaRango.textContent = 'Elegí la fecha de entrada';
      } else if (rango.length === 1) {
        etiquetaRango.textContent = `${V2.fechaCorta(rango[0])}, elegí la salida`;
        etiquetaRango.classList.add('cal__range--awaiting');
      } else {
        const n = noches(rango);
        etiquetaRango.textContent = `${textoRango(rango)}, ${n} ${n === 1 ? 'noche' : 'noches'}`;
        if (state.alo.validando) etiquetaRango.classList.add('cal__range--awaiting');
        else if (!state.alo.valido) etiquetaRango.classList.add('cal__range--danger');
      }
    }

    if (!rango.length) {
      caja.classList.add('notice--warning');
      titulo.textContent = 'Elegí la fecha de entrada';
      texto.textContent = 'El calendario muestra las camas libres de cada día. La salida no suma una noche.';
      return;
    }

    if (rango.length === 1) {
      caja.classList.add('notice--warning');
      titulo.textContent = 'Falta la fecha de salida';
      texto.textContent = `${nombreDia(rango[0])}. La salida no suma una noche.`;
      return;
    }

    const n = noches(rango);
    const cantidad = state.cantidadAlo;

    if (state.alo.validando) {
      caja.classList.add('notice--warning');
      titulo.textContent = 'Revisando disponibilidad';
      texto.textContent = `Consultando las ${cantidad} camas para cada día del rango…`;
      return;
    }

    if (state.alo.valido) {
      caja.classList.add('notice--success');
      titulo.textContent = n === 1
        ? `Hay lugar para la noche del ${V2.fechaCorta(rango[0])}`
        : `Hay lugar para las ${n} noches`;
      texto.textContent = `Las ${cantidad} camas están libres del ${textoRango(rango)} y el rango no toca días sin cupo.`;
      return;
    }

    caja.classList.add('notice--danger');
    titulo.textContent = 'El rango no tiene disponibilidad completa';
    const faltan = state.alo.invalidos.map((iso) => V2.fechaCorta(iso));
    texto.textContent = faltan.length
      ? `No hay ${cantidad} camas el ${faltan.join(', ')}. Probá con otro rango.`
      : `No hay ${cantidad} camas en todos los días del rango. Probá con otro rango.`;
  }

  /* ---------------------------------------------------- calendario visita */

  function pintarCalendarioVisita() {
    const cal = $('calendario-maestro');
    if (!cal) return;
    const { anio, mes } = state.visita;
    const grid = qs('.cal__grid', cal);
    if (!grid) return;

    calendarioCargando(cal, false);
    V2.textoNodo('mes-actual-maestro', V2.nombreMes(anio, mes));

    const botones = qsa('.cal__nav-btn', cal);
    const indice = V2.indiceMes(anio, mes);
    if (botones[0]) botones[0].disabled = indice <= indiceMesActual();
    if (botones[1]) botones[1].disabled = indice >= indiceMesMaximo();

    grid.innerHTML = '';
    const huecos = V2.primerDiaSemanaLunes(anio, mes);
    for (let i = 0; i < huecos; i++) {
      const blanco = document.createElement('span');
      blanco.className = 'cal__blank';
      blanco.setAttribute('aria-hidden', 'true');
      grid.appendChild(blanco);
    }

    const total = V2.diasEnMes(anio, mes);
    for (let dia = 1; dia <= total; dia++) {
      const fecha = new Date(anio, mes, dia);
      const iso = V2.aISO(fecha);
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'cal__day';
      boton.dataset.fecha = iso;
      boton.dataset.date = iso;
      boton.textContent = String(dia);

      const reservable = fechaReservable(iso);
      let etiqueta = nombreDia(iso);

      if (!reservable) {
        boton.classList.add('cal__day--past');
        boton.disabled = true;
        etiqueta += ', fuera de la ventana de reserva';
      }

      if (iso === state.visita.fechaISO) {
        boton.classList.add('cal__day--range-start');
        etiqueta += ', elegido';
        if (state.visita.disponibles !== null && !state.visita.disponible) {
          boton.classList.add('cal__day--invalid');
          etiqueta += ', sin lugar para tu grupo';
        }
      }

      boton.setAttribute('aria-label', etiqueta);
      grid.appendChild(boton);
    }
  }

  function cambiarMesVisita(delta) {
    const actual = V2.indiceMes(state.visita.anio, state.visita.mes);
    const destino = actual + delta;
    if (destino < indiceMesActual() || destino > indiceMesMaximo()) return;
    state.visita.anio = Math.floor(destino / 12);
    state.visita.mes = destino % 12;
    pintarCalendarioVisita();
  }

  function prepararCalendarioVisita() {
    const cal = $('calendario-maestro');
    if (!cal) return;

    const botones = qsa('.cal__nav-btn', cal);
    if (botones[0]) botones[0].addEventListener('click', () => cambiarMesVisita(-1));
    if (botones[1]) botones[1].addEventListener('click', () => cambiarMesVisita(1));

    const grid = qs('.cal__grid', cal);
    if (grid) {
      grid.addEventListener('click', (e) => {
        const boton = e.target.closest('.cal__day');
        if (!boton || boton.disabled) return;
        clickDiaVisita(boton.dataset.fecha);
      });
    }
  }

  async function clickDiaVisita(iso) {
    if (!fechaReservable(iso)) {
      mostrarAlerta('Esa fecha queda fuera de la ventana de reserva.', 'warning');
      return;
    }
    if (!validarCantidadVisita()) return;

    state.visita.fechaISO = iso;
    state.visita.disponibles = null;
    state.visita.disponible = false;
    const campoFecha = $('fechaIngreso-maestro');
    if (campoFecha) campoFecha.value = iso;

    actualizarResumen();
    pintarCalendarioVisita();
    actualizarAvisoVisita();
    await cargarDisponibilidadVisita(iso);
  }

  async function cargarDisponibilidadVisita(iso) {
    if (!state.alb) return;
    state.visita.consultando = true;
    estadoConsultaVisita();
    avisoCargando($('aviso-visita-maestro'), true);
    try {
      const json = await V2.apiGet('obtenerDisponibilidadDia', {
        albergue: state.alb.nombre,
        fecha: iso
      });
      if (!json.success) throw new Error(json.message || 'No se pudo consultar el cupo.');

      state.visita.capacidad = Number(json.capacidad) || 0;
      state.visita.disponibles = Number(json.disponibles) || 0;
      state.visita.disponible = state.visita.disponibles >= state.cantidadVisita;
      V2.textoNodo('capacidad-maestro', String(state.visita.capacidad));
      V2.textoNodo('disponibles-maestro', String(state.visita.disponibles));
    } catch (error) {
      state.visita.disponibles = null;
      state.visita.disponible = false;
      mostrarAlerta(error.message || 'No se pudo consultar el cupo de ese día.', 'danger');
    } finally {
      state.visita.consultando = false;
      avisoCargando($('aviso-visita-maestro'), false);
      pintarCalendarioVisita();
      actualizarAvisoVisita();
    }
  }

  function estadoConsultaVisita() {
    const caja = $('aviso-visita-maestro');
    const texto = $('aviso-visita-texto');
    if (!caja || !texto) return;
    caja.classList.remove('notice--success', 'notice--warning', 'notice--danger');
    caja.classList.add('notice--warning');
    texto.textContent = 'Consultando la disponibilidad del día…';
  }

  function actualizarAvisoVisita() {
    const caja = $('aviso-visita-maestro');
    const texto = $('aviso-visita-texto');
    const etiquetaRango = $('rango-visita-maestro');
    if (!caja || !texto) return;

    // Igual que en alojamiento: el aviso vuelve cuando hay datos del albergue.
    V2.mostrar(caja, true);

    // El pie "Cupo del día" solo tiene sentido con un día elegido y su cupo
    // consultado; si no, queda fuera en lugar de decir "— de — lugares".
    const cupoDia = qs('.cal__cupo');
    if (cupoDia) {
      V2.mostrar(cupoDia, Boolean(state.visita.fechaISO) && state.visita.disponibles !== null);
    }

    caja.classList.remove('notice--success', 'notice--warning', 'notice--danger');

    const fecha = state.visita.fechaISO;
    const horaIn = ($('horaIngreso-maestro') || {}).value || '';
    const horaOut = ($('horaEgreso-maestro') || {}).value || '';

    if (etiquetaRango) {
      etiquetaRango.textContent = fecha
        ? `${V2.fechaCorta(fecha)}, de ${horaIn || '--'} a ${horaOut || '--'}`
        : 'Elegí el día de la visita';
    }

    if (!fecha) {
      caja.classList.add('notice--warning');
      texto.textContent = 'Elegí el día de la visita. Después se confirma el cupo de esa fecha.';
      return;
    }

    if (state.visita.consultando) {
      caja.classList.add('notice--warning');
      texto.textContent = `Consultando el cupo del ${V2.fechaCorta(fecha)}…`;
      return;
    }

    if (state.visita.disponibles === null) {
      caja.classList.add('notice--warning');
      texto.textContent = `Todavía no pudimos confirmar el cupo del ${V2.fechaCorta(fecha)}.`;
      return;
    }

    const disponibles = state.visita.disponibles;
    const cantidad = state.cantidadVisita;
    const capacidad = state.visita.capacidad;

    if (disponibles >= cantidad) {
      caja.classList.add('notice--success');
      texto.textContent = `Hay lugar para ${cantidad} ${cantidad === 1 ? 'persona' : 'personas'} el ${V2.fechaCorta(fecha)}. Quedan ${disponibles} de ${capacidad} lugares.`;
      return;
    }

    caja.classList.add('notice--danger');
    texto.textContent = disponibles === 0
      ? `No queda cupo para el ${V2.fechaCorta(fecha)}. Elegí otro día.`
      : `El ${V2.fechaCorta(fecha)} quedan ${disponibles} lugares y necesitás ${cantidad}. Elegí otro día o bajá la cantidad.`;
  }

  /* -------------------------------------------------------------- resumen */

  function actualizarResumen() {
    const esVisita = state.modalidad === 'visita';
    const cantidad = esVisita ? state.cantidadVisita : state.cantidadAlo;
    const monto = esVisita
      ? (Number(state.alb && state.alb.monto_visita) || 0)
      : (Number(state.alb && state.alb.monto_cama) || 0);

    V2.textoNodo('resumen-cantidad-maestro', String(cantidad));

    if (esVisita) {
      const fecha = state.visita.fechaISO ? V2.fechaCorta(state.visita.fechaISO) : 'elegí el día';
      const horaIn = ($('horaIngreso-maestro') || {}).value || '--';
      const horaOut = ($('horaEgreso-maestro') || {}).value || '--';
      const total = cantidad * monto;
      V2.textoNodo('monto-unitario-maestro', V2.dinero(monto));
      V2.textoNodo('monto-total-maestro', V2.dinero(total));
      V2.textoNodo('monto-ayuda-maestro', `${cantidad} ${cantidad === 1 ? 'persona' : 'personas'} × ${V2.dinero(monto)}`);
      V2.textoNodo('resumen-horario-maestro', `${horaIn} a ${horaOut}`);
      const fechaResumen = $('fecha-range-display-alo-maestro');
      const fechaVisita = qs('[data-rol="fecha-visita"]');
      if (fechaVisita) fechaVisita.textContent = state.visita.fechaISO ? V2.fechaCorta(state.visita.fechaISO) : '—';
      const captionVisita = qs('.wizard__summary-caption .wizard__modalidad--visita');
      if (captionVisita) {
        captionVisita.textContent = `Visita, ${cantidad} ${cantidad === 1 ? 'persona' : 'personas'}, ${fecha}, ${horaIn} a ${horaOut}.`;
      }
      return;
    }

    const rango = state.alo.range;
    const total = cantidad * rango.length * monto;
    V2.textoNodo('monto-unitario-alo-maestro', V2.dinero(monto));
    // Sin fechas elegidas no hay total: un "$ 0" haría pensar que la estadía
    // sale gratis.
    V2.textoNodo('monto-total-alo-maestro', rango.length ? V2.dinero(total) : '—');

    const fechas = $('fecha-range-display-alo-maestro');
    if (fechas) fechas.textContent = rango.length ? textoRango(rango) : '—';

    const delegacion = $('resumen-delegacion-maestro');
    if (delegacion) {
      delegacion.textContent = state.delegacion === 'escuelas' ? 'Escuela' : 'Otra institución';
    }

    const captionAlo = qs('.wizard__summary-caption .wizard__modalidad--alojamiento');
    if (captionAlo) {
      captionAlo.textContent = `Estadía, ${cantidad} ${cantidad === 1 ? 'cama' : 'camas'}, ${rango.length ? textoRango(rango) : 'fechas a elegir'}.`;
    }
  }

  /* ------------------------------------------------------- disponibilidad */

  function prepararHorasVisita() {
    const ingreso = $('horaIngreso-maestro');
    const egreso = $('horaEgreso-maestro');
    const horas = [];
    for (let h = 9; h <= 18; h++) horas.push(`${String(h).padStart(2, '0')}:00`);

    [ingreso, egreso].forEach((select) => {
      if (!select) return;
      select.innerHTML = '<option value="">Elegí la hora</option>'
        + horas.map((h) => `<option value="${h}">${h}</option>`).join('');
    });
    if (ingreso) ingreso.value = '09:00';
    if (egreso) egreso.value = '18:00';

    [ingreso, egreso].forEach((select) => {
      if (!select) return;
      select.addEventListener('change', () => {
        actualizarResumen();
        actualizarAvisoVisita();
      });
    });
  }

  /* ---------------------------------------------------------- formularios */

  function contactoDe(prefijoId, numeroId) {
    const prefijo = ($(prefijoId) || {}).value || '';
    const numero = V2.soloDigitos(($(numeroId) || {}).value || '');
    return `${prefijo}${numero}`;
  }

  /* Los datos del responsable los controla validacion.js: obligatorios, solo
     números o solo letras, y el largo de cada campo. Si el archivo no estuviera
     cargado, el envío sigue como antes y responde la API. */
  function validarDatos(form) {
    return !window.V2Validacion || V2Validacion.revisar(form);
  }

  function ponerBotonCargando(boton, cargando, texto) {
    if (!boton) return;
    const label = qs('.btn__label', boton);
    if (!label.dataset.original) label.dataset.original = label.textContent;
    boton.classList.toggle('is-loading', cargando);
    boton.disabled = cargando;
    if (cargando) boton.setAttribute('aria-busy', 'true');
    else boton.removeAttribute('aria-busy');
    label.textContent = cargando ? texto : label.dataset.original;
  }

  /* El plazo de pago lo calcula el servidor contra el día de ingreso:
     ventana_pago_horas antes del inicio (ver docs/MAQUINA-ESTADOS-
     RESERVAS.md). La nota usa la ventana vigente por si un administrador
     la cambia; el número concreto está en la fila de arriba. */
  function textoPlazoVencimiento() {
    const ventana = (state.meta && state.meta.ventanaPagoHoras) || 48;
    return `El plazo se mide contra el día de ingreso: el comprobante se acepta hasta ${ventana} h antes del ingreso.`;
  }

  function mostrarConfirmacion(json, modalidad, datos) {
    const codigo = json.codigoPublico || json.codigo_publico || String(json.idReserva || '');
    const monto = Number(json.montoTotal) || 0;

    V2.textoNodo('confirmacion-albergue', state.alb.nombre);
    V2.textoNodo('confirmacion-codigo', codigo || '—');
    V2.textoNodo('confirmacion-email', datos.email);
    V2.textoNodo('confirmacion-monto', V2.dinero(monto));
    V2.textoNodo(
      'confirmacion-vence',
      V2.fechaHoraLegible(json.pagoVenceAt) || 'Consultá el correo de la reserva'
    );
    V2.textoNodo('confirmacion-vence-nota', textoPlazoVencimiento());

    let detalle = '';
    if (modalidad === 'visita') {
      detalle = `${datos.cantidad} ${datos.cantidad === 1 ? 'persona' : 'personas'} · ${V2.fechaCorta(datos.fecha)} · ${datos.horaIngreso} a ${datos.horaEgreso}`;
    } else {
      const n = noches(datos.range);
      detalle = `${datos.cantidad} ${datos.cantidad === 1 ? 'cama' : 'camas'} · ${datos.range.length} días (${n} ${n === 1 ? 'noche' : 'noches'}) · ${textoRango(datos.range)}`;
    }
    V2.textoNodo('confirmacion-detalle', detalle);

    const linkPago = $('confirmacion-pago-link');
    const linkMiReserva = $('confirmacion-mireserva-link');
    if (linkPago) linkPago.href = `pago.html?codigo=${encodeURIComponent(codigo)}`;
    if (linkMiReserva) linkMiReserva.href = `mi-reserva.html?codigo=${encodeURIComponent(codigo)}`;

    const grid = qs('.wizard__grid');
    const steps = qs('.steps');
    const selector = qs('.wizard > .segmented');
    if (grid) grid.setAttribute('hidden', '');
    if (steps) steps.setAttribute('hidden', '');
    if (selector) selector.setAttribute('hidden', '');

    const confirmacion = $('reserva-confirmada');
    if (confirmacion) {
      confirmacion.removeAttribute('hidden');
      confirmacion.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    limpiarAlerta();
  }

  function prepararFormularioAlo() {
    const form = $('aloFormMaestro');
    const boton = $('btn-submit-alo-maestro');
    if (!form || !boton) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.enviando) return;

      if (!state.alo.valido || state.alo.range.length === 0) {
        mostrarAlerta('Elegí un rango de fechas con disponibilidad completa antes de confirmar.', 'danger');
        irAPaso(3, window.location.hash);
        return;
      }

      if (!validarDatos(form)) return;

      const contacto = contactoDe('prefijo-alo-maestro', 'numero-alo-maestro');
      const campoContacto = $('contacto-alo-maestro');
      if (campoContacto) campoContacto.value = contacto;

      const dni = V2.soloDigitos(($('dni-alo-maestro') || {}).value || '');
      const email = (($('email-alo-maestro') || {}).value || '').trim().toLowerCase();
      const institucion = (($('institucion-alo-maestro') || {}).value || '').trim();
      const responsable = (($('responsable-alo-maestro') || {}).value || '').trim();

      state.enviando = true;
      ponerBotonCargando(boton, true, 'Creando reserva…');
      limpiarAlerta();

      try {
        const json = await V2.apiPost('crearReservaAlojamiento', {
          albergue: state.alb.nombre,
          institucion,
          responsable,
          dni,
          contacto,
          email,
          cantidad: state.cantidadAlo,
          rangoFechas: state.alo.range.join(',')
        });

        if (!json.success) throw new Error(json.message || 'No se pudo crear la reserva.');

        mostrarConfirmacion(json, 'alojamiento', {
          cantidad: state.cantidadAlo,
          range: state.alo.range.slice(),
          email
        });
      } catch (error) {
        mostrarAlerta(error.message || 'No se pudo crear la reserva. Probá de nuevo.', 'danger');
        state.alo.valido = false;
        await validarRangoAlo();
      } finally {
        state.enviando = false;
        ponerBotonCargando(boton, false);
      }
    });
  }

  function prepararFormularioVisita() {
    const form = $('reservaFormMaestro');
    const boton = $('btn-submit-maestro');
    if (!form || !boton) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.enviando) return;

      if (!state.visita.fechaISO) {
        mostrarAlerta('Elegí el día de la visita en el calendario.', 'warning');
        return;
      }
      if (!state.visita.disponible) {
        mostrarAlerta('La fecha elegida no tiene lugar para esa cantidad de personas.', 'danger');
        return;
      }

      const cantidad = state.cantidadVisita;
      const horaIngreso = ($('horaIngreso-maestro') || {}).value || '';
      const horaEgreso = ($('horaEgreso-maestro') || {}).value || '';
      const contacto = contactoDe('prefijo-visita-maestro', 'numero-visita-maestro');
      const campoContacto = $('contacto-maestro');
      if (campoContacto) campoContacto.value = contacto;

      const dni = V2.soloDigitos(($('dni-maestro') || {}).value || '');
      const email = (($('email-maestro') || {}).value || '').trim().toLowerCase();
      const institucion = (($('institucion-maestro') || {}).value || '').trim();
      const responsable = (($('responsable-maestro') || {}).value || '').trim();

      if (!horaIngreso || !horaEgreso) {
        mostrarAlerta('Elegí la hora de ingreso y la de egreso.', 'warning');
        return;
      }
      if (horaEgreso <= horaIngreso) {
        mostrarAlerta('La hora de egreso tiene que ser posterior a la de ingreso.', 'warning');
        return;
      }

      if (!validarDatos(form)) return;

      state.enviando = true;
      ponerBotonCargando(boton, true, 'Creando reserva…');
      limpiarAlerta();

      try {
        const json = await V2.apiPost('crearReserva', {
          albergue: state.alb.nombre,
          institucion,
          responsable,
          dni,
          contacto,
          email,
          cantidad,
          fechaIngreso: state.visita.fechaISO,
          horaIngreso,
          horaEgreso
        });

        if (!json.success) throw new Error(json.message || 'No se pudo crear la visita.');

        mostrarConfirmacion(json, 'visita', {
          cantidad,
          fecha: state.visita.fechaISO,
          horaIngreso,
          horaEgreso,
          email
        });
      } catch (error) {
        mostrarAlerta(error.message || 'No se pudo crear la visita. Probá de nuevo.', 'danger');
        state.visita.disponible = false;
        await cargarDisponibilidadVisita(state.visita.fechaISO);
      } finally {
        state.enviando = false;
        ponerBotonCargando(boton, false);
      }
    });
  }

  /* --------------------------------------------------------------- arranque */

  function leerFechasDeUrl() {
    const params = new URLSearchParams(window.location.search);
    const entrada = params.get('entrada') || '';
    const salida = params.get('salida') || '';
    const cantidad = parseInt(params.get('cantidad'), 10);

    if (Number.isFinite(cantidad) && cantidad > 0) {
      const inputAlo = $('cantidad-alo-maestro');
      const inputVisita = $('cantidad-maestro');
      if (inputAlo) inputAlo.value = String(cantidad);
      if (inputVisita) inputVisita.value = String(cantidad);
      state.cantidadAlo = cantidad;
      state.cantidadVisita = cantidad;
    }

    if (entrada && fechaReservable(entrada)) {
      const fecha = V2.parseISO(entrada);
      state.alo.anio = fecha.getFullYear();
      state.alo.mes = fecha.getMonth();
      state.visita.anio = fecha.getFullYear();
      state.visita.mes = fecha.getMonth();
      state.alo.startISO = entrada;
      state.alo.range = [entrada];
      state.visita.fechaISO = entrada;
      const campoFecha = $('fechaIngreso-maestro');
      if (campoFecha) campoFecha.value = entrada;

      if (salida && salida >= entrada && fechaReservable(salida)) {
        const rango = V2.rangoISO(entrada, salida);
        if (rango.length > 0 && rango.length <= maxDiasAlo()) {
          state.alo.endISO = salida;
          state.alo.range = rango;
        }
      }
    }
  }

  /* ------------------------------------------------- entrada incompleta ---- */
  /*
    Sin albergue y sin modalidad esta página no puede reservar nada. Hasta acá
    adivinaba: el primer albergue de listarAlbergues (maestro) con modalidad
    alojamiento estaba escrito como valor inicial, y así hasta el CTA del nav
    abría siempre el mismo albergue sin poder elegirlo. Ese adivinar ya no
    existe: si falta cualquiera de los dos datos se vuelve al buscador de la
    home, que es donde se eligen.

    Excepción: #step-N-maestro es el camino de revisión de los pasos sin datos
    (README, styleguide y canvas). Esas URLs no vienen de ningún clic real.
  */
  function entradaCompleta() {
    const params = new URLSearchParams(window.location.search);
    const clave = params.get('albergue') || '';
    const modalidad = params.get('modalidad') || '';
    if (clave && (modalidad === 'visita' || modalidad === 'alojamiento')) return true;
    return /^#step-[1-4]-maestro$/.test(window.location.hash);
  }

  function volverAlBuscador() {
    window.location.replace('index.html?motivo=completar#buscador');
  }

  async function iniciar() {
    if (!entradaCompleta()) {
      volverAlBuscador();
      return;
    }

    // La modalidad ya está en la URL: se pinta ahora, sin esperar la API.
    marcarModalidadInicial();

    // Mientras llegan los datos del albergue, los dos calendarios muestran sus
    // esqueletos y el encabezado y el resumen quedan neutros: la página no
    // muestra datos de otro albergue ni días que después cambian.
    albergueCargando(true);
    calendarioCargando($('calendario-alo-maestro'), true);
    calendarioCargando($('calendario-maestro'), true);

    try {
      const meta = await V2.cargarAlbergues();
      state.meta = meta;

      const clave = V2.claveDePagina();
      const alb = V2.buscarAlbergue(meta, clave);
      if (!alb) throw new Error('No hay albergues disponibles para reservar.');
      state.alb = alb;

      const mes = V2.mesActual();
      state.alo.anio = mes.anio;
      state.alo.mes = mes.mes;
      state.visita.anio = mes.anio;
      state.visita.mes = mes.mes;

      aplicarAlbergue();
      // Los datos del albergue ya están: se apaga el estado de carga del
      // encabezado aunque los calendarios sigan esperando su disponibilidad.
      albergueCargando(false);
      prepararCantidades();
      prepararHorasVisita();
      leerFechasDeUrl();

      const delegacion = qs('[name="delegacion"]:checked');
      if (delegacion) state.delegacion = delegacion.value;
      qsa('[name="delegacion"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          if (!radio.checked) return;
          state.delegacion = radio.value;
          actualizarResumen();
          if (state.alo.range.length > maxDiasAlo()) {
            state.alo.endISO = '';
            state.alo.range = state.alo.startISO ? [state.alo.startISO] : [];
            state.alo.valido = false;
            state.alo.invalidos = [];
            pintarCalendarioAlo();
            actualizarAvisoAlo();
            mostrarAlerta(
              `Con este tipo de delegación la estadía admite hasta ${maxDiasAlo()} días. Elegí la salida de nuevo.`,
              'warning'
            );
          }
        });
      });

      prepararModalidad();
      prepararNavegacion();
      prepararCalendarioAlo();
      prepararCalendarioVisita();
      prepararFormularioAlo();
      prepararFormularioVisita();

      pintarCalendarioAlo();
      pintarCalendarioVisita();
      actualizarResumen();
      actualizarAvisoAlo();
      actualizarAvisoVisita();
      actualizarBarraPasos(pasoDesdeHash());

      await refrescarMesAlo();

      if (state.alo.range.length > 1) await validarRangoAlo();
      if (state.visita.fechaISO) await cargarDisponibilidadVisita(state.visita.fechaISO);
    } catch (error) {
      console.error(error);
      // Sin datos, los calendarios se pintan igual (sin disponibilidad) para no
      // dejar los esqueletos colgados. El mes actual se fija acá porque si la
      // falla ocurre antes, state.alo.anio/mes todavía valen 0.
      const mesActual = V2.mesActual();
      state.alo.anio = mesActual.anio;
      state.alo.mes = mesActual.mes;
      state.visita.anio = mesActual.anio;
      state.visita.mes = mesActual.mes;
      albergueSinDatos();
      pintarCalendarioAlo();
      pintarCalendarioVisita();
      mostrarAlerta(error.message || 'No se pudo cargar la página de reserva.', 'danger');
    } finally {
      albergueCargando(false);
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
