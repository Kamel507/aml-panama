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

// Migración: nivel de riesgo y perfil financiero/transaccional para clientes (Art. 26-B, 40 Ley 23)
agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN nivel_riesgo TEXT DEFAULT 'pendiente'");
agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN factores_riesgo TEXT");
agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN actividad_economica TEXT");
agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN origen_fondos TEXT");
agregarColumnaSiNoExiste("ALTER TABLE clientes ADD COLUMN rango_ingresos TEXT");

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

// ─── API: Expedientes de clientes ──────────────────────────────────────────────
app.get('/api/clientes', (req, res) => {
  const q = (req.query.buscar || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = dbAll('SELECT * FROM clientes WHERE nombre LIKE ? OR cedula LIKE ? ORDER BY nombre', [like, like]);
  } else {
    rows = dbAll('SELECT * FROM clientes ORDER BY nombre');
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
            resultado_onu, resultado_ofac, resultado_ue, resultado_pep, resultado_gafi
     FROM consultas WHERE cliente_id = ? ORDER BY id DESC`,
    [cliente.id]
  );

  res.json({ cliente, documentos, historial });
});

app.post('/api/clientes', (req, res) => {
  const { nombre, cedula, tipo, nacionalidad, fechaNacimiento, notas, usuario } = req.body;
  const nombreT = (nombre || '').trim();
  if (!nombreT) return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });

  const tipoT   = tipo === 'juridica' ? 'juridica' : 'natural';
  const carpeta = generarCarpetaUnica(nombreT);
  fs.mkdirSync(path.join(clientesDir, carpeta), { recursive: true });

  const id = dbInsert(
    `INSERT INTO clientes (nombre, cedula, tipo, nacionalidad, fecha_nacimiento, notas, carpeta, creado_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      nombreT,
      (cedula || '').trim() || null,
      tipoT,
      (nacionalidad || '').trim() || null,
      (fechaNacimiento || '').trim() || null,
      (notas || '').trim() || null,
      carpeta,
      (usuario || '').trim() || null,
    ]
  );
  res.json(dbGet('SELECT * FROM clientes WHERE id = ?', [id]));
});

app.put('/api/clientes/:id', (req, res) => {
  const cliente = dbGet('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const { nombre, cedula, tipo, nacionalidad, fechaNacimiento, notas } = req.body;
  dbExec(
    `UPDATE clientes
     SET nombre = ?, cedula = ?, tipo = ?, nacionalidad = ?, fecha_nacimiento = ?, notas = ?
     WHERE id = ?`,
    [
      (nombre ?? cliente.nombre).trim() || cliente.nombre,
      cedula ?? cliente.cedula,
      tipo === 'juridica' ? 'juridica' : 'natural',
      nacionalidad ?? cliente.nacionalidad,
      fechaNacimiento ?? cliente.fecha_nacimiento,
      notas ?? cliente.notas,
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

  const { nombre, cedula, nacionalidad, porcentajeParticipacion, cargo, usuario } = req.body;
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
      porcentajeParticipacion || null,
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
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.cedula AS cliente_cedula
     FROM consultas c LEFT JOIN clientes cl ON cl.id = c.cliente_id
     WHERE c.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Consulta no encontrada.' });

  let detalles = { onuHits: [], ofacHits: [], ueHits: [], pepHits: [], gafiResultado: null };
  try { detalles = JSON.parse(row.detalles); } catch {}

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-aml-${row.id}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  doc.pipe(res);
  generarPDF(doc, row, detalles);
  doc.end();
});

// ─── Generador de PDF ─────────────────────────────────────────────────────────
function generarPDF(doc, consulta, detalles) {
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
