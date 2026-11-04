/* ==========================================================================
   mi-reserva.js — búsqueda y cancelación (mi-reserva.html)
   --------------------------------------------------------------------------
   El backend no tiene un endpoint público para consultar el estado de una
   reserva. Por eso "buscar" solo valida el formato de los datos y abre la
   confirmación; la reserva se valida de verdad al cancelar, con:

     action=cancelarReserva, idReserva=<código>, dni=<DNI>

   La respuesta trae { success, message } y nada más: la página muestra el
   mensaje de la API, sin inventar montos de devolución.
   ========================================================================== */
(function () {
  'use strict';

  const form = document.getElementById('cancelForm');
  const codigoInput = document.getElementById('cancel-id');
  const dniInput = document.getElementById('cancel-dni');
  const buscar = document.querySelector('#buscar-reserva [data-accion="consultar"]');
  const cancelar = document.getElementById('btn-cancelar-enviar');
  const volver = document.getElementById('btn-volver-buscar');
  const alerta = document.getElementById('consulta-alerta');
  const alertaTexto = document.getElementById('consulta-alerta-texto');
  const comprobante = document.getElementById('comprobante-link');

  let codigo = '';
  let dni = '';
  let enviando = false;

  const $ = (id) => document.getElementById(id);

  function texto(id, valor) {
    const nodo = $(id);
    if (nodo) nodo.textContent = valor;
  }

  function mostrarAlerta(mensaje) {
    if (!alerta || !alertaTexto) return;
    alertaTexto.textContent = mensaje;
    alerta.removeAttribute('hidden');
  }

  function limpiarAlerta() {
    if (alerta) alerta.setAttribute('hidden', '');
  }

  function normalizarCodigo(valor) {
    return String(valor || '').trim().toUpperCase();
  }

  function dniValido(valor) {
    return /^\d{7,8}$/.test(String(valor || ''));
  }

  function actualizarEnlaces() {
    if (!codigo) return;
    if (comprobante) comprobante.href = `pago.html?codigo=${encodeURIComponent(codigo)}`;
  }

  function leerFormulario() {
    codigo = normalizarCodigo(codigoInput ? codigoInput.value : '');
    dni = window.V2 ? V2.soloDigitos(dniInput ? dniInput.value : '') : String((dniInput || {}).value || '');
    if (dniInput) dniInput.value = dni;
    if (codigoInput) codigoInput.value = codigo;
  }

  function irA(id) {
    if (window.location.hash === `#${id}`) {
      // Fuerza el repintado de :target cuando se repite el mismo estado.
      window.location.hash = '';
      window.requestAnimationFrame(() => { window.location.hash = id; });
      return;
    }
    window.location.hash = id;
  }

  /* --------------------------------------------------------------- buscar */

  function confirmarBusqueda(evento) {
    if (evento) evento.preventDefault();

    // Código y DNI: obligatorios, formato y largo (assets/js/validacion.js).
    if (window.V2Validacion && !V2Validacion.revisar(form)) return;

    leerFormulario();
    limpiarAlerta();

    if (!codigo) {
      mostrarAlerta('Ingresá el código de reserva.');
      if (codigoInput) codigoInput.focus();
      return;
    }
    if (!dniValido(dni)) {
      mostrarAlerta('El DNI del responsable tiene que tener 7 u 8 números.');
      if (dniInput) dniInput.focus();
      return;
    }

    const corto = dni.length > 4 ? `…${dni.slice(-4)}` : dni;
    texto(
      'confirmar-texto',
      `Al confirmar, la reserva del código ${codigo} (DNI ${corto}) queda cancelada y el cupo vuelve a estar disponible para otro grupo.`
    );
    actualizarEnlaces();
    irA('confirmar-cancelacion');
  }

  /* -------------------------------------------------------------- cancelar */

  function ponerBotonCargando(boton, cargando) {
    if (!boton) return;
    const etiqueta = boton.querySelector('.btn__label');
    if (etiqueta && !etiqueta.dataset.original) etiqueta.dataset.original = etiqueta.textContent;
    // is-loading es el estado del sistema: muestra el anillo del botón.
    boton.classList.toggle('is-loading', cargando);
    boton.disabled = cargando;
    if (cargando) boton.setAttribute('aria-busy', 'true');
    else boton.removeAttribute('aria-busy');
    if (etiqueta) {
      etiqueta.textContent = cargando ? 'Cancelando…' : (etiqueta.dataset.original || 'Cancelar la reserva');
    }
  }

  async function enviarCancelacion() {
    if (enviando) return;
    leerFormulario();

    if (!codigo || !dniValido(dni)) {
      // Si alguien llegó al hash sin los datos, vuelve al paso 1.
      irA('buscar-reserva');
      mostrarAlerta('Completá el código y el DNI antes de cancelar.');
      return;
    }

    enviando = true;
    ponerBotonCargando(cancelar, true);
    limpiarAlerta();

    try {
      const json = await V2.apiPost('cancelarReserva', {
        idReserva: codigo,
        dni
      });

      if (!json.success) {
        throw new Error(json.message || 'No se pudo cancelar la reserva.');
      }

      const mensaje = json.message || 'Reserva cancelada correctamente.';
      texto(
        'cancelada-texto',
        `${mensaje} La reserva ${codigo} ya no ocupa cupo y el código no sirve para cargar el comprobante.`
      );
      texto('cancelada-aviso', mensaje);
      irA('reserva-cancelada');
    } catch (error) {
      texto(
        'rechazada-texto',
        error.message || 'No se pudo cancelar la reserva. Revisá el código y el DNI.'
      );
      irA('cancelacion-rechazada');
    } finally {
      enviando = false;
      ponerBotonCargando(cancelar, false);
    }
  }

  /* --------------------------------------------------------------- eventos */

  if (form) form.addEventListener('submit', confirmarBusqueda);
  if (buscar && buscar.tagName !== 'BUTTON') {
    // Sin JS el enlace es la forma de navegar; con JS lo interceptamos.
    buscar.addEventListener('click', confirmarBusqueda);
  }

  if (cancelar) cancelar.addEventListener('click', enviarCancelacion);

  if (volver) {
    volver.addEventListener('click', () => {
      if (dniInput) dniInput.value = '';
      dni = '';
      limpiarAlerta();
    });
  }

  /* Las mayúsculas del código y los dígitos del DNI los filtra validacion.js
     (data-regla="codigo" y data-regla="dni"), así que acá solo queda limpiar el
     aviso anterior mientras se escribe. */
  [codigoInput, dniInput].forEach((input) => {
    if (!input) return;
    input.addEventListener('input', limpiarAlerta);
  });

  /* ------------------------------------------------------------- arranque */

  function iniciar() {
    const params = new URLSearchParams(window.location.search);
    const deUrl = normalizarCodigo(params.get('codigo'));
    if (deUrl && codigoInput) {
      codigoInput.value = deUrl;
      codigo = deUrl;
      actualizarEnlaces();
    }

    const hash = window.location.hash.replace('#', '');
    const estados = ['buscar-reserva', 'confirmar-cancelacion', 'reserva-cancelada', 'cancelacion-rechazada'];
    if (estados.includes(hash) && hash !== 'buscar-reserva') {
      // Un enlace directo a un estado posterior sin datos vuelve a la búsqueda.
      if (!codigo || !dniValido(dni)) {
        irA('buscar-reserva');
      }
    }
  }

  iniciar();
})();
