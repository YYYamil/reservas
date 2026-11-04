/* ==========================================================================
   index.js — home de la v2
   --------------------------------------------------------------------------
   Las tarjetas y las fichas son markup estático. Este script conecta los
   enlaces y los números que dependen de datos reales del albergue:

   - [data-placeholder="mapa-{clave}"]       → campo `mapa` de listarAlbergues.
   - [data-placeholder="reglamento-{clave}"] → campo `pdf` de listarAlbergues.
   - [data-modalidad] [data-rol="capacidad"] y [data-rol="precio"]
     → `capacidad`, `capacidad_visitas`, `monto_cama` y `monto_visita`. Es la
     fila de modalidad que comparten la tarjeta y la ficha: la capacidad y el
     precio son de la base, la modalidad y la unidad son texto fijo.

   No embebe el mapa: lo abre en una pestaña nueva, igual que el reglamento.
   Si un albergue no tiene PDF, su control queda como está (deshabilitado en el
   markup) y no se inventa un enlace. Lo mismo con los números: si la base no
   trae el dato, queda el valor del markup, que salió de la misma base.

   Además maneja el estado de carga de la sección Albergues: mientras viaja
   listarAlbergues se ve el esqueleto y la línea de estado, al responder la
   grilla entra con el barrido del sistema, y si la API falla la grilla
   estática igual se muestra con un aviso.

   Y sincroniza el destino de los CTA que heredan del buscador ([data-cta-
   hereda]): la modalidad marcada arriba y la cantidad viajan al wizard, para
   que la tarjeta no abra una modalidad que nadie eligió.
   ========================================================================== */
(function () {
  'use strict';

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function $(id) {
    return document.getElementById(id);
  }

  function prepararEnlace(enlace, url) {
    if (!enlace || !url) return;
    enlace.href = url;
    enlace.target = '_blank';
    enlace.rel = 'noopener';
    enlace.removeAttribute('data-placeholder');
  }

  /* ------------------------------------------------- datos de la tarjeta */
  /*
    Una fila por modalidad, en la tarjeta y en la ficha. La fila se reconoce por
    data-modalidad y cada valor por su data-rol: así el mismo dato se escribe una
    vez por superficie y no queda una tarjeta con la capacidad vieja al lado de
    una ficha actualizada. Si la base no trae el número (0, vacío o texto), no se
    toca el markup: el valor de ejemplo salió de la misma base.
  */
  function escribir(fila, rol, valor) {
    if (!fila || !valor) return;
    const nodo = fila.querySelector(`[data-rol="${rol}"]`);
    if (nodo) nodo.textContent = valor;
  }

  function plural(cantidad, singular, varios) {
    return `${cantidad} ${cantidad === 1 ? singular : varios}`;
  }

  function hidratarDatos(albergue) {
    const clave = albergue.clave;
    if (!clave) return;

    const camas = Number(albergue.capacidad) || 0;
    const lugares = Number(albergue.capacidad_visitas) || camas;
    const precioCama = Number(albergue.monto_cama) || 0;
    const precioVisita = Number(albergue.monto_visita) || 0;

    const raices = [
      document.getElementById(`albergue-${clave}`),
      document.getElementById(`modal-${clave}`)
    ].filter(Boolean);

    raices.forEach((raiz) => {
      const estadia = raiz.querySelector('[data-modalidad="estadia"]');
      const visita = raiz.querySelector('[data-modalidad="visita"]');

      if (camas > 0) escribir(estadia, 'capacidad', plural(camas, 'cama', 'camas'));
      if (precioCama > 0) escribir(estadia, 'precio', V2.dinero(precioCama));
      if (lugares > 0) escribir(visita, 'capacidad', plural(lugares, 'lugar', 'lugares'));
      if (precioVisita > 0) escribir(visita, 'precio', V2.dinero(precioVisita));
    });
  }

  function conectarAlbergue(albergue) {
    const clave = albergue.clave;
    if (!clave) return;

    hidratarDatos(albergue);

    document.querySelectorAll(`[data-placeholder="mapa-${clave}"]`).forEach((enlace) => {
      prepararEnlace(enlace, albergue.mapa || '');
    });

    const pdf = V2.resolverRutaSitio(albergue.pdf || '');
    document.querySelectorAll(`[data-placeholder="reglamento-${clave}"]`).forEach((enlace) => {
      // encodeURI conserva las barras y resuelve espacios y acentos del nombre
      // del archivo, por ejemplo "docs/Albergue Aquilina.pdf".
      prepararEnlace(enlace, pdf ? encodeURI(pdf) : '');
    });
  }

  /* ------------------------------------------------------ estado de carga */

  function ponerCargando(activo) {
    const seccion = $('albergues');
    if (seccion) {
      if (activo) seccion.setAttribute('aria-busy', 'true');
      else seccion.removeAttribute('aria-busy');
    }
    V2.mostrar($('resultados-estado'), activo);
    V2.mostrar($('resultados-cargando'), activo);
    V2.mostrar($('resultados-grilla'), !activo);
  }

  /* La grilla entra con el barrido del sistema cuando la respuesta ya está.
     Se reinicia la animación por si la carga se repite. */
  function revelarGrilla() {
    const grilla = $('resultados-grilla');
    if (!grilla) return;
    grilla.classList.remove('is-revealing');
    void grilla.offsetWidth;
    grilla.classList.add('is-revealing');
  }

  /* ------------------------------------------- CTAs que heredan del buscador */
  /*
    La modalidad y la cantidad se eligen una sola vez, en el buscador de arriba.
    Las tarjetas no repiten esa decisión: la heredan, y el texto del botón dice
    cuál se va a reservar. Antes el CTA de la tarjeta abría el wizard con la
    modalidad por defecto y sin forma de elegir, que es la confusión que se
    corrigió. Solo toca los CTA marcados con data-cta-hereda: los dos de la
    ficha llevan su modalidad escrita y no se tocan.
  */
  function sincronizarCtas() {
    const ctas = qsa('[data-cta-hereda]');
    if (!ctas.length) return;

    const leer = () => {
      const radio = qs('.hero__form [name="modalidad"]:checked');
      const modalidad = radio && radio.value === 'alojamiento' ? 'alojamiento' : 'visita';
      const campo = qs('.hero__form [data-campo="cantidad"]');
      const cantidad = campo ? Math.max(1, parseInt(campo.value, 10) || 1) : 1;
      return { modalidad, cantidad };
    };

    const aplicar = () => {
      const { modalidad, cantidad } = leer();
      ctas.forEach((cta) => {
        const href = cta.getAttribute('href') || '';
        const [ruta, consulta] = href.split('?');
        const clave = new URLSearchParams(consulta || '').get('albergue') || '';
        if (!clave) return;

        const params = new URLSearchParams({ albergue: clave, modalidad });
        params.set('cantidad', String(cantidad));
        cta.setAttribute('href', `${ruta}?${params.toString()}`);

        const etiqueta = qs('.btn__label', cta);
        if (etiqueta) {
          etiqueta.textContent = modalidad === 'visita' ? 'Reservar visita' : 'Reservar estadía';
        }
      });
    };

    qsa('.hero__form [name="modalidad"]').forEach((radio) => {
      radio.addEventListener('change', aplicar);
    });

    const campo = qs('.hero__form [data-campo="cantidad"]');
    if (campo) campo.addEventListener('input', aplicar);

    aplicar();
  }

  /* ----------------------------------------------- aviso de entrada ---- */
  /* reservar.html vuelve acá con ?motivo=completar cuando el enlace que la abrió
     no traía albergue ni modalidad. Sin el aviso, la vuelta parece un error. */
  function avisoDeEntrada() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('motivo') !== 'completar') return;
    V2.mostrar($('buscador-aviso'), true);
  }

  async function iniciar() {
    const aviso = $('resultados-aviso');
    if (aviso) aviso.hidden = true;

    ponerCargando(true);

    try {
      const meta = await V2.cargarAlbergues();
      meta.lista.forEach(conectarAlbergue);
    } catch (error) {
      // La home sigue siendo navegable aunque falle la API; solo estos enlaces
      // quedan sin hidratar, y eso se dice en pantalla.
      console.warn('No se pudieron cargar los enlaces de mapa y reglamento:', error);
      if (aviso) aviso.hidden = false;
    } finally {
      ponerCargando(false);
      revelarGrilla();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    avisoDeEntrada();
    sincronizarCtas();
    iniciar();
  });
})();
