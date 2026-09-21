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
    grilla: f('grilla').querySelector('tbody'),
    sinResultados: f('sinResultados')
  };

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

  function cargarReservas() {
    var params = new Map();
    params.set('desde', ui.fDesde.value);
    params.set('hasta', ui.fHasta.value);
    params.set('tipo', ui.fTipo.value);
    params.set('albergue', ui.fAlbergue.value);
    params.set('estado', ui.fEstado.value);
    params.set('q', ui.fQ.value.trim());

    ui.grilla.innerHTML = '<tr><td colspan="11" class="cargando">Cargando...</td></tr>';
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
          '<td>' + esc(detalle(r)) + '</td>' +
          '<td>' + esc(r.estado) + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (e) {
      ui.grilla.innerHTML = '<tr><td colspan="11" class="error">' + esc(e.message || 'Error') + '</td></tr>';
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