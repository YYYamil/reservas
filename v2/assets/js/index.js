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

   Además la franja de fotos (sección Franja en la home) se desliza sola, de
   punta a punta y de vuelta, mientras nadie la usa: cede el control con el
   puntero o el foco adentro, con una capa abierta, si la sección salió de
   pantalla o si la pestaña quedó oculta. Con movimiento reducido no se mueve.
   ========================================================================== */
(function () {
  'use strict';

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /* Re-disparar la animación de re-impresión de motion.css: quita la clase,
     fuerza el reflow y la vuelve a poner, para que un texto nuevo se vuelva a
     escribir aunque el nodo ya tuviera la animación. Puro presentación: no
     toca datos ni estados de ninguna lógica. */
  function reimprimir(nodo) {
    if (!nodo) return;
    nodo.classList.remove('is-reprint');
    void nodo.offsetWidth;
    nodo.classList.add('is-reprint');
  }

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
          const texto = modalidad === 'visita' ? 'Reservar visita' : 'Reservar estadía';
          // Sólo si cambió: cambiar la cantidad sin tocar la modalidad no
          // debe re-escribir el mismo texto una y otra vez.
          if (etiqueta.textContent !== texto) {
            etiqueta.textContent = texto;
            reimprimir(etiqueta);
          }
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

  /* ----------------------------------------------------- franja de fotos */
  /*
    La franja se desliza sola: un ping-pong continuo que recorre la tira de
    punta a punta invirtiendo la dirección en los bordes, sin duplicar el DOM
    y sin cortes. Es movimiento de ambiente, así que cede el control apenas
    alguien lo necesita, y retoma desde donde quedó:

    - Puntero o foco teclado adentro de la tira: pausa, retoma al salir.
    - Capa abierta (ficha, visor): mira html.hay-capa, que overlays.js enciende
      y apaga al entrar y cerrar.
    - Sección fuera de pantalla o pestaña oculta: pausa.
    - Tocar la tira: pausa mientras dura el toque y retoma un rato después, no
      a mitad del gesto.
    - Scroll manual (rueda horizontal, arrastre, teclas de desplazamiento):
      la tira queda con el snap y sin deslize por un rato.
    - Movimiento reducido del sistema: no desliza nunca, ni a mitad de sesión.
  */
  function iniciarFranja() {
    const tira = qs('.gallery__tira');
    if (!tira || 'glide' in tira.dataset) return;
    tira.dataset.glide = 'on';

    const VELOCIDAD = 40;   // px por segundo
    const REANUDA_MS = 2500; // ventana tras el toque o el scroll manual
    const TECLAS_SCROLLO = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pausa = {
      puntero: false, // el cursor está sobre la tira
      foco: false,    // el foco está en la tira o dentro
      fuera: true,    // la sección no está en pantalla (lo define el observer)
      tactil: false,  // hay un dedo tocando la tira
    };

    let direccion = 1;    // 1 avanza al final de la tira, -1 vuelve al inicio
    let ultimo = 0;       // marca de tiempo del cuadro anterior
    let cuadro = 0;       // id del rAF pedido (0 = deslize colgado)
    let manualHasta = 0;  // scroll manual: respeta hasta esta marca de tiempo
    let alReanudar = 0;   // id del timeout que revisa el estado tras el toque
    let toqueX = 0;       // ancla del dedo para saber si el gesto es horizontal
    let toqueY = 0;

    /* El deslize sólo corre si no hay ningún motivo de pausa. El chequeo del
       snap lo lleva la clase is-gliding, no este cálculo. */
    function puedeDeslizar() {
      return (
        !reducido.matches &&
        !pausa.puntero && !pausa.foco && !pausa.fuera && !pausa.tactil &&
        performance.now() >= manualHasta &&
        !document.documentElement.classList.contains('hay-capa') &&
        !document.hidden &&
        tira.scrollWidth > tira.clientWidth
      );
    }

    function paso(marca) {
      cuadro = 0;

      // La capa se abrió, la pestaña quedó oculta o el sistema pidió menos
      // movimiento después del último evento: no avanza por su cuenta y
      // espera a que un evento llame a sincronizar de nuevo.
      if (!puedeDeslizar()) return;

      // Tras una pausa larga no corre la distancia guardada: cada reanudación
      // toma el cuadro como si el giro recién arrancara.
      const dt = Math.min(marca - ultimo, 100);
      ultimo = marca;

      let x = tira.scrollLeft + direccion * VELOCIDAD * dt / 1000;
      const limite = tira.scrollWidth - tira.clientWidth;

      // Ping-pong: en el borde se apoya y da la vuelta, sin saltar.
      if (x >= limite) { x = limite; direccion = -1; }
      else if (x <= 0) { x = 0; direccion = 1; }

      tira.scrollLeft = x;
      cuadro = requestAnimationFrame(paso);
    }

    function sincronizar() {
      const corriendo = puedeDeslizar();

      // La clase es pegajosa: mientras el deslize es el dueño del scroll
      // (corriendo o en pausa retomable) el snap queda apagado, para que
      // retomar después del hover o de una capa no salte al punto de anclaje
      // más cercano. Sólo el scroll manual la saca: ahí el snap vuelve a
      // mandar, que es lo que el usuario está pidiendo.
      if (corriendo) tira.classList.add('is-gliding');
      else if (performance.now() < manualHasta || reducido.matches) {
        tira.classList.remove('is-gliding');
      }

      if (corriendo && !cuadro) {
        ultimo = performance.now();
        cuadro = requestAnimationFrame(paso);
      } else if (!corriendo && cuadro) {
        cancelAnimationFrame(cuadro);
        cuadro = 0;
      }
    }

    /* Scroll manual: congelar el deslize un rato; sin el apagón el snap lo
       pelearía con escribir scrollLeft a cada cuadro. */
    function aManual() {
      manualHasta = performance.now() + REANUDA_MS;
      clearTimeout(alReanudar);
      alReanudar = setTimeout(sincronizar, REANUDA_MS + 50);
      sincronizar();
    }

    // El puntero pausa, sin contar el dedo: touchstart/touchend lo lleva.
    tira.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      pausa.puntero = true;
      sincronizar();
    });
    tira.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      pausa.puntero = false;
      sincronizar();
    });

    tira.addEventListener('focusin', () => {
      pausa.foco = true;
      sincronizar();
    });
    tira.addEventListener('focusout', (e) => {
      // El foco que pasa de un hijo a otro no sale de la tira.
      if (!tira.contains(e.relatedTarget)) {
        pausa.foco = false;
        sincronizar();
      }
    });

    tira.addEventListener('touchstart', (e) => {
      const dedo = e.touches[0];
      if (dedo) { toqueX = dedo.clientX; toqueY = dedo.clientY; }
      pausa.tactil = true;
      sincronizar();
    }, { passive: true });
    // Arrastre horizontal con el dedo: intención manual, con snap, igual que
    // un scrolleo. Un roce casi vertical (para apoyar y leer) lo ignora.
    tira.addEventListener('touchmove', (e) => {
      const dedo = e.touches[0];
      if (!dedo) return;
      if (Math.abs(dedo.clientX - toqueX) > Math.abs(dedo.clientY - toqueY)) aManual();
    }, { passive: true });
    tira.addEventListener('touchend', () => {
      pausa.tactil = false;
      aManual(); // retoma un rato después del toque, no bajo el dedo
    });
    tira.addEventListener('touchcancel', () => {
      pausa.tactil = false;
      sincronizar();
    });

    // Arrastre horizontal con trackpad o shift + rueda: intención manual.
    tira.addEventListener('wheel', (e) => {
      if (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) aManual();
    }, { passive: true });

    // Las teclas de desplazamiento ya mueven la tira por sí solas: lo único
    // que agrega el script es señalar que el recorrido lo lleva el usuario.
    tira.addEventListener('keydown', (e) => {
      if (TECLAS_SCROLLO.includes(e.key)) aManual();
    });

    // La sección en pantalla se chequea por observation, no por cuadro.
    if (typeof IntersectionObserver !== 'undefined') {
      const vigilar = new IntersectionObserver((entradas) => {
        pausa.fuera = !entradas.some((entrada) => entrada.isIntersecting);
        sincronizar();
      });
      vigilar.observe(tira);
    } else {
      // Sin observer (navegadores viejos): siempre está en pantalla; la pausa
      // por sale-de-vista no es crítica para el resto de los comportamientos.
      pausa.fuera = false;
    }

    // overlays.js abre o cierra el bloqueo del fondo en su propio listener:
    // mirar el atributo class del html es el único punto de verdad que no
    // depende del orden de registro de los listeners.
    new MutationObserver(sincronizar).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // El sistema pidió menos movimiento en el medio de la sesión: al correr
    // el chequeo en cada sync, el deslize se corta solo.
    reducido.addEventListener('change', sincronizar);

    window.addEventListener('resize', sincronizar);
    document.addEventListener('visibilitychange', sincronizar);
    sincronizar(); // si la sección arranca en pantalla, arranca el deslize
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
    iniciarFranja();
    iniciar();
  });
})();
