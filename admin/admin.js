(function () {
  'use strict';

  var API = '../api/index.php';
  var f = function (id) { return document.getElementById(id); };

  var ui = {
    loginBox: f('loginBox'),
    panel: f('panel'),
    loginForm: f('loginForm'),
    usuario: f('usuario'),
    pass: f('pass'),
    loginError: f('loginError'),
    sesionInfo: f('sesionInfo'),
    totales: f('totales'),
    fDesde: f('fDesde'),
    fHasta: f('fHasta'),
    fTipo: f('fTipo'),
    fAlbergue: f('fAlbergue'),
    fEstado: f('fEstado'),
    fQ: f('fQ'),
    btnFiltrar: f('btnFiltrar'),
    btnExportar: f('btnExportar'),
    grilla: f('grilla').querySelector('tbody'),
    sinResultados: f('sinResultados')
  };

  var ESTADOS = ['Pre-Reserva', 'Confirmado'];

  var MSG_WP = 'Hola, te comparto la planilla de nómina para los albergues escolares';
  var URL_PDF = window.location.origin + '/docs/Anexo-nomina.pdf';

  function numeroWhatsApp(contacto) {
    var d = String(contacto == null ? '' : contacto).replace(/\D/g, '');
    if (!d) { return ''; }
    if (d.indexOf('549') === 0) { return d; }
    if (d.indexOf('54') === 0) { return '549' + d.slice(2); }
    return '549' + d;
  }

  function botonWhatsApp(contacto) {
    var num = numeroWhatsApp(contacto);
    if (!num) {
      return '<button class="btn-wp" disabled title="Sin contacto">WP</button>';
    }
    var href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(MSG_WP + '\nDescargá la planilla de nómina: ' + URL_PDF);
    return '<a class="btn-wp" href="' + href + '" target="_blank" rel="noopener" title="Abrir WhatsApp (el mensaje incluye el enlace de descarga de Anexo-nomina.pdf)">WP</a>';
  }

  function opcionesEstado(actual) {
    return ESTADOS.map(function (e) {
      return '<option value="' + e + '"' + (e === actual ? ' selected' : '') + '>' + e + '</option>';
    }).join('');
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function llamar(accion, params) {
    var body = new URLSearchParams();
    body.set('action', accion);
    (params || {}).forEach(function (v, k) { if (v !== '') body.set(k, v); });
    return fetch(API, { method: 'POST', body: body }).then(function (r) {
      if (r.status === 401) { throw { unauthorized: true }; }
      return r.json().then(function (j) {
        if (!j.success) throw new Error(j.message || j.mensaje || 'Error');
        return j;
      });
    });
  }

  function estadoSesion() {
    var n = document.createElement('span');
    n.textContent = 'Sesión iniciada';
    var b = document.createElement('button');
    b.textContent = 'Salir';
    b.onclick = function () {
      llamar('adminLogout', new Map()).then(function () { location.reload(); });
    };
    ui.sesionInfo.textContent = '';
    ui.sesionInfo.appendChild(n);
    ui.sesionInfo.appendChild(b);
  }

  function mostrarLogin() {
    ui.panel.hidden = true;
    ui.loginBox.hidden = false;
  }

  function mostrarPanel() {
    ui.loginBox.hidden = true;
    ui.panel.hidden = false;
    estadoSesion();
    cargarTotales();
    cargarReservas();
  }

  function tarjeta(num, lbl) {
    var d = document.createElement('div');
    d.className = 'cardMini';
    var n = document.createElement('div');
    n.className = 'num';
    n.textContent = num;
    var l = document.createElement('div');
    l.className = 'lbl';
    l.textContent = lbl;
    d.appendChild(n);
    d.appendChild(l);
    return d;
  }

  function cargarTotales() {
    ui.totales.textContent = 'Cargando...';
    llamar('adminTotales', new Map()).then(function (j) {
      ui.totales.textContent = '';
      var t = j.totales;
      ui.totales.appendChild(tarjeta(t.visitas, 'Reservas de visita'));
      ui.totales.appendChild(tarjeta(t.alojamientos, 'Reservas de alojamiento'));
      ui.totales.appendChild(tarjeta(t.visitas_proximos7, 'Visitas · próximos 7 días'));
      ui.totales.appendChild(tarjeta(t.aloj_proximos7, 'Alojamiento · próximos 7 días'));

      // filtros: albergues y estados
      var listaA = ui.fAlbergue;
      listaA.innerHTML = '<option value="">Todos</option>';
      j.por_albergue.forEach(function (a) {
        var o = document.createElement('option');
        o.value = a.albergue;
        o.textContent = a.albergue + ' (cap. ' + a.capacidad + ')';
        listaA.appendChild(o);
      });
      var listaE = ui.fEstado;
      listaE.innerHTML = '<option value="">Todos</option>';
      j.estados.forEach(function (e) {
        var o = document.createElement('option');
        o.value = e;
        o.textContent = e;
        listaE.appendChild(o);
      });
    }).catch(function (e) {
      ui.totales.textContent = e.message || 'Error al cargar totales';
    });
  }

  function detalle(r) {
    if (r.modalidad === 'visita') {
      var ing = r.hora_ingreso || '';
      var egr = r.hora_egreso || '';
      return r.fecha_p + (ing ? ' ' + ing : '') + (egr ? ' → ' + egr : '');
    }
    return r.rango_fechas || '';
  }

  function parametrosFiltro() {
    var params = new Map();
    params.set('desde', ui.fDesde.value);
    params.set('hasta', ui.fHasta.value);
    params.set('tipo', ui.fTipo.value);
    params.set('albergue', ui.fAlbergue.value);
    params.set('estado', ui.fEstado.value);
    params.set('q', ui.fQ.value.trim());
    return params;
  }

  function cargarReservas() {
    var params = parametrosFiltro();

    ui.grilla.innerHTML = '<tr><td colspan="13" class="cargando">Cargando...</td></tr>';
    llamar('adminReservas', params).then(function (j) {
      if (!j.reservas.length) {
        ui.grilla.innerHTML = '';
        ui.sinResultados.hidden = false;
        return;
      }
      ui.sinResultados.hidden = true;
      ui.grilla.innerHTML = j.reservas.map(function (r) {
        return '<tr>' +
          '<td>' + esc(r.id_reserva) + '</td>' +
          '<td><span class="badge ' + esc(r.modalidad) + '">' + esc(r.modalidad) + '</span></td>' +
          '<td>' + esc(r.created_at) + '</td>' +
          '<td>' + esc(r.albergue) + '</td>' +
          '<td>' + esc(r.institucion) + '</td>' +
          '<td>' + esc(r.responsable) + '</td>' +
          '<td>' + esc(r.dni) + '</td>' +
          '<td>' + esc(r.contacto) + '</td>' +
          '<td>' + esc(r.cantidad) + '</td>' +
          '<td class="col-detalle">' + esc(detalle(r)) + '</td>' +
          '<td><select class="selEstado" data-pk="' + esc(r.pk) + '" data-modalidad="' + esc(r.modalidad) + '" data-actual="' + esc(r.estado) + '">' + opcionesEstado(r.estado) + '</select></td>' +
          '<td>' + botonWhatsApp(r.contacto) + '</td>' +
          '<td><input class="inpObs" type="text" maxlength="1000" data-pk="' + esc(r.pk) + '" data-modalidad="' + esc(r.modalidad) + '" data-actual="' + esc(r.observaciones) + '" value="' + esc(r.observaciones) + '" title="Observaciones (editar)"></td>' +
          '</tr>';
      }).join('');
    }).catch(function (e) {
      ui.grilla.innerHTML = '<tr><td colspan="13" class="error">' + esc(e.message || 'Error') + '</td></tr>';
    });
  }

  ui.loginForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    ui.loginError.hidden = true;
    var params = new Map();
    params.set('usuario', ui.usuario.value);
    params.set('pass', ui.pass.value);
    llamar('adminLogin', params).then(function () {
      mostrarPanel();
    }).catch(function (e) {
      ui.loginError.textContent = e.unauthorized ? 'Credenciales inválidas' : (e.message || 'Error de conexión');
      ui.loginError.hidden = false;
    });
  });

  ui.btnFiltrar.addEventListener('click', function () {
    cargarReservas();
  });

  var CABECERAS = ['ID', 'Modalidad', 'Trámite', 'Albergue', 'Institución', 'Responsable', 'DNI', 'Contacto', 'Cant.', 'Detalle', 'Estado', 'Observaciones'];

  function exportarExcel() {
    if (typeof XLSX === 'undefined') {
      alert('La librería de Excel no está cargada (xlsx.full.min.js)');
      return;
    }
    llamar('adminReservas', parametrosFiltro()).then(function (j) {
      if (!j.reservas.length) {
        alert('Sin registros para los filtros activos');
        return;
      }
      var filas = [CABECERAS.slice()];
      j.reservas.forEach(function (r) {
        filas.push([
          r.id_reserva, r.modalidad, r.created_at, r.albergue, r.institucion,
          r.responsable, r.dni, r.contacto, r.cantidad, detalle(r), r.estado, r.observaciones
        ]);
      });
      var ws = XLSX.utils.aoa_to_sheet(filas);
      ws['!cols'] = [
        { wch: 6 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 32 },
        { wch: 22 }, { wch: 13 }, { wch: 16 }, { wch: 6 }, { wch: 42 }, { wch: 13 }, { wch: 32 }
      ];
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: CABECERAS.length - 1 } })
      };
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Reservas');
      var d = new Date();
      var marca = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
        '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
      XLSX.writeFile(wb, 'reservas_' + marca + '.xls', { bookType: 'xls' });
    }).catch(function (e) {
      alert(e.message || 'Error al exportar');
    });
  }

  ui.btnExportar.addEventListener('click', exportarExcel);

  function habilitarRedimensionColumnas() {
    var celdas = document.querySelectorAll('#grilla thead th');
    Array.prototype.forEach.call(celdas, function (th) {
      var rz = document.createElement('span');
      rz.className = 'resizer';
      th.appendChild(rz);
      rz.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        var x0 = ev.clientX;
        var w0 = th.getBoundingClientRect().width;
        function mover(ev2) {
          var w = Math.max(50, w0 + (ev2.clientX - x0));
          th.style.width = w + 'px';
        }
        function soltar() {
          document.removeEventListener('mousemove', mover);
          document.removeEventListener('mouseup', soltar);
          document.body.classList.remove('resizing');
        }
        document.body.classList.add('resizing');
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
      });
    });
  }
  habilitarRedimensionColumnas();

  ui.grilla.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (!sel || !sel.classList) { return; }

    if (sel.classList.contains('inpObs')) {
      var prev = sel.dataset.actual;
      if (sel.value === prev) { return; }
      var params2 = new Map();
      params2.set('pk', sel.dataset.pk);
      params2.set('modalidad', sel.dataset.modalidad);
      params2.set('observaciones', sel.value.trim());
      llamar('adminObservaciones', params2).then(function () {
        sel.dataset.actual = sel.value.trim();
      }).catch(function (e) {
        sel.value = prev;
        alert(e.message || 'No se pudo guardar la observación');
      });
      return;
    }

    if (!sel.classList.contains('selEstado')) { return; }
    var prev = sel.dataset.actual;
    var params = new Map();
    params.set('pk', sel.dataset.pk);
    params.set('modalidad', sel.dataset.modalidad);
    params.set('estado', sel.value);
    llamar('adminEstado', params).then(function () {
      sel.dataset.actual = sel.value;
    }).catch(function () {
      sel.value = prev;
    });
  });
  [ui.fTipo, ui.fAlbergue, ui.fEstado].forEach(function (sel) {
    sel.addEventListener('change', cargarReservas);
  });

  // Al abrir: intentar sesión existente
  llamar('adminTotales', new Map()).then(function () {
    mostrarPanel();
  }).catch(function (e) {
    if (e.unauthorized) { mostrarLogin(); } else { mostrarLogin(); }
  });
})();