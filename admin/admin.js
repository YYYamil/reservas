(function () {
  'use strict';

  var API = '../api/index.php';
  var f = function (id) { return document.getElementById(id); };

  var ui = {
    loginBox: f('loginBox'),
    panel: f('panel'),
    gestor: f('gestor'),
    loginForm: f('loginForm'),
    usuario: f('usuario'),
    pass: f('pass'),
    loginError: f('loginError'),
    btnIngresar: f('btnIngresar'),
    anioActual: f('anioActual'),
    sesionInfo: f('sesionInfo'),
    totales: f('totales'),
    fDesde: f('fDesde'),
    fHasta: f('fHasta'),
    fTipo: f('fTipo'),
    fAlbergue: f('fAlbergue'),
    fEstado: f('fEstado'),
    fEstadoWrap: f('fEstadoWrap'),
    fQ: f('fQ'),
    btnFiltrar: f('btnFiltrar'),
    btnActualizar: f('btnActualizar'),
    btnExportar: f('btnExportar'),
    grilla: f('grilla').querySelector('tbody'),
    tabla: f('grilla'),
    sinResultados: f('sinResultados'),

    formUsuario: f('formUsuario'),
    uId: f('uId'),
    uUsuario: f('uUsuario'),
    uRol: f('uRol'),
    uAlbWrap: f('uAlbWrap'),
    uAlbergue: f('uAlbergue'),
    uPass: f('uPass'),
    uActWrap: f('uActWrap'),
    uActivo: f('uActivo'),
    btnNuevoUsuario: f('btnNuevoUsuario'),
    usuariosBody: f('usuariosBody'),
    usuarioMsg: f('usuarioMsg'),
    usuarioModal: f('usuarioModal'),
    usuarioModalTitulo: f('usuarioModalTitulo'),
    btnCerrarUsuario: f('btnCerrarUsuario'),

    formConfig: f('formConfig'),
    cfgMeses: f('cfgMeses'),
    configMsg: f('configMsg'),
    btnConfig: f('btnConfig'),
    configModal: f('configModal'),
    btnCerrarConfig: f('btnCerrarConfig'),

    formAlbergue: f('formAlbergue'),
    aId: f('aId'),
    aClave: f('aClave'),
    aNombre: f('aNombre'),
    aCapacidad: f('aCapacidad'),
    aCapacidadVisitas: f('aCapacidadVisitas'),
    aMontoVisita: f('aMontoVisita'),
    aMontoCama: f('aMontoCama'),
    aColor: f('aColor'),
    aHabilitado: f('aHabilitado'),
    aDescripcion: f('aDescripcion'),
    aMapa: f('aMapa'),
    aPdf: f('aPdf'),
    archivoPdf: f('archivoPdf'),
    btnSubirPdf: f('btnSubirPdf'),
    pdfMsg: f('pdfMsg'),
    caracList: f('caracList'),
    btnAgregarCarac: f('btnAgregarCarac'),
    archivoImg: f('archivoImg'),
    btnSubirImg: f('btnSubirImg'),
    imgList: f('imgList'),
    imgMsg: f('imgMsg'),
    btnNuevoAlbergue: f('btnNuevoAlbergue'),
    alberguesBody: f('alberguesBody'),
    albergueMsg: f('albergueMsg'),
    albergueModal: f('albergueModal'),
    albergueModalTitulo: f('albergueModalTitulo'),
    btnCerrarAlbergue: f('btnCerrarAlbergue'),
    formConfig: f('formConfig'),
    cfgMailAdmin: f('cfgMailAdmin'),
    cfgNotifMsg: f('cfgNotifMsg'),
  };

  // Estados del ciclo de vida (misma máquina para las dos modalidades).
  var ESTADOS = ['Pre-Reserva', 'Comprobar', 'Confirmado', 'Cancelado', 'Vencido', 'Devolver', 'Finalizado'];

  var MSG_WP = 'Hola, te comparto la planilla de nómina para los albergues escolares';
  var URL_PDF = window.location.origin + '/docs/Anexo-nomina.pdf';
  var pendienteRestaurar = null;
  var rol = null;
  var esLector = false;

  var ROL_LABEL = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    lector: 'Lector'
  };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function numeroWhatsApp(contacto) {
    var d = String(contacto == null ? '' : contacto).replace(/\D/g, '');
    if (!d) { return ''; }
    if (d.indexOf('549') === 0) { return d; }
    if (d.indexOf('54') === 0) { return '549' + d.slice(2); }
    return '549' + d;
  }

  var ICONO_WP = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

  function botonWhatsApp(contacto, editable) {
    if (!editable) { return '<span>—</span>'; }
    var num = numeroWhatsApp(contacto);
    if (!num) {
      return '<button class="btn-wp" disabled title="Sin contacto">' + ICONO_WP + '</button>';
    }
    var href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(MSG_WP + '\nDescargá la planilla de nómina: ' + URL_PDF);
    return '<a class="btn-wp" href="' + href + '" target="_blank" rel="noopener" title="Abrir WhatsApp (el mensaje incluye el enlace de descarga de Anexo-nomina.pdf)">' + ICONO_WP + '</a>';
  }

  function formatoMonto(n) {
    if (n === null || n === undefined || n === '') { return '—'; }
    var v = Number(n);
    if (isNaN(v)) { return '—'; }
    return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function montoCelda(r) {
    var html = formatoMonto(r.monto_total);
    if (r.comprobante_id) {
      // Se usa API ('../api/index.php') y no 'api/index.php': este archivo se sirve
      // desde /admin/, por lo que la ruta relativa simple apuntaba a /admin/api/... (404).
      html += '<br><a class="link-comprobante" target="_blank" rel="noopener" title="Ver comprobante subido por el cliente" ' +
        'href="' + API + '?action=adminComprobante&id=' + encodeURIComponent(r.comprobante_id) + '">ver comprobante</a>';
    }
    return html;
  }

  function claseEstado(estado) {
    switch (estado) {
      case 'Cancelado':  return 'cancelado';
      case 'Vencido':    return 'vencido';
      case 'Devolver':   return 'devolver';
      case 'Comprobar':  return 'comprobar';
      case 'Confirmado': return 'confirmado';
      case 'Finalizado': return 'finalizado';
      default:           return 'prereserva';
    }
  }

  // Acciones permitidas por la máquina de estados, según el estado actual.
  // El backend valida la transición igual: esto es solo la interfaz.
  function accionesEstado(r) {
    var estado = r.estado_efectivo || r.estado;
    var base = 'data-pk="' + esc(r.pk) + '" data-modalidad="' + esc(r.modalidad) + '"';

    if (estado === 'Pre-Reserva') {
      return '<button type="button" class="acc-estado anular" ' + base + ' data-accion="anular" title="Anular la pre-reserva y liberar el cupo">Anular</button>';
    }
    if (estado === 'Comprobar') {
      return '<button type="button" class="acc-estado aprobar" ' + base + ' data-accion="aprobar" title="Verificar el comprobante y confirmar">Aprobar</button>'
        + '<button type="button" class="acc-estado rechazar" ' + base + ' data-accion="rechazar" title="Rechazar el comprobante y pedir uno nuevo">Rechazar</button>';
    }
    if (estado === 'Devolver') {
      var monto = r.devolucion_monto;
      var texto = (monto === null || monto === undefined || monto === '')
        ? 'Marcar devolución'
        : 'Devuelto ' + formatoMonto(monto);
      return '<button type="button" class="acc-estado devolver" ' + base + ' data-accion="devolver" title="Registrar que la devolución ya fue transferida">' + esc(texto) + '</button>';
    }
    return '';
  }

  // '2026-10-12 14:35:10' -> '12/10 14:35' (corta) / '12/10/2026 14:35' (larga)
  function partesFecha(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v || ''));
    return m ? { anio: m[1], mes: m[2], dia: m[3], hora: m[4], min: m[5] } : null;
  }

  function fechaCorta(v) {
    var p = partesFecha(v);
    return p ? (p.dia + '/' + p.mes + ' ' + p.hora + ':' + p.min) : '';
  }

  function fechaLarga(v) {
    var p = partesFecha(v);
    return p ? (p.dia + '/' + p.mes + '/' + p.anio + ' ' + p.hora + ':' + p.min) : '';
  }

  // Sublínea bajo el Estado (solo rol admin): quién hizo el último cambio y cuándo.
  function sublineaEstado(r) {
    if (!r.estado_modificado_at) {
      return '<div class="modif-estado sin-cambios" title="Creada el ' +
        esc(fechaLarga(r.created_at)) + ' — sin cambios de estado">sin cambios</div>';
    }
    var origen = r.estado_origen || 'panel';
    var por = (origen === 'web') ? 'web' : (r.estado_modificado_por || '—');
    var cls = 'modif-estado' + (origen === 'web' ? ' origen-web' : '') + (origen === 'sync' ? ' origen-sync' : '');
    var titulo = 'Modificado por ' + por + ' el ' + fechaLarga(r.estado_modificado_at) + ' — origen: ' + origen;
    return '<div class="' + cls + '" title="' + esc(titulo) + '">por ' +
      esc(por) + ' · ' + esc(fechaCorta(r.estado_modificado_at)) + '</div>';
  }

  function llamar(accion, params) {
    var body = new URLSearchParams();
    body.set('action', accion);
    (params || {}).forEach(function (v, k) { if (v !== '') body.set(k, v); });
    return fetch(API, { method: 'POST', body: body }).then(function (r) {
      return r.json().then(function (j) {
        if (r.status === 401) { throw { unauthorized: true }; }
        if (r.status === 403) { throw new Error(j.message || 'Permiso denegado'); }
        if (!j.success) throw new Error(j.message || j.mensaje || 'Error');
        return j;
      });
    });
  }

  function estadoSesion(usuario) {
    var n = document.createElement('span');
    n.textContent = usuario || '';
    n.style.fontWeight = '600';
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
    ui.gestor.hidden = true;
    ui.loginBox.hidden = false;
  }

  function mostrarPanel(usuario) {
    ui.loginBox.hidden = true;
    ui.gestor.hidden = true;
    ui.panel.hidden = false;
    estadoSesion(usuario);
    ui.btnConfig.hidden = (rol === 'lector');
    ui.fEstadoWrap.hidden = esLector;
    if (esLector) { ui.fEstado.value = ''; }
    ui.totales.hidden = esLector;
    if (esLector) { ui.totales.innerHTML = ''; } else { cargarTotales(); }
    ui.tabla.classList.toggle('solo-lector', esLector);
    aplicarColumnasLector();
    cargarReservas();
  }

  function mostrarGestor(usuario) {
    ui.loginBox.hidden = true;
    ui.panel.hidden = true;
    ui.gestor.hidden = false;
    estadoSesion(usuario);
    if (ui.uRol.value === 'lector') { ui.uAlbWrap.hidden = false; } else { ui.uAlbWrap.hidden = true; }
    cargarListaUsuarios();
    cargarListaAlbergues();
    cargarOpcionesAlbergues();
    cargarConfigNotificaciones();
  }

  function cargarConfigNotificaciones() {
    llamar('adminConfig', new Map()).then(function (j) {
      ui.cfgMailAdmin.value = (j.config && j.config.mail_admin) ? j.config.mail_admin : '';
    }).catch(function () {});
  }

  function aplicarColumnasLector() {
    var elementos = ui.tabla.querySelectorAll('colgroup col#colWp, colgroup col#colObs, thead th.col-wp, thead th.col-obs');
    Array.prototype.forEach.call(elementos, function (el) {
      if (el.dataset.prevDisplay === undefined) { el.dataset.prevDisplay = el.style.display || ''; }
      el.style.display = esLector ? 'none' : el.dataset.prevDisplay;
    });
  }

  function abrirConfig() {
    ui.configMsg.hidden = true;
    ui.configModal.hidden = false;
    cargarConfiguracion();
  }

  function cerrarConfig() {
    ui.configModal.hidden = true;
  }

  function cargarConfiguracion() {
    llamar('adminConfiguraciones', new Map()).then(function (j) {
      var v = 3;
      (j.configuraciones || []).forEach(function (c) {
        if (c.clave === 'meses_anticipacion') { v = parseInt(c.valor, 10) || 3; }
      });
      ui.cfgMeses.value = v;
    }).catch(function (e) {
      ui.configMsg.textContent = e.message || 'Error al cargar configuración';
      ui.configMsg.hidden = false;
    });
  }

  ui.btnConfig.addEventListener('click', abrirConfig);
  ui.btnCerrarConfig.addEventListener('click', cerrarConfig);
  ui.configModal.addEventListener('click', function (ev) {
    if (ev.target === ui.configModal) { cerrarConfig(); }
  });

  ui.formConfig.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var n = parseInt(ui.cfgMeses.value, 10);
    if (!(n >= 1 && n <= 24)) {
      ui.configMsg.textContent = 'Ingresá un valor entre 1 y 24';
      ui.configMsg.classList.add('error');
      ui.configMsg.hidden = false;
      return;
    }
    var params = new Map();
    params.set('clave', 'meses_anticipacion');
    params.set('valor', String(n));
    llamar('adminConfiguracionEditar', params).then(function () {
      ui.configMsg.textContent = 'Guardado: el sitio habilita ' + n + (n === 1 ? ' mes.' : ' meses.');
      ui.configMsg.classList.remove('error');
      ui.configMsg.hidden = false;
      window.setTimeout(cerrarConfig, 1500);
    }).catch(function (e) {
      ui.configMsg.textContent = e.message || 'Error al guardar';
      ui.configMsg.classList.add('error');
      ui.configMsg.hidden = false;
    });
  });

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

      var listaA = ui.fAlbergue;
      listaA.innerHTML = '<option value="">Todos</option>';
      j.por_albergue.forEach(function (a) {
        var o = document.createElement('option');
        o.value = a.albergue;
        o.textContent = a.albergue + ' (cap. ' + a.capacidad + ')';
        listaA.appendChild(o);
      });
      if (esLector && j.por_albergue.length === 1) {
        listaA.value = j.por_albergue[0].albergue;
        listaA.disabled = true;
      }
      var listaE = ui.fEstado;
      listaE.innerHTML = '<option value="">Todos</option>';
      ESTADOS.forEach(function (e) {
        var o = document.createElement('option');
        o.value = e;
        o.textContent = e;
        listaE.appendChild(o);
      });
      if (pendienteRestaurar) {
        var r = pendienteRestaurar;
        pendienteRestaurar = null;
        if (r.albergue && !esLector) { listaA.value = r.albergue; }
        if (r.estado) { listaE.value = r.estado; }
      }
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
    params.set('albergue', esLector ? '' : ui.fAlbergue.value);
    params.set('estado', esLector ? '' : ui.fEstado.value);
    params.set('q', ui.fQ.value.trim());
    return params;
  }

  function cargarReservas() {
    var params = parametrosFiltro();

    ui.grilla.innerHTML = '<tr><td colspan="15" class="cargando">Cargando...</td></tr>';
    llamar('adminReservas', params).then(function (j) {
      var lista = esLector
        ? j.reservas.filter(function (r) { return r.estado === 'Confirmado'; })
        : j.reservas;
      if (!lista.length) {
        ui.grilla.innerHTML = '';
        ui.sinResultados.hidden = false;
        return;
      }
      ui.sinResultados.hidden = true;
      ui.grilla.innerHTML = lista.map(function (r) {
        var est = r.estado_efectivo || r.estado;
        var celdaEstado = '<span class="badge-estado ' + claseEstado(est) + '">' + esc(est) + '</span>';
        if (est !== r.estado) {
          celdaEstado += ' <span class="modif-estado" title="El barrido todavía no la pasó a Vencido; el cupo ya está liberado">vencida</span>';
        }
        var avisoValidacion = '';
        if (est === 'Comprobar' && r.validacion_vence_txt) {
          avisoValidacion = '<div class="modif-estado' + (r.validacion_vencida ? ' vencida' : '') +
            '" title="Plazo para aprobar o rechazar el comprobante desde el panel">validar antes del ' +
            esc(r.validacion_vence_txt) + '</div>';
        }
        return '<tr>' +
          '<td>' + esc(r.codigo_publico || r.id_reserva) + '</td>' +
          '<td><span class="badge ' + esc(r.modalidad) + '">' + esc(r.modalidad) + '</span></td>' +
          '<td>' + esc(r.created_at) + '</td>' +
          '<td>' + esc(r.albergue) + '</td>' +
          '<td>' + esc(r.institucion) + '</td>' +
          '<td>' + esc(r.responsable) + '</td>' +
          '<td>' + esc(r.dni) + '</td>' +
          '<td>' + esc(r.contacto) + '</td>' +
          '<td>' + esc(r.email) + '</td>' +
          '<td>' + esc(r.cantidad) + '</td>' +
          '<td>' + montoCelda(r) + '</td>' +
          '<td class="col-detalle">' + esc(detalle(r)) + '</td>' +
          (esLector
            ? '<td>' + celdaEstado + '</td>'
            : '<td>' + celdaEstado + accionesEstado(r) + avisoValidacion + sublineaEstado(r) + '</td>') +
          (esLector ? '' : '<td class="col-wp">' + botonWhatsApp(r.contacto, true) + '</td>') +
          (esLector ? '' : celdaObs(r, true)) +
          '</tr>';
      }).join('');
    }).catch(function (e) {
      ui.grilla.innerHTML = '<tr><td colspan="14" class="error">' + esc(e.message || 'Error') + '</td></tr>';
    });
  }

  ui.loginForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    ui.loginError.hidden = true;
    ui.btnIngresar.disabled = true;
    ui.btnIngresar.textContent = 'Iniciando...';
    var params = new Map();
    params.set('usuario', ui.usuario.value);
    params.set('pass', ui.pass.value);
    llamar('adminLogin', params).then(function (j) {
      rol = j.rol;
      esLector = (rol === 'lector');
      if (j.rol === 'super_admin') { mostrarGestor(j.usuario); } else { mostrarPanel(j.usuario); }
    }).catch(function (e) {
      ui.loginError.textContent = e.unauthorized ? 'Credenciales inválidas' : (e.message || 'Error de conexión');
      ui.loginError.hidden = false;
      ui.btnIngresar.disabled = false;
      ui.btnIngresar.textContent = 'Ingresar';
    });
  });

  ui.btnFiltrar.addEventListener('click', function () {
    cargarReservas();
  });

ui.btnActualizar.addEventListener('click', function () {
    if (esLector) {
      cargarReservas();
      return;
    }
    pendienteRestaurar = {
      albergue: ui.fAlbergue.value,
      estado: ui.fEstado.value
    };
    cargarTotales();
    cargarReservas();
  });

  var CABECERAS = ['Código', 'Modalidad', 'Trámite', 'Albergue', 'Institución', 'Responsable', 'DNI', 'Contacto', 'Email', 'Cant.', 'Monto', 'Detalle', 'Estado', 'Modif. por', 'Modif. el', 'Origen', 'Observaciones'];

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
          (r.codigo_publico || r.id_reserva), r.modalidad, r.created_at, r.albergue, r.institucion,
          r.responsable, r.dni, r.contacto, r.email, r.cantidad, (r.monto_total || ''), detalle(r), r.estado,
          esLector ? '' : (r.estado_modificado_por || ''),
          r.estado_modificado_at || '', r.estado_origen || '', r.observaciones
        ]);
      });
      var ws = XLSX.utils.aoa_to_sheet(filas);
      ws['!cols'] = [
        { wch: 11 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 32 },
        { wch: 22 }, { wch: 13 }, { wch: 16 }, { wch: 26 }, { wch: 6 }, { wch: 12 }, { wch: 42 }, { wch: 13 },
        { wch: 14 }, { wch: 18 }, { wch: 9 }, { wch: 32 }
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

  function obsBoton(pk, modalidad, texto) {
    return '<button type="button" class="obs-edit" data-pk="' + esc(pk) + '" data-modalidad="' + esc(modalidad) +
      '" data-actual="' + esc(texto) + '" title="Editar observaciones" aria-label="Editar observaciones">&#9998;</button>';
  }

  function obsHtml(texto, botonHtml) {
    var cuerpo = texto
      ? '<span class="obs-texto" title="' + esc(texto) + '">' + esc(texto) + '</span>'
      : '<span class="obs-vacio" title="Sin observaciones">—</span>';
    return cuerpo + (botonHtml || '');
  }

  function celdaObs(r, editable) {
    var t = (r.observaciones || '').trim();
    return '<td class="col-obs">' + obsHtml(t, editable ? obsBoton(r.pk, r.modalidad, t) : '') + '</td>';
  }

  function restaurarCeldaObs(inp) {
    var celda = inp.parentNode;
    if (!celda) { return; }
    var t = inp.dataset.actual || '';
    celda.innerHTML = obsHtml(t, obsBoton(inp.dataset.pk, inp.dataset.modalidad, t));
  }

  function editarObs(btn) {
    var celda = btn.parentNode;
    if (!celda) { return; }
    var t = btn.dataset.actual || '';
    var botonHtml = btn.outerHTML;

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inpObs';
    inp.setAttribute('maxlength', '1000');
    inp.value = t;
    inp.dataset.pk = btn.dataset.pk;
    inp.dataset.modalidad = btn.dataset.modalidad;
    inp.dataset.actual = t;

    celda.textContent = '';
    celda.appendChild(inp);
    inp.focus();
    inp.select();

    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        celda.innerHTML = obsHtml(t, botonHtml);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        inp.blur();
      }
    });

    // Click afuera: el blur dispara el change que guarda. Si no hubo cambios,
    // simplemente se cierra el campo sin llamar al servidor.
    inp.addEventListener('blur', function () {
      window.setTimeout(function () {
        if (!celda.contains(inp)) { return; }
        if (inp.dataset.guardando === '1') { return; }
        if (inp.value === inp.dataset.actual) {
          celda.innerHTML = obsHtml(t, botonHtml);
        }
      }, 0);
    });
  }

  ui.grilla.addEventListener('click', function (ev) {
    if (esLector) { return; }

    var acc = ev.target.closest ? ev.target.closest('.acc-estado') : null;
    if (acc) {
      ev.preventDefault();
      aplicarAccionEstado(acc);
      return;
    }

    var btn = ev.target.closest ? ev.target.closest('.obs-edit') : null;
    if (!btn) { return; }
    ev.preventDefault();
    editarObs(btn);
  });

  // Ejecuta una transición de la máquina de estados desde el panel.
  function aplicarAccionEstado(btn) {
    if (btn.disabled) { return; }
    var accion = btn.dataset.accion;
    var params = new Map();
    params.set('accion', accion);
    params.set('pk', btn.dataset.pk);
    params.set('modalidad', btn.dataset.modalidad);

    if (accion === 'rechazar') {
      var motivo = window.prompt('Motivo del rechazo (se le envía al cliente):', '');
      if (motivo === null) { return; }
      motivo = motivo.trim();
      if (!motivo) { alert('El motivo es obligatorio.'); return; }
      params.set('motivo', motivo);
    } else if (accion === 'devolver') {
      if (!window.confirm('¿Confirmás que la devolución ya fue transferida al cliente?')) { return; }
    } else if (accion === 'anular') {
      if (!window.confirm('¿Anular esta pre-reserva? El cupo se libera y no se puede reactivar.')) { return; }
    }

    btn.disabled = true;
    llamar('adminEstado', params).then(function () {
      cargarReservas();
      cargarTotales();
    }).catch(function (e) {
      btn.disabled = false;
      alert(e.message || 'No se pudo aplicar la acción');
    });
  }

  ui.grilla.addEventListener('change', function (ev) {
    if (esLector) { return; }
    var sel = ev.target;
    if (!sel || !sel.classList) { return; }

    if (sel.classList.contains('inpObs')) {
      var prev = sel.dataset.actual;
      if (sel.value === prev) { restaurarCeldaObs(sel); return; }
      sel.dataset.guardando = '1';
      var params2 = new Map();
      params2.set('pk', sel.dataset.pk);
      params2.set('modalidad', sel.dataset.modalidad);
      params2.set('observaciones', sel.value.trim());
      llamar('adminObservaciones', params2).then(function () {
        sel.dataset.actual = sel.value.trim();
        restaurarCeldaObs(sel);
      }).catch(function (e) {
        sel.value = prev;
        sel.dataset.actual = prev;
        restaurarCeldaObs(sel);
        alert(e.message || 'No se pudo guardar la observación');
      });
      return;
    }
  });
  [ui.fTipo, ui.fAlbergue, ui.fEstado].forEach(function (sel) {
    sel.addEventListener('change', cargarReservas);
  });

  // ===================== Gestión (super_admin) =====================

  function ocultarMsg() {
    ui.usuarioMsg.hidden = true;
    ui.albergueMsg.hidden = true;
  }

  function cargarOpcionesAlbergues() {
    llamar('adminAlbergues', new Map()).then(function (j) {
      var o = ui.uAlbergue;
      o.innerHTML = '<option value="">—</option>';
      j.albergues.forEach(function (a) {
        var op = document.createElement('option');
        op.value = a.id;
        op.textContent = a.nombre + ' (cap. ' + a.capacidad + ')';
        o.appendChild(op);
      });
      return j.albergues;
    }).catch(function (e) {
      alert(e.message || 'Error al cargar albergues');
    });
  }

  function cargarListaUsuarios() {
    llamar('adminUsuarios', new Map()).then(function (j) {
      ui.usuariosBody.innerHTML = j.usuarios.map(function (u) {
        return '<tr>' +
          '<td>' + esc(u.id) + '</td>' +
          '<td>' + esc(u.usuario) + '</td>' +
          '<td>' + esc(ROL_LABEL[u.rol] || u.rol) + '</td>' +
          '<td>' + esc(u.albergues || 'Todos') + '</td>' +
          '<td>' + (u.activo ? 'Sí' : '<b class="error">No</b>') + '</td>' +
          '<td>' + esc(u.ultimo_login || '') + '</td>' +
          '<td><button type="button" class="btn-sec" data-usuario-id="' + esc(u.id) + '">Editar</button></td>' +
          '</tr>';
      }).join('');
      Array.prototype.forEach.call(ui.usuariosBody.querySelectorAll('[data-usuario-id]'), function (b) {
        b.addEventListener('click', function () { editarUsuario(Number(b.dataset.usuarioId)); });
      });
    }).catch(function (e) {
      ui.usuariosBody.innerHTML = '<tr><td colspan="7" class="error">' + esc(e.message || 'Error') + '</td></tr>';
    });
  }

  function abrirModalUsuario(titulo) {
    ui.usuarioModalTitulo.textContent = titulo;
    ui.usuarioModal.hidden = false;
  }

  function cerrarModalUsuario() {
    ui.usuarioModal.hidden = true;
    ocultarMsg();
  }

  function editarUsuario(id) {
    llamar('adminUsuarios', new Map()).then(function (j) {
      var u = j.usuarios.filter(function (x) { return Number(x.id) === id; })[0];
      if (!u) { return; }
      ui.uId.value = u.id;
      ui.uUsuario.value = u.usuario;
      ui.uUsuario.disabled = true;
      ui.uRol.value = u.rol;
      ui.uPass.value = '';
      ui.uActivo.checked = !!u.activo;
      if (u.rol === 'lector') {
        ui.uAlbWrap.hidden = false;
        ui.uAlbergue.value = u.albergue_id ? String(u.albergue_id) : '';
      } else {
        ui.uAlbWrap.hidden = true;
        ui.uAlbergue.value = '';
      }
      ocultarMsg();
      abrirModalUsuario('Editar usuario · ' + u.usuario);
      ui.uPass.focus();
    }).catch(function (e) {
      alert(e.message || 'Error');
    });
  }

  function resetFormUsuario() {
    ui.uId.value = '';
    ui.uUsuario.value = '';
    ui.uUsuario.disabled = false;
    ui.uRol.value = 'admin';
    ui.uPass.value = '';
    ui.uActivo.checked = true;
    ui.uAlbWrap.hidden = !(ui.uRol.value === 'lector');
    ui.uAlbergue.value = '';
    ocultarMsg();
  }

  ui.uRol.addEventListener('change', function () {
    ui.uAlbWrap.hidden = !(ui.uRol.value === 'lector');
    if (ui.uRol.value === 'lector') { ui.uAlbergue.value = ''; }
  });

  ui.btnNuevoUsuario.addEventListener('click', function () {
    resetFormUsuario();
    abrirModalUsuario('Nuevo usuario');
    ui.uUsuario.focus();
  });

  ui.btnCerrarUsuario.addEventListener('click', cerrarModalUsuario);
  ui.usuarioModal.addEventListener('click', function (ev) {
    if (ev.target === ui.usuarioModal) { cerrarModalUsuario(); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && ui.usuarioModal && !ui.usuarioModal.hidden) { cerrarModalUsuario(); }
    if (ev.key === 'Escape' && ui.albergueModal && !ui.albergueModal.hidden) { cerrarModalAlbergue(); }
  });

  ui.formUsuario.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var esNuevo = (ui.uId.value === '');
    var params = new Map();
    if (!esNuevo) { params.set('id', ui.uId.value); }
    params.set('usuario', ui.uUsuario.value.trim());
    params.set('rol', ui.uRol.value);
    params.set('activo', ui.uActivo.checked ? '1' : '0');
    if (ui.uPass.value) { params.set('pass', ui.uPass.value); }
    if (ui.uRol.value === 'lector') { params.set('albergue_id', ui.uAlbergue.value); }

    llamar(esNuevo ? 'adminUsuarioCrear' : 'adminUsuarioEditar', params).then(function () {
      cerrarModalUsuario();
      resetFormUsuario();
      cargarListaUsuarios();
    }).catch(function (e) {
      ui.usuarioMsg.textContent = e.message || 'Error al guardar';
      ui.usuarioMsg.hidden = false;
    });
  });

  var caracArr = [];
  var imgArr = [];

  function renderCarac() {
    ui.caracList.innerHTML = caracArr.map(function (c, i) {
      return '<div class="carac-fila">' +
        '<input type="text" class="carac-icono" data-index="' + i + '" value="' + esc(c.icono) + '" placeholder="fa-utensils">' +
        '<input type="text" class="carac-texto" data-index="' + i + '" value="' + esc(c.texto) + '" placeholder="Texto de la característica">' +
        '<button type="button" class="btn-sec btn-quitar" data-remove-carac="' + i + '" title="Quitar">&times;</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(ui.caracList.querySelectorAll('.carac-icono, .carac-texto'), function (inp) {
      inp.addEventListener('change', function () {
        var idx = Number(inp.dataset.index);
        caracArr[idx][inp.classList.contains('carac-icono') ? 'icono' : 'texto'] = inp.value;
      });
    });
    Array.prototype.forEach.call(ui.caracList.querySelectorAll('[data-remove-carac]'), function (b) {
      b.addEventListener('click', function () {
        caracArr.splice(Number(b.dataset.removeCarac), 1);
        renderCarac();
      });
    });
  }

  function renderImg() {
    ui.imgList.innerHTML = imgArr.map(function (ruta, i) {
      return '<div class="img-fila">' +
        '<img src="../' + esc(ruta) + '" alt="">' +
        '<span class="img-ruta">' + esc(ruta) + '</span>' +
        '<button type="button" class="btn-sec btn-quitar" data-remove-img="' + i + '" title="Quitar">&times;</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(ui.imgList.querySelectorAll('[data-remove-img]'), function (b) {
      b.addEventListener('click', function () {
        imgArr.splice(Number(b.dataset.removeImg), 1);
        renderImg();
      });
    });
  }

  function abrirModalAlbergue(titulo) {
    ui.albergueModalTitulo.textContent = titulo;
    ui.albergueModal.hidden = false;
  }

  function cerrarModalAlbergue() {
    ui.albergueModal.hidden = true;
    ocultarMsg();
  }

  function editarAlbergue(id) {
    llamar('adminAlbergues', new Map()).then(function (j) {
      var a = j.albergues.filter(function (x) { return Number(x.id) === id; })[0];
      if (!a) { return; }
      ui.aId.value = a.id;
      ui.aClave.value = a.clave;
      ui.aClave.disabled = true;
      ui.aNombre.value = a.nombre;
      ui.aCapacidad.value = a.capacidad;
      ui.aCapacidadVisitas.value = a.capacidad_visitas;
      ui.aMontoVisita.value = (a.monto_visita !== null && a.monto_visita !== undefined) ? a.monto_visita : 2000;
      ui.aMontoCama.value = (a.monto_cama !== null && a.monto_cama !== undefined) ? a.monto_cama : 5000;
      ui.aColor.value = a.color || '#005CA2';
      ui.aHabilitado.checked = !!a.habilitado;
      ui.aDescripcion.value = a.descripcion || '';
      ui.aMapa.value = a.mapa || '';
      ui.aPdf.value = a.pdf || '';
      ui.pdfMsg.textContent = a.pdf ? ('Actual: ' + a.pdf) : 'Aún no hay PDF adjunto (máx. 8 MB)';
      ui.pdfMsg.classList.remove('error');
      caracArr = (a.caracteristicas || []).map(function (c) {
        return { icono: c.icono || '', texto: c.texto || '' };
      });
      imgArr = (a.imagenes || []).slice();
      renderCarac();
      renderImg();
      ui.albergueMsg.hidden = true;
      abrirModalAlbergue('Editar albergue · ' + a.nombre);
      ui.aNombre.focus();
    }).catch(function (e) {
      alert(e.message || 'Error');
    });
  }

  function cargarListaAlbergues() {
    llamar('adminAlbergues', new Map()).then(function (j) {
      ui.alberguesBody.innerHTML = j.albergues.map(function (a) {
        return '<tr>' +
          '<td>' + esc(a.id) + '</td>' +
          '<td>' + esc(a.clave) + '</td>' +
          '<td>' + esc(a.nombre) + '</td>' +
          '<td>' + esc(a.capacidad) + '</td>' +
          '<td>' + esc(a.capacidad_visitas) + '</td>' +
          '<td>' + (a.habilitado ? 'Sí' : '<span class="error">No</span>') + '</td>' +
          '<td><button type="button" class="btn-sec" data-albergue-id="' + esc(a.id) + '">Editar</button></td>' +
          '</tr>';
      }).join('');
      Array.prototype.forEach.call(ui.alberguesBody.querySelectorAll('[data-albergue-id]'), function (b) {
        b.addEventListener('click', function () { editarAlbergue(Number(b.dataset.albergueId)); });
      });
    }).catch(function (e) {
      ui.alberguesBody.innerHTML = '<tr><td colspan="7" class="error">' + esc(e.message || 'Error') + '</td></tr>';
    });
  }

  function resetFormAlbergue() {
    ui.aId.value = '';
    ui.aClave.value = '';
    ui.aClave.disabled = false;
    ui.aNombre.value = '';
    ui.aCapacidad.value = '';
    ui.aCapacidadVisitas.value = '';
    ui.aMontoVisita.value = 2000;
    ui.aMontoCama.value = 5000;
    ui.aColor.value = '#005CA2';
    ui.aHabilitado.checked = true;
    ui.aDescripcion.value = '';
    ui.aMapa.value = '';
    ui.aPdf.value = '';
    caracArr = [];
    imgArr = [];
    renderCarac();
    renderImg();
    ui.imgMsg.textContent = '(máx. 8 MB por foto)';
    ui.imgMsg.classList.remove('error');
    ui.pdfMsg.textContent = 'Aún no hay PDF adjunto (máx. 8 MB)';
    ui.pdfMsg.classList.remove('error');
    ocultarMsg();
  }

  ui.btnAgregarCarac.addEventListener('click', function () {
    caracArr.push({ icono: '', texto: '' });
    renderCarac();
    var inputs = ui.caracList.querySelectorAll('.carac-icono');
    if (inputs.length) { inputs[inputs.length - 1].focus(); }
  });

  ui.btnSubirImg.addEventListener('click', function () {
    if (!ui.aClave.value.trim()) {
      ui.imgMsg.textContent = 'Primero escribí la clave del albergue';
      ui.imgMsg.classList.add('error');
      return;
    }
    ui.imgMsg.textContent = '';
    ui.archivoImg.click();
  });

  ui.archivoImg.addEventListener('change', function () {
    var archivo = ui.archivoImg.files[0];
    if (!archivo) { return; }
    var fd = new FormData();
    fd.append('action', 'adminAlbergueSubirImagen');
    fd.append('clave', ui.aClave.value.trim());
    fd.append('archivo', archivo);
    ui.btnSubirImg.disabled = true;
    ui.imgMsg.textContent = 'Subiendo…';
    ui.imgMsg.classList.remove('error');
    fetch(API, { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        ui.btnSubirImg.disabled = false;
        ui.archivoImg.value = '';
        if (!j.success) { throw new Error(j.message || 'Error al subir'); }
        imgArr.push(j.ruta);
        renderImg();
        ui.imgMsg.textContent = 'Imagen subida: ' + j.ruta;
      })
      .catch(function (e) {
        ui.btnSubirImg.disabled = false;
        ui.archivoImg.value = '';
        ui.imgMsg.classList.add('error');
        ui.imgMsg.textContent = e.message || 'Error al subir la imagen';
      });
  });

  ui.btnSubirPdf.addEventListener('click', function () {
    if (!ui.aClave.value.trim()) {
      ui.pdfMsg.textContent = 'Primero escribí la clave del albergue';
      ui.pdfMsg.classList.add('error');
      return;
    }
    ui.pdfMsg.textContent = '';
    ui.archivoPdf.click();
  });

  ui.archivoPdf.addEventListener('change', function () {
    var archivo = ui.archivoPdf.files[0];
    if (!archivo) { return; }
    var fd = new FormData();
    fd.append('action', 'adminAlbergueSubirArchivo');
    fd.append('clave', ui.aClave.value.trim());
    fd.append('archivo', archivo);
    ui.btnSubirPdf.disabled = true;
    ui.pdfMsg.textContent = 'Subiendo…';
    ui.pdfMsg.classList.remove('error');
    fetch(API, { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        ui.btnSubirPdf.disabled = false;
        ui.archivoPdf.value = '';
        if (!j.success) { throw new Error(j.message || 'Error al subir'); }
        ui.aPdf.value = j.ruta;
        ui.pdfMsg.textContent = 'PDF subido: ' + j.ruta;
      })
      .catch(function (e) {
        ui.btnSubirPdf.disabled = false;
        ui.archivoPdf.value = '';
        ui.pdfMsg.classList.add('error');
        ui.pdfMsg.textContent = e.message || 'Error al subir el PDF';
      });
  });

  ui.btnNuevoAlbergue.addEventListener('click', function () {
    resetFormAlbergue();
    abrirModalAlbergue('Nuevo albergue');
    ui.aClave.focus();
  });

  ui.btnCerrarAlbergue.addEventListener('click', cerrarModalAlbergue);
  ui.albergueModal.addEventListener('click', function (ev) {
    if (ev.target === ui.albergueModal) { cerrarModalAlbergue(); }
  });

  ui.formAlbergue.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!imgArr.length) {
      ui.albergueMsg.textContent = 'Agregá al menos 1 imagen';
      ui.albergueMsg.hidden = false;
      return;
    }
    if (!caracArr.length) {
      ui.albergueMsg.textContent = 'Agregá al menos 1 característica';
      ui.albergueMsg.hidden = false;
      return;
    }
    var esNuevo = (ui.aId.value === '');
    var params = new Map();
    if (!esNuevo) { params.set('id', ui.aId.value); }
    if (esNuevo) { params.set('clave', ui.aClave.value.trim()); }
    params.set('nombre', ui.aNombre.value.trim());
    params.set('capacidad', ui.aCapacidad.value);
    params.set('capacidad_visitas', ui.aCapacidadVisitas.value);
    params.set('monto_visita', ui.aMontoVisita.value);
    params.set('monto_cama', ui.aMontoCama.value);
    params.set('descripcion', ui.aDescripcion.value.trim());
    params.set('color', ui.aColor.value);
    params.set('mapa', ui.aMapa.value.trim());
    params.set('pdf', ui.aPdf.value.trim());
    params.set('habilitado', ui.aHabilitado.checked ? '1' : '0');
    params.set('caracteristicas', JSON.stringify(caracArr));
    params.set('imagenes', JSON.stringify(imgArr));
    llamar(esNuevo ? 'adminAlbergueCrear' : 'adminAlbergueEditar', params).then(function () {
      cerrarModalAlbergue();
      resetFormAlbergue();
      cargarListaAlbergues();
      cargarOpcionesAlbergues();
    }).catch(function (e) {
      ui.albergueMsg.textContent = e.message || 'Error al guardar';
      ui.albergueMsg.hidden = false;
    });
  });

  ui.formConfig.addEventListener('submit', function (ev) {
    ev.preventDefault();
    ui.cfgNotifMsg.hidden = true;
    var params = new Map();
    params.set('mail_admin', ui.cfgMailAdmin.value.trim());
    llamar('adminConfigGuardar', params).then(function () {
      ui.cfgNotifMsg.textContent = 'Configuración guardada.';
      ui.cfgNotifMsg.classList.remove('error');
      ui.cfgNotifMsg.hidden = false;
    }).catch(function (e) {
      ui.cfgNotifMsg.textContent = e.message || 'Error al guardar';
      ui.cfgNotifMsg.classList.add('error');
      ui.cfgNotifMsg.hidden = false;
    });
  });

  // ===================== Inicio =====================
  ocultarMsg();
  resetFormUsuario();
  resetFormAlbergue();

  if (ui.anioActual) { ui.anioActual.textContent = new Date().getFullYear(); }

  llamar('adminSesion', new Map()).then(function (j) {
    rol = j.rol;
    esLector = (rol === 'lector');
    estadoSesion(j.usuario);
    if (rol === 'super_admin') { mostrarGestor(j.usuario); } else { mostrarPanel(j.usuario); }
  }).catch(function () {
    mostrarLogin();
  });
})();