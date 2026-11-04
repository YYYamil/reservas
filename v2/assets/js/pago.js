/* ==========================================================================
   pago.js — carga del comprobante (pago.html)
   --------------------------------------------------------------------------
   Usa el endpoint público `subirComprobante` (multipart):
     action=subirComprobante, codigo, comprobante (PDF/JPG/PNG, hasta 8 MB).

   El envío va con XMLHttpRequest para poder mostrar el progreso real de la
   subida. Los estados de la tarjeta se manejan con `data-estado` en el form
   (sin-archivo, subiendo, recibido, rechazado, error-red); sin JS los estados
   siguen funcionando con #hash gracias a las reglas :target del CSS.
   ========================================================================== */
(function () {
  'use strict';

  const MAX_BYTES = 8 * 1024 * 1024;
  const TIPOS = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPG',
    'image/png': 'PNG'
  };
  const EXTENSIONES = { pdf: 'PDF', jpg: 'JPG', jpeg: 'JPG', png: 'PNG' };

  const form = document.getElementById('pagoForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const codigoInput = $('pago-codigo');
  const archivoInput = $('pago-archivo');
  const boton = $('pagoBtn');
  const mensaje = $('pagoMsg');
  const mensajeTexto = $('pagoMsg-texto');
  const drop = form.querySelector('.upload__drop');

  let archivo = null;
  let xhr = null;

  /* ------------------------------------------------------------- mensajes */

  function mostrarMensaje(texto) {
    if (!mensaje || !mensajeTexto) return;
    mensajeTexto.textContent = texto || '';
    mensaje.removeAttribute('hidden');
  }

  function limpiarMensaje() {
    if (!mensaje) return;
    mensaje.setAttribute('hidden', '');
  }

  /* --------------------------------------------------------------- estado */

  function estado(valor) {
    form.dataset.estado = valor;
    // Mientras sube, el formulario está ocupado: el lector no anuncia cambios
    // internos y el CSS puede mostrar el estado como en curso.
    if (valor === 'subiendo') form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
    // El CSS no-JS usa :target; con JS manda data-estado.
    form.classList.add('pago__card--js');
  }

  function resetear() {
    archivo = null;
    if (xhr) {
      try { xhr.abort(); } catch (error) { /* sin conexión activa */ }
      xhr = null;
    }
    if (archivoInput) archivoInput.value = '';
    if (boton) boton.disabled = true;
    limpiarMensaje();
    estado('sin-archivo');
  }

  /* --------------------------------------------------------------- archivo */

  function tipoDeArchivo(file) {
    const porMime = TIPOS[file.type];
    if (porMime) return porMime;
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    return EXTENSIONES[extension] || '';
  }

  function etiquetaArchivo(file) {
    const tipo = tipoDeArchivo(file) || 'Archivo';
    return `${window.V2 ? V2.tamanoLegible(file.size) : file.size + ' B'}, ${tipo}`;
  }

  function prepararArchivo(file) {
    if (!file) {
      archivo = null;
      if (boton) boton.disabled = true;
      limpiarMensaje();
      return false;
    }

    if (!tipoDeArchivo(file)) {
      mostrarMensaje('El comprobante tiene que ser un PDF, JPG o PNG.');
      resetear();
      return false;
    }

    if (file.size > MAX_BYTES) {
      mostrarMensaje('El comprobante supera los 8 MB. Comprimí la foto o subí un PDF más chico.');
      resetear();
      return false;
    }

    archivo = file;
    if (boton) boton.disabled = false;
    limpiarMensaje();

    const nombre = file.name || 'comprobante';
    const meta = etiquetaArchivo(file);
    texto('subiendo-nombre', nombre);
    texto('subiendo-meta', `${meta}, subiendo`);
    texto('recibido-nombre', nombre);
    texto('recibido-meta', meta);
    texto('rechazado-nombre', nombre);
    texto('rechazado-meta', meta);
    texto('error-nombre', nombre);
    texto('error-meta', meta);
    return true;
  }

  function texto(id, valor) {
    const nodo = $(id);
    if (nodo) nodo.textContent = valor;
  }

  /* ------------------------------------------------------------------ envío */

  function codigoNormalizado() {
    return (codigoInput ? codigoInput.value : '').trim().toUpperCase();
  }

  function enviar() {
    if (!archivo) {
      mostrarMensaje('Elegí el comprobante antes de enviarlo.');
      return;
    }

    // El código de reserva lo controla validacion.js (data-regla="codigo").
    if (window.V2Validacion && !V2Validacion.revisar(form)) return;

    const codigo = codigoNormalizado();
    if (!codigo) {
      mostrarMensaje('Ingresá el código de reserva.');
      if (codigoInput) codigoInput.focus();
      return;
    }

    if (xhr) {
      try { xhr.abort(); } catch (error) { /* sin conexión activa */ }
      xhr = null;
    }

    limpiarMensaje();
    estado('subiendo');

    const progreso = $('subiendo-progress');
    if (progreso) progreso.value = 0;
    texto('subiendo-meta', `${etiquetaArchivo(archivo)}, subiendo`);

    const datos = new FormData();
    datos.append('action', 'subirComprobante');
    datos.append('codigo', codigo);
    datos.append('comprobante', archivo, archivo.name);

    const pedido = new XMLHttpRequest();
    xhr = pedido;
    pedido.open('POST', V2.API_URL, true);
    pedido.responseType = 'text';
    pedido.setRequestHeader('Accept', 'application/json');

    pedido.upload.addEventListener('progress', (evento) => {
      if (!evento.lengthComputable) return;
      const porcentaje = Math.max(0, Math.min(100, Math.round((evento.loaded / evento.total) * 100)));
      if (progreso) progreso.value = porcentaje;
      texto('subiendo-meta', `${etiquetaArchivo(archivo)}, ${porcentaje} %`);
    });

    pedido.addEventListener('load', () => {
      xhr = null;
      let json = null;
      try {
        json = JSON.parse(pedido.responseText || '');
      } catch (error) {
        json = null;
      }

      if (pedido.status >= 200 && pedido.status < 300 && json && json.success) {
        recibido(json);
        return;
      }

      const mensajeApi = json && json.message
        ? json.message
        : 'El servidor no pudo recibir el comprobante. Probá de nuevo.';
      rechazado(mensajeApi);
    });

    pedido.addEventListener('error', () => {
      xhr = null;
      estado('error-red');
    });

    pedido.addEventListener('abort', () => {
      xhr = null;
    });

    pedido.send(datos);
  }

  function recibido(json) {
    estado('recibido');
    limpiarMensaje();

    const codigo = (json && json.codigo) || codigoNormalizado();
    if (json && json.codigo && codigoInput) codigoInput.value = json.codigo;

    const enlaceReserva = $('recibido-mireserva');
    if (enlaceReserva) {
      enlaceReserva.href = `mi-reserva.html?codigo=${encodeURIComponent(codigo)}`;
    }

    document.querySelectorAll('[data-accion="consultar"]').forEach((enlace) => {
      if (enlace.tagName === 'A') {
        enlace.href = `mi-reserva.html?codigo=${encodeURIComponent(codigo)}`;
      }
    });

    const nota = $('recibido-texto');
    if (nota && json && json.mensaje) nota.textContent = json.mensaje;
  }

  function rechazado(textoError) {
    estado('rechazado');
    texto('rechazado-texto', textoError);
  }

  /* ----------------------------------------------------------------- eventos */

  if (archivoInput) {
    archivoInput.addEventListener('change', () => {
      prepararArchivo(archivoInput.files && archivoInput.files[0]);
    });
  }

  if (drop) {
    ['dragenter', 'dragover'].forEach((evento) => {
      drop.addEventListener(evento, (e) => {
        e.preventDefault();
        drop.classList.add('upload__drop--over');
      });
    });
    ['dragleave', 'drop'].forEach((evento) => {
      drop.addEventListener(evento, (e) => {
        e.preventDefault();
        drop.classList.remove('upload__drop--over');
      });
    });
    drop.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (prepararArchivo(file)) {
        // Mantenemos el input sincronizado para que el form también lo lleve.
        try {
          const transferencia = new DataTransfer();
          transferencia.items.add(file);
          archivoInput.files = transferencia.files;
        } catch (error) {
          // Algunos navegadores no permiten asignar files; el envío usa `archivo`.
        }
      }
    });
  }

  /* El código se escribe en mayúsculas y sin caracteres raros por
     validacion.js (data-regla="codigo"), no acá. */

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    enviar();
  });

  const cancelarSubida = $('btn-cancelar-subida');
  if (cancelarSubida) {
    cancelarSubida.addEventListener('click', () => {
      if (xhr) {
        try { xhr.abort(); } catch (error) { /* sin conexión activa */ }
        xhr = null;
      }
      resetear();
      mostrarMensaje('Se canceló la subida. El comprobante no se envió.');
    });
  }

  const reintentar = $('btn-reintentar');
  if (reintentar) reintentar.addEventListener('click', enviar);

  const elegirRechazado = $('btn-elegir-otro-rechazado');
  if (elegirRechazado) {
    elegirRechazado.addEventListener('click', () => {
      resetear();
      if (archivoInput) archivoInput.focus();
    });
  }

  const elegirError = $('btn-elegir-otro-error');
  if (elegirError) {
    elegirError.addEventListener('click', () => {
      resetear();
      if (archivoInput) archivoInput.focus();
    });
  }

  /* ------------------------------------------------------------- arranque */

  function iniciar() {
    form.classList.add('pago__card--js');
    const codigoUrl = new URLSearchParams(window.location.search).get('codigo');
    if (codigoUrl && codigoInput) {
      codigoInput.value = codigoUrl.toUpperCase();
      limpiarMensaje();
    }
    if (boton) boton.disabled = true;
    estado(form.dataset.estado || 'sin-archivo');
  }

  iniciar();
})();
