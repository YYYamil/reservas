/* ==========================================================================
   validacion.js — controles de los formularios de la v2
   --------------------------------------------------------------------------
   Cada campo declara su regla en el markup con data-regla y este archivo la
   aplica. No inventa markup nuevo: los mensajes se crean debajo del campo que
   falla, con el patrón .field--invalid + .field__error que ya documenta el
   styleguide ("Datos del responsable").

     data-regla="nombre"       solo letras, espacios, apóstrofo y guion
     data-regla="institucion"  letras y números (el N° 4 de una escuela vale)
     data-regla="dni"          7 u 8 dígitos, sin puntos ni espacios
     data-regla="celular"      dígitos; con el código de área suma 9 o 10
     data-regla="email"        correo con arroba y dominio
     data-regla="codigo"       código de reserva en mayúsculas (R-248715)
     data-regla="acepta"       casilla de aceptación marcada
     data-contador="8"         contador de caracteres sobre el largo máximo

   Comportamiento
   - Filtra al tipear: lo que no corresponde al campo no llega a escribirse
     (sin letras en el DNI, sin dígitos en el nombre). Al pegar también se
     limpia, y el cursor se conserva.
   - Valida al salir del campo y al confirmar. En vivo solo revisa el campo que
     ya está marcado, para que el aviso se vaya apenas queda bien.
   - El formulario pasa a novalidate al inicializarse: los mensajes son propios
     y en español, sin las burbujas del navegador. Los atributos required,
     pattern, minlength y maxlength siguen en el markup como contrato y como
     respaldo sin script.
   - revisar(form) frena el envío, marca todos los campos y lleva el foco al
     primero que falla. El error entra en aria-describedby, así el lector de
     pantalla lo lee al enfocar el campo.

   Uso
     V2Validacion.mejorar(form);            // se llama solo al cargar la página
     if (!V2Validacion.revisar(form)) return;  // antes de enviar
   ========================================================================== */
(function () {
  'use strict';

  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /* ---------------------------------------------------------------- reglas */

  function soloDigitos(valor, max) {
    const limpio = String(valor || '').replace(/\D+/g, '');
    return max ? limpio.slice(0, max) : limpio;
  }

  /* Letras de cualquier acento, espacios, apóstrofo, punto y guion: lo que
     puede aparecer en un nombre. Los dígitos no entran. */
  function limpiarLetras(valor, max) {
    const limpio = String(valor || '')
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'’.-]/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s'’.-]+/, '');
    return max ? limpio.slice(0, max) : limpio;
  }

  /* Una institución se llama "Escuela Normal N° 4": lleva números y signos. */
  function limpiarInstitucion(valor, max) {
    const limpio = String(valor || '')
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\s.,°º'’#&()/-]/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\s+/, '');
    return max ? limpio.slice(0, max) : limpio;
  }

  function limpiarCodigo(valor, max) {
    const limpio = String(valor || '')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');
    return max ? limpio.slice(0, max) : limpio;
  }

  /* El código de área vive en el select del mismo grupo de campo. */
  function prefijoDe(campo) {
    const caja = campo.closest('.field');
    const select = caja ? caja.querySelector('select') : null;
    return select ? soloDigitos(select.value) : '';
  }

  const REGLAS = {
    nombre: {
      max: 60,
      limpiar: limpiarLetras,
      validar(valor) {
        const texto = String(valor || '').trim();
        if (!texto) return 'Escribí el nombre y el apellido del responsable.';
        if (texto.length < 3) return 'El nombre del responsable es demasiado corto.';
        return '';
      }
    },

    institucion: {
      max: 80,
      limpiar: limpiarInstitucion,
      validar(valor) {
        const texto = String(valor || '').trim();
        if (!texto) return 'Escribí la escuela o institución que hace la reserva.';
        if (texto.length < 3) return 'El nombre de la institución es demasiado corto.';
        if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(texto)) {
          return 'La institución necesita un nombre, no solo números.';
        }
        return '';
      }
    },

    dni: {
      max: 8,
      limpiar: soloDigitos,
      validar(valor) {
        const dni = soloDigitos(valor, 8);
        if (!dni) return 'Escribí el DNI del responsable, sin puntos.';
        if (!/^\d{7,8}$/.test(dni)) return 'El DNI tiene que tener 7 u 8 números.';
        return '';
      }
    },

    celular: {
      max: 7,
      limpiar: soloDigitos,
      validar(valor, campo) {
        const numero = soloDigitos(valor, 7);
        if (!numero) return 'Escribí el celular del responsable, sin 0 ni 15.';
        const total = prefijoDe(campo) + numero;
        if (!/^\d{9,10}$/.test(total)) {
          return 'El código de área y el número tienen que sumar 9 o 10 dígitos.';
        }
        return '';
      }
    },

    email: {
      max: 120,
      limpiar(valor, max) {
        const limpio = String(valor || '').replace(/\s+/g, '');
        return max ? limpio.slice(0, max) : limpio;
      },
      validar(valor) {
        const correo = String(valor || '').trim();
        if (!correo) return 'Escribí el correo del responsable.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) {
          return 'Revisá el correo: falta la arroba o el dominio.';
        }
        return '';
      }
    },

    codigo: {
      max: 8,
      limpiar: limpiarCodigo,
      validar(valor) {
        const codigo = String(valor || '').trim().toUpperCase();
        if (!codigo) return 'Escribí el código de la reserva.';
        if (!/^[A-Z0-9-]{6,8}$/.test(codigo)) return 'El código tiene entre 6 y 8 caracteres, como R-248715.';
        if (!/\d/.test(codigo)) return 'El código lleva números, como R-248715.';
        return '';
      }
    },

    acepta: {
      validar(valor, campo) {
        return campo.checked ? '' : 'Para reservar tenés que aceptar el reglamento.';
      }
    }
  };

  /* ------------------------------------------------------------- mensajes */

  /* El ícono del aviso es el que tenga la página: no todas traen el mismo set. */
  function iconoAlerta() {
    if (document.getElementById('i-alert')) return '#i-alert';
    if (document.getElementById('i-alert-triangle')) return '#i-alert-triangle';
    return '';
  }

  function cajaDe(campo) {
    return campo.closest('.field') || campo.parentElement;
  }

  function nodoError(caja, campo) {
    const id = `${campo.id || campo.name}-error`;
    let error = caja.querySelector(`.field__error[id="${id}"]`);
    if (error) return error;

    error = document.createElement('p');
    error.className = 'field__error';
    error.id = id;
    error.setAttribute('hidden', '');

    const href = iconoAlerta();
    if (href) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'icon icon--sm');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', href);
      svg.appendChild(use);
      error.appendChild(svg);
    }

    caja.appendChild(error);

    const descrito = String(campo.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter(Boolean);
    if (!descrito.includes(id)) descrito.push(id);
    campo.setAttribute('aria-describedby', descrito.join(' '));

    return error;
  }

  /* Deja el ícono en su lugar y escribe el texto después. */
  function escribirMensaje(error, mensaje) {
    Array.from(error.childNodes).forEach((nodo) => {
      if (nodo.nodeType === Node.TEXT_NODE) error.removeChild(nodo);
    });
    if (mensaje) error.appendChild(document.createTextNode(mensaje));
  }

  function pintar(campo, mensaje) {
    const caja = cajaDe(campo);
    if (!caja) return;

    caja.classList.toggle('field--invalid', Boolean(mensaje));
    if (mensaje) campo.setAttribute('aria-invalid', 'true');
    else campo.removeAttribute('aria-invalid');

    if (mensaje) {
      const error = nodoError(caja, campo);
      escribirMensaje(error, mensaje);
      error.removeAttribute('hidden');
      return;
    }

    const error = caja.querySelector('.field__error');
    if (error) {
      escribirMensaje(error, '');
      error.setAttribute('hidden', '');
    }
  }

  /* ------------------------------------------------------------- contador */

  function actualizarContador(campo, max) {
    if (!max) return;
    const caja = cajaDe(campo);
    const cuenta = caja ? caja.querySelector('.field__count') : null;
    if (!cuenta) return;
    cuenta.textContent = `${String(campo.value || '').length}/${max}`;
  }

  /* ------------------------------------------------------------- escritura */

  /* Reemplaza el valor conservando el cursor: si estaba al final, sigue al
     final; si estaba en el medio, no se mueve de dónde estaba escribiendo. */
  function escribir(campo, valor) {
    if (campo.value === valor) return;
    let inicio = null;
    try {
      inicio = campo.selectionStart;
    } catch (error) {
      // email y otros tipos no exponen el cursor.
    }
    const alFinal = inicio === null || inicio === campo.value.length;
    campo.value = valor;
    if (inicio === null) return;
    const destino = alFinal ? valor.length : Math.min(inicio, valor.length);
    try {
      campo.setSelectionRange(destino, destino);
    } catch (error) {
      // Los campos sin selección de texto (email en algunos navegadores)
      // no aceptan el cursor: el valor ya quedó limpio.
    }
  }

  /* --------------------------------------------------------------- control */

  function validarCampo(campo) {
    const regla = REGLAS[campo.dataset.regla];
    if (!regla) return '';
    const mensaje = regla.validar ? regla.validar(campo.value || '', campo) : '';
    pintar(campo, mensaje);
    return mensaje;
  }

  function prepararCampo(campo) {
    const regla = REGLAS[campo.dataset.regla];
    if (!regla || campo.dataset.controlado === 'on') return;
    campo.dataset.controlado = 'on';

    const max = Number(campo.dataset.contador) || regla.max || 0;
    const caja = cajaDe(campo);
    const esCasilla = campo.type === 'checkbox';

    if (esCasilla) {
      campo.addEventListener('change', () => validarCampo(campo));
      return;
    }

    if (max && campo.maxLength < 0) campo.maxLength = max;
    actualizarContador(campo, max);

    campo.addEventListener('input', () => {
      if (regla.limpiar) escribir(campo, regla.limpiar(campo.value, max));
      actualizarContador(campo, max);
      if (caja && caja.classList.contains('field--invalid')) validarCampo(campo);
    });

    campo.addEventListener('blur', () => {
      const yaMarcado = caja && caja.classList.contains('field--invalid');
      if (String(campo.value || '').trim() || yaMarcado) validarCampo(campo);
    });

    // Cambiar el código de área cambia el largo total del celular.
    const select = caja ? caja.querySelector('select') : null;
    if (select) {
      select.addEventListener('change', () => {
        if (caja.classList.contains('field--invalid')) validarCampo(campo);
      });
    }
  }

  function campos(form) {
    return qsa('[data-regla]', form).filter((campo) => Boolean(REGLAS[campo.dataset.regla]));
  }

  /* Los mensajes son de este módulo: se apaga la burbuja nativa y quedan los
     atributos del markup como contrato. */
  function mejorar(form) {
    if (!form || !form.elements) return;
    form.noValidate = true;
    campos(form).forEach(prepararCampo);
  }

  function revisar(form) {
    if (!form) return true;
    mejorar(form);

    let primero = null;
    campos(form).forEach((campo) => {
      const mensaje = validarCampo(campo);
      if (mensaje && !primero) primero = campo;
    });

    if (!primero) return true;

    const caja = cajaDe(primero);
    if (caja && caja.scrollIntoView) {
      caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    try {
      primero.focus({ preventScroll: true });
    } catch (error) {
      primero.focus();
    }
    return false;
  }

  /* Arranque: cualquier formulario de la página con campos declarados queda
     controlado, sin que cada script de página tenga que acordarse. */
  function iniciar() {
    qsa('form').forEach((form) => {
      if (form.querySelector('[data-regla]')) mejorar(form);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  window.V2Validacion = { mejorar, revisar, validarCampo, reglas: REGLAS };
})();
