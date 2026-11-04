/* ==========================================================================
   overlays.js — cierre animado de la ficha y del visor
   --------------------------------------------------------------------------
   La apertura la resuelve el CSS con :target. El cierre no: al cambiar el hash
   el elemento vuelve a display:none y desaparece de un cuadro al siguiente.

   Esta capa intercepta el cierre, deja que el CSS anime (clase .is-closing),
   espera a que la animación termine y recién ahí cambia el hash. Sin este
   archivo todo funciona igual que antes: las anclas navegan solas.

   Qué agrega sobre el comportamiento actual:
   - Cerrar con Escape (primero el visor, después la ficha).
   - Devolver el foco al control que abrió la capa.
   - Bloquear el scroll del fondo sin que el contenido salte.
   - No sumar una entrada al historial por cada cierre.
   ========================================================================== */
(function () {
  'use strict';

  if (!document.querySelector('.modal')) return;

  var RED_MS = 320;
  var cerrando = new WeakSet();
  var disparador = null;

  /* ------------------------------------------------------------- helpers */

  function capaVisible() {
    var visor = Array.prototype.slice
      .call(document.querySelectorAll('.visor'))
      .filter(function (v) { return !!v.querySelector('img:target'); })[0];
    if (visor) return visor;

    return Array.prototype.slice
      .call(document.querySelectorAll('.modal'))
      .filter(function (m) { return getComputedStyle(m).display !== 'none'; })[0] || null;
  }

  function esVisor(capa) {
    return capa.classList.contains('visor');
  }

  /* Con movimiento reducido la animación dura 0 y no hay animationend fiable:
     el timeout es la red de seguridad en todos los casos. */
  function esperarAnimacion(capa) {
    var objetivo = esVisor(capa)
      ? capa.querySelector('img:target')
      : capa.querySelector('.modal__panel');

    if (!objetivo || typeof objetivo.getAnimations !== 'function') {
      return Promise.resolve();
    }

    var corriendo = objetivo.getAnimations().filter(function (a) {
      return a.playState === 'running';
    });
    if (!corriendo.length) return Promise.resolve();

    var terminadas = Promise.all(corriendo.map(function (a) {
      return a.finished.catch(function () {});
    }));

    var tope = new Promise(function (listo) {
      window.setTimeout(listo, RED_MS);
    });

    return Promise.race([terminadas, tope]);
  }

  /* --------------------------------------------------------------- scroll */

  function bloquearScroll(activo) {
    var html = document.documentElement;
    if (activo) {
      // Ancho de la barra para que el contenido no salte al ocultarla.
      var ancho = window.innerWidth - html.clientWidth;
      html.style.setProperty('--ancho-barra', ancho + 'px');
    }
    html.classList.toggle('hay-capa', activo);
  }

  /* ---------------------------------------------------------------- foco */

  function guardarDisparador() {
    var activo = document.activeElement;
    if (!activo || activo === document.body || !activo.closest) return;

    // Al abrirse, el foco cae en la propia capa (el diálogo lleva tabindex="-1").
    // Eso no es un disparador: el ancla que abrió ya quedó guardada en el clic.
    if (activo.closest('.modal, .visor')) return;

    disparador = activo;
  }

  function devolverFoco() {
    if (disparador && document.contains(disparador)) {
      disparador.focus({ preventScroll: true });
      return;
    }
    // Sin referencia: la grilla de albergues es el destino razonable.
    var tarjeta = document.querySelector('.card[data-albergue]');
    if (tarjeta) tarjeta.focus({ preventScroll: true });
  }

  /* Al procesar el hash el navegador manda el foco al body, y eso ocurre
     DESPUÉS de que el script cierra la capa: enfocar antes se pierde. Se espera
     a que la navegación ocurra y recién ahí se devuelve el foco, cuadro por
     cuadro, con un tope por si el hash no cambia. */
  var navegacionHecha = false;
  var focoPendiente = false;

  function devolverFocoCuandoNavegue() {
    var intentos = 0;

    // Con setTimeout y no con requestAnimationFrame: si la pestaña no está
    // visible los cuadros no corren y el foco se perdería.
    function intentar() {
      if (!focoPendiente) return;

      // Mientras la capa siga abierta se sigue esperando: la navegación del
      // hash todavía no ocurrió y enfocar ahora se perdería.
      if (!capaVisible() && (navegacionHecha || intentos > 8)) {
        devolverFoco();
        focoPendiente = false;
        return;
      }

      intentos++;
      if (intentos > 20) {
        focoPendiente = false;
        return;
      }
      window.setTimeout(intentar, 50);
    }

    window.setTimeout(intentar, 40);
  }

  /* --------------------------------------------------------------- cierre */

  function cerrar(capa, destino) {
    if (!capa || cerrando.has(capa)) return;
    cerrando.add(capa);

    capa.classList.add('is-closing');

    esperarAnimacion(capa).then(function () {
      capa.classList.remove('is-closing');
      cerrando.delete(capa);

      // location.replace con un hash reemplaza la entrada actual (no suma
      // historial) y además reevalúa :target. replaceState cambiaría la URL
      // pero no el :target, y la capa quedaría abierta.
      // El foco sólo vuelve al cerrar la ficha: cerrar el visor devuelve a la
      // ficha y ahí el usuario sigue dentro de la capa.
      if (!esVisor(capa)) {
        navegacionHecha = false;
        focoPendiente = true;
        devolverFocoCuandoNavegue();
      }

      if (destino) window.location.replace(destino);

      bloquearScroll(!!capaVisible());
    });
  }

  /* -------------------------------------------------------------- eventos */

  // Se guarda el ancla que ABRE, antes de que el navegador navegue al hash.
  // Los controles de cierre quedan afuera: si no, el clic de cierre pisaría al
  // disparador y el foco volvería a un enlace que ya está oculto.
  document.addEventListener('click', function (e) {
    var ancla = e.target.closest ? e.target.closest('a') : null;
    if (!ancla) return;
    if (ancla.closest('.modal__close, .modal__backdrop, .visor__close, .visor__backdrop')) return;

    var href = ancla.getAttribute('href') || '';
    if (href.charAt(0) === '#') disparador = ancla;
  }, true);

  document.addEventListener('click', function (e) {
    var control = e.target.closest
      ? e.target.closest('.modal__close, .modal__backdrop, .visor__close, .visor__backdrop')
      : null;
    if (!control) return;

    var capa = control.closest('.visor') || control.closest('.modal');
    if (!capa) return;

    e.preventDefault();
    cerrar(capa, control.getAttribute('href'));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;

    var capa = capaVisible();
    if (!capa) return;

    e.preventDefault();
    var cierre = esVisor(capa)
      ? capa.querySelector('.visor__close')
      : capa.querySelector('.modal__close');
    if (cierre) cerrar(capa, cierre.getAttribute('href'));
  });

  window.addEventListener('hashchange', function () {
    navegacionHecha = true;
    var abierta = capaVisible();
    if (abierta) guardarDisparador();
    bloquearScroll(!!abierta);
  });

  bloquearScroll(!!capaVisible());
})();
