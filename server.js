'use strict';

require('dotenv').config();

const express      = require('express');
const axios        = require('axios');
const { XMLParser } = require('fast-xml-parser');
const initSqlJs    = require('sql.js');
const PDFDocument  = require('pdfkit');
const path         = require('path');
const fs           = require('fs');
const multer       = require('multer');
const Anthropic    = require('@anthropic-ai/sdk');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Directorios ─────────────────────────────────────────────────────────────
const datosDir    = path.join(__dirname, 'datos');
const clientesDir = path.join(datosDir, 'clientes');
if (!fs.existsSync(datosDir))    fs.mkdirSync(datosDir, { recursive: true });
if (!fs.existsSync(clientesDir)) fs.mkdirSync(clientesDir, { recursive: true });

// ─── Base de datos SQLite (sql.js / WASM) ────────────────────────────────────
const DB_FILE = path.join(datosDir, 'consultas.db');
let db = null; // set after initDB()

function guardarDB() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function dbExec(sql, params) {
  db.run(sql, params || []);
  guardarDB();
}

function dbInsert(sql, params) {
  db.run(sql, params);
  const res = db.exec('SELECT last_insert_rowid()');
  guardarDB();
  return res[0]?.values[0][0];
}

function dbGet(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params || []);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params) {
  const res = db.exec(sql, params || []);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function agregarColumnaSiNoExiste(sql) {
  try { db.run(sql); } catch (_) { /* la columna ya existe */ }
}

// ─── Personas Expuestas Políticamente — categorías legales (Art. 34, Ley 23 de 2015) ─
const PEP_CATEGORIAS = [
  { id: 'presidente_vp',        nombre: 'Presidente y Vicepresidente de la República',                         articulo: 'Art. 34, núm. 1' },
  { id: 'ministros',            nombre: 'Ministros y Viceministros de Estado',                                  articulo: 'Art. 34, núm. 2' },
  { id: 'magistrados_csj',      nombre: 'Magistrados de la Corte Suprema de Justicia',                          articulo: 'Art. 34, núm. 3' },
  { id: 'diputados',            nombre: 'Diputados de la Asamblea Nacional (principales y suplentes)',          articulo: 'Art. 34, núm. 4' },
  { id: 'directores_estatales', nombre: 'Directores y miembros de juntas directivas de empresas estatales',     articulo: 'Art. 34, núm. 5' },
  { id: 'alcaldes',             nombre: 'Alcaldes',                                                              articulo: 'Art. 34, núm. 6' },
  { id: 'gobernadores',         nombre: 'Gobernadores',                                                          articulo: 'Art. 34, núm. 7' },
  { id: 'tribunal_electoral',   nombre: 'Magistrados del Tribunal Electoral',                                   articulo: 'Art. 34, núm. 8' },
  { id: 'procurador',           nombre: 'Procurador General de la Nación / Procurador de la Administración',    articulo: 'Art. 34, núm. 9' },
  { id: 'contralor',            nombre: 'Contralor General de la República',                                    articulo: 'Art. 34, núm. 10' },
  { id: 'defensor_pueblo',      nombre: 'Defensor del Pueblo',                                                   articulo: 'Art. 34, núm. 11' },
  { id: 'familiar',             nombre: 'Familiar cercano de un PEP (cónyuge o hasta 2º grado)',                 articulo: 'Art. 34, párr. final' },
  { id: 'colaborador',          nombre: 'Colaborador cercano de un PEP',                                        articulo: 'Art. 34, párr. final' },
];

function categoriaPep(id) {
  return PEP_CATEGORIAS.find(c => c.id === id) || null;
}

// ─── Inicialización / migración de la base de datos ──────────────────────────
async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS consultas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha           TEXT NOT NULL,
      hora            TEXT NOT NULL,
      tipo_busqueda   TEXT,
      nombre          TEXT,
      cedula          TEXT,
      resultado_onu   TEXT,
      resultado_ofac  TEXT,
      coincidencia    INTEGER DEFAULT 0,
      detalles        TEXT,
      ip_cliente      TEXT,
      creado_en       TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Migración: columnas agregadas para usuario, país (GAFI), cliente vinculado y nuevas listas.
  agregarColumnaSiNoExiste("ALTER TABLE consultas ADD COLUMN usuario TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE consultas ADD COLUMN pais TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE consultas ADD COLUMN cliente_id INTEGER");
  agregarColumnaSiNoExiste("ALTER TABLE consultas ADD COLUMN resultado_ue TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE consultas ADD COLUMN resultado_pep TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE consultas ADD COLUMN resultado_gafi TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE consultas ADD COLUMN listas_consultadas TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS pep_personas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre        TEXT NOT NULL,
      cargo         TEXT,
      categoria_id  TEXT,
      vinculado_a   TEXT,
      notas         TEXT,
      agregado_por  TEXT,
      creado_en     TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gafi_paises (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre    TEXT NOT NULL,
      codigo    TEXT,
      lista     TEXT NOT NULL,
      creado_en TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS beneficiarios_finales (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id               INTEGER NOT NULL,
    nombre                   TEXT NOT NULL,
    cedula                   TEXT,
    nacionalidad             TEXT,
    porcentaje_participacion REAL,
    cargo                    TEXT,
    resultado_listas         TEXT,
    coincidencia             INTEGER DEFAULT 0,
    fecha_revision           TEXT,
    creado_en                TEXT DEFAULT (datetime('now','localtime'))
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre           TEXT NOT NULL,
      cedula           TEXT,
      tipo             TEXT NOT NULL DEFAULT 'natural',
      nacionalidad     TEXT,
      fecha_nacimiento TEXT,
      notas            TEXT,
      carpeta          TEXT NOT NULL,
      creado_por       TEXT,
      creado_en        TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Migraciones: campos adicionales Ley 23 de 2015
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN nivel_riesgo TEXT DEFAULT 'pendiente'");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN actividad_economica TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN origen_fondos TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN rango_ingresos TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN direccion TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN representante_legal TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN fecha_fin_relacion TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN aprobacion_gerencia TEXT DEFAULT 'no_requerida'");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN aprobacion_fecha TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN aprobacion_por TEXT");
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN aprobacion_notas TEXT");
  // Discriminador cliente / proveedor: el mismo expediente de debida diligencia
  // aplica a proveedores (Decreto Ejecutivo 35 de 2022). 'cliente' por defecto
  // para no afectar los registros existentes.
  agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN tipo_expediente TEXT DEFAULT 'cliente'");

  // Conozca a su empleado (KYE) — Decreto Ejecutivo 35 de 2022
  db.run(`
    CREATE TABLE IF NOT EXISTS empleados (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre           TEXT NOT NULL,
      cedula           TEXT,
      cargo            TEXT,
      departamento     TEXT,
      fecha_ingreso    TEXT,
      fecha_salida     TEXT,
      tipo_contrato    TEXT,
      salario_rango    TEXT,
      es_pep           INTEGER DEFAULT 0,
      declaracion_pep  TEXT,
      acceso_sensible  INTEGER DEFAULT 0,
      nivel_riesgo     TEXT DEFAULT 'pendiente',
      resultado_listas TEXT,
      coincidencia     INTEGER DEFAULT 0,
      fecha_revision   TEXT,
      notas            TEXT,
      creado_por       TEXT,
      creado_en        TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Operaciones inusuales (Decreto 35 de 2022): registro previo al ROS. Toda
  // operación que se aparte del perfil del cliente se documenta y analiza; si el
  // análisis confirma sospecha, se escala a ROS (reportes_sospechosos).
  db.run(`
    CREATE TABLE IF NOT EXISTS operaciones_inusuales (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id      INTEGER,
      fecha_deteccion TEXT NOT NULL,
      tipo_operacion  TEXT,
      monto           TEXT,
      descripcion     TEXT NOT NULL,
      detectada_por   TEXT,
      estado          TEXT DEFAULT 'pendiente_analisis',
      analisis        TEXT,
      analizada_por   TEXT,
      fecha_analisis  TEXT,
      ros_id          INTEGER,
      notas           TEXT,
      creado_por      TEXT,
      creado_en       TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Congelamiento preventivo de fondos (Art. 41 Ley 23; Resoluciones ONU
  // 1267/1373/1718). Ante una coincidencia con listas de sanciones se congela
  // de inmediato y se reporta a la autoridad competente.
  db.run(`
    CREATE TABLE IF NOT EXISTS congelamientos (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id         INTEGER,
      nombre_persona     TEXT NOT NULL,
      cedula             TEXT,
      lista_origen       TEXT,
      referencia_lista   TEXT,
      fecha_deteccion    TEXT,
      fecha_congelamiento TEXT,
      monto_congelado    TEXT,
      descripcion_bienes TEXT,
      estado             TEXT DEFAULT 'pendiente',
      reportado_a        TEXT,
      fecha_reporte      TEXT,
      numero_ref         TEXT,
      notas              TEXT,
      creado_por         TEXT,
      creado_en          TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reportes_sospechosos (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id          INTEGER,
      fecha_deteccion     TEXT NOT NULL,
      fecha_limite        TEXT NOT NULL,
      fecha_reporte_uaf   TEXT,
      descripcion         TEXT NOT NULL,
      monto               TEXT,
      tipo_operacion      TEXT,
      estado              TEXT DEFAULT 'borrador',
      reportado_por       TEXT,
      numero_ref_uaf      TEXT,
      notas               TEXT,
      creado_por          TEXT,
      creado_en           TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documentos_cliente (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id      INTEGER NOT NULL,
      tipo_documento  TEXT,
      nombre_original TEXT,
      nombre_archivo  TEXT,
      mime            TEXT,
      tamano          INTEGER,
      subido_por      TEXT,
      subido_en       TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Semilla inicial de países GAFI/FATF (Art. 41) — lista de alto riesgo y monitoreo
  // intensificado. ADVERTENCIA: el GAFI actualiza estas listas periódicamente
  // (fatf-gafi.org/en/countries/black-and-grey-lists.html). Esta semilla es solo un
  // punto de partida editable desde la pestaña "Listas y Cumplimiento"; el Oficial
  // de Cumplimiento debe verificar y mantener esta lista actualizada.
  const totalGafi = dbAll('SELECT COUNT(*) AS n FROM gafi_paises')[0]?.n || 0;
  if (totalGafi === 0) {
    db.run(`
      INSERT INTO gafi_paises (nombre, codigo, lista) VALUES
      ('Corea del Norte', 'KP', 'negra'),
      ('Irán', 'IR', 'negra'),
      ('Myanmar', 'MM', 'negra'),
      ('Argelia', 'DZ', 'gris'),
      ('Angola', 'AO', 'gris'),
      ('Bolivia', 'BO', 'gris'),
      ('Burkina Faso', 'BF', 'gris'),
      ('Camerún', 'CM', 'gris'),
      ('Costa de Marfil', 'CI', 'gris'),
      ('República Democrática del Congo', 'CD', 'gris'),
      ('Haití', 'HT', 'gris'),
      ('Kenia', 'KE', 'gris'),
      ('Laos', 'LA', 'gris'),
      ('Líbano', 'LB', 'gris'),
      ('Mali', 'ML', 'gris'),
      ('Mónaco', 'MC', 'gris'),
      ('Mozambique', 'MZ', 'gris'),
      ('Namibia', 'NA', 'gris'),
      ('Nepal', 'NP', 'gris'),
      ('Nigeria', 'NG', 'gris'),
      ('Sudáfrica', 'ZA', 'gris'),
      ('Sudán del Sur', 'SS', 'gris'),
      ('Siria', 'SY', 'gris'),
      ('Tanzania', 'TZ', 'gris'),
      ('Venezuela', 'VE', 'gris'),
      ('Vietnam', 'VN', 'gris'),
      ('Yemen', 'YE', 'gris')
    `);
  }

  guardarDB();
}

// ─── Caché XML ───────────────────────────────────────────────────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

let unList   = { entries: [], lastFetch: 0, error: null };
let ofacList = { entries: [], lastFetch: 0, error: null };
let euList   = { entries: [], lastFetch: 0, error: null };

const xmlParser = new XMLParser({
  ignoreAttributes   : false,
  attributeNamePrefix: '@_',
  removeNSPrefix     : true,
  parseTagValue      : true,
  trimValues         : true,
  isArray(tagName) {
    return [
      'INDIVIDUAL','ENTITY',
      'INDIVIDUAL_ALIAS','ENTITY_ALIAS',
      'INDIVIDUAL_DOCUMENT','ENTITY_DOCUMENT',
      'INDIVIDUAL_ADDRESS','ENTITY_ADDRESS',
      'INDIVIDUAL_DATE_OF_BIRTH',
      'sdnEntry','aka','id','program',
      'sanctionEntity','nameAlias','identification','citizenship','address',
    ].includes(tagName);
  },
});

// ─── Normalización y matching ─────────────────────────────────────────────────
function normalize(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function tokenScore(search, target) {
  const sNorm = normalize(search);
  const tNorm = normalize(target);
  if (!sNorm || !tNorm || sNorm.length < 3) return { score: 0, matchedCount: 0 };

  const sTok = sNorm.split(' ').filter(t => t.length > 2);
  const tTok = tNorm.split(' ').filter(t => t.length > 2);
  if (!sTok.length || !tTok.length) return { score: 0, matchedCount: 0 };

  // Comparación exacta de tokens (palabra completa), no substring
  const tTokSet = new Set(tTok);
  const sTokSet = new Set(sTok);

  const matchedSinT = sTok.filter(t => tTokSet.has(t)).length;
  const matchedTinS = tTok.filter(t => sTokSet.has(t)).length;

  const score        = Math.max(matchedSinT / sTok.length, matchedTinS / tTok.length);
  const matchedCount = Math.max(matchedSinT, matchedTinS);

  return { score, matchedCount };
}

// ─── Descarga lista ONU ──────────────────────────────────────────────────────
async function fetchUNList(forceRefresh = false) {
  if (!forceRefresh && Date.now() - unList.lastFetch < CACHE_TTL && unList.entries.length > 0) {
    return unList;
  }

  const cacheFile = path.join(datosDir, 'onu_consolidated.xml');
  let xmlText;

  try {
    console.log('[ONU] Descargando lista consolidada de sanciones...');
    const res = await axios.get(
      'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
      { timeout: 120_000, responseType: 'text', maxContentLength: Infinity, maxBodyLength: Infinity }
    );
    xmlText = res.data;
    fs.writeFileSync(cacheFile, xmlText, 'utf-8');
    console.log('[ONU] Descarga completada.');
  } catch (err) {
    if (fs.existsSync(cacheFile)) {
      console.warn(`[ONU] Error de red, usando caché en disco: ${err.message}`);
      xmlText = fs.readFileSync(cacheFile, 'utf-8');
    } else {
      unList.error = err.message;
      throw new Error(`No se pudo obtener la lista ONU: ${err.message}`);
    }
  }

  const parsed = xmlParser.parse(xmlText);
  const root   = parsed.CONSOLIDATED_LIST || parsed;
  const entries = [];

  // Individuos
  const individuals = toArray(root.INDIVIDUALS?.INDIVIDUAL);
  for (const ind of individuals) {
    const mainName = [ind.FIRST_NAME, ind.SECOND_NAME, ind.THIRD_NAME, ind.FOURTH_NAME]
      .filter(Boolean).join(' ').trim();
    const names = mainName ? [mainName] : [];

    for (const alias of toArray(ind.INDIVIDUAL_ALIAS)) {
      if (alias.ALIAS_NAME) names.push(String(alias.ALIAS_NAME));
    }

    const docIds = toArray(ind.INDIVIDUAL_DOCUMENT)
      .map(d => d.NUMBER).filter(Boolean).map(String);

    entries.push({
      tipo      : 'Individual',
      id        : String(ind.DATAID || ''),
      nombres   : names,
      docIds,
      listaTipo : ind.UN_LIST_TYPE || '',
      refNumero : ind.REFERENCE_NUMBER || '',
      listedOn  : ind.LISTED_ON || '',
      nacionalidad: toArray(ind.NATIONALITY?.VALUE).join(', '),
      fuente    : 'ONU',
    });
  }

  // Entidades
  const entities = toArray(root.ENTITIES?.ENTITY);
  for (const ent of entities) {
    const names = ent.FIRST_NAME ? [String(ent.FIRST_NAME)] : [];
    for (const alias of toArray(ent.ENTITY_ALIAS)) {
      if (alias.ALIAS_NAME) names.push(String(alias.ALIAS_NAME));
    }

    entries.push({
      tipo     : 'Entidad',
      id       : String(ent.DATAID || ''),
      nombres  : names,
      docIds   : [],
      listaTipo: ent.UN_LIST_TYPE || '',
      refNumero: ent.REFERENCE_NUMBER || '',
      listedOn : ent.LISTED_ON || '',
      fuente   : 'ONU',
    });
  }

  unList = { entries, lastFetch: Date.now(), error: null };
  console.log(`[ONU] ${entries.length} entradas cargadas.`);
  return unList;
}

// ─── Descarga lista OFAC SDN ──────────────────────────────────────────────────
async function fetchOFACList(forceRefresh = false) {
  if (!forceRefresh && Date.now() - ofacList.lastFetch < CACHE_TTL && ofacList.entries.length > 0) {
    return ofacList;
  }

  const cacheFile = path.join(datosDir, 'ofac_sdn.xml');
  let xmlText;

  try {
    console.log('[OFAC] Descargando lista SDN de OFAC...');
    const res = await axios.get(
      'https://www.treasury.gov/ofac/downloads/sdn.xml',
      { timeout: 180_000, responseType: 'text', maxContentLength: Infinity, maxBodyLength: Infinity, maxRedirects: 5 }
    );
    xmlText = res.data;
    fs.writeFileSync(cacheFile, xmlText, 'utf-8');
    console.log('[OFAC] Descarga completada.');
  } catch (err) {
    if (fs.existsSync(cacheFile)) {
      console.warn(`[OFAC] Error de red, usando caché en disco: ${err.message}`);
      xmlText = fs.readFileSync(cacheFile, 'utf-8');
    } else {
      ofacList.error = err.message;
      throw new Error(`No se pudo obtener la lista OFAC: ${err.message}`);
    }
  }

  const parsed = xmlParser.parse(xmlText);
  // Buscar la raíz correcta independientemente del namespace
  let root = null;
  for (const key of Object.keys(parsed)) {
    const val = parsed[key];
    if (val && (val.sdnEntry || val.publshInformation)) { root = val; break; }
  }
  if (!root) root = parsed.sdnList || parsed;

  const sdn = toArray(root.sdnEntry);
  const entries = [];

  for (const entry of sdn) {
    const lastName  = entry.lastName  ? String(entry.lastName)  : '';
    const firstName = entry.firstName ? String(entry.firstName) : '';
    const fullName  = firstName ? `${firstName} ${lastName}`.trim() : lastName;
    const names = fullName ? [fullName] : [];

    for (const aka of toArray(entry.akaList?.aka)) {
      const akName = [aka.firstName, aka.lastName].filter(Boolean).join(' ').trim();
      if (akName && !names.includes(akName)) names.push(akName);
    }

    const docIds = toArray(entry.idList?.id)
      .map(i => i?.idNumber).filter(Boolean).map(String);

    const programs = toArray(entry.programList?.program).join(', ');

    entries.push({
      tipo    : entry.sdnType || 'Individual',
      id      : String(entry.uid || ''),
      nombres : names,
      docIds,
      programas: programs,
      fuente  : 'OFAC',
      notas   : entry.remarks ? String(entry.remarks) : '',
    });
  }

  ofacList = { entries, lastFetch: Date.now(), error: null };
  console.log(`[OFAC] ${entries.length} entradas cargadas.`);
  return ofacList;
}

// ─── Descarga / carga lista de sanciones financieras de la UE ────────────────
// Fuente: https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList/content
// NOTA: este portal de la Comisión Europea puede bloquear solicitudes automatizadas
// según el origen de red (devuelve 403). Si la descarga automática falla, use el
// botón "Cargar archivo XML manualmente" en la pestaña "Listas y Cumplimiento"
// para subir el XML descargado manualmente desde un navegador.
const EU_SANCTIONS_URL = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList/content';

function parseEUXml(xmlText) {
  const parsed = xmlParser.parse(xmlText);
  const root = parsed.export || parsed;
  const entidades = toArray(root.sanctionEntity);
  const entries = [];

  for (const ent of entidades) {
    const aliases = toArray(ent.nameAlias);
    const names = [];
    for (const a of aliases) {
      const whole = a['@_wholeName'] ||
        [a['@_firstName'], a['@_middleName'], a['@_lastName']].filter(Boolean).join(' ').trim();
      if (whole && !names.includes(String(whole))) names.push(String(whole));
    }

    const docIds = toArray(ent.identification)
      .map(i => i?.['@_number']).filter(Boolean).map(String);

    entries.push({
      tipo     : ent['@_subjectType'] || ent.subjectType?.['@_code'] || 'Individual/Entidad',
      id       : String(ent['@_logicalId'] || ''),
      nombres  : names,
      docIds,
      refNumero: ent['@_referenceNumber'] || ent['@_euReferenceNumber'] || '',
      fuente   : 'UE',
    });
  }

  return entries;
}

async function fetchEUList(forceRefresh = false) {
  if (!forceRefresh && Date.now() - euList.lastFetch < CACHE_TTL && euList.entries.length > 0) {
    return euList;
  }

  const cacheFile = path.join(datosDir, 'ue_sanciones.xml');
  let xmlText;

  try {
    console.log('[UE] Descargando lista de sanciones financieras de la Unión Europea...');
    const res = await axios.get(EU_SANCTIONS_URL, {
      timeout: 120_000, responseType: 'text', maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SistemaAML-FT-Panama/1.0)',
        'Accept'    : 'application/xml,text/xml,*/*',
      },
    });
    xmlText = res.data;
    if (typeof xmlText !== 'string' || !xmlText.trim().startsWith('<')) {
      throw new Error('La respuesta no es un XML válido (posible bloqueo de red por parte del portal de la UE).');
    }
    fs.writeFileSync(cacheFile, xmlText, 'utf-8');
    console.log('[UE] Descarga completada.');
  } catch (err) {
    if (fs.existsSync(cacheFile)) {
      console.warn(`[UE] Error de red, usando caché en disco: ${err.message}`);
      xmlText = fs.readFileSync(cacheFile, 'utf-8');
    } else {
      euList.error = err.message;
      throw new Error(`No se pudo obtener la lista de la UE: ${err.message}. Puede cargar el archivo XML manualmente desde "Listas y Cumplimiento".`);
    }
  }

  const entries = parseEUXml(xmlText);
  euList = { entries, lastFetch: Date.now(), error: null };
  console.log(`[UE] ${entries.length} entradas cargadas.`);
  return euList;
}

// ─── Búsqueda ─────────────────────────────────────────────────────────────────
const UMBRAL_SCORE    = 0.85; // similitud mínima por token (>85%)
const UMBRAL_PALABRAS = 3;    // mínimo de palabras completas coincidentes
const MAX_RESULTADOS  = 15;

function buscarEnLista(entries, { nombre, cedula }) {
  const hits = [];

  for (const entry of entries) {
    let coincide    = false;
    let razonMatch  = '';
    let puntaje     = 0;

    // Búsqueda por nombre
    if (nombre && normalize(nombre).length >= 3) {
      for (const n of entry.nombres) {
        const { score, matchedCount } = tokenScore(nombre, n);
        if (score >= UMBRAL_SCORE || matchedCount >= UMBRAL_PALABRAS) {
          coincide   = true;
          puntaje    = score;
          razonMatch = `Nombre: "${n}" (${Math.round(score * 100)}% similitud, ${matchedCount} palabras coinciden)`;
          break;
        }
      }
    }

    // Búsqueda por cédula / documento — solo coincidencia exacta del número completo
    if (!coincide && cedula && cedula.replace(/[-\s]/g, '').length >= 4) {
      const cNorm = cedula.replace(/[-\s]/g, '').toUpperCase();
      for (const docId of entry.docIds || []) {
        const dNorm = String(docId).replace(/[-\s]/g, '').toUpperCase();
        if (dNorm === cNorm) {
          coincide   = true;
          razonMatch = `Documento/ID: ${docId}`;
          break;
        }
      }
    }

    if (coincide) {
      hits.push({ ...entry, razonMatch, puntaje });
    }
  }

  return hits
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, MAX_RESULTADOS);
}

// ─── PEP Panamá (Art. 34) ──────────────────────────────────────────────────────
function pepEntries() {
  const personas = dbAll('SELECT * FROM pep_personas');
  return personas.map(p => {
    const cat = categoriaPep(p.categoria_id);
    return {
      tipo     : 'PEP',
      id       : String(p.id),
      nombres  : [p.nombre],
      docIds   : [],
      fuente   : 'PEP Panamá',
      listaTipo: `${cat ? cat.nombre : (p.categoria_id || 'Categoría no especificada')} (${cat ? cat.articulo : 'Art. 34'})`,
      cargo    : p.cargo,
      vinculadoA: p.vinculado_a,
    };
  });
}

// ─── GAFI/FATF — países de alto riesgo (Art. 41) ──────────────────────────────
function chequearGAFI(pais) {
  const paisT = (pais || '').trim();
  if (!paisT) return null;

  const pNorm = normalize(paisT);
  const filas = dbAll('SELECT * FROM gafi_paises');

  for (const fila of filas) {
    const coincideNombre = normalize(fila.nombre) === pNorm;
    const coincideCodigo = fila.codigo && fila.codigo.toUpperCase() === paisT.toUpperCase();
    if (coincideNombre || coincideCodigo) {
      return { coincide: true, lista: fila.lista, pais: fila.nombre, codigo: fila.codigo };
    }
  }

  return { coincide: false, paisConsultado: paisT };
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function ahoraPA() {
  const now = new Date();
  const opts = { timeZone: 'America/Panama' };
  const fecha = now.toLocaleDateString('es-PA', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hora  = now.toLocaleTimeString('es-PA', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { fecha, hora };
}

function slugCliente(nombre) {
  const base = String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return base || 'cliente';
}

function generarCarpetaUnica(nombre) {
  const base = slugCliente(nombre);
  let candidato = base;
  let i = 1;
  while (fs.existsSync(path.join(clientesDir, candidato))) {
    i += 1;
    candidato = `${base}-${i}`;
  }
  return candidato;
}

// ─── Multer: lectura de documento de identidad (Claude Vision) ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ─── Multer: documentos del expediente de cliente (a disco) ──────────────────
const uploadDocCliente = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
      if (!cliente) return cb(new Error('Cliente no encontrado.'));
      const dir = path.join(clientesDir, cliente.carpeta);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext      = path.extname(file.originalname) || '';
      const baseSafe = path.basename(file.originalname, ext)
        .replace(/[^a-zA-Z0-9_\-]+/g, '_')
        .slice(0, 60) || 'documento';
      cb(null, `${Date.now()}-${baseSafe}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ─── Multer: carga manual del XML de sanciones de la UE ──────────────────────
const uploadXML = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const esXml = file.mimetype === 'text/xml' || file.mimetype === 'application/xml' ||
      file.originalname.toLowerCase().endsWith('.xml');
    cb(null, esXml);
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: Consultar ──────────────────────────────────────────────────────────
app.post('/api/consultar', async (req, res) => {
  const { nombre, cedula, pais, usuario, clienteId } = req.body;
  const nombreT  = (nombre   || '').trim();
  const cedulaT  = (cedula   || '').trim();
  const paisT    = (pais     || '').trim();
  const usuarioT = (usuario  || '').trim();

  if (!nombreT && !cedulaT) {
    return res.status(400).json({ error: 'Debe proporcionar al menos un nombre o cédula.' });
  }

  const { fecha, hora } = ahoraPA();
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconocida';

  let onuHits  = [];
  let ofacHits = [];
  let ueHits   = [];
  let pepHits  = [];
  const errores = [];
  const listasConsultadas = ['ONU (Art. 41)', 'OFAC (Art. 41)', 'PEP Panamá (Art. 34)'];

  try {
    const lista = await fetchUNList();
    onuHits = buscarEnLista(lista.entries, { nombre: nombreT, cedula: cedulaT });
  } catch (e) {
    errores.push(`ONU: ${e.message}`);
  }

  try {
    const lista = await fetchOFACList();
    ofacHits = buscarEnLista(lista.entries, { nombre: nombreT, cedula: cedulaT });
  } catch (e) {
    errores.push(`OFAC: ${e.message}`);
  }

  try {
    const lista = await fetchEUList();
    ueHits = buscarEnLista(lista.entries, { nombre: nombreT, cedula: cedulaT });
    listasConsultadas.push('UE (Art. 41)');
  } catch (e) {
    errores.push(`UE: ${e.message}`);
  }

  try {
    pepHits = buscarEnLista(pepEntries(), { nombre: nombreT, cedula: cedulaT });
  } catch (e) {
    errores.push(`PEP: ${e.message}`);
  }

  let gafiResultado = null;
  if (paisT) {
    gafiResultado = chequearGAFI(paisT);
    listasConsultadas.push('GAFI/FATF (Art. 41)');
  }

  const hayCoincidencia =
    onuHits.length > 0 || ofacHits.length > 0 || ueHits.length > 0 || pepHits.length > 0 ||
    (gafiResultado && gafiResultado.coincide);

  const tipo = (nombreT && cedulaT) ? 'nombre+cedula' : (nombreT ? 'nombre' : 'cedula');

  const detalles = JSON.stringify({ onuHits, ofacHits, ueHits, pepHits, gafiResultado });

  const resultadoTexto = (n) => (n > 0 ? `${n} coincidencia(s)` : 'Sin coincidencias');
  const resultadoGafiTexto = gafiResultado
    ? (gafiResultado.coincide
        ? `País en lista ${gafiResultado.lista === 'negra' ? 'NEGRA' : 'GRIS'}: ${gafiResultado.pais}`
        : 'Sin alerta')
    : 'No evaluado (sin país)';

  const consultaId = dbInsert(
    `INSERT INTO consultas
       (fecha, hora, tipo_busqueda, nombre, cedula, pais, usuario, cliente_id,
        resultado_onu, resultado_ofac, resultado_ue, resultado_pep, resultado_gafi,
        coincidencia, detalles, ip_cliente, listas_consultadas)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      fecha, hora, tipo,
      nombreT || null,
      cedulaT || null,
      paisT   || null,
      usuarioT || null,
      clienteId || null,
      resultadoTexto(onuHits.length),
      resultadoTexto(ofacHits.length),
      resultadoTexto(ueHits.length),
      resultadoTexto(pepHits.length),
      resultadoGafiTexto,
      hayCoincidencia ? 1 : 0,
      detalles,
      ip,
      listasConsultadas.join(', '),
    ]
  );

  res.json({
    consultaId,
    fecha,
    hora,
    nombre         : nombreT || null,
    cedula         : cedulaT || null,
    pais           : paisT   || null,
    hayCoincidencia,
    onuHits,
    ofacHits,
    ueHits,
    pepHits,
    gafiResultado,
    listasConsultadas,
    errores        : errores.length ? errores : undefined,
  });
});

// ─── API: Leer documento de identidad con Claude Vision ──────────────────────
app.post('/api/leer-documento', upload.single('documento'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo. Use imagen (JPG, PNG, WebP) o PDF.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no está configurada en el servidor.' });
  }

  const { mimetype, buffer } = req.file;
  const base64 = buffer.toString('base64');
  const isPDF  = mimetype === 'application/pdf';

  const prompt = `Analiza este documento de identidad (pasaporte, cédula panameña u otro documento oficial) y extrae los siguientes datos.

Devuelve ÚNICAMENTE un objeto JSON con exactamente estos campos (sin ningún texto adicional antes ni después):
{
  "nombre": "nombre completo tal como aparece en el documento",
  "cedula": "número de documento, cédula o pasaporte",
  "fechaNacimiento": "fecha de nacimiento en formato DD/MM/AAAA",
  "nacionalidad": "país de nacionalidad si aparece en el documento, o null"
}

Si algún campo no es legible o no está presente, usa null para ese campo.`;

  const contentBlock = isPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mimetype,           data: base64 } };

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model     : 'claude-sonnet-4-6',
      max_tokens: 512,
      messages  : [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
    });

    const rawText = message.content[0]?.text || '';
    const match   = rawText.match(/\{[\s\S]*?\}/);
    if (!match) {
      return res.status(422).json({ error: 'No se pudo extraer información del documento. Asegúrese de que la imagen sea clara y muestre el documento completo.' });
    }

    const datos = JSON.parse(match[0]);
    res.json({
      nombre         : datos.nombre          || null,
      cedula         : datos.cedula          || null,
      fechaNacimiento: datos.fechaNacimiento || null,
      nacionalidad   : datos.nacionalidad    || null,
    });
  } catch (err) {
    console.error('[Claude Vision] Error:', err.message);
    res.status(500).json({ error: `Error al procesar el documento con IA: ${err.message}` });
  }
});

// ─── API: Detalle consulta ───────────────────────────────────────────────────
app.get('/api/consulta/:id', (req, res) => {
  const row = dbGet('SELECT * FROM consultas WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Consulta no encontrada.' });
  try { row.detalles = JSON.parse(row.detalles); } catch {}
  res.json(row);
});

// ─── API: Historial (con filtros opcionales) ──────────────────────────────────
app.get('/api/historial', (req, res) => {
  const { fechaDesde, fechaHasta, resultado } = req.query;
  const condiciones = [];
  const params = [];

  if (fechaDesde) { condiciones.push("date(substr(creado_en,1,10)) >= date(?)"); params.push(fechaDesde); }
  if (fechaHasta) { condiciones.push("date(substr(creado_en,1,10)) <= date(?)"); params.push(fechaHasta); }
  if (resultado === 'alerta') condiciones.push('coincidencia = 1');
  if (resultado === 'limpio') condiciones.push('coincidencia = 0');

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const rows = dbAll(
    `SELECT c.id, c.fecha, c.hora, c.nombre, c.cedula, c.pais, c.usuario, c.cliente_id,
            c.coincidencia, c.resultado_onu, c.resultado_ofac, c.resultado_ue, c.resultado_pep,
            c.resultado_gafi, c.listas_consultadas, c.creado_en, cl.nombre AS cliente_nombre
     FROM consultas c
     LEFT JOIN clientes cl ON cl.id = c.cliente_id
     ${where}
     ORDER BY c.id DESC
     LIMIT 500`,
    params
  );
  res.json(rows);
});

// ─── API: Estado de listas ───────────────────────────────────────────────────
app.get('/api/estado-listas', (_req, res) => {
  const cacheONU  = path.join(datosDir, 'onu_consolidated.xml');
  const cacheOFAC = path.join(datosDir, 'ofac_sdn.xml');
  const cacheUE   = path.join(datosDir, 'ue_sanciones.xml');

  const totalPep  = dbAll('SELECT COUNT(*) AS n FROM pep_personas')[0]?.n || 0;
  const totalGafi = dbAll('SELECT COUNT(*) AS n FROM gafi_paises')[0]?.n || 0;

  res.json({
    onu: {
      cargada           : unList.entries.length > 0,
      entradas          : unList.entries.length,
      ultimaActualizacion: unList.lastFetch ? new Date(unList.lastFetch).toISOString() : null,
      cacheDisco        : fs.existsSync(cacheONU),
      error             : unList.error,
    },
    ofac: {
      cargada           : ofacList.entries.length > 0,
      entradas          : ofacList.entries.length,
      ultimaActualizacion: ofacList.lastFetch ? new Date(ofacList.lastFetch).toISOString() : null,
      cacheDisco        : fs.existsSync(cacheOFAC),
      error             : ofacList.error,
    },
    ue: {
      cargada           : euList.entries.length > 0,
      entradas          : euList.entries.length,
      ultimaActualizacion: euList.lastFetch ? new Date(euList.lastFetch).toISOString() : null,
      cacheDisco        : fs.existsSync(cacheUE),
      error             : euList.error,
    },
    pep: {
      total: totalPep,
    },
    gafi: {
      total: totalGafi,
    },
  });
});

// ─── API: Forzar actualización ───────────────────────────────────────────────
app.post('/api/actualizar-listas', async (_req, res) => {
  const errores = [];
  try { await fetchUNList(true);  } catch (e) { errores.push(`ONU: ${e.message}`);  }
  try { await fetchOFACList(true); } catch (e) { errores.push(`OFAC: ${e.message}`); }
  try { await fetchEUList(true);   } catch (e) { errores.push(`UE: ${e.message}`);   }

  res.json({
    onu  : { entradas: unList.entries.length },
    ofac : { entradas: ofacList.entries.length },
    ue   : { entradas: euList.entries.length },
    errores: errores.length ? errores : undefined,
  });
});

// ─── API: Carga manual del XML de sanciones de la UE ──────────────────────────
app.post('/api/listas/ue/cargar-manual', uploadXML.single('archivo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo XML válido.' });
  }
  try {
    const xmlText = req.file.buffer.toString('utf-8');
    const entries = parseEUXml(xmlText);
    fs.writeFileSync(path.join(datosDir, 'ue_sanciones.xml'), xmlText, 'utf-8');
    euList = { entries, lastFetch: Date.now(), error: null };
    res.json({ entradas: entries.length });
  } catch (err) {
    res.status(422).json({ error: `No se pudo procesar el archivo XML: ${err.message}` });
  }
});

// ─── API: PEP Panamá (Art. 34) ─────────────────────────────────────────────────
app.get('/api/pep', (_req, res) => {
  const personas = dbAll('SELECT * FROM pep_personas ORDER BY nombre');
  res.json({
    categorias: PEP_CATEGORIAS,
    personas: personas.map(p => ({ ...p, categoria: categoriaPep(p.categoria_id) })),
  });
});

app.post('/api/pep', (req, res) => {
  const { nombre, cargo, categoriaId, vinculadoA, notas, usuario } = req.body;
  const nombreT = (nombre || '').trim();
  if (!nombreT) return res.status(400).json({ error: 'El nombre es obligatorio.' });

  const id = dbInsert(
    `INSERT INTO pep_personas (nombre, cargo, categoria_id, vinculado_a, notas, agregado_por)
     VALUES (?,?,?,?,?,?)`,
    [nombreT, (cargo || '').trim() || null, (categoriaId || '').trim() || null,
     (vinculadoA || '').trim() || null, (notas || '').trim() || null, (usuario || '').trim() || null]
  );
  res.json(dbGet('SELECT * FROM pep_personas WHERE id = ?', [id]));
});

app.delete('/api/pep/:id', (req, res) => {
  const row = dbGet('SELECT * FROM pep_personas WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Registro PEP no encontrado.' });
  dbExec('DELETE FROM pep_personas WHERE id = ?', [row.id]);
  res.json({ ok: true });
});

// ─── API: GAFI/FATF — países de alto riesgo (Art. 41) ─────────────────────────
app.get('/api/gafi', (_req, res) => {
  res.json({ paises: dbAll('SELECT * FROM gafi_paises ORDER BY lista, nombre') });
});

app.post('/api/gafi', (req, res) => {
  const { nombre, codigo, lista } = req.body;
  const nombreT = (nombre || '').trim();
  const listaT  = lista === 'negra' ? 'negra' : 'gris';
  if (!nombreT) return res.status(400).json({ error: 'El nombre del país es obligatorio.' });

  const id = dbInsert(
    'INSERT INTO gafi_paises (nombre, codigo, lista) VALUES (?,?,?)',
    [nombreT, (codigo || '').trim().toUpperCase() || null, listaT]
  );
  res.json(dbGet('SELECT * FROM gafi_paises WHERE id = ?', [id]));
});

app.delete('/api/gafi/:id', (req, res) => {
  const row = dbGet('SELECT * FROM gafi_paises WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'País no encontrado.' });
  dbExec('DELETE FROM gafi_paises WHERE id = ?', [row.id]);
  res.json({ ok: true });
});

// ─── Cálculo automático de riesgo y pendientes ───────────────────────────────
const MESES_REVISION = { alto: 12, medio: 24, bajo: 36 };

function calcularRiesgoCliente(cliente, historial, beneficiarios) {
  const razones = [];
  let nivel = 'bajo';

  const conAlerta = historial.filter(h => h.coincidencia);
  if (conAlerta.length > 0) {
    razones.push(`Coincidencia en listas de sanciones en ${conAlerta.length} búsqueda(s) AML`);
    nivel = 'alto';
  }

  const bfAlerta = beneficiarios.filter(b => b.coincidencia);
  if (bfAlerta.length > 0) {
    razones.push(`${bfAlerta.length} beneficiario(s) final(es) con coincidencia en listas (Art. 26-A)`);
    nivel = 'alto';
  }

  if (cliente.nacionalidad) {
    const gafi = chequearGAFI(cliente.nacionalidad);
    if (gafi && gafi.coincide) {
      razones.push(`País en lista ${gafi.lista === 'negra' ? 'NEGRA' : 'GRIS'} del GAFI: ${gafi.pais} (Art. 41)`);
      nivel = 'alto';
    }
  }

  const peps = pepEntries();
  if (peps.length > 0 && (cliente.nombre || cliente.cedula)) {
    const hits = buscarEnLista(peps, { nombre: cliente.nombre || '', cedula: cliente.cedula || '' });
    if (hits.length > 0) {
      razones.push('Cliente identificado como PEP o vinculado a PEP (Art. 34)');
      nivel = 'alto';
    }
  }

  if (nivel !== 'alto') {
    if (cliente.tipo === 'juridica') {
      razones.push('Persona jurídica — riesgo inherente medio (Art. 26-B)');
      nivel = 'medio';
    } else {
      razones.push('Persona natural sin indicadores de riesgo detectados');
    }
  }

  const meses = MESES_REVISION[nivel] || 36;
  const baseISO = historial.length > 0 ? historial[0].creado_en : (cliente.creado_en || new Date().toISOString());
  const base = new Date(baseISO);
  const proxima = new Date(base);
  proxima.setMonth(proxima.getMonth() + meses);
  const diasRestantes = Math.ceil((proxima - new Date()) / 86400000);

  return {
    nivel,
    razones,
    ultimaRevision : base.toISOString().split('T')[0],
    proximaRevision: proxima.toISOString().split('T')[0],
    frecuenciaMeses: meses,
    diasRestantes,
    vencido       : diasRestantes < 0,
    proximoVencer : diasRestantes >= 0 && diasRestantes <= 30,
  };
}

function diasHabiles(fechaISO, dias) {
  const d = new Date(fechaISO);
  let n = 0;
  while (n < dias) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return d.toISOString().split('T')[0];
}

function calcularPendientes(cliente, documentos, beneficiarios, riesgo) {
  const items = [];
  const esJuridica = cliente.tipo === 'juridica';

  // Campos básicos
  if (!cliente.cedula)              items.push({ tipo: 'campo', msg: 'Falta número de cédula / RUC' });
  if (!cliente.nacionalidad)        items.push({ tipo: 'campo', msg: 'Falta país / nacionalidad' });
  if (!cliente.actividad_economica) items.push({ tipo: 'campo', msg: 'Falta actividad económica (Art. 40)' });
  if (!cliente.origen_fondos)       items.push({ tipo: 'campo', msg: 'Falta declaración de origen de fondos (Art. 26)' });
  if (!cliente.direccion)           items.push({ tipo: 'campo', msg: 'Falta dirección (Art. 23)' });
  if (esJuridica && !cliente.representante_legal)
    items.push({ tipo: 'campo', msg: 'Falta representante legal / apoderado (Art. 28)' });

  // Documentos
  if (documentos.length === 0) {
    items.push({ tipo: 'documento', msg: 'Sin documentos subidos al expediente' });
  } else {
    if (!documentos.some(d => ['cedula','pasaporte'].includes(d.tipo_documento)))
      items.push({ tipo: 'documento', msg: 'Falta copia de documento de identidad (cédula o pasaporte)' });
    if (esJuridica && !documentos.some(d => d.tipo_documento === 'pacto_social'))
      items.push({ tipo: 'documento', msg: 'Falta pacto social / escritura de constitución (Art. 28)' });
  }

  // Beneficiarios finales
  if (esJuridica && beneficiarios.length === 0)
    items.push({ tipo: 'beneficiario', msg: 'Sin beneficiarios finales registrados (Art. 26-A y 28)' });

  // Aprobación de gerencia para alto riesgo (Art. 26)
  if (riesgo.nivel === 'alto') {
    const apr = cliente.aprobacion_gerencia || 'no_requerida';
    if (apr === 'no_requerida' || apr === 'pendiente')
      items.push({ tipo: 'aprobacion', msg: 'Requiere aprobación de alta gerencia — cliente de alto riesgo (Art. 26)' });
    if (apr === 'rechazada')
      items.push({ tipo: 'aprobacion', msg: 'Aprobación de gerencia RECHAZADA — relación no debe continuar (Art. 26)' });
  }

  // Revisión AML vencida / próxima
  if (riesgo.vencido)
    items.push({ tipo: 'revision', msg: `Revisión AML vencida hace ${Math.abs(riesgo.diasRestantes)} días — frecuencia: cada ${riesgo.frecuenciaMeses} meses` });
  else if (riesgo.proximoVencer)
    items.push({ tipo: 'revision', msg: `Revisión AML vence en ${riesgo.diasRestantes} día(s) — límite: ${riesgo.proximaRevision}` });

  // Conservación de registros — Art. 38 (5 años desde fin de relación)
  if (cliente.fecha_fin_relacion) {
    const fin = new Date(cliente.fecha_fin_relacion);
    const limite = new Date(fin);
    limite.setFullYear(limite.getFullYear() + 5);
    const hoy = new Date();
    const diasParaLimite = Math.ceil((limite - hoy) / 86400000);
    if (diasParaLimite < 0)
      items.push({ tipo: 'conservacion', msg: `Período de conservación de 5 años cumplido (desde ${cliente.fecha_fin_relacion}) — expediente puede archivarse (Art. 38)` });
    else if (diasParaLimite <= 90)
      items.push({ tipo: 'conservacion', msg: `Conservación obligatoria vence en ${diasParaLimite} días — ${limite.toISOString().split('T')[0]} (Art. 38)` });
  }

  return items;
}

// ─── API: Expedientes de clientes ──────────────────────────────────────────────
app.get('/api/clientes', (req, res) => {
  const q = (req.query.buscar || '').trim();
  // Filtro por tipo de expediente. Los registros antiguos (NULL) se tratan como 'cliente'.
  const expediente = req.query.expediente === 'proveedor' ? 'proveedor' : 'cliente';
  const expWhere = expediente === 'proveedor'
    ? "tipo_expediente = 'proveedor'"
    : "(tipo_expediente = 'cliente' OR tipo_expediente IS NULL)";
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = dbAll(`SELECT * FROM clientes WHERE ${expWhere} AND (nombre LIKE ? OR cedula LIKE ?) ORDER BY nombre`, [like, like]);
  } else {
    rows = dbAll(`SELECT * FROM clientes WHERE ${expWhere} ORDER BY nombre`);
  }
  res.json(rows);
});

app.get('/api/clientes/:id', (req, res) => {
  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const documentos = dbAll(
    'SELECT * FROM documentos_cliente WHERE cliente_id = ? ORDER BY subido_en DESC',
    [cliente.id]
  );
  const historial = dbAll(
    `SELECT id, fecha, hora, nombre, cedula, pais, usuario, coincidencia,
            resultado_onu, resultado_ofac, resultado_ue, resultado_pep, resultado_gafi, creado_en
     FROM consultas WHERE cliente_id = ? ORDER BY id DESC`,
    [cliente.id]
  );
  const beneficiarios = dbAll(
    'SELECT * FROM beneficiarios_finales WHERE cliente_id = ? ORDER BY id',
    [cliente.id]
  );

  const ros            = dbAll('SELECT * FROM reportes_sospechosos WHERE cliente_id = ? ORDER BY id DESC', [cliente.id]);
  const riesgoCalculado = calcularRiesgoCliente(cliente, historial, beneficiarios);
  const pendientes      = calcularPendientes(cliente, documentos, beneficiarios, riesgoCalculado);

  res.json({ cliente, documentos, historial, beneficiarios, ros, riesgoCalculado, pendientes });
});

app.post('/api/clientes', (req, res) => {
  const { nombre, cedula, tipo, nacionalidad, fechaNacimiento, notas, usuario,
          direccion, representanteLegal, actividadEconomica, origenFondos, tipoExpediente } = req.body;
  const nombreT = (nombre || '').trim();
  if (!nombreT) return res.status(400).json({ error: 'El nombre es obligatorio.' });

  const tipoT       = tipo === 'juridica' ? 'juridica' : 'natural';
  const expedienteT = tipoExpediente === 'proveedor' ? 'proveedor' : 'cliente';
  const carpeta = generarCarpetaUnica(nombreT);
  fs.mkdirSync(path.join(clientesDir, carpeta), { recursive: true });

  const id = dbInsert(
    `INSERT INTO clientes
       (nombre, cedula, tipo, nacionalidad, fecha_nacimiento, notas, carpeta, creado_por,
        direccion, representante_legal, actividad_economica, origen_fondos, tipo_expediente)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      nombreT,
      (cedula || '').trim() || null,
      tipoT,
      (nacionalidad || '').trim() || null,
      (fechaNacimiento || '').trim() || null,
      (notas || '').trim() || null,
      carpeta,
      (usuario || '').trim() || null,
      (direccion || '').trim() || null,
      (representanteLegal || '').trim() || null,
      (actividadEconomica || '').trim() || null,
      (origenFondos || '').trim() || null,
      expedienteT,
    ]
  );
  res.json(dbGet('SELECT * FROM clientes WHERE id = ?', [id]));
});

app.put('/api/clientes/:id', (req, res) => {
  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const { nombre, cedula, tipo, nacionalidad, fechaNacimiento, notas,
          nivelRiesgo, actividadEconomica, origenFondos, rangoIngresos,
          direccion, representanteLegal, fechaFinRelacion } = req.body;
  dbExec(
    `UPDATE clientes
     SET nombre = ?, cedula = ?, tipo = ?, nacionalidad = ?, fecha_nacimiento = ?, notas = ?,
         nivel_riesgo = ?, actividad_economica = ?, origen_fondos = ?, rango_ingresos = ?,
         direccion = ?, representante_legal = ?, fecha_fin_relacion = ?
     WHERE id = ?`,
    [
      (nombre ?? cliente.nombre).trim() || cliente.nombre,
      cedula ?? cliente.cedula,
      tipo === 'juridica' ? 'juridica' : 'natural',
      nacionalidad ?? cliente.nacionalidad,
      fechaNacimiento ?? cliente.fecha_nacimiento,
      notas ?? cliente.notas,
      nivelRiesgo ?? cliente.nivel_riesgo,
      actividadEconomica ?? cliente.actividad_economica,
      origenFondos ?? cliente.origen_fondos,
      rangoIngresos ?? cliente.rango_ingresos,
      direccion ?? cliente.direccion,
      representanteLegal ?? cliente.representante_legal,
      fechaFinRelacion ?? cliente.fecha_fin_relacion,
      cliente.id,
    ]
  );
  res.json(dbGet('SELECT * FROM clientes WHERE id = ?', [cliente.id]));
});

app.post('/api/clientes/:id/documentos', uploadDocCliente.single('documento'), (req, res) => {
  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo. Use imagen (JPG, PNG, WebP) o PDF.' });
  }

  const id = dbInsert(
    `INSERT INTO documentos_cliente (cliente_id, tipo_documento, nombre_original, nombre_archivo, mime, tamano, subido_por)
     VALUES (?,?,?,?,?,?,?)`,
    [
      cliente.id,
      (req.body.tipoDocumento || 'otro').trim(),
      req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      (req.body.usuario || '').trim() || null,
    ]
  );
  res.json(dbGet('SELECT * FROM documentos_cliente WHERE id = ?', [id]));
});


// ───── Beneficiarios Finales (Art. 26-A, 28 Ley 23 — personas jurídicas) ─────
app.get('/api/clientes/:id/beneficiarios', (req, res) => {
  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const beneficiarios = dbAll('SELECT * FROM beneficiarios_finales WHERE cliente_id = ? ORDER BY id', [req.params.id]);
  res.json(beneficiarios);
});

app.post('/api/clientes/:id/beneficiarios', async (req, res) => {
  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const { nombre, cedula, nacionalidad, participacion, cargo, usuario } = req.body;
  const nombreT = (nombre || '').trim();
  if (!nombreT) return res.status(400).json({ error: 'El nombre del beneficiario final es obligatorio.' });
  const cedulaT = (cedula || '').trim();
  const { fecha, hora } = ahoraPA();

  let onuHits = [], ofacHits = [], ueHits = [], pepHits = [];
  const errores = [];

  try { const lista = await fetchUNList(); onuHits = buscarEnLista(lista.entries, { nombre: nombreT, cedula: cedulaT }); }
  catch (e) { errores.push(`ONU: ${e.message}`); }

  try { const lista = await fetchOFACList(); ofacHits = buscarEnLista(lista.entries, { nombre: nombreT, cedula: cedulaT }); }
  catch (e) { errores.push(`OFAC: ${e.message}`); }

  try { const lista = await fetchEUList(); ueHits = buscarEnLista(lista.entries, { nombre: nombreT, cedula: cedulaT }); }
  catch (e) { errores.push(`UE: ${e.message}`); }

  try { pepHits = buscarEnLista(pepEntries(), { nombre: nombreT, cedula: cedulaT }); }
  catch (e) { errores.push(`PEP: ${e.message}`); }

  const hayCoincidencia = onuHits.length > 0 || ofacHits.length > 0 || ueHits.length > 0 || pepHits.length > 0;
  const resultadoTexto = (n) => (n > 0 ? `${n} coincidencia(s)` : 'Sin coincidencias');
  const detalles = JSON.stringify({ onuHits, ofacHits, ueHits, pepHits });
  const resumen = `ONU: ${resultadoTexto(onuHits.length)} | OFAC: ${resultadoTexto(ofacHits.length)} | UE: ${resultadoTexto(ueHits.length)} | PEP: ${resultadoTexto(pepHits.length)}`;

  const id = dbInsert(
    `INSERT INTO beneficiarios_finales
      (cliente_id, nombre, cedula, nacionalidad, porcentaje_participacion, cargo, resultado_listas, coincidencia, fecha_revision)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      cliente.id,
      nombreT,
      cedulaT || null,
      (nacionalidad || '').trim() || null,
      participacion != null && participacion !== '' ? Number(participacion) : null,
      (cargo || '').trim() || null,
      resumen,
      hayCoincidencia ? 1 : 0,
      `${fecha} ${hora}`,
    ]
  );

  res.json({
    ...dbGet('SELECT * FROM beneficiarios_finales WHERE id = ?', [id]),
    detalles,
    errores,
  });
});

app.delete('/api/clientes/:id/beneficiarios/:bfId', (req, res) => {
  const beneficiario = dbGet('SELECT * FROM beneficiarios_finales WHERE id = ? AND cliente_id = ?', [req.params.bfId, req.params.id]);
  if (!beneficiario) return res.status(404).json({ error: 'Beneficiario final no encontrado.' });
  dbExec('DELETE FROM beneficiarios_finales WHERE id = ?', [req.params.bfId]);
  res.json({ ok: true });
});

app.get('/api/clientes/:id/documentos/:docId/descargar', (req, res) => {
  const doc = dbGet(
    `SELECT d.*, c.carpeta AS carpeta FROM documentos_cliente d
     JOIN clientes c ON c.id = d.cliente_id
     WHERE d.id = ? AND d.cliente_id = ?`,
    [req.params.docId, req.params.id]
  );
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

  const filePath = path.join(clientesDir, doc.carpeta, doc.nombre_archivo);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado en disco.' });
  res.download(filePath, doc.nombre_original);
});

app.delete('/api/clientes/:id/documentos/:docId', (req, res) => {
  const doc = dbGet(
    `SELECT d.*, c.carpeta AS carpeta FROM documentos_cliente d
     JOIN clientes c ON c.id = d.cliente_id
     WHERE d.id = ? AND d.cliente_id = ?`,
    [req.params.docId, req.params.id]
  );
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' });

  const filePath = path.join(clientesDir, doc.carpeta, doc.nombre_archivo);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
  dbExec('DELETE FROM documentos_cliente WHERE id = ?', [doc.id]);
  res.json({ ok: true });
});

// ─── API: Reporte PDF ─────────────────────────────────────────────────────────
app.get('/api/reporte/:id', (req, res) => {
  const row = dbGet(
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.cedula AS cliente_cedula, cl.tipo AS cliente_tipo
     FROM consultas c LEFT JOIN clientes cl ON cl.id = c.cliente_id
     WHERE c.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Consulta no encontrada.' });

  let detalles = { onuHits: [], ofacHits: [], ueHits: [], pepHits: [], gafiResultado: null };
  try { detalles = JSON.parse(row.detalles); } catch {}

  let beneficiarios = [];
  if (row.cliente_id && row.cliente_tipo === 'juridica') {
    beneficiarios = dbAll('SELECT * FROM beneficiarios_finales WHERE cliente_id = ? ORDER BY id', [row.cliente_id]);
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-aml-${row.id}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  doc.pipe(res);
  generarPDF(doc, row, detalles, beneficiarios);
  doc.end();
});

// ─── Generador de PDF ─────────────────────────────────────────────────────────
function generarPDF(doc, consulta, detalles, beneficiarios = []) {
  const { onuHits = [], ofacHits = [], ueHits = [], pepHits = [], gafiResultado = null } = detalles;
  const coincidencia = consulta.coincidencia === 1 || consulta.coincidencia === true;

  const C = {
    azul      : '#003F87',
    rojo      : '#CC0000',
    verde     : '#1A7A2A',
    rojoClaro : '#FFE8E8',
    verdeClaro: '#E8FFE8',
    gris      : '#555555',
    grisCla   : '#F2F2F2',
    negro     : '#1A1A1A',
    blanco    : '#FFFFFF',
  };

  const PW = doc.page.width;

  // ── Encabezado ──
  doc.rect(50, 45, PW - 100, 90).fill(C.azul);

  doc.fillColor(C.blanco).font('Helvetica-Bold').fontSize(17)
     .text('REPORTE DE CONSULTA AML/FT', 70, 60, { width: PW - 140 });

  doc.font('Helvetica').fontSize(9)
     .text('Sistema de Prevención de Lavado de Dinero y Financiamiento del Terrorismo', 70, 83)
     .text('Ley 23 de 2015 de la República de Panamá', 70, 96);

  doc.fontSize(8)
     .text(
       `N° de Consulta: ${consulta.id}   |   Fecha: ${consulta.fecha}   |   Hora: ${consulta.hora}`,
       70, 113, { width: PW - 140 }
     );

  // ── Veredicto ──
  const verdColor = coincidencia ? C.rojo   : C.verde;
  const verdTxt   = coincidencia ? 'COINCIDENCIA DETECTADA - ALERTA AML/FT'
                                 : 'SIN COINCIDENCIAS EN LISTAS DE SANCIONES';
  doc.rect(50, 148, PW - 100, 44).fill(verdColor);
  doc.fillColor(C.blanco).font('Helvetica-Bold').fontSize(14)
     .text(verdTxt, 60, 160, { align: 'center', width: PW - 120 });

  // ── Datos de la consulta ──
  let y = 210;

  doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(11)
     .text('DATOS DE LA CONSULTA', 50, y);
  y += 16;
  doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor(C.azul).lineWidth(1.5).stroke();
  y += 12;

  const campos = [
    ['Nombre buscado',      consulta.nombre  || 'No especificado'],
    ['Cédula / ID buscado', consulta.cedula  || 'No especificado'],
    ['País / Nacionalidad', consulta.pais    || 'No especificado'],
    ['Tipo de búsqueda',    consulta.tipo_busqueda || '-'],
    ['Realizado por',       consulta.usuario || 'No identificado'],
    ['Cliente vinculado',   consulta.cliente_nombre
        ? `${consulta.cliente_nombre}${consulta.cliente_cedula ? ' (' + consulta.cliente_cedula + ')' : ''}`
        : 'Sin vincular a un expediente'],
    ['IP del solicitante',  consulta.ip_cliente    || '-'],
  ];

  for (const [label, valor] of campos) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.gris).text(`${label}:`, 55, y, { width: 130, continued: false });
    doc.font('Helvetica').fontSize(9).fillColor(C.negro).text(valor, 190, y, { width: PW - 240 });
    y = doc.y + 5;
  }

  y += 6;

  // ── Resultados por lista, cada una con su artículo de la Ley 23 de 2015 ──
  y = seccionResultados(doc, y, 'LISTA CONSOLIDADA DE SANCIONES ONU (Art. 41)', onuHits, C, PW);
  y += 10;
  y = seccionResultados(doc, y, 'LISTA OFAC SDN — DEPARTAMENTO DEL TESORO EE.UU. (Art. 41)', ofacHits, C, PW);
  y += 10;
  y = seccionResultados(doc, y, 'SANCIONES FINANCIERAS DE LA UNIÓN EUROPEA (Art. 41)', ueHits, C, PW);
  y += 10;
  y = seccionResultados(doc, y, 'PERSONAS EXPUESTAS POLÍTICAMENTE — PEP PANAMÁ (Art. 34)', pepHits, C, PW);
  y += 10;

  // ── Alerta GAFI/FATF ──
  verificarEspacio(doc, y, 60);
  y = doc.y + 5;
  doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(11)
     .text('PAÍSES DE ALTO RIESGO GAFI/FATF (Art. 41)', 50, y);
  y += 16;
  doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor('#AAAAAA').lineWidth(0.5).stroke();
  y += 10;

  if (!gafiResultado) {
    doc.rect(50, y, PW - 100, 28).fill(C.grisCla);
    doc.fillColor(C.gris).font('Helvetica-Bold').fontSize(9)
       .text('—  No se proporcionó país/nacionalidad para esta evaluación.', 60, y + 9);
    y += 36;
  } else if (gafiResultado.coincide) {
    doc.rect(50, y, PW - 100, 38).fill(C.rojoClaro);
    doc.fillColor(C.rojo).font('Helvetica-Bold').fontSize(9.5)
       .text(`⚠  País "${gafiResultado.pais}" en LISTA ${gafiResultado.lista === 'negra' ? 'NEGRA' : 'GRIS'} del GAFI.`, 60, y + 8);
    doc.font('Helvetica-Bold').fontSize(9)
       .text('DILIGENCIA AMPLIADA REQUERIDA — Ley 23 de 2015, Art. 41.', 60, y + 22);
    y += 46;
  } else {
    doc.rect(50, y, PW - 100, 28).fill(C.verdeClaro);
    doc.fillColor(C.verde).font('Helvetica-Bold').fontSize(9)
       .text(`✓  País "${gafiResultado.paisConsultado || ''}" no está en las listas GAFI de alto riesgo.`, 60, y + 9);
    y += 36;
  }

  y += 14;

  // ── Beneficiarios Finales (Art. 26-A, 28 — solo jurídicas) ──
  if (beneficiarios.length > 0) {
    verificarEspacio(doc, y, 60);
    y = doc.y + 5;
    doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(11)
       .text('BENEFICIARIOS FINALES (Art. 26-A y 28, Ley 23 de 2015)', 50, y);
    y += 16;
    doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor('#AAAAAA').lineWidth(0.5).stroke();
    y += 10;

    for (const bf of beneficiarios) {
      verificarEspacio(doc, y, 55);
      y = doc.y + 4;
      const bfColor = bf.coincidencia ? C.rojoClaro : C.verdeClaro;
      const bfBorde = bf.coincidencia ? C.rojo : C.verde;
      doc.rect(50, y, PW - 100, 44).fill(bfColor);
      doc.moveTo(50, y).lineTo(50, y + 44).strokeColor(bfBorde).lineWidth(4).stroke();

      doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(8.5)
         .text(bf.nombre, 60, y + 7, { width: PW - 180, continued: false });
      doc.font('Helvetica').fontSize(7.5)
         .text([
           bf.cedula        ? `Cédula: ${bf.cedula}`                                    : null,
           bf.nacionalidad  ? `Nac.: ${bf.nacionalidad}`                                : null,
           bf.porcentaje_participacion != null ? `Part.: ${bf.porcentaje_participacion}%` : null,
           bf.cargo         ? `Cargo: ${bf.cargo}`                                      : null,
         ].filter(Boolean).join('   '), 60, y + 20, { width: PW - 180 });

      const bfVeredicto = bf.coincidencia ? '⚠ COINCIDENCIA EN LISTAS' : '✓ Sin coincidencias';
      doc.fillColor(bf.coincidencia ? C.rojo : C.verde).font('Helvetica-Bold').fontSize(7.5)
         .text(bfVeredicto, PW - 170, y + 10, { width: 120, align: 'right' });
      if (bf.resultado_listas) {
        doc.fillColor(C.gris).font('Helvetica').fontSize(6.5)
           .text(bf.resultado_listas, PW - 170, y + 24, { width: 120, align: 'right' });
      }
      y += 52;
    }
    y += 6;
  }

  // ── Conclusión ──
  verificarEspacio(doc, y, 80);
  y = doc.y + 5;

  doc.rect(50, y, PW - 100, 55).fill(C.grisCla);
  doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(10)
     .text('CONCLUSIÓN DEL SISTEMA', 60, y + 8);
  doc.font('Helvetica').fontSize(9)
     .text(
       coincidencia
         ? 'ALERTA: Se encontraron coincidencias en listas de sanciones, PEP o GAFI. El Oficial de Cumplimiento debe revisar y escalar según los procedimientos establecidos en la Política AML/FT de la institución y la Ley 23 de 2015.'
         : 'La búsqueda no arrojó coincidencias en las listas consultadas. Esto no exime de la obligación de due diligence continuo conforme a la Ley 23 de 2015.',
       60, y + 22, { width: PW - 120 }
     );
  y += 70;

  // ── Pie de página ──
  const footY = doc.page.height - 75;
  doc.moveTo(50, footY).lineTo(PW - 50, footY).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(6.5).fillColor(C.gris)
     .text(
       'Este reporte es generado automáticamente por el Sistema de Cumplimiento AML/FT conforme a la Ley 23 de 27 de abril de 2015 de Panamá. ' +
       'La información proviene de fuentes públicas oficiales (ONU, OFAC, Unión Europea) y de los registros de PEP y GAFI mantenidos por la institución. ' +
       'Las coincidencias deben ser verificadas manualmente por el Oficial de Cumplimiento designado antes de tomar cualquier acción.',
       50, footY + 8, { width: PW - 100, align: 'justify' }
     );
  doc.text(
    `Generado: ${new Date().toLocaleString('es-PA', { timeZone: 'America/Panama' })}  |  Sistema AML/FT  |  Ley 23 de 2015 - República de Panamá`,
    50, footY + 48, { align: 'center', width: PW - 100 }
  );
}

function seccionResultados(doc, y, titulo, hits, C, PW) {
  verificarEspacio(doc, y, 60);
  y = doc.y + 5;

  doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(11).text(titulo, 50, y);
  y += 16;
  doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor('#AAAAAA').lineWidth(0.5).stroke();
  y += 10;

  if (hits.length === 0) {
    doc.rect(50, y, PW - 100, 28).fill(C.verdeClaro);
    doc.fillColor(C.verde).font('Helvetica-Bold').fontSize(9)
       .text('✓  Sin coincidencias encontradas en esta lista.', 60, y + 9);
    y += 36;
  } else {
    doc.rect(50, y, PW - 100, 28).fill(C.rojoClaro);
    doc.fillColor(C.rojo).font('Helvetica-Bold').fontSize(9)
       .text(`⚠  ${hits.length} coincidencia(s) encontrada(s).`, 60, y + 9);
    y += 36;

    for (const hit of hits) {
      verificarEspacio(doc, y, 80);
      y = doc.y + 4;

      doc.rect(50, y, PW - 100, 2).fill(C.rojo);
      y += 6;

      const blockH = 65;
      doc.rect(50, y, PW - 100, blockH).fill(C.rojoClaro);

      doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(8.5)
         .text(`Tipo: ${hit.tipo}`, 58, y + 7, { continued: true })
         .text(`   Fuente: ${hit.fuente}`, { continued: true })
         .text(`   Ref/ID: ${hit.refNumero || hit.id}`);

      doc.font('Helvetica').fontSize(8)
         .text(`Nombre(s) en lista: ${hit.nombres.slice(0, 3).join(' / ')}`, 58, y + 21, { width: PW - 120 });

      if (hit.listaTipo) {
        doc.text(`Lista: ${hit.listaTipo}`, 58, y + 33);
      }
      if (hit.programas) {
        doc.text(`Programas: ${hit.programas}`, 58, y + 33);
      }

      doc.fillColor(C.rojo).font('Helvetica-Bold').fontSize(8)
         .text(`Razón de coincidencia: ${hit.razonMatch}`, 58, y + 47, { width: PW - 120 });

      if (hit.listedOn) {
        doc.fillColor(C.gris).font('Helvetica').fontSize(7.5)
           .text(`Incluido en lista: ${hit.listedOn}`, PW - 180, y + 7, { width: 130, align: 'right' });
      }

      y += blockH + 10;
    }
  }

  doc.y = y;
  return y;
}

function verificarEspacio(doc, y, necesario) {
  if (y + necesario > doc.page.height - 90) {
    doc.addPage();
    doc.y = 60;
  }
}

// ─── API: Aprobación de alta gerencia (Art. 26) ──────────────────────────────
app.put('/api/clientes/:id/aprobacion', (req, res) => {
  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const { estado, aprobadoPor, notas } = req.body;
  const estadosValidos = ['pendiente', 'aprobada', 'rechazada', 'no_requerida'];
  if (!estadosValidos.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  const { fecha } = ahoraPA();
  dbExec(
    'UPDATE clientes SET aprobacion_gerencia = ?, aprobacion_fecha = ?, aprobacion_por = ?, aprobacion_notas = ? WHERE id = ?',
    [estado, fecha, (aprobadoPor || '').trim() || null, (notas || '').trim() || null, cliente.id]
  );
  res.json(dbGet('SELECT * FROM clientes WHERE id = ?', [cliente.id]));
});

// ─── API: Reportes de Operaciones Sospechosas — ROS (Art. 42) ────────────────
app.get('/api/ros', (req, res) => {
  const rows = dbAll(
    `SELECT r.*, c.nombre AS cliente_nombre
     FROM reportes_sospechosos r
     LEFT JOIN clientes c ON c.id = r.cliente_id
     ORDER BY r.id DESC`
  );
  res.json(rows);
});

app.get('/api/ros/:id', (req, res) => {
  const row = dbGet(
    `SELECT r.*, c.nombre AS cliente_nombre FROM reportes_sospechosos r
     LEFT JOIN clientes c ON c.id = r.cliente_id WHERE r.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'ROS no encontrado.' });
  res.json(row);
});

app.post('/api/ros', (req, res) => {
  const { clienteId, fechaDeteccion, descripcion, monto, tipoOperacion, reportadoPor, notas } = req.body;
  const fechaD = (fechaDeteccion || '').trim();
  const descT  = (descripcion || '').trim();
  if (!fechaD) return res.status(400).json({ error: 'La fecha de detección es obligatoria.' });
  if (!descT)  return res.status(400).json({ error: 'La descripción es obligatoria.' });

  const fechaLimite = diasHabiles(fechaD + 'T00:00:00', 3);
  const id = dbInsert(
    `INSERT INTO reportes_sospechosos
       (cliente_id, fecha_deteccion, fecha_limite, descripcion, monto, tipo_operacion, reportado_por, notas, estado, creado_por)
     VALUES (?,?,?,?,?,?,?,?,'borrador',?)`,
    [
      clienteId || null,
      fechaD,
      fechaLimite,
      descT,
      (monto || '').trim() || null,
      (tipoOperacion || '').trim() || null,
      (reportadoPor || '').trim() || null,
      (notas || '').trim() || null,
      (reportadoPor || '').trim() || null,
    ]
  );
  res.json(dbGet('SELECT * FROM reportes_sospechosos WHERE id = ?', [id]));
});

app.put('/api/ros/:id', (req, res) => {
  const ros = dbGet('SELECT * FROM reportes_sospechosos WHERE id = ?', [req.params.id]);
  if (!ros) return res.status(404).json({ error: 'ROS no encontrado.' });
  const { estado, fechaReporteUaf, numeroRefUaf, reportadoPor, notas, monto, tipoOperacion, descripcion } = req.body;
  dbExec(
    `UPDATE reportes_sospechosos
     SET estado = ?, fecha_reporte_uaf = ?, numero_ref_uaf = ?, reportado_por = ?,
         notas = ?, monto = ?, tipo_operacion = ?, descripcion = ?
     WHERE id = ?`,
    [
      estado ?? ros.estado,
      fechaReporteUaf ?? ros.fecha_reporte_uaf,
      numeroRefUaf ?? ros.numero_ref_uaf,
      reportadoPor ?? ros.reportado_por,
      notas ?? ros.notas,
      monto ?? ros.monto,
      tipoOperacion ?? ros.tipo_operacion,
      descripcion ?? ros.descripcion,
      ros.id,
    ]
  );
  res.json(dbGet('SELECT * FROM reportes_sospechosos WHERE id = ?', [ros.id]));
});

app.delete('/api/ros/:id', (req, res) => {
  const ros = dbGet('SELECT * FROM reportes_sospechosos WHERE id = ?', [req.params.id]);
  if (!ros) return res.status(404).json({ error: 'ROS no encontrado.' });
  dbExec('DELETE FROM reportes_sospechosos WHERE id = ?', [ros.id]);
  res.json({ ok: true });
});

// ─── API: Dashboard de alertas y pendientes ──────────────────────────────────
app.get('/api/alertas', (_req, res) => {
  const clientes = dbAll('SELECT * FROM clientes ORDER BY nombre');
  const resultado = clientes.map(c => {
    const documentos    = dbAll('SELECT tipo_documento FROM documentos_cliente WHERE cliente_id = ?', [c.id]);
    const historial     = dbAll(
      'SELECT id, coincidencia, creado_en FROM consultas WHERE cliente_id = ? ORDER BY id DESC',
      [c.id]
    );
    const beneficiarios = dbAll('SELECT coincidencia FROM beneficiarios_finales WHERE cliente_id = ?', [c.id]);
    const riesgo        = calcularRiesgoCliente(c, historial, beneficiarios);
    const pendientes    = calcularPendientes(c, documentos, beneficiarios, riesgo);
    return { id: c.id, nombre: c.nombre, tipo: c.tipo, tipoExpediente: c.tipo_expediente || 'cliente', riesgoCalculado: riesgo, pendientes };
  });

  resultado.sort((a, b) => {
    const score = r => (r.riesgoCalculado.vencido ? 3 : r.riesgoCalculado.proximoVencer ? 2 : 0) + r.pendientes.length * 0.1;
    return score(b) - score(a);
  });

  res.json(resultado);
});

// ═════════════════════════════════════════════════════════════════════════════
//  CONOZCA A SU EMPLEADO (KYE) — Decreto Ejecutivo 35 de 2022, Ley 23 de 2015
// ═════════════════════════════════════════════════════════════════════════════

// Tamiza un empleado contra todas las listas y devuelve el resumen + coincidencia.
async function tamizarPersona(nombre, cedula) {
  const nombreT = (nombre || '').trim();
  const cedulaT = (cedula || '').trim();
  let onuHits = [], ofacHits = [], ueHits = [], pepHits = [];
  const errores = [];
  try { const l = await fetchUNList();   onuHits  = buscarEnLista(l.entries, { nombre: nombreT, cedula: cedulaT }); } catch (e) { errores.push(`ONU: ${e.message}`); }
  try { const l = await fetchOFACList(); ofacHits = buscarEnLista(l.entries, { nombre: nombreT, cedula: cedulaT }); } catch (e) { errores.push(`OFAC: ${e.message}`); }
  try { const l = await fetchEUList();   ueHits   = buscarEnLista(l.entries, { nombre: nombreT, cedula: cedulaT }); } catch (e) { errores.push(`UE: ${e.message}`); }
  try { pepHits = buscarEnLista(pepEntries(), { nombre: nombreT, cedula: cedulaT }); } catch (e) { errores.push(`PEP: ${e.message}`); }
  const hayCoincidencia = onuHits.length + ofacHits.length + ueHits.length + pepHits.length > 0;
  const t = (n) => (n > 0 ? `${n} coincidencia(s)` : 'Sin coincidencias');
  const resumen = `ONU: ${t(onuHits.length)} | OFAC: ${t(ofacHits.length)} | UE: ${t(ueHits.length)} | PEP: ${t(pepHits.length)}`;
  return { hayCoincidencia, resumen, pepHits, errores };
}

app.get('/api/empleados', (req, res) => {
  const q = (req.query.buscar || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = dbAll('SELECT * FROM empleados WHERE nombre LIKE ? OR cedula LIKE ? OR cargo LIKE ? ORDER BY nombre', [like, like, like]);
  } else {
    rows = dbAll('SELECT * FROM empleados ORDER BY nombre');
  }
  res.json(rows);
});

app.get('/api/empleados/:id', (req, res) => {
  const empleado = dbGet('SELECT * FROM empleados WHERE id = ?', [req.params.id]);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });
  // Pendientes KYE: campos mínimos del Decreto 35
  const pendientes = [];
  if (!empleado.cedula)        pendientes.push({ tipo: 'campo', msg: 'Falta cédula / identificación del empleado.' });
  if (!empleado.cargo)         pendientes.push({ tipo: 'campo', msg: 'Falta cargo / posición.' });
  if (!empleado.fecha_ingreso) pendientes.push({ tipo: 'campo', msg: 'Falta fecha de ingreso.' });
  if (!empleado.declaracion_pep) pendientes.push({ tipo: 'campo', msg: 'Falta declaración PEP del empleado.' });
  if (!empleado.fecha_revision)  pendientes.push({ tipo: 'revision', msg: 'Empleado aún no tamizado en listas de sanciones.' });
  if (empleado.coincidencia)     pendientes.push({ tipo: 'revision', msg: '⚠ Coincidencia en listas — requiere análisis del Oficial de Cumplimiento.' });
  if (empleado.nivel_riesgo === 'pendiente') pendientes.push({ tipo: 'campo', msg: 'Falta confirmar nivel de riesgo del empleado.' });
  res.json({ empleado, pendientes });
});

app.post('/api/empleados', async (req, res) => {
  const { nombre, cedula, cargo, departamento, fechaIngreso, tipoContrato, salarioRango,
          esPep, declaracionPep, accesoSensible, notas, usuario } = req.body;
  const nombreT = (nombre || '').trim();
  if (!nombreT) return res.status(400).json({ error: 'El nombre del empleado es obligatorio.' });

  const { fecha, hora } = ahoraPA();
  const tam = await tamizarPersona(nombreT, cedula);
  // Riesgo automático del empleado: coincidencia o PEP o acceso a áreas sensibles → alto
  let nivel = 'bajo';
  if (tam.hayCoincidencia || tam.pepHits.length > 0 || String(esPep) === '1' || esPep === true) nivel = 'alto';
  else if (String(accesoSensible) === '1' || accesoSensible === true) nivel = 'medio';

  const id = dbInsert(
    `INSERT INTO empleados
       (nombre, cedula, cargo, departamento, fecha_ingreso, tipo_contrato, salario_rango,
        es_pep, declaracion_pep, acceso_sensible, nivel_riesgo, resultado_listas, coincidencia,
        fecha_revision, notas, creado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      nombreT,
      (cedula || '').trim() || null,
      (cargo || '').trim() || null,
      (departamento || '').trim() || null,
      (fechaIngreso || '').trim() || null,
      (tipoContrato || '').trim() || null,
      (salarioRango || '').trim() || null,
      (String(esPep) === '1' || esPep === true) ? 1 : 0,
      (declaracionPep || '').trim() || null,
      (String(accesoSensible) === '1' || accesoSensible === true) ? 1 : 0,
      nivel,
      tam.resumen,
      tam.hayCoincidencia ? 1 : 0,
      `${fecha} ${hora}`,
      (notas || '').trim() || null,
      (usuario || '').trim() || null,
    ]
  );
  res.json({ ...dbGet('SELECT * FROM empleados WHERE id = ?', [id]), coincidencia: tam.hayCoincidencia ? 1 : 0, errores: tam.errores });
});

app.put('/api/empleados/:id', async (req, res) => {
  const empleado = dbGet('SELECT * FROM empleados WHERE id = ?', [req.params.id]);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });

  const { nombre, cedula, cargo, departamento, fechaIngreso, fechaSalida, tipoContrato,
          salarioRango, esPep, declaracionPep, accesoSensible, nivelRiesgo, notas, retamizar } = req.body;

  let resultado = empleado.resultado_listas;
  let coincidencia = empleado.coincidencia;
  let fechaRevision = empleado.fecha_revision;
  // Re-tamizar si se pide explícitamente o si cambió el nombre/cédula
  const nombreNuevo = nombre !== undefined ? (nombre || '').trim() : empleado.nombre;
  const cedulaNueva = cedula !== undefined ? (cedula || '').trim() : empleado.cedula;
  if (retamizar || nombreNuevo !== empleado.nombre || cedulaNueva !== (empleado.cedula || '')) {
    const tam = await tamizarPersona(nombreNuevo, cedulaNueva);
    resultado = tam.resumen;
    coincidencia = tam.hayCoincidencia ? 1 : 0;
    const { fecha, hora } = ahoraPA();
    fechaRevision = `${fecha} ${hora}`;
  }

  dbExec(
    `UPDATE empleados
     SET nombre = ?, cedula = ?, cargo = ?, departamento = ?, fecha_ingreso = ?, fecha_salida = ?,
         tipo_contrato = ?, salario_rango = ?, es_pep = ?, declaracion_pep = ?, acceso_sensible = ?,
         nivel_riesgo = ?, resultado_listas = ?, coincidencia = ?, fecha_revision = ?, notas = ?
     WHERE id = ?`,
    [
      nombreNuevo || empleado.nombre,
      cedulaNueva || null,
      cargo !== undefined ? (cargo || '').trim() || null : empleado.cargo,
      departamento !== undefined ? (departamento || '').trim() || null : empleado.departamento,
      fechaIngreso !== undefined ? (fechaIngreso || '').trim() || null : empleado.fecha_ingreso,
      fechaSalida !== undefined ? (fechaSalida || '').trim() || null : empleado.fecha_salida,
      tipoContrato !== undefined ? (tipoContrato || '').trim() || null : empleado.tipo_contrato,
      salarioRango !== undefined ? (salarioRango || '').trim() || null : empleado.salario_rango,
      esPep !== undefined ? ((String(esPep) === '1' || esPep === true) ? 1 : 0) : empleado.es_pep,
      declaracionPep !== undefined ? (declaracionPep || '').trim() || null : empleado.declaracion_pep,
      accesoSensible !== undefined ? ((String(accesoSensible) === '1' || accesoSensible === true) ? 1 : 0) : empleado.acceso_sensible,
      nivelRiesgo !== undefined ? nivelRiesgo : empleado.nivel_riesgo,
      resultado,
      coincidencia,
      fechaRevision,
      notas !== undefined ? (notas || '').trim() || null : empleado.notas,
      empleado.id,
    ]
  );
  res.json(dbGet('SELECT * FROM empleados WHERE id = ?', [empleado.id]));
});

app.delete('/api/empleados/:id', (req, res) => {
  const empleado = dbGet('SELECT * FROM empleados WHERE id = ?', [req.params.id]);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });
  dbExec('DELETE FROM empleados WHERE id = ?', [empleado.id]);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
//  OPERACIONES INUSUALES — Decreto Ejecutivo 35 de 2022 (paso previo al ROS)
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/inusuales', (req, res) => {
  const cond = [];
  const params = [];
  if (req.query.clienteId) { cond.push('o.cliente_id = ?'); params.push(req.query.clienteId); }
  if (req.query.estado)    { cond.push('o.estado = ?');     params.push(req.query.estado); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = dbAll(
    `SELECT o.*, c.nombre AS cliente_nombre FROM operaciones_inusuales o
     LEFT JOIN clientes c ON c.id = o.cliente_id ${where} ORDER BY o.id DESC`,
    params
  );
  res.json(rows);
});

app.get('/api/inusuales/:id', (req, res) => {
  const row = dbGet(
    `SELECT o.*, c.nombre AS cliente_nombre FROM operaciones_inusuales o
     LEFT JOIN clientes c ON c.id = o.cliente_id WHERE o.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Operación inusual no encontrada.' });
  res.json(row);
});

app.post('/api/inusuales', (req, res) => {
  const { clienteId, fechaDeteccion, tipoOperacion, monto, descripcion, detectadaPor, notas, usuario } = req.body;
  const fechaD = (fechaDeteccion || '').trim();
  const descT  = (descripcion || '').trim();
  if (!fechaD) return res.status(400).json({ error: 'La fecha de detección es obligatoria.' });
  if (!descT)  return res.status(400).json({ error: 'La descripción es obligatoria.' });

  const id = dbInsert(
    `INSERT INTO operaciones_inusuales
       (cliente_id, fecha_deteccion, tipo_operacion, monto, descripcion, detectada_por, estado, notas, creado_por)
     VALUES (?,?,?,?,?,?,'pendiente_analisis',?,?)`,
    [
      clienteId || null,
      fechaD,
      (tipoOperacion || '').trim() || null,
      (monto || '').trim() || null,
      descT,
      (detectadaPor || '').trim() || null,
      (notas || '').trim() || null,
      (usuario || '').trim() || null,
    ]
  );
  res.json(dbGet('SELECT * FROM operaciones_inusuales WHERE id = ?', [id]));
});

// Analizar: descartar o escalar a ROS. Al escalar se crea el ROS automáticamente.
app.put('/api/inusuales/:id', (req, res) => {
  const op = dbGet('SELECT * FROM operaciones_inusuales WHERE id = ?', [req.params.id]);
  if (!op) return res.status(404).json({ error: 'Operación inusual no encontrada.' });

  const { estado, analisis, analizadaPor, notas } = req.body;
  const { fecha, hora } = ahoraPA();
  let rosId = op.ros_id;

  // Si se escala a ROS y aún no existe, crear el ROS vinculado
  if (estado === 'escalada_ros' && !op.ros_id) {
    const fechaLimite = diasHabiles(op.fecha_deteccion + 'T00:00:00', 3);
    rosId = dbInsert(
      `INSERT INTO reportes_sospechosos
         (cliente_id, fecha_deteccion, fecha_limite, descripcion, monto, tipo_operacion, reportado_por, notas, estado, creado_por)
       VALUES (?,?,?,?,?,?,?,?,'borrador',?)`,
      [
        op.cliente_id || null,
        op.fecha_deteccion,
        fechaLimite,
        `[Escalado de operación inusual #${op.id}] ${op.descripcion}` + (analisis ? ` — Análisis: ${analisis}` : ''),
        op.monto,
        op.tipo_operacion,
        (analizadaPor || '').trim() || null,
        op.notas,
        (analizadaPor || '').trim() || null,
      ]
    );
  }

  dbExec(
    `UPDATE operaciones_inusuales
     SET estado = ?, analisis = ?, analizada_por = ?, fecha_analisis = ?, ros_id = ?, notas = ?
     WHERE id = ?`,
    [
      estado ?? op.estado,
      analisis ?? op.analisis,
      (analizadaPor || '').trim() || op.analizada_por,
      (estado === 'descartada' || estado === 'escalada_ros') ? `${fecha} ${hora}` : op.fecha_analisis,
      rosId || null,
      notas ?? op.notas,
      op.id,
    ]
  );
  res.json({ ...dbGet('SELECT * FROM operaciones_inusuales WHERE id = ?', [op.id]), rosCreado: rosId && !op.ros_id ? rosId : null });
});

app.delete('/api/inusuales/:id', (req, res) => {
  const op = dbGet('SELECT * FROM operaciones_inusuales WHERE id = ?', [req.params.id]);
  if (!op) return res.status(404).json({ error: 'Operación inusual no encontrada.' });
  dbExec('DELETE FROM operaciones_inusuales WHERE id = ?', [op.id]);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
//  CONGELAMIENTO PREVENTIVO — Art. 41 Ley 23; Res. ONU 1267/1373/1718
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/congelamientos', (_req, res) => {
  const rows = dbAll(
    `SELECT g.*, c.nombre AS cliente_nombre FROM congelamientos g
     LEFT JOIN clientes c ON c.id = g.cliente_id ORDER BY g.id DESC`
  );
  res.json(rows);
});

app.get('/api/congelamientos/:id', (req, res) => {
  const row = dbGet(
    `SELECT g.*, c.nombre AS cliente_nombre FROM congelamientos g
     LEFT JOIN clientes c ON c.id = g.cliente_id WHERE g.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Congelamiento no encontrado.' });
  res.json(row);
});

app.post('/api/congelamientos', (req, res) => {
  const { clienteId, nombrePersona, cedula, listaOrigen, referenciaLista, fechaDeteccion,
          montoCongelado, descripcionBienes, notas, usuario } = req.body;
  const nombreT = (nombrePersona || '').trim();
  if (!nombreT) return res.status(400).json({ error: 'El nombre de la persona/entidad es obligatorio.' });
  const { fecha } = ahoraPA();

  const id = dbInsert(
    `INSERT INTO congelamientos
       (cliente_id, nombre_persona, cedula, lista_origen, referencia_lista, fecha_deteccion,
        monto_congelado, descripcion_bienes, estado, notas, creado_por)
     VALUES (?,?,?,?,?,?,?,?,'pendiente',?,?)`,
    [
      clienteId || null,
      nombreT,
      (cedula || '').trim() || null,
      (listaOrigen || '').trim() || null,
      (referenciaLista || '').trim() || null,
      (fechaDeteccion || '').trim() || fecha,
      (montoCongelado || '').trim() || null,
      (descripcionBienes || '').trim() || null,
      (notas || '').trim() || null,
      (usuario || '').trim() || null,
    ]
  );
  res.json(dbGet('SELECT * FROM congelamientos WHERE id = ?', [id]));
});

app.put('/api/congelamientos/:id', (req, res) => {
  const g = dbGet('SELECT * FROM congelamientos WHERE id = ?', [req.params.id]);
  if (!g) return res.status(404).json({ error: 'Congelamiento no encontrado.' });
  const { estado, fechaCongelamiento, montoCongelado, descripcionBienes, reportadoA,
          fechaReporte, numeroRef, notas } = req.body;
  dbExec(
    `UPDATE congelamientos
     SET estado = ?, fecha_congelamiento = ?, monto_congelado = ?, descripcion_bienes = ?,
         reportado_a = ?, fecha_reporte = ?, numero_ref = ?, notas = ?
     WHERE id = ?`,
    [
      estado ?? g.estado,
      fechaCongelamiento ?? g.fecha_congelamiento,
      montoCongelado ?? g.monto_congelado,
      descripcionBienes ?? g.descripcion_bienes,
      reportadoA ?? g.reportado_a,
      fechaReporte ?? g.fecha_reporte,
      numeroRef ?? g.numero_ref,
      notas ?? g.notas,
      g.id,
    ]
  );
  res.json(dbGet('SELECT * FROM congelamientos WHERE id = ?', [g.id]));
});

app.delete('/api/congelamientos/:id', (req, res) => {
  const g = dbGet('SELECT * FROM congelamientos WHERE id = ?', [req.params.id]);
  if (!g) return res.status(404).json({ error: 'Congelamiento no encontrado.' });
  dbExec('DELETE FROM congelamientos WHERE id = ?', [g.id]);
  res.json({ ok: true });
});

// ─── Manejo de errores (multer / destinos inválidos) ──────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor.' });
});

// ─── Inicio del servidor ──────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('\n══════════════════════════════════════════════════');
    console.log('   Sistema AML/FT - Ley 23 de 2015 - Panamá');
    console.log('══════════════════════════════════════════════════');
    console.log(`   URL:      http://localhost:${PORT}`);
    console.log(`   BD:       ${DB_FILE}`);
    console.log('══════════════════════════════════════════════════\n');
    console.log('Precargando listas de sanciones en segundo plano...\n');

    fetchUNList().catch(e   => console.error('[ONU]  Error al precargar:', e.message));
    fetchOFACList().catch(e => console.error('[OFAC] Error al precargar:', e.message));
    fetchEUList().catch(e   => console.error('[UE]   Error al precargar (puede requerir carga manual):', e.message));
  });
}).catch(err => {
  console.error('Error al inicializar la base de datos:', err);
  process.exit(1);
});
