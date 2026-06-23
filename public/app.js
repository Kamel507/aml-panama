'use strict';

// ── Estado de sesión simple (recordar nombre de usuario entre acciones) ──────
let usuarioActual = sessionStorage.getItem('amlUsuario') || '';
let clienteEnFicha = null; // cliente actualmente abierto en la ficha

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
    if (id === 'estado')    { cargarEstadoListas(); cargarPep(); cargarGafi(); }
    if (id === 'clientes')  mostrarVistaListaClientes();
  });
});

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
    const params = buscar ? `?buscar=${encodeURIComponent(buscar)}` : '';
    const res  = await fetch(`/api/clientes${params}`);
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="cargando-msg">No hay clientes registrados. Cree uno con "+ Nuevo Cliente".</td></tr>';
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

document.getElementById('form-nuevo-cliente').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('error-nuevo-cliente');
  err.classList.add('oculto');

  const body = {
    nombre         : document.getElementById('nc-nombre').value.trim(),
    cedula         : document.getElementById('nc-cedula').value.trim(),
    tipo           : document.getElementById('nc-tipo').value,
    nacionalidad   : document.getElementById('nc-nacionalidad').value.trim(),
    fechaNacimiento: document.getElementById('nc-fecha-nacimiento').value.trim(),
    notas          : document.getElementById('nc-notas').value.trim(),
    usuario        : usuarioActual,
  };

  if (!body.nombre) {
    mostrarError(err, 'El nombre del cliente es obligatorio.');
    return;
  }

  try {
    const res  = await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear el cliente.');
    document.getElementById('form-nuevo-cliente').reset();
    document.getElementById('form-nuevo-cliente-tarjeta').classList.add('oculto');
    cargarClientes();
    abrirFichaCliente(data.id);
  } catch (e2) {
    mostrarError(err, e2.message);
  }
});

async function abrirFichaCliente(id) {
  try {
    const res  = await fetch(`/api/clientes/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el cliente.');

    clienteEnFicha = data.cliente;
    renderizarFicha(data.cliente, data.documentos, data.historial, data.beneficiarios || [], data.riesgoCalculado, data.pendientes || []);
    mostrarVistaFichaCliente();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function renderizarFicha(cliente, documentos, historial, beneficiarios, riesgoCalculado, pendientes) {
  document.getElementById('ficha-nombre').textContent = cliente.nombre;
  document.getElementById('ficha-cedula').textContent = cliente.cedula || '—';
  document.getElementById('ficha-tipo').textContent = cliente.tipo === 'juridica' ? 'Persona jurídica' : 'Persona natural';
  document.getElementById('ficha-nacionalidad').textContent = cliente.nacionalidad || '—';
  document.getElementById('ficha-fecha-nacimiento').textContent = cliente.fecha_nacimiento || '—';
  document.getElementById('ficha-creado').textContent = cliente.creado_en || '—';

  renderizarAnalisisRiesgo(cliente, riesgoCalculado, pendientes);

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
const PENDIENTE_ICONOS = { campo: '📋', documento: '📄', beneficiario: '👥', revision: '🔔' };

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
                <span class="alerta-tipo">${c.tipo === 'juridica' ? 'Jurídica' : 'Natural'}</span>
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
