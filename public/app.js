'use strict';

// ── Estado de sesión simple (recordar nombre de usuario entre acciones) ──────
let usuarioActual = sessionStorage.getItem('amlUsuario') || '';
let clienteEnFicha = null; // cliente actualmente abierto en la ficha
let contextoExpediente = 'cliente'; // 'cliente' | 'proveedor' — qué lista/ficha se está viendo
let colabEnFicha = null; // colaborador actualmente abierto en la ficha

// ── Íconos SVG (Lucide) — reemplazan emojis en la navegación ─────────────────
const LUCIDE = {
  search:    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  users:     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  building:  '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  'hard-hat':'<path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z"/><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><path d="M14 6a6 6 0 0 1 6 6v3"/>',
  history:   '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  alert:     '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  scan:      '<path d="m8 11 2 2 4-4"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  flag:      '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  snowflake: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  cap:       '<path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  chart:     '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  shield:    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  camera:    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  refresh:   '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
};
function svgIcon(nombre, cls = 'icono') {
  const p = LUCIDE[nombre];
  if (!p) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
// Inyecta el SVG en cualquier elemento con data-icon. Las pestañas reciben la
// clase tab-icono; el resto (botones) reciben btn-icono.
document.querySelectorAll('[data-icon]').forEach(el => {
  const esTab = el.classList.contains('tab');
  el.insertAdjacentHTML('afterbegin', svgIcon(el.dataset.icon, esTab ? 'tab-icono' : 'btn-icono'));
});

// ── Tabs ──────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('activo'));
    btn.classList.add('activo');
    document.getElementById(`tab-${id}`).classList.add('activo');
    if (id === 'historial') cargarHistorial();
    if (id === 'alertas')   cargarAlertas();
    if (id === 'ros')       { cargarROS(); cargarSelectClientesROS(); }
    if (id === 'inusuales') { cargarInusuales(); cargarSelectClientesEn('inu-cliente'); }
    if (id === 'congelamiento') { cargarCongelamientos(); cargarSelectClientesEn('con-cliente'); }
    if (id === 'capacitacion') cargarCapacitaciones();
    if (id === 'riesgo-inst')  cargarEvaluaciones();
    if (id === 'estado')    { cargarEstadoListas(); cargarPep(); cargarGafi(); }
    if (id === 'clientes') {
      contextoExpediente = btn.dataset.expediente === 'proveedor' ? 'proveedor' : 'cliente';
      aplicarContextoExpediente();
      mostrarVistaListaClientes();
    }
    if (id === 'colaboradores') cargarColaboradores();
  });
});

// ── Contexto cliente / proveedor (mismo motor de debida diligencia) ───────────
const TXT_EXPEDIENTE = {
  cliente:   { titulo: 'Expedientes de Clientes',   sub: 'Cree fichas de clientes, suba sus documentos y consulte su historial AML.', nuevoBtn: '+ Nuevo Cliente', formTitulo: 'Nuevo Cliente', crearBtn: 'Crear Ficha de Cliente', buscar: 'Buscar por nombre o cédula…', volver: '← Volver a la lista de clientes', badge: 'CLIENTE' },
  proveedor: { titulo: 'Expedientes de Proveedores', sub: 'Debida diligencia de proveedores (Decreto 35 de 2022): documentos, beneficiarios finales y tamizaje AML.', nuevoBtn: '+ Nuevo Proveedor', formTitulo: 'Nuevo Proveedor', crearBtn: 'Crear Ficha de Proveedor', buscar: 'Buscar proveedor por nombre o RUC…', volver: '← Volver a la lista de proveedores', badge: 'PROVEEDOR' },
};

function aplicarContextoExpediente() {
  const t = TXT_EXPEDIENTE[contextoExpediente];
  const set = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };
  set('clientes-titulo-lista', 'textContent', t.titulo);
  set('clientes-subtitulo-lista', 'textContent', t.sub);
  set('btn-nuevo-cliente', 'textContent', t.nuevoBtn);
  set('nc-form-titulo', 'textContent', t.formTitulo);
  set('btn-crear-cliente', 'textContent', t.crearBtn);
  const buscar = document.getElementById('buscar-cliente');
  if (buscar) buscar.placeholder = t.buscar;
  set('btn-volver-clientes', 'textContent', t.volver);
}

function activarTab(id) {
  document.querySelector(`.tab[data-tab="${id}"]`)?.click();
}

// ── Formulario de consulta ────────────────────────────────
const form       = document.getElementById('form-consulta');
const btnBuscar  = document.getElementById('btn-buscar');
const errForm    = document.getElementById('error-form');
const cargando   = document.getElementById('cargando');
const resultCont = document.getElementById('resultado-contenedor');
const inputUsuario = document.getElementById('usuario');

if (usuarioActual) inputUsuario.value = usuarioActual;
inputUsuario.addEventListener('change', () => {
  usuarioActual = inputUsuario.value.trim();
  sessionStorage.setItem('amlUsuario', usuarioActual);
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const nombre    = document.getElementById('nombre').value.trim();
  const cedula    = document.getElementById('cedula').value.trim();
  const pais      = document.getElementById('pais').value.trim();
  const usuario   = document.getElementById('usuario').value.trim();
  const clienteId = document.getElementById('cliente-id').value || null;

  errForm.classList.add('oculto');
  resultCont.classList.add('oculto');

  if (!nombre && !cedula) {
    mostrarError(errForm, 'Por favor ingrese al menos un nombre o número de cédula/pasaporte.');
    return;
  }
  if (nombre && nombre.length < 3) {
    mostrarError(errForm, 'El nombre debe tener al menos 3 caracteres.');
    return;
  }
  if (cedula && cedula.replace(/[-\s]/g, '').length < 4) {
    mostrarError(errForm, 'La cédula o ID debe tener al menos 4 caracteres.');
    return;
  }

  btnBuscar.disabled = true;
  btnBuscar.querySelector('.btn-texto').textContent = 'Consultando…';
  cargando.classList.remove('oculto');

  try {
    const res  = await fetch('/api/consultar', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ nombre, cedula, pais, usuario, clienteId }),
    });
    const data = await res.json();

    if (!res.ok) {
      mostrarError(errForm, data.error || 'Error al realizar la consulta.');
      return;
    }

    renderizarResultado(data);
  } catch (err) {
    mostrarError(errForm, `Error de conexión: ${err.message}`);
  } finally {
    btnBuscar.disabled = false;
    btnBuscar.querySelector('.btn-texto').textContent = 'Consultar Listas de Sanciones';
    cargando.classList.add('oculto');
  }
});

// ── Renderizar resultado ──────────────────────────────────
function renderizarResultado(data) {
  const { consultaId, fecha, hora, nombre, cedula, pais, hayCoincidencia, onuHits, ofacHits, ueHits, pepHits, gafiResultado, errores } = data;

  // Veredicto
  const banner = document.getElementById('veredicto-banner');
  banner.className = `veredicto-banner ${hayCoincidencia ? 'coincidencia' : 'sin-coincidencia'}`;
  document.getElementById('veredicto-icono').textContent = hayCoincidencia ? '⚠' : '✓';
  document.getElementById('veredicto-texto').textContent = hayCoincidencia
    ? 'COINCIDENCIA DETECTADA — ALERTA AML/FT'
    : 'SIN COINCIDENCIAS EN LISTAS DE SANCIONES';

  // Metadata
  document.getElementById('meta-id').textContent    = consultaId;
  document.getElementById('meta-fecha').textContent = fecha;
  document.getElementById('meta-hora').textContent  = hora;
  document.getElementById('meta-nombre').textContent = nombre || '—';
  document.getElementById('meta-cedula').textContent = cedula || '—';
  document.getElementById('meta-pais').textContent   = pais   || '—';
  document.getElementById('btn-pdf').href = `/api/reporte/${consultaId}`;

  // Alerta GAFI
  const alertaGafi = document.getElementById('alerta-gafi');
  if (gafiResultado && gafiResultado.coincide) {
    alertaGafi.className = 'tarjeta alerta-gafi alerta-gafi-activa';
    alertaGafi.innerHTML = `
      <div class="alerta-gafi-titulo">⚠ DILIGENCIA AMPLIADA REQUERIDA — Art. 41, Ley 23 de 2015</div>
      <p>El país declarado <strong>${esc(gafiResultado.pais)}</strong> se encuentra en la
      <strong>lista ${gafiResultado.lista === 'negra' ? 'NEGRA (alto riesgo — acción urgente)' : 'GRIS (mayor monitoreo)'}</strong>
      del GAFI/FATF. Debe aplicarse debida diligencia ampliada conforme a la Ley 23 de 2015.</p>`;
    alertaGafi.classList.remove('oculto');
  } else if (gafiResultado) {
    alertaGafi.className = 'tarjeta alerta-gafi alerta-gafi-ok';
    alertaGafi.innerHTML = `<p>✓ El país declarado (<strong>${esc(gafiResultado.paisConsultado || '')}</strong>) no se encuentra en las listas GAFI/FATF de alto riesgo (Art. 41).</p>`;
    alertaGafi.classList.remove('oculto');
  } else {
    alertaGafi.classList.add('oculto');
  }

  // ONU / OFAC / UE / PEP
  renderizarHits('onu', onuHits || []);
  renderizarHits('ofac', ofacHits || []);
  renderizarHits('ue', ueHits || []);
  renderizarHits('pep', pepHits || []);

  // Errores de listas (si alguna falló)
  const errDiv = document.getElementById('errores-consulta');
  if (errores && errores.length) {
    errDiv.textContent = '⚠ Advertencia: ' + errores.join(' | ');
    errDiv.classList.remove('oculto');
  } else {
    errDiv.classList.add('oculto');
  }

  resultCont.classList.remove('oculto');
  resultCont.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderizarHits(fuente, hits) {
  const contenedor = document.getElementById(`resultados-${fuente}`);
  const badge      = document.getElementById(`badge-${fuente}`);

  if (hits.length === 0) {
    badge.className = 'badge ok';
    badge.textContent = '✓ Sin coincidencias';
    contenedor.innerHTML = `
      <div class="sin-resultado">
        <span>✓</span>
        <span>No se encontraron coincidencias en esta lista.</span>
      </div>`;
    return;
  }

  badge.className = 'badge alerta';
  badge.textContent = `⚠ ${hits.length} coincidencia(s)`;

  contenedor.innerHTML = hits.map(hit => {
    const nombres = (hit.nombres || []).slice(0, 4).join(' / ') || '—';
    const extras = [];
    if (hit.listaTipo)  extras.push(`<span><strong>Lista:</strong> ${esc(hit.listaTipo)}</span>`);
    if (hit.programas)  extras.push(`<span><strong>Programas:</strong> ${esc(hit.programas)}</span>`);
    if (hit.listedOn)   extras.push(`<span><strong>Incluido:</strong> ${esc(hit.listedOn)}</span>`);
    if (hit.nacionalidad) extras.push(`<span><strong>Nac.:</strong> ${esc(hit.nacionalidad)}</span>`);
    if (hit.cargo)       extras.push(`<span><strong>Cargo:</strong> ${esc(hit.cargo)}</span>`);
    if (hit.vinculadoA)  extras.push(`<span><strong>Vinculado a:</strong> ${esc(hit.vinculadoA)}</span>`);

    return `
      <div class="hit-card">
        <div class="hit-header">
          <span class="hit-tipo">${esc(hit.tipo || 'Desconocido')}</span>
          <span class="hit-fuente">${esc(hit.fuente || fuente.toUpperCase())}</span>
          <span class="hit-ref">Ref/ID: ${esc(hit.refNumero || hit.id || '—')}</span>
        </div>
        <div class="hit-nombres">${esc(nombres)}</div>
        ${extras.length ? `<div class="hit-detalle">${extras.join('')}</div>` : ''}
        <div class="hit-razon">🔎 ${esc(hit.razonMatch || '—')}</div>
      </div>`;
  }).join('');
}

// ── Historial ─────────────────────────────────────────────
async function cargarHistorial() {
  const tbody = document.getElementById('tbody-historial');
  tbody.innerHTML = '<tr><td colspan="15" class="cargando-msg">Cargando…</td></tr>';

  const params = new URLSearchParams();
  const desde = document.getElementById('filtro-fecha-desde').value;
  const hasta = document.getElementById('filtro-fecha-hasta').value;
  const resultado = document.getElementById('filtro-resultado').value;
  if (desde) params.set('fechaDesde', desde);
  if (hasta) params.set('fechaHasta', hasta);
  if (resultado) params.set('resultado', resultado);

  try {
    const res  = await fetch(`/api/historial?${params.toString()}`);
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="15" class="cargando-msg">No hay consultas registradas para estos filtros.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const claseRow = r.coincidencia ? 'es-alerta' : '';
      const veredicto = r.coincidencia
        ? '<span class="resultado-alerta">⚠ COINCIDENCIA</span>'
        : '<span class="resultado-ok">✓ LIMPIO</span>';
      const celda = (val) => `<td class="${val && val !== 'Sin coincidencias' && val !== 'Sin alerta' && val !== 'No evaluado (sin país)' ? 'resultado-alerta' : 'resultado-sin'}">${esc(val || '—')}</td>`;
      return `
        <tr class="${claseRow}">
          <td>${r.id}</td>
          <td>${esc(r.fecha)}</td>
          <td>${esc(r.hora)}</td>
          <td>${esc(r.nombre || '—')}</td>
          <td>${esc(r.cedula || '—')}</td>
          <td>${esc(r.pais || '—')}</td>
          <td>${esc(r.usuario || '—')}</td>
          <td>${r.cliente_nombre ? esc(r.cliente_nombre) : '—'}</td>
          ${celda(r.resultado_onu)}
          ${celda(r.resultado_ofac)}
          ${celda(r.resultado_ue)}
          ${celda(r.resultado_pep)}
          ${celda(r.resultado_gafi)}
          <td>${veredicto}</td>
          <td><a href="/api/reporte/${r.id}" target="_blank" class="link-pdf">📄 PDF</a></td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="15" class="cargando-msg">Error al cargar historial: ${esc(err.message)}</td></tr>`;
  }
}

document.getElementById('btn-actualizar-historial').addEventListener('click', cargarHistorial);
document.getElementById('btn-filtrar-historial').addEventListener('click', cargarHistorial);
document.getElementById('btn-limpiar-filtros').addEventListener('click', () => {
  document.getElementById('filtro-fecha-desde').value = '';
  document.getElementById('filtro-fecha-hasta').value = '';
  document.getElementById('filtro-resultado').value = '';
  cargarHistorial();
});

// ── Estado de listas ──────────────────────────────────────
async function cargarEstadoListas() {
  try {
    const res  = await fetch('/api/estado-listas');
    const data = await res.json();
    actualizarBarraEstado(data);
    renderizarEstadoLista('onu', data.onu);
    renderizarEstadoLista('ofac', data.ofac);
    renderizarEstadoLista('ue', data.ue);
  } catch (err) {
    console.warn('Error al cargar estado de listas:', err.message);
  }
}

function renderizarEstadoLista(id, info) {
  const cargada = document.getElementById(`${id}-cargada`);
  const entradas = document.getElementById(`${id}-entradas`);
  const fecha   = document.getElementById(`${id}-fecha`);
  const cache   = document.getElementById(`${id}-cache`);

  if (info.cargada) {
    cargada.textContent = '✓ Cargada en memoria';
    cargada.className   = 'texto-ok';
  } else if (info.error) {
    cargada.textContent = `✗ Error: ${info.error}`;
    cargada.className   = 'texto-error';
  } else {
    cargada.textContent = '⏳ Descargando…';
    cargada.className   = 'texto-warn';
  }

  entradas.textContent = info.entradas
    ? info.entradas.toLocaleString('es-PA') + ' registros'
    : '—';

  if (info.ultimaActualizacion) {
    const d = new Date(info.ultimaActualizacion);
    fecha.textContent = d.toLocaleString('es-PA', { timeZone: 'America/Panama' });
  } else {
    fecha.textContent = '—';
  }

  cache.textContent = info.cacheDisco ? '✓ Sí' : '✗ No';
  cache.className   = info.cacheDisco ? 'texto-ok' : 'texto-warn';
}

function actualizarBarraEstado(data) {
  const barra = document.getElementById('barra-estado');
  const onuOk  = data.onu.cargada;
  const ofacOk = data.ofac.cargada;
  const ueOk   = data.ue.cargada;

  if (onuOk && ofacOk) {
    let txt = `✓ Listas activas — ONU: ${data.onu.entradas.toLocaleString('es-PA')} | OFAC: ${data.ofac.entradas.toLocaleString('es-PA')}`;
    txt += ueOk ? ` | UE: ${data.ue.entradas.toLocaleString('es-PA')}` : ' | UE: pendiente de carga';
    barra.className = ueOk ? 'barra-estado ok' : 'barra-estado warn';
    barra.textContent = txt;
  } else if (!onuOk && !ofacOk) {
    barra.className = 'barra-estado warn';
    barra.textContent = '⚠ Las listas de sanciones están descargándose. Las primeras consultas pueden tardar unos minutos.';
  } else {
    barra.className = 'barra-estado warn';
    const pendiente = !onuOk ? 'ONU' : 'OFAC';
    barra.textContent = `⚠ Lista ${pendiente} aún cargando. Resto disponible.`;
  }
}

// ── Forzar actualización (ONU, OFAC, UE) ──────────────────
document.getElementById('btn-forzar-actualizacion').addEventListener('click', async () => {
  const btn = document.getElementById('btn-forzar-actualizacion');
  const div = document.getElementById('actualizacion-resultado');
  btn.disabled = true;
  btn.textContent = '⬇ Descargando… (puede tardar varios minutos)';
  div.textContent = 'Descargando listas de sanciones. Por favor espere…';
  div.className = 'mensaje-info';
  div.classList.remove('oculto');

  try {
    const res  = await fetch('/api/actualizar-listas', { method: 'POST' });
    const data = await res.json();
    let msg = `✓ Actualización completada — ONU: ${data.onu.entradas.toLocaleString('es-PA')} | OFAC: ${data.ofac.entradas.toLocaleString('es-PA')} | UE: ${data.ue.entradas.toLocaleString('es-PA')}`;
    if (data.errores) msg += ` | Errores: ${data.errores.join('; ')}`;
    div.textContent = msg;
    await cargarEstadoListas();
  } catch (err) {
    div.className = 'mensaje-error';
    div.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Forzar Descarga de Listas Ahora (ONU, OFAC, UE)';
  }
});

// ── Carga manual de la lista UE ───────────────────────────
document.getElementById('form-ue-manual').addEventListener('submit', async e => {
  e.preventDefault();
  const fileInput = document.getElementById('ue-archivo-manual');
  const file = fileInput.files[0];
  if (!file) return;

  const div = document.getElementById('actualizacion-resultado');
  div.className = 'mensaje-info';
  div.textContent = 'Cargando archivo XML de la UE…';
  div.classList.remove('oculto');

  const formData = new FormData();
  formData.append('archivo', file);

  try {
    const res  = await fetch('/api/listas/ue/cargar-manual', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar el archivo.');
    div.className = 'mensaje-info';
    div.textContent = `✓ Lista UE cargada manualmente — ${data.entradas.toLocaleString('es-PA')} registros.`;
    await cargarEstadoListas();
  } catch (err) {
    div.className = 'mensaje-error';
    div.textContent = `Error: ${err.message}`;
  } finally {
    fileInput.value = '';
  }
});

// ── PEP Panamá ─────────────────────────────────────────────
async function cargarPep() {
  const tbody = document.getElementById('tbody-pep');
  const selectCategoria = document.getElementById('pep-categoria');
  try {
    const res  = await fetch('/api/pep');
    const data = await res.json();

    if (!selectCategoria.dataset.cargado) {
      selectCategoria.innerHTML = data.categorias.map(c =>
        `<option value="${esc(c.id)}">${esc(c.nombre)} (${esc(c.articulo)})</option>`
      ).join('');
      selectCategoria.dataset.cargado = '1';
    }

    if (!data.personas.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="cargando-msg">No hay personas registradas. Agregue PEP usando el formulario superior.</td></tr>';
      return;
    }

    tbody.innerHTML = data.personas.map(p => `
      <tr>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.cargo || '—')}</td>
        <td>${esc(p.categoria ? `${p.categoria.nombre} (${p.categoria.articulo})` : (p.categoria_id || '—'))}</td>
        <td>${esc(p.vinculado_a || '—')}</td>
        <td><button class="btn-borrar" data-id="${p.id}" data-tipo="pep">✕</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('.btn-borrar').forEach(btn => btn.addEventListener('click', borrarRegistroLista));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

document.getElementById('form-nuevo-pep').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-pep');
  err.classList.add('oculto');

  const body = {
    nombre     : document.getElementById('pep-nombre').value.trim(),
    cargo      : document.getElementById('pep-cargo').value.trim(),
    categoriaId: document.getElementById('pep-categoria').value,
    vinculadoA : document.getElementById('pep-vinculado').value.trim(),
    usuario    : usuarioActual,
  };

  try {
    const res  = await fetch('/api/pep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al agregar PEP.');
    document.getElementById('form-nuevo-pep').reset();
    cargarPep();
  } catch (e2) {
    mostrarError(err, e2.message);
  }
});

// ── GAFI ───────────────────────────────────────────────────
async function cargarGafi() {
  const negra = document.getElementById('lista-gafi-negra');
  const gris  = document.getElementById('lista-gafi-gris');
  try {
    const res  = await fetch('/api/gafi');
    const data = await res.json();

    const itemHtml = (p) => `<li>${esc(p.nombre)}${p.codigo ? ` (${esc(p.codigo)})` : ''} <button class="btn-borrar-mini" data-id="${p.id}" data-tipo="gafi">✕</button></li>`;

    const negras = data.paises.filter(p => p.lista === 'negra');
    const grises = data.paises.filter(p => p.lista === 'gris');

    negra.innerHTML = negras.length ? negras.map(itemHtml).join('') : '<li class="gafi-vacio">Sin países registrados.</li>';
    gris.innerHTML  = grises.length ? grises.map(itemHtml).join('') : '<li class="gafi-vacio">Sin países registrados.</li>';

    document.querySelectorAll('.btn-borrar-mini').forEach(btn => btn.addEventListener('click', borrarRegistroLista));
  } catch (err) {
    negra.innerHTML = `<li class="gafi-vacio">Error: ${esc(err.message)}</li>`;
  }
}

document.getElementById('form-nuevo-gafi').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-gafi');
  err.classList.add('oculto');

  const body = {
    nombre: document.getElementById('gafi-nombre').value.trim(),
    codigo: document.getElementById('gafi-codigo').value.trim(),
    lista : document.getElementById('gafi-lista').value,
  };

  try {
    const res  = await fetch('/api/gafi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al agregar país.');
    document.getElementById('form-nuevo-gafi').reset();
    cargarGafi();
  } catch (e2) {
    mostrarError(err, e2.message);
  }
});

async function borrarRegistroLista(e) {
  const id   = e.currentTarget.dataset.id;
  const tipo = e.currentTarget.dataset.tipo;
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await fetch(`/api/${tipo}/${id}`, { method: 'DELETE' });
    if (tipo === 'pep')  cargarPep();
    if (tipo === 'gafi') cargarGafi();
  } catch (err) {
    alert(`Error al eliminar: ${err.message}`);
  }
}

// ── CLIENTES ───────────────────────────────────────────────
const vistaListaClientes = document.getElementById('clientes-vista-lista');
const vistaFichaCliente   = document.getElementById('clientes-vista-ficha');

function mostrarVistaListaClientes() {
  vistaListaClientes.classList.remove('oculto');
  vistaFichaCliente.classList.add('oculto');
  cargarClientes();
}

function mostrarVistaFichaCliente() {
  vistaListaClientes.classList.add('oculto');
  vistaFichaCliente.classList.remove('oculto');
}

async function cargarClientes(buscar) {
  const tbody = document.getElementById('tbody-clientes');
  tbody.innerHTML = '<tr><td colspan="6" class="cargando-msg">Cargando…</td></tr>';
  try {
    const params = new URLSearchParams({ expediente: contextoExpediente });
    if (buscar) params.set('buscar', buscar);
    const res  = await fetch(`/api/clientes?${params.toString()}`);
    const rows = await res.json();

    if (!rows.length) {
      const vacio = contextoExpediente === 'proveedor'
        ? 'No hay proveedores registrados. Cree uno con "+ Nuevo Proveedor".'
        : 'No hay clientes registrados. Cree uno con "+ Nuevo Cliente".';
      tbody.innerHTML = `<tr><td colspan="6" class="cargando-msg">${vacio}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(c => `
      <tr>
        <td>${esc(c.nombre)}</td>
        <td>${esc(c.cedula || '—')}</td>
        <td>${c.tipo === 'juridica' ? 'Jurídica' : 'Natural'}</td>
        <td>${esc(c.nacionalidad || '—')}</td>
        <td>${esc((c.creado_en || '').split(' ')[0] || '—')}</td>
        <td><button class="btn-secundario btn-chico btn-ver-ficha" data-id="${c.id}">Ver ficha</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('.btn-ver-ficha').forEach(btn =>
      btn.addEventListener('click', () => abrirFichaCliente(btn.dataset.id))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

let debounceBuscarCliente = null;
document.getElementById('buscar-cliente').addEventListener('input', e => {
  clearTimeout(debounceBuscarCliente);
  debounceBuscarCliente = setTimeout(() => cargarClientes(e.target.value.trim()), 250);
});

document.getElementById('btn-nuevo-cliente').addEventListener('click', () => {
  document.getElementById('form-nuevo-cliente-tarjeta').classList.remove('oculto');
});
document.getElementById('btn-cancelar-nuevo-cliente').addEventListener('click', () => {
  document.getElementById('form-nuevo-cliente-tarjeta').classList.add('oculto');
  document.getElementById('form-nuevo-cliente').reset();
});

// ── Nuevo cliente: mostrar/ocultar campos según tipo ──────────────────────────
document.getElementById('nc-tipo').addEventListener('change', function () {
  const esJuridica = this.value === 'juridica';
  const secJur = document.getElementById('nc-campos-juridica');
  const secNat = document.getElementById('nc-campos-natural');
  if (secJur) secJur.classList.toggle('oculto', !esJuridica);
  if (secNat) secNat.classList.toggle('oculto', esJuridica);
});

// ── Agregar filas de beneficiario en formulario nuevo cliente ─────────────────
let _ncBfCount = 0;
const btnAgregarBfFila = document.getElementById('btn-agregar-bf-fila');
if (btnAgregarBfFila) {
  btnAgregarBfFila.addEventListener('click', () => {
    _ncBfCount++;
    const contenedor = document.getElementById('nc-bf-filas');
    const div = document.createElement('div');
    div.className = 'nc-bf-fila';
    div.dataset.idx = _ncBfCount;
    div.innerHTML = `
      <div class="campos-fila">
        <div class="campo"><label>Nombre completo *</label><input type="text" name="nc-bf-nombre-${_ncBfCount}" class="nc-bf-nombre" /></div>
        <div class="campo"><label>Cédula / Pasaporte</label><input type="text" name="nc-bf-cedula-${_ncBfCount}" class="nc-bf-cedula" /></div>
      </div>
      <div class="campos-fila">
        <div class="campo"><label>Nacionalidad</label><input type="text" name="nc-bf-nac-${_ncBfCount}" class="nc-bf-nac" /></div>
        <div class="campo"><label>% Participación</label><input type="number" name="nc-bf-pct-${_ncBfCount}" class="nc-bf-pct" min="0" max="100" step="0.01" /></div>
        <div class="campo"><label>Cargo / Función</label><input type="text" name="nc-bf-cargo-${_ncBfCount}" class="nc-bf-cargo" /></div>
      </div>
      <button type="button" class="btn-borrar btn-chico nc-bf-eliminar">✕ Quitar</button>`;
    div.querySelector('.nc-bf-eliminar').addEventListener('click', () => div.remove());
    contenedor.appendChild(div);
  });
}

document.getElementById('form-nuevo-cliente').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-nuevo-cliente');
  err.classList.add('oculto');
  const tipo = document.getElementById('nc-tipo').value;

  // Recoger notas del campo correcto según tipo
  const notasEl = tipo === 'juridica'
    ? document.getElementById('nc-notas')
    : (document.getElementById('nc-notas-natural') || document.getElementById('nc-notas'));

  const body = {
    nombre            : document.getElementById('nc-nombre').value.trim(),
    cedula            : document.getElementById('nc-cedula').value.trim(),
    tipo,
    nacionalidad      : document.getElementById('nc-nacionalidad').value.trim(),
    fechaNacimiento   : document.getElementById('nc-fecha-nacimiento').value.trim(),
    notas             : notasEl ? notasEl.value.trim() : '',
    usuario           : usuarioActual,
    direccion         : (document.getElementById('nc-direccion') || {}).value?.trim() || '',
    actividadEconomica: (document.getElementById('nc-actividad') || {}).value?.trim() || '',
    origenFondos      : (document.getElementById('nc-origen-fondos') || {}).value?.trim() || '',
    representanteLegal: tipo === 'juridica' ? ((document.getElementById('nc-representante') || {}).value?.trim() || '') : '',
    tipoExpediente    : contextoExpediente,
  };

  if (!body.nombre) {
    mostrarError(err, `El nombre del ${contextoExpediente} es obligatorio.`);
    return;
  }

  // Recoger beneficiarios del formulario (solo jurídica)
  const bfFilas = [];
  if (tipo === 'juridica') {
    document.querySelectorAll('#nc-bf-filas .nc-bf-fila').forEach(fila => {
      const nombre = fila.querySelector('.nc-bf-nombre')?.value.trim();
      if (nombre) {
        bfFilas.push({
          nombre,
          cedula      : fila.querySelector('.nc-bf-cedula')?.value.trim() || '',
          nacionalidad: fila.querySelector('.nc-bf-nac')?.value.trim() || '',
          participacion: fila.querySelector('.nc-bf-pct')?.value || '',
          cargo       : fila.querySelector('.nc-bf-cargo')?.value.trim() || '',
        });
      }
    });
  }

  // Mostrar progreso si hay beneficiarios
  const progEl = document.getElementById('nc-progreso');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (bfFilas.length && progEl) progEl.classList.remove('oculto');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res  = await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear el cliente.');
    const clienteId = data.id;

    // Crear beneficiarios secuencialmente
    let bfErrores = [];
    for (let i = 0; i < bfFilas.length; i++) {
      if (progEl) progEl.textContent = `Verificando beneficiario ${i + 1} de ${bfFilas.length} en listas AML…`;
      try {
        const bfRes = await fetch(`/api/clientes/${clienteId}/beneficiarios`, {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ ...bfFilas[i], usuario: usuarioActual }),
        });
        const bfData = await bfRes.json();
        if (!bfRes.ok) bfErrores.push(`${bfFilas[i].nombre}: ${bfData.error}`);
        else if (bfData.coincidencia) bfErrores.push(`⚠ ${bfFilas[i].nombre}: COINCIDENCIA en listas AML`);
      } catch (bfErr) {
        bfErrores.push(`${bfFilas[i].nombre}: ${bfErr.message}`);
      }
    }

    document.getElementById('form-nuevo-cliente').reset();
    document.getElementById('nc-bf-filas').innerHTML = '';
    document.getElementById('form-nuevo-cliente-tarjeta').classList.add('oculto');
    if (progEl) progEl.classList.add('oculto');

    if (bfErrores.length) {
      alert('Cliente creado. Advertencias de beneficiarios:\n' + bfErrores.join('\n'));
    }

    cargarClientes();
    abrirFichaCliente(clienteId);
  } catch (e2) {
    mostrarError(err, e2.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (progEl) progEl.classList.add('oculto');
  }
});

async function abrirFichaCliente(id) {
  try {
    const res  = await fetch(`/api/clientes/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el cliente.');

    clienteEnFicha = data.cliente;
    // Sincronizar contexto con el tipo de expediente del registro abierto
    contextoExpediente = data.cliente.tipo_expediente === 'proveedor' ? 'proveedor' : 'cliente';
    aplicarContextoExpediente();
    renderizarFicha(data.cliente, data.documentos, data.historial, data.beneficiarios || [], data.riesgoCalculado, data.pendientes || []);
    mostrarVistaFichaCliente();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function renderizarFicha(cliente, documentos, historial, beneficiarios, riesgoCalculado, pendientes) {
  // El h2 contiene un nodo de texto (nombre) + el badge de expediente. Solo actualizo el texto.
  const fichaNombreEl = document.getElementById('ficha-nombre');
  if (fichaNombreEl.childNodes[0]) fichaNombreEl.childNodes[0].nodeValue = `${cliente.nombre} `;

  // Badge de tipo de expediente (cliente / proveedor)
  const esProv = cliente.tipo_expediente === 'proveedor';
  const badge = document.getElementById('ficha-expediente-badge');
  if (badge) {
    badge.textContent = esProv ? 'PROVEEDOR' : 'CLIENTE';
    badge.className = `badge-expediente ${esProv ? 'badge-expediente--proveedor' : 'badge-expediente--cliente'}`;
    badge.classList.remove('oculto');
  }
  document.getElementById('ficha-cedula').textContent = cliente.cedula || '—';
  document.getElementById('ficha-tipo').textContent = cliente.tipo === 'juridica' ? 'Persona jurídica' : 'Persona natural';
  document.getElementById('ficha-nacionalidad').textContent = cliente.nacionalidad || '—';
  document.getElementById('ficha-fecha-nacimiento').textContent = cliente.fecha_nacimiento || '—';
  document.getElementById('ficha-creado').textContent = cliente.creado_en || '—';

  // Campos nuevos en encabezado de ficha
  const dirEl = document.getElementById('ficha-direccion');
  if (dirEl) dirEl.textContent = cliente.direccion || '—';
  const repEl = document.getElementById('ficha-representante');
  if (repEl) repEl.textContent = cliente.representante_legal || '—';

  renderizarAnalisisRiesgo(cliente, riesgoCalculado, pendientes);
  renderizarAprobacion(cliente);
  renderizarROSCliente(cliente.id);
  renderizarConservacion(cliente);

  document.getElementById('form-editar-cliente').classList.add('oculto');

  const cardBf = document.getElementById('card-beneficiarios');
  if (cliente.tipo === 'juridica') {
    cardBf.classList.remove('oculto');
    cargarBeneficiarios(cliente.id);
  } else {
    cardBf.classList.add('oculto');
  }

  renderizarDocumentos(cliente.id, documentos);
  renderizarHistorialCliente(historial);
}

function renderizarDocumentos(clienteId, documentos) {
  const cont = document.getElementById('lista-documentos-cliente');
  if (!documentos.length) {
    cont.innerHTML = '<p class="cargando-msg">No hay documentos subidos aún.</p>';
    return;
  }

  const etiquetas = {
    pasaporte: 'Pasaporte', cedula: 'Cédula', pacto_social: 'Pacto Social',
    estados_financieros: 'Estados Financieros', ruc: 'RUC', otro: 'Otro',
  };

  cont.innerHTML = documentos.map(d => `
    <div class="documento-item">
      <span class="documento-tipo">${esc(etiquetas[d.tipo_documento] || d.tipo_documento || 'Otro')}</span>
      <span class="documento-nombre">${esc(d.nombre_original)}</span>
      <span class="documento-fecha">${esc((d.subido_en || '').split(' ')[0] || '')}</span>
      <a class="btn-secundario btn-chico" href="/api/clientes/${clienteId}/documentos/${d.id}/descargar" target="_blank">⬇ Descargar</a>
      <button class="btn-borrar btn-borrar-doc" data-cliente="${clienteId}" data-id="${d.id}">✕</button>
    </div>`).join('');

  cont.querySelectorAll('.btn-borrar-doc').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este documento?')) return;
    try {
      await fetch(`/api/clientes/${btn.dataset.cliente}/documentos/${btn.dataset.id}`, { method: 'DELETE' });
      abrirFichaCliente(btn.dataset.cliente);
    } catch (err) {
      alert(`Error al eliminar: ${err.message}`);
    }
  }));
}

function renderizarHistorialCliente(historial) {
  const tbody = document.getElementById('tbody-historial-cliente');
  if (!historial.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="cargando-msg">Sin búsquedas AML registradas para este cliente.</td></tr>';
    return;
  }
  tbody.innerHTML = historial.map(h => {
    const veredicto = h.coincidencia
      ? '<span class="resultado-alerta">⚠ COINCIDENCIA</span>'
      : '<span class="resultado-ok">✓ LIMPIO</span>';
    return `
      <tr class="${h.coincidencia ? 'es-alerta' : ''}">
        <td>${h.id}</td>
        <td>${esc(h.fecha)}</td>
        <td>${esc(h.hora)}</td>
        <td>${esc(h.usuario || '—')}</td>
        <td>${veredicto}</td>
        <td><a href="/api/reporte/${h.id}" target="_blank" class="link-pdf">📄 PDF</a></td>
      </tr>`;
  }).join('');
}

document.getElementById('btn-volver-clientes').addEventListener('click', mostrarVistaListaClientes);

document.getElementById('btn-editar-cliente').addEventListener('click', () => {
  const f = document.getElementById('form-editar-cliente');
  if (!clienteEnFicha) return;
  document.getElementById('ec-nombre').value = clienteEnFicha.nombre || '';
  document.getElementById('ec-cedula').value = clienteEnFicha.cedula || '';
  document.getElementById('ec-tipo').value = clienteEnFicha.tipo || 'natural';
  document.getElementById('ec-nacionalidad').value = clienteEnFicha.nacionalidad || '';
  document.getElementById('ec-fecha-nacimiento').value = clienteEnFicha.fecha_nacimiento || '';
  document.getElementById('ec-notas').value = clienteEnFicha.notas || '';
  document.getElementById('ec-nivel-riesgo').value = clienteEnFicha.nivel_riesgo || 'pendiente';
  document.getElementById('ec-actividad-economica').value = clienteEnFicha.actividad_economica || '';
  document.getElementById('ec-origen-fondos').value = clienteEnFicha.origen_fondos || '';
  document.getElementById('ec-rango-ingresos').value = clienteEnFicha.rango_ingresos || '';
  const ecDirEl = document.getElementById('ec-direccion');
  if (ecDirEl) ecDirEl.value = clienteEnFicha.direccion || '';
  const ecRepEl = document.getElementById('ec-representante');
  if (ecRepEl) ecRepEl.value = clienteEnFicha.representante_legal || '';
  const ecFinEl = document.getElementById('ec-fecha-fin');
  if (ecFinEl) ecFinEl.value = clienteEnFicha.fecha_fin_relacion || '';
  f.classList.remove('oculto');
});
document.getElementById('btn-cancelar-editar-cliente').addEventListener('click', () => {
  document.getElementById('form-editar-cliente').classList.add('oculto');
});

document.getElementById('form-editar-cliente').addEventListener('submit', async e => {
  e.preventDefault();
  if (!clienteEnFicha) return;
  const body = {
    nombre            : document.getElementById('ec-nombre').value.trim(),
    cedula            : document.getElementById('ec-cedula').value.trim(),
    tipo              : document.getElementById('ec-tipo').value,
    nacionalidad      : document.getElementById('ec-nacionalidad').value.trim(),
    fechaNacimiento   : document.getElementById('ec-fecha-nacimiento').value.trim(),
    notas             : document.getElementById('ec-notas').value.trim(),
    nivelRiesgo       : document.getElementById('ec-nivel-riesgo').value,
    actividadEconomica: document.getElementById('ec-actividad-economica').value.trim(),
    origenFondos      : document.getElementById('ec-origen-fondos').value.trim(),
    rangoIngresos     : document.getElementById('ec-rango-ingresos').value.trim(),
    direccion         : (document.getElementById('ec-direccion') || {}).value?.trim() || '',
    representanteLegal: (document.getElementById('ec-representante') || {}).value?.trim() || '',
    fechaFinRelacion  : (document.getElementById('ec-fecha-fin') || {}).value?.trim() || '',
  };
  try {
    const res  = await fetch(`/api/clientes/${clienteEnFicha.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar.');
    clienteEnFicha = data;
    abrirFichaCliente(data.id);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
});

document.getElementById('form-subir-documento').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-subir-doc');
  err.classList.add('oculto');
  if (!clienteEnFicha) return;

  const fileInput = document.getElementById('doc-archivo');
  const file = fileInput.files[0];
  if (!file) {
    mostrarError(err, 'Seleccione un archivo PDF o imagen.');
    return;
  }

  const formData = new FormData();
  formData.append('documento', file);
  formData.append('tipoDocumento', document.getElementById('doc-tipo').value);
  formData.append('usuario', usuarioActual);

  try {
    const res  = await fetch(`/api/clientes/${clienteEnFicha.id}/documentos`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al subir el documento.');
    fileInput.value = '';
    abrirFichaCliente(clienteEnFicha.id);
  } catch (e2) {
    mostrarError(err, e2.message);
  }
});

// Botón "Buscar AML de este cliente" — pasa a la pestaña de consulta con los datos precargados
document.getElementById('btn-buscar-aml-cliente').addEventListener('click', () => {
  if (!clienteEnFicha) return;

  document.getElementById('nombre').value = clienteEnFicha.nombre || '';
  document.getElementById('cedula').value = clienteEnFicha.cedula || '';
  document.getElementById('pais').value   = clienteEnFicha.nacionalidad || '';
  document.getElementById('cliente-id').value = clienteEnFicha.id;

  const banner = document.getElementById('banner-cliente-vinculado');
  banner.textContent = `🔗 Esta búsqueda se vinculará y guardará en el expediente de: ${clienteEnFicha.nombre}`;
  banner.classList.remove('oculto');

  activarTab('consulta');
  form.dispatchEvent(new Event('submit'));
});

// ── Lectura automática de documento de identidad ─────────
const btnSubirDoc  = document.getElementById('btn-subir-documento');
const fileDoc      = document.getElementById('file-documento');
const docInfo      = document.getElementById('doc-info');

btnSubirDoc.addEventListener('click', () => fileDoc.click());

fileDoc.addEventListener('change', async () => {
  const file = fileDoc.files[0];
  if (!file) return;

  errForm.classList.add('oculto');
  docInfo.classList.add('oculto');
  resultCont.classList.add('oculto');

  btnSubirDoc.disabled = true;
  btnSubirDoc.querySelector('.btn-texto').textContent = 'Leyendo documento…';
  cargando.classList.remove('oculto');
  cargando.querySelector('p').textContent = 'Analizando documento con inteligencia artificial…';

  const formData = new FormData();
  formData.append('documento', file);

  try {
    const res  = await fetch('/api/leer-documento', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      mostrarError(errForm, data.error || 'Error al leer el documento.');
      return;
    }

    const camposLlenados = [];

    if (data.nombre) {
      document.getElementById('nombre').value = data.nombre;
      camposLlenados.push(`Nombre: ${data.nombre}`);
    }
    if (data.cedula) {
      document.getElementById('cedula').value = data.cedula;
      camposLlenados.push(`Documento: ${data.cedula}`);
    }
    if (data.nacionalidad) {
      document.getElementById('pais').value = data.nacionalidad;
      camposLlenados.push(`Nacionalidad: ${data.nacionalidad}`);
    }
    if (data.fechaNacimiento) {
      camposLlenados.push(`Fecha de nacimiento: ${data.fechaNacimiento}`);
    }

    if (camposLlenados.length === 0) {
      mostrarError(errForm, 'No se pudieron extraer datos del documento. Verifique que la imagen sea clara.');
      return;
    }

    docInfo.textContent = '✓ Datos extraídos: ' + camposLlenados.join(' · ');
    docInfo.classList.remove('oculto');

    if (data.nombre || data.cedula) {
      cargando.querySelector('p').textContent = 'Consultando listas de sanciones…';
      form.dispatchEvent(new Event('submit'));
    }
  } catch (err) {
    mostrarError(errForm, `Error al procesar el documento: ${err.message}`);
  } finally {
    btnSubirDoc.disabled = false;
    btnSubirDoc.querySelector('.btn-texto').textContent = 'Subir documento de identidad';
    fileDoc.value = '';
    cargando.querySelector('p').textContent = 'Consultando listas de sanciones internacionales…';
  }
});

// ── Análisis de Riesgo Automático (Art. 26-B) ────────────────────────────────
const RIESGO_LABELS = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto — Diligencia Ampliada', pendiente: 'Pendiente' };
const RIESGO_CLASES = { bajo: 'badge-riesgo--bajo', medio: 'badge-riesgo--medio', alto: 'badge-riesgo--alto', pendiente: 'badge-riesgo--pendiente' };
const PENDIENTE_ICONOS = { campo: '📋', documento: '📄', beneficiario: '👥', revision: '🔔', aprobacion: '✅', conservacion: '🗂' };

function renderizarAnalisisRiesgo(cliente, rc, pendientes) {
  if (!rc) return;

  // Badge calculado
  const badgeEl = document.getElementById('riesgo-calculado-badge');
  badgeEl.textContent = RIESGO_LABELS[rc.nivel] || rc.nivel;
  badgeEl.className = `badge-riesgo ${RIESGO_CLASES[rc.nivel] || 'badge-riesgo--pendiente'}`;

  // Razones
  const razonesEl = document.getElementById('riesgo-razones');
  razonesEl.innerHTML = (rc.razones || []).map(r => `<li>${esc(r)}</li>`).join('');

  // Select confirmado
  const selectEl = document.getElementById('ec-nivel-riesgo-ficha');
  selectEl.value = cliente.nivel_riesgo || 'pendiente';
  const infoEl = document.getElementById('riesgo-confirmado-info');
  infoEl.textContent = cliente.nivel_riesgo && cliente.nivel_riesgo !== 'pendiente'
    ? `Confirmado: ${RIESGO_LABELS[cliente.nivel_riesgo]}`
    : 'Aún sin confirmar por el Oficial';

  // Timeline de revisión
  document.getElementById('revision-ultima').textContent     = rc.ultimaRevision || '—';
  document.getElementById('revision-proxima').textContent    = rc.proximaRevision || '—';
  document.getElementById('revision-frecuencia').textContent = `Cada ${rc.frecuenciaMeses} meses (riesgo ${rc.nivel})`;

  const estadoEl = document.getElementById('revision-estado');
  const barraEl  = document.getElementById('revision-progreso-barra');
  if (rc.vencido) {
    estadoEl.textContent  = `⚠ Vencida hace ${Math.abs(rc.diasRestantes)} días`;
    estadoEl.className    = 'revision-valor texto-error';
    barraEl.style.width   = '100%';
    barraEl.className     = 'revision-progreso-barra barra-vencida';
  } else if (rc.proximoVencer) {
    estadoEl.textContent  = `⚠ Vence en ${rc.diasRestantes} días`;
    estadoEl.className    = 'revision-valor texto-warn';
    const pct = Math.round((1 - rc.diasRestantes / (rc.frecuenciaMeses * 30)) * 100);
    barraEl.style.width   = `${Math.min(pct, 100)}%`;
    barraEl.className     = 'revision-progreso-barra barra-proxima';
  } else {
    estadoEl.textContent  = `✓ Al día — faltan ${rc.diasRestantes} días`;
    estadoEl.className    = 'revision-valor texto-ok';
    const pct = Math.round((1 - rc.diasRestantes / (rc.frecuenciaMeses * 30)) * 100);
    barraEl.style.width   = `${Math.max(pct, 4)}%`;
    barraEl.className     = 'revision-progreso-barra barra-ok';
  }

  // Pendientes
  const listEl = document.getElementById('pendientes-lista');
  if (!pendientes || !pendientes.length) {
    listEl.innerHTML = '<p class="pendientes-ok">✓ Sin pendientes — expediente completo</p>';
  } else {
    listEl.innerHTML = `
      <div class="pendientes-titulo">Pendientes del expediente (${pendientes.length})</div>
      ${pendientes.map(p => `
        <div class="pendiente-item pendiente-${p.tipo}">
          <span class="pendiente-icono">${PENDIENTE_ICONOS[p.tipo] || '•'}</span>
          <span>${esc(p.msg)}</span>
        </div>`).join('')}`;
  }
}

document.getElementById('btn-confirmar-riesgo').addEventListener('click', async () => {
  if (!clienteEnFicha) return;
  const nivel = document.getElementById('ec-nivel-riesgo-ficha').value;
  try {
    const res  = await fetch(`/api/clientes/${clienteEnFicha.id}`, {
      method : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ nivelRiesgo: nivel }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar.');
    clienteEnFicha = data;
    const infoEl = document.getElementById('riesgo-confirmado-info');
    infoEl.textContent = `Confirmado: ${RIESGO_LABELS[nivel] || nivel}`;
    infoEl.style.color = 'var(--verde)';
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
});

// ── Panel de Alertas ──────────────────────────────────────────────────────────
async function cargarAlertas() {
  const cont = document.getElementById('alertas-contenedor');
  cont.innerHTML = '<p class="cargando-msg">Calculando alertas…</p>';
  try {
    const res  = await fetch('/api/alertas');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar alertas.');

    if (!data.length) {
      cont.innerHTML = '<p class="cargando-msg">No hay clientes registrados.</p>';
      return;
    }

    const sinAlertas = data.filter(c => !c.riesgoCalculado.vencido && !c.riesgoCalculado.proximoVencer && c.pendientes.length === 0);
    const conAlertas = data.filter(c => c.riesgoCalculado.vencido || c.riesgoCalculado.proximoVencer || c.pendientes.length > 0);

    let html = '';

    if (conAlertas.length) {
      html += conAlertas.map(c => {
        const rc = c.riesgoCalculado;
        const estadoClase = rc.vencido ? 'alerta-card--vencido' : rc.proximoVencer ? 'alerta-card--proximo' : 'alerta-card--pendiente';
        const estadoTxt   = rc.vencido
          ? `⚠ Revisión vencida hace ${Math.abs(rc.diasRestantes)} días`
          : rc.proximoVencer
          ? `⚠ Revisión vence en ${rc.diasRestantes} días`
          : '';

        return `
          <div class="alerta-card ${estadoClase}">
            <div class="alerta-card-header">
              <div>
                <span class="alerta-nombre">${esc(c.nombre)}</span>
                <span class="badge-riesgo ${RIESGO_CLASES[rc.nivel] || 'badge-riesgo--pendiente'}" style="margin-left:10px">${RIESGO_LABELS[rc.nivel]}</span>
                <span class="alerta-tipo">${c.tipo === 'juridica' ? 'Jurídica' : 'Natural'}${c.tipoExpediente === 'proveedor' ? ' · 🏢 Proveedor' : ''}</span>
              </div>
              <div class="alerta-header-right">
                ${estadoTxt ? `<span class="alerta-estado-txt">${estadoTxt}</span>` : ''}
                <button class="btn-secundario btn-chico btn-ir-ficha" data-id="${c.id}">Ver ficha →</button>
              </div>
            </div>
            ${c.pendientes.length ? `
              <ul class="alerta-pendientes">
                ${c.pendientes.map(p => `<li class="pendiente-item pendiente-${p.tipo}"><span class="pendiente-icono">${PENDIENTE_ICONOS[p.tipo]}</span> ${esc(p.msg)}</li>`).join('')}
              </ul>` : ''}
            <div class="alerta-revision">Próxima revisión: <strong>${rc.proximaRevision}</strong> · Frecuencia: cada ${rc.frecuenciaMeses} meses</div>
          </div>`;
      }).join('');
    }

    if (sinAlertas.length) {
      html += `<details class="alertas-ok-grupo">
        <summary>✓ ${sinAlertas.length} cliente(s) sin pendientes</summary>
        <ul class="alertas-ok-lista">
          ${sinAlertas.map(c => `<li>${esc(c.nombre)} — próxima revisión: ${c.riesgoCalculado.proximaRevision}</li>`).join('')}
        </ul>
      </details>`;
    }

    cont.innerHTML = html;
    cont.querySelectorAll('.btn-ir-ficha').forEach(btn =>
      btn.addEventListener('click', () => {
        activarTab('clientes');
        setTimeout(() => abrirFichaCliente(btn.dataset.id), 50);
      })
    );
  } catch (err) {
    cont.innerHTML = `<p class="cargando-msg">Error: ${esc(err.message)}</p>`;
  }
}

document.getElementById('btn-actualizar-alertas').addEventListener('click', cargarAlertas);

// ── Beneficiarios Finales (Art. 26-A y 28, Ley 23 de 2015) ───────────────────
async function cargarBeneficiarios(clienteId) {
  const tbody = document.getElementById('tbody-beneficiarios');
  tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">Cargando…</td></tr>';
  try {
    const res  = await fetch(`/api/clientes/${clienteId}/beneficiarios`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar beneficiarios.');

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">No hay beneficiarios registrados. Agregue uno con el formulario superior.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(bf => {
      const hayAlerta = bf.coincidencia;
      const veredicto = hayAlerta
        ? '<span class="resultado-alerta">⚠ COINCIDENCIA</span>'
        : '<span class="resultado-ok">✓ Limpio</span>';
      return `
        <tr class="${hayAlerta ? 'es-alerta' : ''}">
          <td>${esc(bf.nombre)}</td>
          <td>${esc(bf.cedula || '—')}</td>
          <td>${esc(bf.nacionalidad || '—')}</td>
          <td>${bf.participacion != null ? esc(String(bf.participacion)) + '%' : '—'}</td>
          <td>${esc(bf.cargo || '—')}</td>
          <td>${veredicto}</td>
          <td><button class="btn-borrar btn-borrar-bf" data-cliente="${clienteId}" data-id="${bf.id}">✕</button></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-borrar-bf').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este beneficiario final?')) return;
      try {
        await fetch(`/api/clientes/${btn.dataset.cliente}/beneficiarios/${btn.dataset.id}`, { method: 'DELETE' });
        cargarBeneficiarios(btn.dataset.cliente);
        document.getElementById('bf-resultado-busqueda').classList.add('oculto');
      } catch (err) {
        alert(`Error al eliminar: ${err.message}`);
      }
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

document.getElementById('form-nuevo-beneficiario').addEventListener('submit', async e => {
  e.preventDefault();
  if (!clienteEnFicha) return;

  const errEl  = document.getElementById('error-beneficiario');
  const btnEl  = document.getElementById('btn-agregar-bf');
  const txtEl  = btnEl.querySelector('.btn-texto');
  const resDiv = document.getElementById('bf-resultado-busqueda');
  errEl.classList.add('oculto');
  resDiv.classList.add('oculto');

  const body = {
    nombre        : document.getElementById('bf-nombre').value.trim(),
    cedula        : document.getElementById('bf-cedula').value.trim(),
    nacionalidad  : document.getElementById('bf-nacionalidad').value.trim(),
    participacion : document.getElementById('bf-participacion').value,
    cargo         : document.getElementById('bf-cargo').value.trim(),
    usuario       : usuarioActual,
  };

  if (!body.nombre) {
    mostrarError(errEl, 'El nombre del beneficiario es obligatorio.');
    return;
  }

  btnEl.disabled = true;
  txtEl.textContent = 'Verificando en listas AML…';

  try {
    const res  = await fetch(`/api/clientes/${clienteEnFicha.id}/beneficiarios`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al agregar beneficiario.');

    document.getElementById('form-nuevo-beneficiario').reset();

    const hayCoincidencia = data.coincidencia;
    resDiv.className = hayCoincidencia
      ? 'veredicto-banner coincidencia'
      : 'veredicto-banner sin-coincidencia';
    resDiv.innerHTML = hayCoincidencia
      ? `<span>⚠</span> <span><strong>${esc(data.nombre)}</strong> — COINCIDENCIA DETECTADA EN LISTAS AML/FT</span>`
      : `<span>✓</span> <span><strong>${esc(data.nombre)}</strong> — Sin coincidencias en ONU, OFAC, UE ni PEP</span>`;
    resDiv.classList.remove('oculto');

    cargarBeneficiarios(clienteEnFicha.id);
  } catch (err) {
    mostrarError(errEl, err.message);
  } finally {
    btnEl.disabled = false;
    txtEl.textContent = 'Agregar y Verificar en Listas AML';
  }
});

// ── Aprobación de Alta Gerencia (Art. 26) ─────────────────────────────────────
function renderizarAprobacion(cliente) {
  const card = document.getElementById('card-aprobacion');
  if (!card) return;

  const esAlto = (cliente.nivel_riesgo === 'alto') || (cliente.aprobacion_gerencia && cliente.aprobacion_gerencia !== 'no_requerida');
  card.classList.toggle('oculto', !esAlto);
  if (!esAlto) return;

  const bloque = document.getElementById('aprobacion-estado-bloque');
  const estado = cliente.aprobacion_gerencia || 'no_requerida';
  const clases = { pendiente: 'texto-warn', aprobada: 'texto-ok', rechazada: 'texto-error', no_requerida: '' };
  const labels = { pendiente: '⏳ Pendiente de decisión', aprobada: '✓ Aprobada', rechazada: '✗ Rechazada', no_requerida: '—' };

  bloque.innerHTML = `
    <div class="aprobacion-resumen">
      <span class="${clases[estado] || ''}" style="font-weight:600">${labels[estado] || estado}</span>
      ${cliente.aprobacion_por ? `<span class="subtitulo-legal"> · Por: ${esc(cliente.aprobacion_por)}</span>` : ''}
      ${cliente.aprobacion_fecha ? `<span class="subtitulo-legal"> · Fecha: ${esc(cliente.aprobacion_fecha)}</span>` : ''}
      ${cliente.aprobacion_notas ? `<p style="margin-top:6px;font-size:0.9em">${esc(cliente.aprobacion_notas)}</p>` : ''}
    </div>`;

  const form = document.getElementById('form-aprobacion');
  if (!form._wired) {
    form._wired = true;
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (!clienteEnFicha) return;
      const body = {
        estado: document.getElementById('apr-estado').value,
        aprobadoPor: document.getElementById('apr-por').value.trim(),
        notas: document.getElementById('apr-notas').value.trim(),
        usuario: usuarioActual,
      };
      try {
        const res = await fetch(`/api/clientes/${clienteEnFicha.id}/aprobacion`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar aprobación.');
        abrirFichaCliente(clienteEnFicha.id);
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  }

  document.getElementById('apr-estado').value = estado === 'no_requerida' ? 'pendiente' : estado;
  document.getElementById('apr-por').value = cliente.aprobacion_por || '';
  document.getElementById('apr-notas').value = cliente.aprobacion_notas || '';
}

// ── ROS por cliente (Art. 42) ─────────────────────────────────────────────────
async function renderizarROSCliente(clienteId) {
  const lista = document.getElementById('lista-ros-cliente');
  if (!lista) return;
  lista.innerHTML = '<p class="cargando-msg">Cargando…</p>';
  try {
    const res  = await fetch(`/api/ros?clienteId=${clienteId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar ROS.');

    if (!data.length) {
      lista.innerHTML = '<p class="cargando-msg">Sin ROS registrados para este cliente.</p>';
    } else {
      lista.innerHTML = data.map(r => {
        const esReportado = r.estado === 'reportado';
        return `
          <div class="ros-item">
            <div class="ros-item-header">
              <span class="badge-ros badge-ros--${esc(r.estado)}">${esReportado ? '✓ Reportado a UAF' : '📝 Borrador'}</span>
              <span class="ros-tipo">${esc(r.tipo_operacion || '—')}</span>
              <span class="ros-monto">${r.monto ? 'USD ' + Number(r.monto).toLocaleString('es-PA') : '—'}</span>
              <span class="subtitulo-legal">Detectado: ${esc(r.fecha_deteccion || '—')} · Límite: <strong>${esc(r.fecha_limite || '—')}</strong></span>
            </div>
            <p class="ros-descripcion">${esc(r.descripcion || '')}</p>
            ${r.numero_ref_uaf ? `<p class="subtitulo-legal">Ref. UAF: ${esc(r.numero_ref_uaf)}</p>` : ''}
            <div class="ros-acciones">
              ${!esReportado ? `<button class="btn-primario btn-chico btn-marcar-reportado" data-id="${r.id}">✓ Marcar como reportado a UAF</button>` : ''}
              <button class="btn-borrar btn-chico btn-borrar-ros" data-id="${r.id}">✕ Eliminar</button>
            </div>
          </div>`;
      }).join('');

      lista.querySelectorAll('.btn-marcar-reportado').forEach(btn => btn.addEventListener('click', async () => {
        const refUaf = prompt('Número de referencia UAF (opcional):') ?? '';
        try {
          const r2 = await fetch(`/api/ros/${btn.dataset.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'reportado', numeroRefUaf: refUaf, usuario: usuarioActual }),
          });
          if (!r2.ok) throw new Error((await r2.json()).error || 'Error');
          renderizarROSCliente(clienteId);
        } catch (err) { alert(`Error: ${err.message}`); }
      }));

      lista.querySelectorAll('.btn-borrar-ros').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este ROS?')) return;
        try {
          await fetch(`/api/ros/${btn.dataset.id}`, { method: 'DELETE' });
          renderizarROSCliente(clienteId);
        } catch (err) { alert(`Error: ${err.message}`); }
      }));
    }
  } catch (err) {
    lista.innerHTML = `<p class="cargando-msg">Error: ${esc(err.message)}</p>`;
  }
}

// Botón nuevo ROS desde ficha de cliente
const btnNuevoRosCliente = document.getElementById('btn-nuevo-ros-cliente');
if (btnNuevoRosCliente) {
  btnNuevoRosCliente.addEventListener('click', async () => {
    if (!clienteEnFicha) return;
    const desc = prompt('Descripción de la operación sospechosa:');
    if (!desc) return;
    const fecha = prompt('Fecha de detección (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
    if (!fecha) return;
    const monto = prompt('Monto estimado (USD, deje en blanco si desconocido):') || '';
    const tipo  = prompt('Tipo de operación (ej. transferencia, depósito, efectivo…):') || '';
    try {
      const res = await fetch('/api/ros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: clienteEnFicha.id,
          fechaDeteccion: fecha,
          descripcion: desc,
          monto,
          tipoOperacion: tipo,
          reportadoPor: usuarioActual,
          creadoPor: usuarioActual,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear ROS.');
      renderizarROSCliente(clienteEnFicha.id);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });
}

// ── Conservación de Registros (Art. 38) ──────────────────────────────────────
function renderizarConservacion(cliente) {
  const div = document.getElementById('conservacion-info');
  if (!div) return;
  if (!cliente.fecha_fin_relacion) {
    div.innerHTML = `<p>La relación con este cliente está <strong>activa</strong>. El contador de 5 años comenzará cuando se registre la fecha de fin de relación.</p>
      <p class="subtitulo-legal">Art. 38, Ley 23 de 2015: los documentos deben conservarse por un mínimo de 5 años desde el fin de la relación comercial.</p>`;
    return;
  }
  const finRelacion = new Date(cliente.fecha_fin_relacion);
  const limiteConservacion = new Date(finRelacion);
  limiteConservacion.setFullYear(limiteConservacion.getFullYear() + 5);
  const hoy = new Date();
  const diasRestantes = Math.round((limiteConservacion - hoy) / (1000 * 60 * 60 * 24));
  const puedeArchivar = hoy >= limiteConservacion;
  const alerta90 = diasRestantes <= 90 && !puedeArchivar;

  div.innerHTML = `
    <div class="conservacion-grid">
      <div><span class="subtitulo-legal">Fin de relación</span><br><strong>${esc(cliente.fecha_fin_relacion)}</strong></div>
      <div><span class="subtitulo-legal">Límite conservación (5 años)</span><br><strong>${limiteConservacion.toISOString().split('T')[0]}</strong></div>
      <div><span class="subtitulo-legal">Estado</span><br>
        ${puedeArchivar
          ? '<span class="texto-ok">✓ Período cumplido — puede archivarse o eliminarse según política interna</span>'
          : alerta90
          ? `<span class="texto-warn">⚠ Faltan ${diasRestantes} días — próximo a vencer</span>`
          : `<span>Faltan ${diasRestantes} días</span>`}
      </div>
    </div>
    <p class="subtitulo-legal" style="margin-top:8px">Art. 38, Ley 23 de 2015: 5 años de conservación obligatoria desde el fin de la relación comercial.</p>`;
}

// ── ROS — Tab Global (Art. 42) ────────────────────────────────────────────────
async function cargarROS() {
  const tbody = document.getElementById('tbody-ros');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="cargando-msg">Cargando…</td></tr>';
  try {
    const res  = await fetch('/api/ros');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar ROS.');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="cargando-msg">Sin reportes de operaciones sospechosas registrados.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => {
      const esReportado = r.estado === 'reportado';
      return `
        <tr class="${!esReportado ? 'es-alerta' : ''}">
          <td>${r.id}</td>
          <td>${esc(r.fecha_deteccion || '—')}</td>
          <td><strong>${esc(r.fecha_limite || '—')}</strong></td>
          <td>${esc(r.cliente_nombre || r.cliente_id || '—')}</td>
          <td>${esc(r.tipo_operacion || '—')}</td>
          <td>${r.monto ? 'USD ' + Number(r.monto).toLocaleString('es-PA') : '—'}</td>
          <td>
            <span class="badge-ros badge-ros--${esc(r.estado)}">
              ${esReportado ? '✓ Reportado' : '📝 Borrador'}
            </span>
          </td>
          <td>
            ${!esReportado ? `<button class="btn-primario btn-chico btn-ros-reportar" data-id="${r.id}">Marcar reportado</button> ` : ''}
            <button class="btn-borrar btn-chico btn-ros-borrar" data-id="${r.id}">✕</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-ros-reportar').forEach(btn => btn.addEventListener('click', async () => {
      const refUaf = prompt('Número de referencia UAF (opcional):') ?? '';
      try {
        const r2 = await fetch(`/api/ros/${btn.dataset.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: 'reportado', numeroRefUaf: refUaf, usuario: usuarioActual }),
        });
        if (!r2.ok) throw new Error((await r2.json()).error || 'Error');
        cargarROS();
      } catch (err) { alert(`Error: ${err.message}`); }
    }));

    tbody.querySelectorAll('.btn-ros-borrar').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este ROS?')) return;
      try {
        await fetch(`/api/ros/${btn.dataset.id}`, { method: 'DELETE' });
        cargarROS();
      } catch (err) { alert(`Error: ${err.message}`); }
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

// Formulario nuevo ROS global
const formRos = document.getElementById('form-nuevo-ros');
if (formRos) {
  formRos.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('error-ros');
    if (err) err.classList.add('oculto');
    const body = {
      clienteId     : document.getElementById('ros-cliente').value || null,
      fechaDeteccion: document.getElementById('ros-fecha-deteccion').value,
      tipoOperacion : document.getElementById('ros-tipo').value.trim(),
      monto         : document.getElementById('ros-monto').value || null,
      descripcion   : document.getElementById('ros-descripcion').value.trim(),
      reportadoPor  : document.getElementById('ros-reportado-por').value.trim() || usuarioActual,
      notas         : document.getElementById('ros-notas').value.trim(),
      creadoPor     : usuarioActual,
    };
    if (!body.descripcion) {
      if (err) { err.textContent = 'La descripción es obligatoria.'; err.classList.remove('oculto'); }
      return;
    }
    try {
      const res  = await fetch('/api/ros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear ROS.');
      formRos.reset();
      document.getElementById('form-nuevo-ros-tarjeta').classList.add('oculto');
      cargarROS();
    } catch (e2) {
      if (err) { err.textContent = e2.message; err.classList.remove('oculto'); }
      else alert(e2.message);
    }
  });
}

// Cargar select de clientes en tab ROS
async function cargarSelectClientesROS() {
  const sel = document.getElementById('ros-cliente');
  if (!sel || sel.dataset.cargado) return;
  try {
    const res  = await fetch('/api/clientes');
    const data = await res.json();
    sel.innerHTML = '<option value="">— Sin vincular —</option>' +
      data.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    sel.dataset.cargado = '1';
  } catch (_) {}
}

// Mostrar / ocultar formulario de nuevo ROS (tab global)
const btnNuevoRos = document.getElementById('btn-nuevo-ros');
if (btnNuevoRos) {
  btnNuevoRos.addEventListener('click', () => {
    document.getElementById('form-nuevo-ros-tarjeta').classList.remove('oculto');
  });
}
const btnCancelarRos = document.getElementById('btn-cancelar-ros');
if (btnCancelarRos) {
  btnCancelarRos.addEventListener('click', () => {
    document.getElementById('form-nuevo-ros-tarjeta').classList.add('oculto');
    formRos.reset();
  });
}

// ── Actualizar tab handler para ROS ──────────────────────────────────────────
// (el tab ya llama cargarROS en el bloque de tabs, pero también necesitamos cargar el select)
document.querySelectorAll('.tab').forEach(btn => {
  if (btn.dataset.tab === 'ros') {
    btn.addEventListener('click', () => {
      cargarSelectClientesROS();
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  COLABORADORES — Conozca a su Empleado (KYE), Decreto 35 de 2022
// ═══════════════════════════════════════════════════════════════════════════
const colabVistaLista = () => document.getElementById('colab-vista-lista');
const colabVistaFicha = () => document.getElementById('colab-vista-ficha');

async function cargarColaboradores(buscar) {
  mostrarVistaListaColab();
  const tbody = document.getElementById('tbody-colab');
  tbody.innerHTML = '<tr><td colspan="8" class="cargando-msg">Cargando…</td></tr>';
  try {
    const params = buscar ? `?buscar=${encodeURIComponent(buscar)}` : '';
    const res  = await fetch(`/api/empleados${params}`);
    const rows = await res.json();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="cargando-msg">No hay colaboradores registrados. Cree uno con "+ Nuevo Colaborador".</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(e => {
      const coincide = e.coincidencia
        ? '<span class="resultado-alerta">⚠ Coincidencia</span>'
        : '<span class="resultado-ok">✓ Limpio</span>';
      return `
        <tr class="${e.coincidencia ? 'es-alerta' : ''}">
          <td>${esc(e.nombre)}</td>
          <td>${esc(e.cedula || '—')}</td>
          <td>${esc(e.cargo || '—')}</td>
          <td>${esc(e.departamento || '—')}</td>
          <td>${esc(e.fecha_ingreso || '—')}</td>
          <td><span class="badge-riesgo ${RIESGO_CLASES[e.nivel_riesgo] || 'badge-riesgo--pendiente'}">${RIESGO_LABELS[e.nivel_riesgo] || e.nivel_riesgo}</span></td>
          <td>${coincide}</td>
          <td><button class="btn-secundario btn-chico btn-ver-colab" data-id="${e.id}">Ver ficha</button></td>
        </tr>`;
    }).join('');
    tbody.querySelectorAll('.btn-ver-colab').forEach(btn =>
      btn.addEventListener('click', () => abrirFichaColab(btn.dataset.id)));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

function mostrarVistaListaColab() {
  colabVistaLista().classList.remove('oculto');
  colabVistaFicha().classList.add('oculto');
}
function mostrarVistaFichaColab() {
  colabVistaLista().classList.add('oculto');
  colabVistaFicha().classList.remove('oculto');
}

let debounceBuscarColab = null;
document.getElementById('buscar-colab').addEventListener('input', e => {
  clearTimeout(debounceBuscarColab);
  debounceBuscarColab = setTimeout(() => cargarColaboradores(e.target.value.trim()), 250);
});

document.getElementById('btn-nuevo-colab').addEventListener('click', () => {
  document.getElementById('form-nuevo-colab-tarjeta').classList.remove('oculto');
});
document.getElementById('btn-cancelar-nuevo-colab').addEventListener('click', () => {
  document.getElementById('form-nuevo-colab-tarjeta').classList.add('oculto');
  document.getElementById('form-nuevo-colab').reset();
  document.getElementById('colab-resultado-busqueda').classList.add('oculto');
});

document.getElementById('form-nuevo-colab').addEventListener('submit', async e => {
  e.preventDefault();
  const err   = document.getElementById('error-nuevo-colab');
  const resDiv = document.getElementById('colab-resultado-busqueda');
  const btn   = document.getElementById('btn-crear-colab');
  const txt   = btn.querySelector('.btn-texto');
  err.classList.add('oculto');
  resDiv.classList.add('oculto');

  const body = {
    nombre        : document.getElementById('col-nombre').value.trim(),
    cedula        : document.getElementById('col-cedula').value.trim(),
    cargo         : document.getElementById('col-cargo').value.trim(),
    departamento  : document.getElementById('col-departamento').value.trim(),
    fechaIngreso  : document.getElementById('col-fecha-ingreso').value,
    tipoContrato  : document.getElementById('col-tipo-contrato').value,
    salarioRango  : document.getElementById('col-salario').value.trim(),
    declaracionPep: document.getElementById('col-declaracion-pep').value,
    esPep         : document.getElementById('col-es-pep').checked ? 1 : 0,
    accesoSensible: document.getElementById('col-acceso-sensible').checked ? 1 : 0,
    notas         : document.getElementById('col-notas').value.trim(),
    usuario       : usuarioActual,
  };
  if (!body.nombre) { mostrarError(err, 'El nombre del colaborador es obligatorio.'); return; }

  btn.disabled = true;
  if (txt) txt.textContent = 'Verificando en listas AML…';
  try {
    const res  = await fetch('/api/empleados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear el colaborador.');

    document.getElementById('form-nuevo-colab').reset();
    const hay = data.coincidencia;
    resDiv.className = hay ? 'veredicto-banner coincidencia' : 'veredicto-banner sin-coincidencia';
    resDiv.innerHTML = hay
      ? `<span>⚠</span> <span><strong>${esc(data.nombre)}</strong> — COINCIDENCIA en listas AML/PEP. Requiere análisis del Oficial.</span>`
      : `<span>✓</span> <span><strong>${esc(data.nombre)}</strong> — Sin coincidencias en ONU, OFAC, UE ni PEP.</span>`;
    resDiv.classList.remove('oculto');
    document.getElementById('form-nuevo-colab-tarjeta').classList.add('oculto');
    cargarColaboradores();
  } catch (e2) {
    mostrarError(err, e2.message);
  } finally {
    btn.disabled = false;
    if (txt) txt.textContent = 'Crear y Verificar en Listas AML';
  }
});

async function abrirFichaColab(id) {
  try {
    const res  = await fetch(`/api/empleados/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el colaborador.');
    colabEnFicha = data.empleado;
    renderizarFichaColab(data.empleado, data.pendientes || []);
    mostrarVistaFichaColab();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function renderizarFichaColab(e, pendientes) {
  document.getElementById('colab-ficha-nombre').textContent = e.nombre;
  document.getElementById('colab-ficha-cedula').textContent = e.cedula || '—';
  document.getElementById('colab-ficha-cargo').textContent = e.cargo || '—';
  document.getElementById('colab-ficha-departamento').textContent = e.departamento || '—';
  document.getElementById('colab-ficha-ingreso').textContent = e.fecha_ingreso || '—';
  document.getElementById('colab-ficha-contrato').textContent = e.tipo_contrato || '—';
  document.getElementById('colab-ficha-pep').textContent = e.declaracion_pep || (e.es_pep ? 'Marcado como PEP' : '—');
  document.getElementById('colab-ficha-revision').textContent = e.fecha_revision || 'Sin tamizar';
  document.getElementById('colab-ficha-listas').textContent = e.resultado_listas || '—';

  const riesgoEl = document.getElementById('colab-ficha-riesgo');
  riesgoEl.textContent = RIESGO_LABELS[e.nivel_riesgo] || e.nivel_riesgo;
  riesgoEl.className = `badge-riesgo ${RIESGO_CLASES[e.nivel_riesgo] || 'badge-riesgo--pendiente'}`;

  const coincEl = document.getElementById('colab-ficha-coincidencia');
  if (e.coincidencia) {
    coincEl.className = 'veredicto-banner coincidencia';
    coincEl.innerHTML = '<span>⚠</span> <span>COINCIDENCIA en listas de sanciones / PEP — el Oficial de Cumplimiento debe analizar y documentar la decisión.</span>';
    coincEl.classList.remove('oculto');
  } else {
    coincEl.classList.add('oculto');
  }

  const listEl = document.getElementById('colab-pendientes-lista');
  if (!pendientes.length) {
    listEl.innerHTML = '<p class="pendientes-ok">✓ Expediente KYE completo</p>';
  } else {
    listEl.innerHTML = `<div class="pendientes-titulo">Pendientes (${pendientes.length})</div>` +
      pendientes.map(p => `<div class="pendiente-item pendiente-${p.tipo}"><span class="pendiente-icono">${PENDIENTE_ICONOS[p.tipo] || '•'}</span><span>${esc(p.msg)}</span></div>`).join('');
  }
  document.getElementById('form-editar-colab').classList.add('oculto');
}

document.getElementById('btn-volver-colab').addEventListener('click', () => cargarColaboradores());

document.getElementById('btn-editar-colab').addEventListener('click', () => {
  if (!colabEnFicha) return;
  const e = colabEnFicha;
  document.getElementById('ecol-nombre').value = e.nombre || '';
  document.getElementById('ecol-cedula').value = e.cedula || '';
  document.getElementById('ecol-cargo').value = e.cargo || '';
  document.getElementById('ecol-departamento').value = e.departamento || '';
  document.getElementById('ecol-fecha-ingreso').value = e.fecha_ingreso || '';
  document.getElementById('ecol-fecha-salida').value = e.fecha_salida || '';
  document.getElementById('ecol-nivel-riesgo').value = e.nivel_riesgo || 'pendiente';
  document.getElementById('ecol-declaracion-pep').value = e.declaracion_pep || '';
  document.getElementById('ecol-notas').value = e.notas || '';
  document.getElementById('form-editar-colab').classList.remove('oculto');
});
document.getElementById('btn-cancelar-editar-colab').addEventListener('click', () => {
  document.getElementById('form-editar-colab').classList.add('oculto');
});

document.getElementById('form-editar-colab').addEventListener('submit', async ev => {
  ev.preventDefault();
  if (!colabEnFicha) return;
  const body = {
    nombre        : document.getElementById('ecol-nombre').value.trim(),
    cedula        : document.getElementById('ecol-cedula').value.trim(),
    cargo         : document.getElementById('ecol-cargo').value.trim(),
    departamento  : document.getElementById('ecol-departamento').value.trim(),
    fechaIngreso  : document.getElementById('ecol-fecha-ingreso').value,
    fechaSalida   : document.getElementById('ecol-fecha-salida').value,
    nivelRiesgo   : document.getElementById('ecol-nivel-riesgo').value,
    declaracionPep: document.getElementById('ecol-declaracion-pep').value,
    notas         : document.getElementById('ecol-notas').value.trim(),
  };
  try {
    const res  = await fetch(`/api/empleados/${colabEnFicha.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar.');
    abrirFichaColab(colabEnFicha.id);
  } catch (err) { alert(`Error: ${err.message}`); }
});

document.getElementById('btn-retamizar-colab').addEventListener('click', async () => {
  if (!colabEnFicha) return;
  if (!confirm('¿Volver a tamizar a este colaborador en las listas de sanciones?')) return;
  try {
    const res  = await fetch(`/api/empleados/${colabEnFicha.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retamizar: true }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al re-tamizar.');
    abrirFichaColab(colabEnFicha.id);
  } catch (err) { alert(`Error: ${err.message}`); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  Select compartido de clientes + proveedores (para vincular registros)
// ═══════════════════════════════════════════════════════════════════════════
async function cargarSelectClientesEn(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel || sel.dataset.cargado) return;
  try {
    const [cli, prov] = await Promise.all([
      fetch('/api/clientes?expediente=cliente').then(r => r.json()),
      fetch('/api/clientes?expediente=proveedor').then(r => r.json()),
    ]);
    let html = '<option value="">— Sin vincular —</option>';
    if (cli.length)  html += '<optgroup label="Clientes">' + cli.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('') + '</optgroup>';
    if (prov.length) html += '<optgroup label="Proveedores">' + prov.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('') + '</optgroup>';
    sel.innerHTML = html;
    sel.dataset.cargado = '1';
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════
//  OPERACIONES INUSUALES — Decreto 35 de 2022 (paso previo al ROS)
// ═══════════════════════════════════════════════════════════════════════════
const INUSUAL_ESTADO = {
  pendiente_analisis: { txt: '⏳ Pendiente de análisis', clase: 'badge-ros--borrador' },
  descartada:         { txt: '✓ Descartada',            clase: 'badge-ros--reportado' },
  escalada_ros:       { txt: '⚠ Escalada a ROS',        clase: 'badge-inusual--escalada' },
};

async function cargarInusuales() {
  const tbody = document.getElementById('tbody-inusuales');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">Cargando…</td></tr>';
  try {
    const data = await (await fetch('/api/inusuales')).json();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">Sin operaciones inusuales registradas.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(o => {
      const e = INUSUAL_ESTADO[o.estado] || { txt: o.estado, clase: '' };
      const pend = o.estado === 'pendiente_analisis';
      return `
        <tr class="${pend ? 'es-alerta' : ''}">
          <td>${o.id}</td>
          <td>${esc(o.fecha_deteccion || '—')}</td>
          <td>${esc(o.cliente_nombre || '—')}</td>
          <td>${esc(o.tipo_operacion || '—')}</td>
          <td>${o.monto ? 'USD ' + esc(o.monto) : '—'}</td>
          <td><span class="badge-ros ${e.clase}">${e.txt}</span>${o.ros_id ? ` <span class="subtitulo-legal">(ROS #${o.ros_id})</span>` : ''}</td>
          <td>
            ${pend ? `<button class="btn-primario btn-chico btn-analizar-inusual" data-id="${o.id}">Analizar</button> ` : ''}
            <button class="btn-borrar btn-chico btn-borrar-inusual" data-id="${o.id}">✕</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-analizar-inusual').forEach(btn => btn.addEventListener('click', () => analizarInusual(btn.dataset.id)));
    tbody.querySelectorAll('.btn-borrar-inusual').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta operación inusual?')) return;
      await fetch(`/api/inusuales/${btn.dataset.id}`, { method: 'DELETE' });
      cargarInusuales();
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

async function analizarInusual(id) {
  const decision = prompt('Análisis del Oficial de Cumplimiento.\n\nEscriba "ESCALAR" para escalar a ROS (se creará el ROS automáticamente),\no "DESCARTAR" para descartar la operación:');
  if (!decision) return;
  const dec = decision.trim().toUpperCase();
  let estado;
  if (dec.startsWith('ESCAL')) estado = 'escalada_ros';
  else if (dec.startsWith('DESCART')) estado = 'descartada';
  else { alert('Escriba ESCALAR o DESCARTAR.'); return; }

  const analisis = prompt('Justificación / análisis (se documenta en el expediente):') || '';
  try {
    const res = await fetch(`/api/inusuales/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado, analisis, analizadaPor: usuarioActual }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al analizar.');
    if (data.rosCreado) alert(`Operación escalada. Se creó el ROS #${data.rosCreado} (borrador). Revíselo en la pestaña ROS para reportarlo a la UAF dentro de 3 días hábiles.`);
    cargarInusuales();
  } catch (err) { alert(`Error: ${err.message}`); }
}

const btnNuevaInusual = document.getElementById('btn-nueva-inusual');
if (btnNuevaInusual) btnNuevaInusual.addEventListener('click', () => document.getElementById('form-nueva-inusual-tarjeta').classList.remove('oculto'));
const btnCancelarInusual = document.getElementById('btn-cancelar-inusual');
if (btnCancelarInusual) btnCancelarInusual.addEventListener('click', () => {
  document.getElementById('form-nueva-inusual-tarjeta').classList.add('oculto');
  document.getElementById('form-nueva-inusual').reset();
});

const formInusual = document.getElementById('form-nueva-inusual');
if (formInusual) formInusual.addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-inusual');
  err.classList.add('oculto');
  const body = {
    clienteId     : document.getElementById('inu-cliente').value || null,
    fechaDeteccion: document.getElementById('inu-fecha').value,
    tipoOperacion : document.getElementById('inu-tipo').value.trim(),
    monto         : document.getElementById('inu-monto').value.trim(),
    descripcion   : document.getElementById('inu-descripcion').value.trim(),
    detectadaPor  : document.getElementById('inu-detectada-por').value.trim() || usuarioActual,
    notas         : document.getElementById('inu-notas').value.trim(),
    usuario       : usuarioActual,
  };
  if (!body.descripcion || !body.fechaDeteccion) { mostrarError(err, 'Fecha y descripción son obligatorias.'); return; }
  try {
    const res = await fetch('/api/inusuales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar.');
    formInusual.reset();
    document.getElementById('form-nueva-inusual-tarjeta').classList.add('oculto');
    cargarInusuales();
  } catch (e2) { mostrarError(err, e2.message); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  CONGELAMIENTO PREVENTIVO — Art. 41; Res. ONU 1267/1373/1718
// ═══════════════════════════════════════════════════════════════════════════
const CONGEL_ESTADO = {
  pendiente:  { txt: '⏳ Pendiente', clase: 'badge-ros--borrador' },
  congelado:  { txt: '🧊 Congelado', clase: 'badge-congel--congelado' },
  reportado:  { txt: '✓ Reportado a autoridad', clase: 'badge-ros--reportado' },
  levantado:  { txt: '↩ Levantado', clase: 'badge-ros--borrador' },
};

async function cargarCongelamientos() {
  const tbody = document.getElementById('tbody-congelamientos');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">Cargando…</td></tr>';
  try {
    const data = await (await fetch('/api/congelamientos')).json();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">Sin congelamientos registrados.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(g => {
      const e = CONGEL_ESTADO[g.estado] || { txt: g.estado, clase: '' };
      const activo = g.estado === 'pendiente' || g.estado === 'congelado';
      return `
        <tr class="${activo ? 'es-alerta' : ''}">
          <td>${g.id}</td>
          <td>${esc(g.nombre_persona)}${g.cliente_nombre ? ` <span class="subtitulo-legal">(${esc(g.cliente_nombre)})</span>` : ''}</td>
          <td>${esc(g.lista_origen || '—')}${g.referencia_lista ? ` · ${esc(g.referencia_lista)}` : ''}</td>
          <td>${esc(g.fecha_deteccion || '—')}</td>
          <td>${g.monto_congelado ? 'USD ' + esc(g.monto_congelado) : '—'}</td>
          <td><span class="badge-ros ${e.clase}">${e.txt}</span></td>
          <td>
            ${g.estado === 'pendiente' ? `<button class="btn-primario btn-chico btn-congel-accion" data-id="${g.id}" data-estado="congelado">Marcar congelado</button> ` : ''}
            ${g.estado === 'congelado' ? `<button class="btn-primario btn-chico btn-congel-accion" data-id="${g.id}" data-estado="reportado">Marcar reportado</button> ` : ''}
            <button class="btn-borrar btn-chico btn-congel-borrar" data-id="${g.id}">✕</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-congel-accion').forEach(btn => btn.addEventListener('click', async () => {
      const estado = btn.dataset.estado;
      const body = { estado };
      const { fecha } = { fecha: new Date().toISOString().split('T')[0] };
      if (estado === 'congelado') body.fechaCongelamiento = fecha;
      if (estado === 'reportado') {
        body.reportadoA = prompt('¿A qué autoridad se reportó? (Ej: UAF, Ministerio Público, Intendencia):') || '';
        body.numeroRef = prompt('Número de referencia del reporte (opcional):') || '';
        body.fechaReporte = fecha;
      }
      try {
        const res = await fetch(`/api/congelamientos/${btn.dataset.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error((await res.json()).error || 'Error');
        cargarCongelamientos();
      } catch (err) { alert(`Error: ${err.message}`); }
    }));
    tbody.querySelectorAll('.btn-congel-borrar').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este registro de congelamiento?')) return;
      await fetch(`/api/congelamientos/${btn.dataset.id}`, { method: 'DELETE' });
      cargarCongelamientos();
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

const btnNuevoCongel = document.getElementById('btn-nuevo-congelamiento');
if (btnNuevoCongel) btnNuevoCongel.addEventListener('click', () => document.getElementById('form-nuevo-congelamiento-tarjeta').classList.remove('oculto'));
const btnCancelarCongel = document.getElementById('btn-cancelar-congelamiento');
if (btnCancelarCongel) btnCancelarCongel.addEventListener('click', () => {
  document.getElementById('form-nuevo-congelamiento-tarjeta').classList.add('oculto');
  document.getElementById('form-nuevo-congelamiento').reset();
});

const formCongel = document.getElementById('form-nuevo-congelamiento');
if (formCongel) formCongel.addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-congelamiento');
  err.classList.add('oculto');
  const body = {
    clienteId        : document.getElementById('con-cliente').value || null,
    nombrePersona    : document.getElementById('con-nombre').value.trim(),
    cedula           : document.getElementById('con-cedula').value.trim(),
    listaOrigen      : document.getElementById('con-lista').value,
    referenciaLista  : document.getElementById('con-referencia').value.trim(),
    fechaDeteccion   : document.getElementById('con-fecha').value,
    montoCongelado   : document.getElementById('con-monto').value.trim(),
    descripcionBienes: document.getElementById('con-bienes').value.trim(),
    notas            : document.getElementById('con-notas').value.trim(),
    usuario          : usuarioActual,
  };
  if (!body.nombrePersona) { mostrarError(err, 'El nombre de la persona/entidad es obligatorio.'); return; }
  try {
    const res = await fetch('/api/congelamientos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar.');
    formCongel.reset();
    document.getElementById('form-nuevo-congelamiento-tarjeta').classList.add('oculto');
    cargarCongelamientos();
  } catch (e2) { mostrarError(err, e2.message); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  CAPACITACIÓN — Decreto 35 de 2022
// ═══════════════════════════════════════════════════════════════════════════
async function cargarCapacitaciones() {
  const tbody = document.getElementById('tbody-capacitaciones');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">Cargando…</td></tr>';
  try {
    const data = await (await fetch('/api/capacitaciones')).json();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="cargando-msg">Sin capacitaciones registradas.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(c => `
      <tr>
        <td>${esc(c.fecha || '—')}</td>
        <td>${esc(c.titulo)}${c.temas ? `<br><span class="subtitulo-legal">${esc(c.temas).slice(0,90)}</span>` : ''}</td>
        <td>${esc(c.modalidad || '—')}</td>
        <td>${esc(c.facilitador || '—')}</td>
        <td>${esc(c.duracion_horas || '—')}</td>
        <td>${c.num_participantes || 0}${c.participantes ? ` <button class="btn-secundario btn-chico btn-ver-asistentes" data-id="${c.id}">ver</button>` : ''}</td>
        <td><button class="btn-borrar btn-chico btn-borrar-cap" data-id="${c.id}">✕</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('.btn-ver-asistentes').forEach(btn => btn.addEventListener('click', () => {
      const cap = data.find(x => x.id == btn.dataset.id);
      alert(`Asistentes a "${cap.titulo}":\n\n${cap.participantes || '—'}`);
    }));
    tbody.querySelectorAll('.btn-borrar-cap').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta capacitación?')) return;
      await fetch(`/api/capacitaciones/${btn.dataset.id}`, { method: 'DELETE' });
      cargarCapacitaciones();
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="cargando-msg">Error: ${esc(err.message)}</td></tr>`;
  }
}

const btnNuevaCap = document.getElementById('btn-nueva-capacitacion');
if (btnNuevaCap) btnNuevaCap.addEventListener('click', () => document.getElementById('form-nueva-capacitacion-tarjeta').classList.remove('oculto'));
const btnCancelarCap = document.getElementById('btn-cancelar-capacitacion');
if (btnCancelarCap) btnCancelarCap.addEventListener('click', () => {
  document.getElementById('form-nueva-capacitacion-tarjeta').classList.add('oculto');
  document.getElementById('form-nueva-capacitacion').reset();
});

const formCap = document.getElementById('form-nueva-capacitacion');
if (formCap) formCap.addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-capacitacion');
  err.classList.add('oculto');
  const body = {
    titulo       : document.getElementById('cap-titulo').value.trim(),
    fecha        : document.getElementById('cap-fecha').value,
    modalidad    : document.getElementById('cap-modalidad').value,
    facilitador  : document.getElementById('cap-facilitador').value.trim(),
    duracionHoras: document.getElementById('cap-duracion').value.trim(),
    temas        : document.getElementById('cap-temas').value.trim(),
    participantes: document.getElementById('cap-participantes').value.trim(),
    notas        : document.getElementById('cap-notas').value.trim(),
    usuario      : usuarioActual,
  };
  if (!body.titulo) { mostrarError(err, 'El título es obligatorio.'); return; }
  try {
    const res = await fetch('/api/capacitaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar.');
    formCap.reset();
    document.getElementById('form-nueva-capacitacion-tarjeta').classList.add('oculto');
    cargarCapacitaciones();
  } catch (e2) { mostrarError(err, e2.message); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  EVALUACIÓN DE RIESGO INSTITUCIONAL — Decreto 35 de 2022
// ═══════════════════════════════════════════════════════════════════════════
function badgeNivel(n) {
  if (!n) return '<span class="badge-riesgo badge-riesgo--pendiente">—</span>';
  return `<span class="badge-riesgo ${RIESGO_CLASES[n] || 'badge-riesgo--pendiente'}">${RIESGO_LABELS[n] || n}</span>`;
}

async function cargarEvaluaciones() {
  const cont = document.getElementById('lista-evaluaciones');
  if (!cont) return;
  cont.innerHTML = '<p class="cargando-msg">Cargando…</p>';
  try {
    const data = await (await fetch('/api/evaluaciones')).json();
    if (!data.length) {
      cont.innerHTML = '<p class="cargando-msg">Sin evaluaciones de riesgo institucional. Cree una con "+ Nueva evaluación".</p>';
      return;
    }
    cont.innerHTML = data.map(ev => `
      <div class="eval-card">
        <div class="eval-card-header">
          <div>
            <span class="eval-periodo">Período ${esc(ev.periodo)}</span>
            <span class="subtitulo-legal"> · ${esc(ev.fecha || 's/f')} · ${esc(ev.elaborado_por || '—')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="subtitulo-legal">Riesgo general:</span> ${badgeNivel(ev.riesgo_general)}
            <button class="btn-borrar btn-chico btn-borrar-eval" data-id="${ev.id}">✕</button>
          </div>
        </div>
        <div class="eval-factores">
          <div>Clientes: ${badgeNivel(ev.riesgo_clientes)}</div>
          <div>Productos: ${badgeNivel(ev.riesgo_productos)}</div>
          <div>Canales: ${badgeNivel(ev.riesgo_canales)}</div>
          <div>Jurisdiccional: ${badgeNivel(ev.riesgo_jurisdiccional)}</div>
        </div>
        ${ev.factores ? `<p class="eval-texto"><strong>Factores:</strong> ${esc(ev.factores)}</p>` : ''}
        ${ev.controles_mitigacion ? `<p class="eval-texto"><strong>Controles:</strong> ${esc(ev.controles_mitigacion)}</p>` : ''}
        ${ev.conclusiones ? `<p class="eval-texto"><strong>Conclusiones:</strong> ${esc(ev.conclusiones)}</p>` : ''}
        ${ev.proxima_evaluacion ? `<p class="subtitulo-legal">Próxima evaluación: ${esc(ev.proxima_evaluacion)}</p>` : ''}
      </div>`).join('');

    cont.querySelectorAll('.btn-borrar-eval').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta evaluación?')) return;
      await fetch(`/api/evaluaciones/${btn.dataset.id}`, { method: 'DELETE' });
      cargarEvaluaciones();
    }));
  } catch (err) {
    cont.innerHTML = `<p class="cargando-msg">Error: ${esc(err.message)}</p>`;
  }
}

const btnNuevaEval = document.getElementById('btn-nueva-evaluacion');
if (btnNuevaEval) btnNuevaEval.addEventListener('click', () => document.getElementById('form-nueva-evaluacion-tarjeta').classList.remove('oculto'));
const btnCancelarEval = document.getElementById('btn-cancelar-evaluacion');
if (btnCancelarEval) btnCancelarEval.addEventListener('click', () => {
  document.getElementById('form-nueva-evaluacion-tarjeta').classList.add('oculto');
  document.getElementById('form-nueva-evaluacion').reset();
});

const formEval = document.getElementById('form-nueva-evaluacion');
if (formEval) formEval.addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-evaluacion');
  err.classList.add('oculto');
  const body = {
    periodo             : document.getElementById('ev-periodo').value.trim(),
    fecha               : document.getElementById('ev-fecha').value,
    elaboradoPor        : document.getElementById('ev-elaborado-por').value.trim(),
    riesgoClientes      : document.getElementById('ev-r-clientes').value,
    riesgoProductos     : document.getElementById('ev-r-productos').value,
    riesgoCanales       : document.getElementById('ev-r-canales').value,
    riesgoJurisdiccional: document.getElementById('ev-r-jurisdiccional').value,
    riesgoGeneral       : document.getElementById('ev-r-general').value,
    factores            : document.getElementById('ev-factores').value.trim(),
    controlesMitigacion : document.getElementById('ev-controles').value.trim(),
    conclusiones        : document.getElementById('ev-conclusiones').value.trim(),
    proximaEvaluacion   : document.getElementById('ev-proxima').value,
    notas               : document.getElementById('ev-notas').value.trim(),
    usuario             : usuarioActual,
  };
  if (!body.periodo) { mostrarError(err, 'El período es obligatorio.'); return; }
  try {
    const res = await fetch('/api/evaluaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar.');
    formEval.reset();
    document.getElementById('form-nueva-evaluacion-tarjeta').classList.add('oculto');
    cargarEvaluaciones();
  } catch (e2) { mostrarError(err, e2.message); }
});

// ── Utilidades ────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mostrarError(el, msg) {
  el.textContent = msg;
  el.classList.remove('oculto');
}

// ── Polling de estado al cargar ────────────────────────────
let pollingInterval = null;

async function pollearEstado() {
  try {
    const res  = await fetch('/api/estado-listas');
    const data = await res.json();
    actualizarBarraEstado(data);

    if (data.onu.cargada && data.ofac.cargada) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  } catch (_) {}
}

// Verificar estado inmediatamente y luego cada 8 segundos
pollearEstado();
pollingInterval = setInterval(pollearEstado, 8000);
