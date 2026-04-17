/* ============================================================
   SESAME VACATION CALENDAR - app.js
   Lógica de frontend, gestión de estado y filtrado.
   ============================================================ */

'use strict';

const MASTER_PASSWORDS = ['B50449107', 'B99030074'];

// Auto-detect if running via local proxy server (server.py)
function isLocalProxy() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || 
         h.startsWith('192.168.') || h.startsWith('10.') || 
         h.startsWith('172.') || h.endsWith('.local');
}

const HOLIDAYS_ZGZ = {
  '2026-01-01': 'Año Nuevo',
  '2026-01-06': 'Reyes Magos',
  '2026-01-29': 'San Valero',
  '2026-03-05': 'Cincomarzada',
  '2026-04-02': 'Jueves Santo',
  '2026-04-03': 'Viernes Santo',
  '2026-04-23': 'San Jorge / Día de Aragón',
  '2026-05-01': 'Día del Trabajo',
  '2026-08-15': 'Asunción de la Virgen',
  '2026-10-12': 'Fiesta Nacional / El Pilar',
  '2026-11-02': 'Todos los Santos (Lunes)',
  '2026-12-06': 'Día de la Constitución',
  '2026-12-08': 'Inmaculada Concepción',
  '2026-12-25': 'Navidad'
};

// Build the correct API base URL (proxy or direct)
function apiBase() {
  if (isLocalProxy()) {
    return `${window.location.origin}/sesame-api`;
  }
  return STATE.backendUrl;
}

// ── State ──────────────────────────────────────────────────────────────────
const STATE = {
  token:       null,
  companyId:   null,
  backendUrl:  null,
  currentUser: null,
  theme:       localStorage.getItem('theme') || 'dark',
  companies:     [],     // List of company configs
  activeId:      "",     // Currently active company ID
  allEmployees:  new Map(), // Todos los empleados detectados
  hiddenEmployeeIds: new Set(), // Empleados ocultos en el filtro
  calendarData: {},     // 'YYYY-MM-DD' → [{type, employees}]
  currentDate:  new Date(),
  calView:      'month', // 'month' | 'week'
  activeView:   'calendar',
  isLoading:    false,  // Guard to prevent redundant loads
  sidebarCollapsed: localStorage.getItem('ssm_sidebar_collapsed') === 'true',
  sidebarSections: {
    'absence-section': localStorage.getItem('sidebar_section_absence_collapsed') === 'true',
    'employee-section': localStorage.getItem('sidebar_section_employee_collapsed') === 'true'
  },
  currentModule: 'vacaciones'

};

let REFRESH_TIMER = null;

// ── Utils ───────────────────────────────────────────────────────────────────
function toggleSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const isCollapsed = section.classList.toggle('is-collapsed');
  STATE.sidebarSections[sectionId] = isCollapsed;
  
  // Persist
  const storageKey = sectionId === 'absence-section' 
    ? 'sidebar_section_absence_collapsed' 
    : 'sidebar_section_employee_collapsed';
  localStorage.setItem(storageKey, isCollapsed);
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── STORAGE helpers ────────────────────────────────────────────────────────
function saveCredentials() {
  localStorage.setItem('ssm_token',      STATE.token);
  localStorage.setItem('ssm_companyId',  STATE.companyId);
  localStorage.setItem('ssm_backendUrl', STATE.backendUrl);
}
function loadCredentials() {
  STATE.token     = localStorage.getItem('ssm_token')      || null;
  STATE.companyId = localStorage.getItem('ssm_companyId')  || null;
  STATE.backendUrl= localStorage.getItem('ssm_backendUrl') || 'https://back-eu1.sesametime.com';
}
// Global Audit & Discovery State
const AUDIT = {
  lastBiStatus: null,
  lastRawStatus: null,
  lastPresenceStatus: null,
  lastMeStatus: null,
  lastPresencePathTried: null,
  isSearching: false,
  teamChecksRestricted: false,
  forbiddenChecksCount: 0,
  accessibleChecksCount: 0
};

function getCurrentEmployeeId() {
  if (!STATE.currentUser) return null;
  return String(STATE.currentUser.id || STATE.currentUser.employeeId || '');
}

const DISCOVERY = {
  presencePaths: [
    '/api/v3/statistics/presence',
    '/api/v3/presence-status',
    '/api/v3/employees/presence',
    '/api/v3/presence',
    '/api/v3/attendance/presence',
    '/api/v3/work-entries/presence',
    '/api/v3/companies/{companyId}/employees/presence'
  ],
  checksPaths: [
    '/api/v3/work-entries/search',
    '/api/v3/checks/search',
    '/api/v3/work-entries',
    '/api/v3/checks',
    '/api/v3/attendance',
    '/api/v3/timesheets',
    '/api/v3/work-entries/list',
    '/api/v3/companies/{companyId}/work-entries/search',
    '/api/v3/companies/{companyId}/work-entries',
    '/api/v3/attendance/work-entries/search',
    '/api/v3/companies/{companyId}/attendance/work-entries',
    '/api/v3/companies/{companyId}/attendance/work-entries/search'
  ],
  balancePaths: [
    '/api/v3/vacation-configuration/employee/{id}',
    '/api/v3/statistics/employee/{id}/vacations'
  ],
  workingPresence: localStorage.getItem('ssm_path_presence') || null,
  workingChecks:   localStorage.getItem('ssm_path_checks') || null,
  workingBalance:  localStorage.getItem('ssm_path_balance')  || null
};

// Función de Descubrimiento Inteligente: Prueba POST, si falla 405/404, prueba GET
async function discoverEndpoint(candidates, payload = null) {
  for (let path of candidates) {
    // Si la ruta contiene {companyId}, la reemplazamos
    if (path.includes('{companyId}') && STATE.companyId) {
       path = path.replace('{companyId}', STATE.companyId);
    }

    const methodsToTry = payload ? ['POST', 'GET'] : ['GET'];
    
    for (const method of methodsToTry) {
      try {
        console.log(`Deep Discovery: Testing ${method} ${path}...`);
        
        // Si es GET, convertimos el payload en query params si existe
        let finalPath = path;
        let body = null;
        
        if (method === 'POST') {
          body = JSON.stringify(payload);
        } else if (method === 'GET' && payload) {
          const qs = new URLSearchParams(payload).toString();
          finalPath += (finalPath.includes('?') ? '&' : '?') + qs;
        }

        const res = await apiFetch(finalPath, { method, body });
        // Si no dio error, hemos encontrado la ruta
        console.log(`Deep Discovery: SUCCESS! -> ${method} ${finalPath}`);
        return finalPath; 
      } catch (e) {
        console.warn(`Deep Discovery: Failed ${method} ${path}: ${e.message}`);
        // Seguimos al siguiente método o ruta
      }
    }
  }
  
  // CIRCUIT BREAKER: Si todo falla, marcamos ambos como injaqueables.
  // Usamos la longitud del array para discriminar el tipo (no includes() que es frágil).
  console.error("Deep Discovery: Todos los endpoints fallaron. Funcionalidad deshabilitada.");
  if (candidates === DISCOVERY.presencePaths || candidates.length === DISCOVERY.presencePaths.length) {
      DISCOVERY.workingPresence = 'DISABLED';
      localStorage.setItem('ssm_path_presence', 'DISABLED');
  }
  if (candidates === DISCOVERY.checksPaths || candidates.length === DISCOVERY.checksPaths.length) {
      DISCOVERY.workingChecks = 'DISABLED';
      localStorage.setItem('ssm_path_checks', 'DISABLED');
  }
  
  return null;
}

function clearCredentials() {
  localStorage.removeItem('ssm_token');
  localStorage.removeItem('ssm_companyId');
  localStorage.removeItem('ssm_backendUrl');
  localStorage.removeItem('ssm_path_presence');
  localStorage.removeItem('ssm_path_checks');
}

// ── API layer ──────────────────────────────────────────────────────────────
async function apiFetch(path, params = {}, isRetry = false) {
  // 1. Determinar el servidor de Sesame objetivo (Redundancia)
  let sesameBaseUrl = STATE.backendUrl || 'https://back-eu1.sesametime.com';
  if (isRetry) {
    sesameBaseUrl = sesameBaseUrl.includes('back-') 
      ? sesameBaseUrl.replace('back-', 'api-') 
      : sesameBaseUrl.replace('api-', 'back-');
    console.warn(`Retry: Switching to alternative Sesame server: ${sesameBaseUrl}`);
  }

  // 2. IMPORTANTE: El navegador solo puede llamar al proxy local para evitar errores CORS (Failed to fetch)
  // Construimos la URL final que el navegador realmente llamará
  const finalUrl = new URL(`${apiBase()}${path}`);
  
  // Añadimos parámetros de búsqueda si existen
  Object.entries(params).forEach(([k, v]) => {
    if (k === 'method' || k === 'body') return;
    if (Array.isArray(v)) v.forEach(i => finalUrl.searchParams.append(k, i));
    else finalUrl.searchParams.set(k, v);
  });

  // 3. Cabeceras que el proxy necesita reenviar a Sesame
  const headers = {
    'Authorization': `Bearer ${STATE.token}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'x-company-id':  STATE.companyId || '',
    'csid':          STATE.companyId || '',
    'X-Sesame-Region': 'eu1',
    'X-Backend-Url': sesameBaseUrl // El proxy leerá esto y sabrá a dónde ir
  };

  const fetchOptions = {
    method: params.method || 'GET',
    headers
  };
  if (params.body) fetchOptions.body = params.body;

  try {
    const res = await fetch(finalUrl.toString(), fetchOptions);
    
    // Rastrear estados para Auditoría
    if (path.includes('/me')) AUDIT.lastMeStatus = res.status;
    if (path.includes('/presence')) AUDIT.lastPresenceStatus = res.status;
    if (path.includes('/checks') || path.includes('/work-entries')) {
      AUDIT.lastRawStatus = res.status;
      const myId = getCurrentEmployeeId();
      if (res.status === 403 && myId && !path.includes(myId)) {
        AUDIT.forbiddenChecksCount++;
        AUDIT.teamChecksRestricted = true;
      } else if (res.status === 200) {
        AUDIT.accessibleChecksCount++;
      }
    }

    // NOTA: El retry automático en 404/405 generaba el doble de peticiones al WAF,
    // aumentando la puntuación de bot. Se elimina para reducir huella.
    // Solo reintentamos en errores de red reales (502, 503), no en rutas inexistentes.

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("Sesión caducada (401). Por favor vuelve a conectar.");
      }
      
      // MIGRATION AUDIT: Intentar capturar el cuerpo del error de Sesame para diagnóstico
      let serverDetail = "";
      try {
        const errorJson = await res.json();
        serverDetail = `: ${JSON.stringify(errorJson)}`;
      } catch (e) {}
      
      throw new Error(`Error de API ${res.status}${serverDetail || ` (${res.statusText})`}`);
    }
    
    return await res.json();
  } catch (err) {
    // Si el error es "Failed to fetch", probablemente el servidor local python3 server.py no está corriendo
    if (err.message === 'Failed to fetch') {
       throw new Error("Error de Red: El puente local (servidor Python) no responde. ¿Está iniciado?");
    }
    throw err;
  }
}

async function apiFetchBi(query) {
  const url = '/api/v3/analytics/report-query';
  
  const headers = {
    'Authorization': `Bearer ${STATE.token}`,
    'Content-Type':  'application/json',
    'csid':          STATE.companyId,
    'x-company-id':  STATE.companyId,
    'X-Region':      'EU1',
    // Estas cabeceras son críticas para el WAF del bi-engine.
    // El proxy las reenvía a Sesame tal cual.
    'Origin':  'https://app.sesametime.com',
    'Referer': 'https://app.sesametime.com/'
  };

  // Deshabilitado el proxy local para evitar el WAF de Python.
  const bypassProxyUrl = 'https://bi-engine.sesametime.com/api/v3/analytics/report-query';

  const res = await fetch(bypassProxyUrl, { 
    method: 'POST',
    headers,
    body: JSON.stringify(query)
  });

  if (!res.ok) {
    AUDIT.lastBiStatus = res.status;
    throw new Error(`BI API Error ${res.status} al consultar report-query`);
  }
  AUDIT.lastBiStatus = res.status;
  return res.json();
}

/**
 * Añade o actualiza un empleado en el estado global de forma robusta.
 * Unifica los IDs como String y mezcla la información para no perder fotos.
 */
function upsertEmployee(emp) {
  if (!emp || !emp.id) return;
  const idStr = String(emp.id);
  
  const existing = STATE.allEmployees.get(idStr) || {};
  
  // Mezclamos la información, priorizando la que tenga más campos útiles (fotos, cargos)
  const updated = {
    ...existing,
    ...emp,
    id: emp.id,
    birthDate: emp.birthDate || emp.birthday || emp.dateOfBirth || emp.date_of_birth || 
               (emp.personalData && (emp.personalData.birthDate || emp.personalData.birthday)) || 
               (emp.details && emp.details.birthDate) || existing.birthDate || '',
    hiringDate: emp.hiringDate || emp.dateOfJoined || emp.joinedDate || emp.createdAt || 
                (emp.contract && emp.contract.startAt) || existing.hiringDate || ''
  };

  // MEJORA AGRESIVA DE FOTOS: Buscamos en todos los campos posibles de Sesame
  const photo = emp.imageProfileURL || emp.imageProfile || emp.photoUrl || emp.photo || emp.avatarUrl || emp.avatar || '';
  
  if (!photo && existing.imageProfileURL) {
    updated.imageProfileURL = existing.imageProfileURL;
  } else {
    updated.imageProfileURL = photo;
  }
  
  STATE.allEmployees.set(idStr, updated);
  
  // El estado central es STATE.allEmployees (Map)

  
  // Actualizar el contador visual si existe
  const badge = document.getElementById('profiles-count-badge');
  if (badge) {
    badge.innerHTML = `👤 Directorio: ${STATE.allEmployees.size} perfiles`;
    badge.style.display = 'block';
  }

  // Refrescar el panel lateral si está visible para que la cosecha sea instantánea en la UI
  if (typeof renderEmployeeFilterList === 'function') {
    renderEmployeeFilterList();
  }
}


async function fetchMe() {
  const data = await apiFetch('/api/v3/security/me');
  return data.data || data;
}

const PREMIUM_PALETTE = [
  '#E11D48', '#2563EB', '#059669', '#D97706', '#7C3AED', 
  '#DB2777', '#0284C7', '#16A34A', '#EA580C', '#9333EA',
  '#F43F5E', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6',
  '#BE185D', '#1D4ED8', '#15803D', '#9A3412', '#6D28D9',
  '#0891B2', '#CA8A04', '#DC2626', '#4F46E5', '#0D9488',
  '#0369A1', '#854D0E', '#991B1B', '#4338CA', '#0F766E'
];

async function fetchAbsenceTypes() {
  const data = await apiFetch(`/api/v3/companies/${STATE.companyId}/absence-types`);
  const list = data.data || data || [];
  return list.map((t, i) => {
    // Evitar que el color sea repetitivo si hay muchos calendarios
    const paletteColor = PREMIUM_PALETTE[i % PREMIUM_PALETTE.length];
    return {
      id:    t.id,
      name:  t.name || t.alias || 'Ausencia',
      color: paletteColor,
    };
  });
}

async function fetchCalendarGrouped(from, to, typeIds) {
  const params = {
    from, to,
    'types[]': typeIds.length ? typeIds : [],
    view: 'employee',
  };
  const data = await apiFetch(
    `/api/v3/companies/${STATE.companyId}/calendars-grouped`,
    params
  );
  return data.data || data || [];
}

async function fetchPresence() {
  try {
    // 1. Si ya conocemos el camino
    if (DISCOVERY.workingPresence === 'DISABLED') {
        return [];
    }
    if (DISCOVERY.workingPresence) {
      AUDIT.lastPresencePathTried = DISCOVERY.workingPresence;
      const data = await apiFetch(DISCOVERY.workingPresence);
      return data.data || data || [];
    }

    // 2. Si no, iniciar descubrimiento
    AUDIT.isSearching = true;
    const found = await discoverEndpoint(DISCOVERY.presencePaths);
    if (found) {
      DISCOVERY.workingPresence = found;
      localStorage.setItem('ssm_path_presence', found);
      return fetchPresence(); // Reintentar con la ruta guardada
    }
    
    return [];
  } catch (e) {
    console.warn("Could not fetch presence data:", e);
    return [];
  } finally {
    AUDIT.isSearching = false;
  }
}

async function fetchVacationBalance(employeeId) {
  try {
    // 1. Intentar endpoints oficiales primero (con descubrimiento para evitar 404 recurrentes)
    if (DISCOVERY.workingBalance === 'DISABLED') {
      // Proceder directamente al fallback si ya sabemos que no existen
    } else if (DISCOVERY.workingBalance) {
      try {
        const path = DISCOVERY.workingBalance.replace('{id}', employeeId);
        const data = await apiFetch(path);
        const balance = data.data || data;
        if (balance && (balance.daysTotal || balance.totalDays)) return balance;
      } catch (e) {
        DISCOVERY.workingBalance = null; // Re-intentar descubrimiento si falla la guardada
      }
    }

    if (DISCOVERY.workingBalance !== 'DISABLED') {
      for (const rawPath of DISCOVERY.balancePaths) {
        const path = rawPath.replace('{id}', employeeId);
        try {
          const data = await apiFetch(path);
          const balance = data.data || data;
          if (balance && (balance.daysTotal || balance.totalDays)) {
            DISCOVERY.workingBalance = rawPath;
            localStorage.setItem('ssm_path_balance', rawPath);
            return balance;
          }
        } catch (e) {
          if (e.message.includes('404')) {
             console.warn(`Balance API not found: ${path}.`);
          }
        }
      }
      
      // Si llegamos aquí, ninguna ruta oficial funciona
      DISCOVERY.workingBalance = 'DISABLED';
      localStorage.setItem('ssm_path_balance', 'DISABLED');
    }

    // 2. FALLBACK INTELIGENTE: Auto-cálculo basado en el calendario real
    // Si la API restringe el acceso al balance, contamos nosotros mismos los días del año
    console.log("Vacation Balance: Official API restricted. Switching to Smart Calendar Scan...");
    
    const currentYear = new Date().getFullYear();
    const from = `${currentYear}-01-01`;
    const to = `${currentYear}-12-31`;
    
    // Necesitamos saber qué IDs de tipo corresponden a "Vacaciones"
    // Buscamos en los tipos de ausencia ya cargados
    const vacationType = STATE.absenceTypes.find(t => 
      t.name.toLowerCase().includes('vacac')
    );
    
    if (!vacationType) return null;

    // Consultamos el calendario agrupado para todo el año (solo nuestro ID)
    const rawData = await apiFetch(`/api/v3/companies/${STATE.companyId}/calendars-grouped`, {
      from, to, view: 'employee'
    });
    
    const entries = rawData.data || rawData || [];
    let usedDays = 0;
    
    entries.forEach(day => {
      const types = day.calendar_types || [];
      const hasVacation = types.some(ct => ct.calendar_type?.id === vacationType.id);
      if (hasVacation) usedDays++;
    });

    return {
      daysUsed: usedDays,
      daysTotal: 22, // Estándar por defecto si no podemos leer el oficial
      isAutocalculated: true
    };

  } catch (e) {
    console.warn("Could not fetch vacation balance:", e);
    return null;
  }
}

async function fetchEmployees() {
  try {
    // 1. Intentamos el directorio global (tradicionalmente con más permisos)
    let data = await apiFetch(`/api/v3/employees?limit=500`);
    let results = data.data || data || [];

    // 2. Fallback final: endpoint de empresa
    if (results.length <= 1) {
      console.log("[Directory] Falling back to company employees...");
      const companyData = await apiFetch(`/api/v3/companies/${STATE.companyId}/employees?limit=500`);
      results = companyData.data || companyData || [];
    }

    return results.map(e => {
      // Intentar obtener la jornada laboral del contrato activo
      const contract = (e.contracts && e.contracts.length > 0) ? e.contracts[0] : null;
      const workdays = contract ? {
        1: contract.mondaySeconds ?? 28800,
        2: contract.tuesdaySeconds ?? 28800,
        3: contract.wednesdaySeconds ?? 28800,
        4: contract.fridaySeconds ?? 28800,
        5: contract.fridaySeconds ?? 28800,
        6: contract.saturdaySeconds ?? 0,
        0: contract.sundaySeconds ?? 0
      } : null;

      return {
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        imageProfileURL: e.imageProfileURL || e.photoUrl || e.avatarUrl || '',
        email: e.email || e.companyEmail || '',
        phone: e.personalPhone || e.companyPhone || e.phone || '',
        jobTitle: e.jobTitle || e.position?.name || '',
        birthDate: e.birthDate || e.birthday || e.dateOfBirth || e.date_of_birth || '',
        hiringDate: e.hiringDate || e.dateOfJoined || e.joinedDate || e.createdAt || '',
        workdays: workdays,
        status: e.status // Proporcionado por el endpoint de presencia si se mezcla después
      };
    });
  } catch (e) {
    console.warn('Could not fetch full employee list:', e);
    return [];
  }
}

// ── Color helpers ──────────────────────────────────────────────────────────
const COLOR_MAP = {
  'ssmv2-pink':   '#FF6B8A',
  'ssmv2-green':  '#4ADE80',
  'ssmv2-blue':   '#60A5FA',
  'ssmv2-yellow': '#FBBF24',
  'ssmv2-purple': '#A78BFA',
  'ssmv2-orange': '#FB923C',
  'ssmv2-teal':   '#2DD4BF',
  'ssmv2-red':    '#F87171',
};
function resolveColor(colorKey) {
  if (!colorKey) return '#A78BFA';
  if (colorKey.startsWith('#')) return colorKey;
  return COLOR_MAP[colorKey] || '#A78BFA';
}
function hexToRgba(hex, alpha = 0.25) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Date helpers ───────────────────────────────────────────────────────────
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getMonthRange(date) {
  const y = date.getFullYear(), m = date.getMonth();
  const from = new Date(y, m, 1);
  const to   = new Date(y, m+1, 0);
  return { from: fmtDate(from), to: fmtDate(to) };
}

function isBirthdayToday(dateStr) {
  if (!dateStr) return false;
  try {
    const today = new Date();
    // Sesame puede devolver YYYY-MM-DD o MM-DD o incluso DD/MM
    let month, day;
    
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
      } else if (parts.length === 2) {
        month = parseInt(parts[0]);
        day = parseInt(parts[1]);
      }
    } else if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      day = parseInt(parts[0]);
      month = parseInt(parts[1]);
    }
    
    return month === (today.getMonth() + 1) && day === today.getDate();
  } catch(e) { return false; }
}

function isAnniversaryToday(dateStr) {
  if (!dateStr) return false;
  try {
    const today = new Date();
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length < 3) return false;
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    return month === (today.getMonth() + 1) && day === today.getDate();
  } catch(e) { return false; }
}

function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  const from = fmtDate(d);
  d.setDate(d.getDate() + 6);
  const fromObj = new Date(d); // just for consistency
  const to   = fmtDate(d);
  return { from, to };
}
function getDayRange(date) {
  const d = fmtDate(date);
  return { from: d, to: d };
}
function isToday(dateStr) {
  return dateStr === fmtDate(new Date());
}

/**
 * Retorna un icono según el origen del fichaje (BI Engine)
 */
function getOriginIcon(origin) {
  if (!origin) return '❓';
  const o = origin.toLowerCase();
  if (o.includes('web')) return '💻';
  if (o.includes('app') || o.includes('mobile')) return '📱';
  if (o.includes('tablet') || o.includes('kiosk') || o.includes('kiosko')) return '📟';
  return '📍';
}


// ── Multi-Company Config ───────────────────────────────────────────────────
async function loadSavedConfig() {
  if (!isLocalProxy()) return;
  try {
    const res = await fetch('/config');
    if (!res.ok) return;
    const cfg = await res.json();
    
    STATE.companies = cfg.companies || [];
    STATE.activeId = cfg.activeId || "";

    if (STATE.companies.length > 0) {
      const active = STATE.companies.find(c => c.companyId === STATE.activeId) || STATE.companies[0];
      if (active && (!STATE.token || active.companyId !== STATE.companyId)) {
        STATE.token = active.token;
        STATE.companyId = active.companyId;
        STATE.backendUrl = active.backendUrl;
        saveCredentials();
        console.log(`\u2705 Empresa activa: ${active.name || active.companyId}`);
      }
      renderCompanySelector();
    }
  } catch (e) { console.error("Error loading config:", e); }
}

function renderCompanySelector() {
  const select = $('company-select');
  if (!select) return;
  select.innerHTML = '';
  
  STATE.companies.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.companyId;
    opt.textContent = c.name || c.companyId.substring(0, 8);
    opt.selected = c.companyId === STATE.companyId;
    select.appendChild(opt);
  });

  // Apply branding for active company IF we don't have it already
  const active = STATE.companies.find(c => c.companyId === STATE.companyId);
  if (active) applyCompanyBranding(active);
}

function applyCompanyBranding(company) {
  const logoContainer = $('company-logo-container');
  const nameDisplay = $('company-name-display');
  
  const name = company.name || 'Pruebas';
  if (nameDisplay) nameDisplay.textContent = name;
  
  // Custom Branding Logic
  let brandColor = company.brandColor;
  let logoUrl = company.logoUrl;

  // Fallback to corporate defaults if no manual color is provided
  if (!brandColor) {
    if (name.toUpperCase().includes('FIBERCOM')) {
      brandColor = '#e63946'; // Rojo corporativo
    } else if (name.toUpperCase().includes('ARAGON')) {
      brandColor = '#1d3557'; // Azul marino corporativo
    } else {
      brandColor = '#60A5FA'; // Default blue
    }
  }

  if (logoContainer) {
    if (logoUrl) {
      logoContainer.innerHTML = `<img src="${logoUrl}" style="width:24px;height:24px;object-fit:contain;border-radius:4px;" onerror="this.outerHTML='📅'">`;
    } else {
      logoContainer.innerHTML = '📅';
    }
  }

  // Inject brand color with contrast adjustment for dark mode
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  
  // Create a lightened version for text/highlights in dark mode if needed
  let accentColor = brandColor;
  if (isDark) {
    // If the color is very dark, we boost its brightness for the UI accents
    // Simple way: if it starts with #00 or #1, it's likely dark.
    // For a more robust fix, we'll just lighten any color slightly in dark mode 
    // to make it "pop" against the near-black background.
    accentColor = adjustColorBrightness(brandColor, 40); 
  }

  document.documentElement.style.setProperty('--accent', accentColor);
  document.documentElement.style.setProperty('--accent-glow', brandColor + '40');
}

/**
 * Utility to lighten/darken a hex color
 */
function adjustColorBrightness(hex, percent) {
  try {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const calc = (v) => Math.min(255, Math.max(0, v + (percent * 2.55)));
    
    const newR = Math.round(calc(r)).toString(16).padStart(2, '0');
    const newG = Math.round(calc(g)).toString(16).padStart(2, '0');
    const newB = Math.round(calc(b)).toString(16).padStart(2, '0');
    
    return `#${newR}${newG}${newB}`;
  } catch (e) {
    return `#${hex}`; // Fallback
  }
}

async function handleDeleteCompany() {
  const cid = STATE.companyId;
  if (!cid) return;
  
  const company = STATE.companies.find(c => c.companyId === cid);
  const name = company ? (company.name || cid) : cid;
  
  if (!confirm(`\u26A0\uFE0F \u00BFEst\u00E1s seguro de que quieres eliminar la empresa "${name}"?\n\nEsta acci\u00F3n no se puede deshacer.`)) {
    return;
  }
  
  showLoading(true);
  try {
    const res = await fetch('/delete-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: cid })
    });
    
    if (res.ok) {
      // Clear localStorage so it doesn't try to reload the deleted company
      clearCredentials();
      window.location.reload();
    } else {
      const err = await res.json();
      alert("Error: " + (err.error || "No se pudo eliminar la empresa."));
      showLoading(false);
    }
  } catch (e) {
    console.error("Error deleting company:", e);
    alert("Error de conexi\u00F3n con el servidor.");
    showLoading(false);
  }
}

function switchCompany(cid) {
  const next = STATE.companies.find(c => c.companyId === cid);
  if (!next) return;
  
  STATE.token = next.token;
  STATE.companyId = next.companyId;
  STATE.backendUrl = next.backendUrl;
  saveCredentials();
  
  // Persist choice to server
  if (isLocalProxy()) {
    fetch('/save-config', {
      method: 'POST',
      body: JSON.stringify(next)
    });
  }
  
  loadData();
  startAutoRefresh();
}

/**
 * Inicia el temporizador de auto-refresco cada 5 minutos.
 */
function startAutoRefresh() {
  if (REFRESH_TIMER) clearInterval(REFRESH_TIMER);
  REFRESH_TIMER = setInterval(async () => {
    const isAppVisible = !$('app-screen').classList.contains('hidden');
    if (isAppVisible && !STATE.isLoading && STATE.token && STATE.companyId) {
      console.log("🔄 Auto-refrescando datos (intervalo 5 min)...");
      await loadData();
    }
  }, 5 * 60 * 1000); 
}

/**
 * Detiene el temporizador de auto-refresco.
 */
function stopAutoRefresh() {
  if (REFRESH_TIMER) {
    clearInterval(REFRESH_TIMER);
    REFRESH_TIMER = null;
  }
}


// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // --- Master Password Protection ---
  const isUnlocked = sessionStorage.getItem('ssm_unlocked') === 'true';
  const lockScreen = $('lock-screen');
  const unlockBtn = $('unlock-btn');
  const passInput = $('master-pass');

  if (!isUnlocked) {
    showScreen('lock-screen');
    
    const handleUnlock = () => {
      const val = passInput.value.trim().toUpperCase();
      if (MASTER_PASSWORDS.includes(val)) {
        sessionStorage.setItem('ssm_unlocked', 'true');
        lockScreen.classList.remove('active');
        lockScreen.classList.add('hidden');
        startApp();
      } else {
        const card = lockScreen.querySelector('.setup-card');
        card.classList.add('shake');
        $('lock-error').classList.remove('hidden');
        setTimeout(() => card.classList.remove('shake'), 500);
      }
    };

    unlockBtn.addEventListener('click', handleUnlock);
    passInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });
    return; // Stop here until unlocked
  }

  // If already unlocked
  lockScreen.classList.remove('active');
  lockScreen.classList.add('hidden');
  startApp();
}

/**
 * Muestra una pantalla específica y oculta las demás.
 */
function showScreen(screenId) {
  $$('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  $(screenId).classList.remove('hidden');
  $(screenId).classList.add('active');
}

/**
 * Alterna entre módulos principales (Vacaciones / Fichajes)
 */
function switchModule(module) {
  STATE.currentModule = module;
  
  // Actualizar estados visuales de los botones del switcher
  $$('.module-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.module === module);
  });
  
  // Ocultar/Mostrar wrappers de cada módulo con sus clases correspondientes
  $$('.module-wrapper').forEach(w => {
    w.style.display = 'none';
    w.classList.remove('active');
  });
  
  let activeWrapper = document.getElementById(`module-${module}-wrapper`);
  // Fallback para nombres antiguos o simplificados
  if (!activeWrapper && module === 'vacaciones') activeWrapper = document.getElementById('calendar-wrapper');
  
  if (activeWrapper) {
    activeWrapper.style.display = 'block';
    activeWrapper.classList.add('active');
  }

  // Control de visibilidad del sidebar según el módulo
  const sidebarNav = document.querySelector('.sidebar-nav');
  const absenceSection = document.getElementById('absence-section');
  const employeeSection = document.getElementById('employee-section');
  
  if (module === 'fichajes') {
    if (sidebarNav) sidebarNav.style.display = 'none';
    if (absenceSection) absenceSection.style.display = 'none';
    // Mantenemos la sección de empleados visible para permitir el filtrado múltiple
    if (employeeSection) employeeSection.style.display = 'block';
    
    // Inicialización específica de Fichajes
    FichajesModule.init();
    FichajesModule.loadData();
  } else {
    if (sidebarNav) sidebarNav.style.display = 'block';
    if (absenceSection) absenceSection.style.display = 'block';
    if (employeeSection) employeeSection.style.display = 'block';
    loadData();
  }
}

async function startApp() {
  loadCredentials();

  // Wire setup form
  $('connect-btn').addEventListener('click', handleConnect);
  $('token-input').addEventListener('keydown', e => { if (e.key==='Enter') handleConnect(); });

  // Wire setup prefill & proxy hint
  if (STATE.backendUrl) $('backend-input').value = STATE.backendUrl;
  if (isLocalProxy()) {
    const hint = document.querySelector('#backend-input + small');
    if (hint) hint.innerHTML = '\u2705 Proxy local activo (<code>server.py</code>) — CORS resuelto';
  }

  // Wire nav
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $$('.vt-btn').forEach(btn => btn.addEventListener('click', () => switchCalView(btn.dataset.calView)));
  $$('.module-btn').forEach(btn => btn.addEventListener('click', () => switchModule(btn.dataset.module)));

  $('prev-month').addEventListener('click', () => shiftPeriod(-1));
  $('next-month').addEventListener('click', () => shiftPeriod(1));
  $('today-btn').addEventListener('click', () => { STATE.currentDate = new Date(); loadData(); });
  $('refresh-btn').addEventListener('click', loadData);
  $('logout-btn').addEventListener('click', logout);
  
  $('sidebar-toggle').addEventListener('click', () => {
    STATE.sidebarCollapsed = !STATE.sidebarCollapsed;
    document.body.classList.toggle('sidebar-collapsed', STATE.sidebarCollapsed);
    localStorage.setItem('ssm_sidebar_collapsed', STATE.sidebarCollapsed);
  });

  // Restore sidebar sections state
  Object.entries(STATE.sidebarSections).forEach(([id, collapsed]) => {
    if (collapsed) document.getElementById(id)?.classList.add('is-collapsed');
  });

  // Botón para guiar a la multiselección desde Fichajes
  const btnMulti = $('btn-show-multi-filter');
  if (btnMulti) {
    btnMulti.onclick = () => {
      // Si la sidebar está colapsada, la abrimos
      if (document.body.classList.contains('sidebar-collapsed')) {
        document.body.classList.remove('sidebar-collapsed');
        STATE.sidebarCollapsed = false;
        localStorage.setItem('ssm_sidebar_collapsed', false);
      }
      // Aseguramos que la sección de empleados no esté colapsada internamente
      const empSection = document.getElementById('employee-section');
      if (empSection && empSection.classList.contains('is-collapsed')) {
        empSection.classList.remove('is-collapsed');
      }
      // Scroll suave hasta la lista de filtros
      const empFilterList = $('employee-filter-list');
      if (empFilterList) {
        empFilterList.scrollIntoView({ behavior: 'smooth', block: 'center' });
        empFilterList.classList.add('highlight-flash');
        setTimeout(() => empFilterList.classList.remove('highlight-flash'), 2000);
      }
    };
  }

  // Apply initial state
  if (STATE.sidebarCollapsed) {
    document.body.classList.add('sidebar-collapsed');
  }

  // Wire employee filters
  const empSearch = $('employee-search');
  if(empSearch) empSearch.addEventListener('input', renderEmployeeFilterList);
  
  const empSelAll = $('emp-sel-all');
  if(empSelAll) empSelAll.addEventListener('click', (e) => {
    e.preventDefault();
    STATE.hiddenEmployeeIds.clear();
    renderEmployeeFilterList();
    renderFilters(); renderCalendar(); renderEmployeeList(); renderStats();
    
    if (typeof FichajesModule !== 'undefined' && FichajesModule.initialized) {
      FichajesModule.renderTable();
    }
  });
  
  const empSelNone = $('emp-sel-none');
  if(empSelNone) empSelNone.addEventListener('click', (e) => {
    e.preventDefault();
    STATE.allEmployees.forEach((emp, id) => STATE.hiddenEmployeeIds.add(String(id)));
    renderEmployeeFilterList();
    renderFilters(); renderCalendar(); renderEmployeeList(); renderStats();
    
    if (typeof FichajesModule !== 'undefined' && FichajesModule.initialized) {
      FichajesModule.renderTable();
    }
  });

  const exportBtn = $('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportToIcal);

  const subscribeBtn = $('subscribe-btn');
  if (subscribeBtn) subscribeBtn.addEventListener('click', showSubscriptionModal);

  const companySelect = $('company-select');
  if (companySelect) companySelect.addEventListener('change', (e) => switchCompany(e.target.value));

  const addCompanyBtn = $('add-company-btn');
  if (addCompanyBtn) addCompanyBtn.addEventListener('click', () => {
    STATE.token = STATE.companyId = null;
    showSetup();
  });

  const deleteCompanyBtn = $('delete-company-btn');
  if (deleteCompanyBtn) {
    deleteCompanyBtn.addEventListener('click', handleDeleteCompany);
  }

  $('modal-close').addEventListener('click', closeModal);
  $('day-modal').addEventListener('click', e => { if (e.target === $('day-modal')) closeModal(); });

  // Multi-button theme toggle synchronization
  const updateThemeUI = () => {
    document.documentElement.setAttribute('data-theme', STATE.theme);
    localStorage.setItem('theme', STATE.theme);
    
    // Update all theme buttons simultaneously
    const themeButtons = document.querySelectorAll('.theme-toggle');
    themeButtons.forEach(btn => {
      btn.textContent = STATE.theme === 'light' ? '🌙' : '☀️';
    });

    // Update UI components
    const active = STATE.companies.find(c => c.companyId === STATE.companyId);
    if (active) applyCompanyBranding(active);
    
    renderCalendar();
    renderFilters();
    renderStats();
    
    // Redraw signings if active to apply theme-aware table styles
    if (STATE.currentModule === 'fichajes' && MODULES.fichajes) {
      MODULES.fichajes.render();
    }
  };

  const themeToggleButtons = document.querySelectorAll('.theme-toggle');
  themeToggleButtons.forEach(btn => {
    btn.textContent = STATE.theme === 'light' ? '🌙' : '☀️';
    btn.addEventListener('click', () => {
      STATE.theme = STATE.theme === 'light' ? 'dark' : 'light';
      updateThemeUI();
    });
  });

  // Try loading credentials saved by get-token.py via server
  await loadSavedConfig();

  // Auto-login if credentials available
  if (STATE.token && STATE.companyId) {
    showApp();
    await loadInitialData();
    startAutoRefresh();
    loadWeather();
  } else {
    showSetup();
  }
}

function showSetup() {
  showScreen('setup-screen');
  if ($('token-input')) $('token-input').value = '';
  if ($('company-input')) $('company-input').value = '';
  if ($('name-input')) $('name-input').value = '';
  if ($('color-input')) $('color-input').value = '';
  if ($('logo-input')) $('logo-input').value = '';
}


// ── Setup / Connect ────────────────────────────────────────────────────────
async function handleConnect() {
  const token     = $('token-input').value.trim();
  const companyId = $('company-input').value.trim();
  const backendUrl= $('backend-input').value.trim().replace(/\/+$/, '');
  const manualName = $('name-input')?.value.trim();
  const manualColor = $('color-input')?.value.trim();
  const manualLogo = $('logo-input')?.value.trim();

  const err = $('setup-error');
  err.textContent = '';
  err.classList.add('hidden');

  // Acceso rápido por CIF: busca el token REAL guardado en config.json
  const cifMap = {
    'B50449107': 'Fibercom',
    'B99030074': 'AragonPh'
  };
  const isBypassCIF = cifMap.hasOwnProperty(companyId);
  if (isBypassCIF && !token) {
    console.log("Acceso vía CIF: buscando token real guardado en config.json...");
    try {
      const res = await fetch('/config');
      if (res.ok) {
        const cfg = await res.json();
        const matchName = cifMap[companyId];
        const saved = (cfg.companies || []).find(c => 
          c.name && c.name.toUpperCase().includes(matchName.toUpperCase())
        );
        if (saved && saved.token) {
          console.log(`✅ Token real encontrado para ${saved.name}. Conectando con datos reales...`);
          STATE.token = saved.token;
          STATE.companyId = saved.companyId;
          STATE.backendUrl = saved.backendUrl || 'https://back-eu1.sesametime.com';
          saveCredentials();
          showLoading(true);
          try {
            const meData = await fetchMe();
            const companyData = meData.company || {};
            STATE.currentUser = meData.employee || (Array.isArray(meData) ? meData[0] : meData);
            await finalizeLogin(companyData);
          } catch (e) {
            showSetupError(`Token guardado caducado. Introduce un USID nuevo: ${e.message}`);
            STATE.token = STATE.companyId = null;
          } finally {
            showLoading(false);
          }
          return;
        }
      }
    } catch (e) {
      console.warn("No se pudo leer config.json:", e);
    }
    return showSetupError('No hay token real guardado para este CIF. Introduce tu USID (Token) manualmente.');
  }

  if (!token)     return showSetupError('Por favor introduce el token de sesión (USID).');
  if (!companyId) return showSetupError('Por favor introduce el Company ID.');

  STATE.token     = token;
  STATE.companyId = companyId;
  STATE.backendUrl= backendUrl || 'https://back-eu1.sesametime.com';

  showLoading(true);

  try {
    const meData = await fetchMe();
    const companyData = meData.company || {};
    STATE.currentUser = meData.employee || (Array.isArray(meData) ? meData[0] : meData);
    
    await finalizeLogin(companyData);
  } catch (e) {
    showSetupError(`No se pudo conectar: ${e.message}. Verifica el token y el Company ID.`);
    STATE.token = STATE.companyId = null;
  } finally {
    showLoading(false);
  }
}

async function finalizeLogin(companyData = {}) {
  const manualName = $('name-input')?.value.trim();
  const manualColor = $('color-input')?.value.trim();
  const manualLogo = $('logo-input')?.value.trim();

  const companyName = manualName || companyData.name || 'Mi Empresa';
  const brandColor = manualColor || companyData.brandColor || null;
  const logoUrl = manualLogo || companyData.logo || null;

  saveCredentials();
  if (typeof persistConfigToServer === 'function') {
    await persistConfigToServer(companyName, brandColor, logoUrl);
  }
  
  applyCompanyBranding({
    id: STATE.companyId,
    name: companyName,
    brandColor: brandColor,
    logo: logoUrl
  });
  
  showApp();
  await loadInitialData();
  startAutoRefresh();
  loadWeather();
}

/**
 * Muestra el error de configuración en la UI
 */
function showSetupError(msg) {
  const err = $('setup-error');
  if (!err) return;
  err.textContent = msg;
  err.classList.remove('hidden');
  showLoading(false);
}

// ── Save config to server when connected ────────────────────────────────────
async function persistConfigToServer(name, brandColor, logoUrl) {
  if (!isLocalProxy()) return;
  try {
    await fetch('/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:       name || 'Mi Empresa',
        token:      STATE.token,
        companyId:  STATE.companyId,
        backendUrl: STATE.backendUrl,
        brandColor: brandColor,
        logoUrl:    logoUrl
      }),
    });
  } catch (e) { /* non-critical */ }
}

// ── Load data ──────────────────────────────────────────────────────────────
// ── Load data ──────────────────────────────────────────────────────────────
async function loadInitialData() {
  if (STATE.isLoading) return;
  STATE.isLoading = true;
  showLoading(true);
  
  try {
    // 1. Parallel fetch of core metadata (siempre datos reales)
    const [absTypes, meData, teamEmps] = await Promise.all([
      fetchAbsenceTypes(),
      fetchMe(),
      fetchEmployees()
    ]);

    // 2. Process Absence Types
    STATE.absenceTypes = absTypes;
    STATE.activeFilters = new Set(STATE.absenceTypes.map(t => t.id));
    renderFilters();

    // 3. Process User & Company Info
    STATE.currentUser = meData.employee || (Array.isArray(meData) ? meData[0] : meData);
    
    if (meData.company) {
      const brand = {
        companyId: STATE.companyId,
        name: meData.company.name,
        brandColor: meData.company.brandColor,
        logoUrl: meData.company.logo
      };
      applyCompanyBranding(brand);
      
      if (!STATE.companies.some(c => c.companyId === STATE.companyId)) {
        await persistConfigToServer(brand.name, brand.brandColor, brand.logoUrl);
        await loadSavedConfig(); 
      }
    }
    renderUserInfo(STATE.currentUser);

    // 4. Process Employee Directory
    const me = STATE.currentUser;
    const teamArray = Array.isArray(teamEmps) ? teamEmps : (teamEmps?.data || []);
    
    // COSECHA ESPECIAL: Si encontramos al usuario actual en el directorio de empleados,
    // fusionamos los datos porque el directorio suele traer más campos (contratos, cargos, etc)
    const detailedMe = teamArray.find(e => String(e.id) === String(me?.id));
    if (detailedMe) {
      STATE.currentUser = { ...STATE.currentUser, ...detailedMe };
    }

    // El usuario actual siempre primero en el estado global
    if (STATE.currentUser && STATE.currentUser.id) {
      upsertEmployee(STATE.currentUser);
    }

    // El resto de la plantilla
    teamArray.forEach(emp => {
      upsertEmployee(emp);
    });

    // 5. Initial calendar load
    await loadDataInternal();
  } catch (e) {
    console.error('loadInitialData failed:', e);
    if (e.message.includes('401')) {
      logout();
    } else {
      showSetupError(e.message);
    }
  } finally {
    STATE.isLoading = false;
    showLoading(false);
  }
}

async function loadData() {
  if (STATE.isLoading) return;
  STATE.isLoading = true;
  showLoading(true);
  try {
    await loadDataInternal();
  } finally {
    STATE.isLoading = false;
    showLoading(false);
  }
}

async function loadDataInternal() {
  try {
    let range;
    if (STATE.calView === 'day') range = getDayRange(STATE.currentDate);
    else if (STATE.calView === 'week') range = getWeekRange(STATE.currentDate);
    else range = getMonthRange(STATE.currentDate);

    // Expand range slightly to fill calendar grid
    const fromDate = new Date(range.from);
    fromDate.setDate(fromDate.getDate() - 7);
    const toDate = new Date(range.to);
    toDate.setDate(toDate.getDate() + 7);

    const typeIds = [...STATE.activeFilters];
    const rawData = await fetchCalendarGrouped(fmtDate(fromDate), fmtDate(toDate), typeIds);

    // Index by date and extract all employees seen
    STATE.calendarData = {};
    rawData.forEach(dayObj => {
      const date = dayObj.date;
      if (!date) return;
      STATE.calendarData[date] = (dayObj.calendar_types || []).map(ct => {
        const emps = ct.employees || [];
        emps.forEach(emp => {
          // COSECHA INTELIGENTE: Si el calendario trae perfiles nuevos o con más info (fotos), los guardamos
          upsertEmployee(emp);
        });

        const rawType = ct.calendar_type || {};
        const masterType = STATE.absenceTypes.find(t => t.id === rawType.id) || {};
        
        return {
          type: {
            ...rawType,
            name: masterType.name || rawType.name || 'Ausencia',
            color: masterType.color || 'ssmv2-purple'
          },
          employees: emps,
          numEmployees: ct.num_employees || 0,
        };
      });
    });

    updateMonthLabel();
    renderFilters();
    renderEmployeeFilterList();
    renderCalendar();
    renderEmployeeList();
    renderStats();
  } catch(e) {
    console.error('Internal data fetch failed:', e);
    throw e;
  }
}

// ── Render: filters ────────────────────────────────────────────────────────
/**
 * Renderiza la lista lateral de tipos de ausencia activos.
 * Filtra automáticamente aquellos tipos que no tienen registros (count === 0).
 */
function renderFilters() {
  const container = $('absence-type-filters');
  container.innerHTML = '';

  // Calcular conteos actuales respetando otros filtros (como el de empleados)
  const counts = {};
  Object.values(STATE.calendarData).forEach(entries => {
    entries.forEach(e => {
      const id = e.type.id;
      const visibleEmps = e.employees.filter(emp => !STATE.hiddenEmployeeIds.has(emp.id));
      if (id) counts[id] = (counts[id] || 0) + visibleEmps.length;
    });
  });

  STATE.absenceTypes.forEach(type => {
    const count = counts[type.id] || 0;
    if (count === 0) return; // Ocultar si el conteo es 0

    const color = resolveColor(type.color);
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (STATE.activeFilters.has(type.id) ? ' active' : '');
    chip.innerHTML = `
      <span class="filter-dot" style="background:${color}"></span>
      <span class="filter-name">${type.name}</span>
      <span class="filter-count">${count}</span>
    `;
    chip.addEventListener('click', () => toggleFilter(type.id, chip));
    container.appendChild(chip);
  });
}

function toggleFilter(typeId, chip) {
  if (STATE.activeFilters.has(typeId)) {
    STATE.activeFilters.delete(typeId);
    chip.classList.remove('active');
  } else {
    STATE.activeFilters.add(typeId);
    chip.classList.add('active');
  }
  // No need to fetch again, just re-render!
  renderCalendar();
  renderEmployeeList();
  renderStats();
}

// ── Render: employee filters ───────────────────────────────────────────────
function renderEmployeeFilterList() {
  const container = $('employee-filters');
  const title = $('emp-filter-title');
  const search = $('employee-search') ? $('employee-search').value.toLowerCase().trim() : '';
  
  if (!container) return;
  container.innerHTML = '';
  
  const emps = Array.from(STATE.allEmployees.values()).sort((a,b) => {
    const na = `${a.firstName||''} ${a.lastName||''}`.toLowerCase();
    const nb = `${b.firstName||''} ${b.lastName||''}`.toLowerCase();
    return na.localeCompare(nb);
  });
  
  emps.forEach(emp => {
    const name = `${emp.firstName||''} ${emp.lastName||''}`.trim();
    if (search && !name.toLowerCase().includes(search)) return;
    
    const isHidden = STATE.hiddenEmployeeIds.has(String(emp.id));
    
    const presence = (FichajesModule.realtimePresence || []).find(p => String(p.employeeId) === String(emp.id));
    const status = presence ? presence.status : 'out';
    const initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
    
    const label = document.createElement('label');
    label.className = 'emp-filter-item-premium';
    label.innerHTML = `
      <div class="emp-filter-main">
        <input type="checkbox" value="${emp.id}" ${isHidden ? '' : 'checked'} class="ssm-checkbox">
        <div class="emp-avatar-filter" style="${emp.imageProfileURL ? '' : `background: linear-gradient(135deg, var(--accent), var(--accent2));`}">
          ${emp.imageProfileURL 
            ? `<img src="${emp.imageProfileURL}" alt="${name}" onerror="this.parentElement.innerHTML='${initials}'; this.parentElement.style.background='linear-gradient(135deg, var(--accent), var(--accent2))'">` 
            : initials}
          <span class="status-indicator ${status}" title="Estado: ${status}"></span>
        </div>
        <div class="emp-filter-info" style="margin-left: 12px;">
          <span class="emp-filter-name" title="${name}" style="font-weight: 600;">${name}</span>
          ${emp.jobTitle ? `<span class="emp-filter-job" style="font-size: 0.65rem;">${emp.jobTitle}</span>` : ''}
        </div>
      </div>
    `;
    
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) STATE.hiddenEmployeeIds.delete(String(emp.id));
      else STATE.hiddenEmployeeIds.add(String(emp.id));
      
      renderFilters();
      renderCalendar();
      renderEmployeeList();
      renderStats();
      
      // Sincronizar Fichajes si el módulo está cargado
      if (typeof FichajesModule !== 'undefined' && FichajesModule.initialized) {
        FichajesModule.renderTable();
      }
    });
    
    container.appendChild(label);
  });

  // Update counter in title
  if (title) {
    const total = STATE.allEmployees.size;
    const hidden = STATE.hiddenEmployeeIds.size;
    const selected = total - hidden;
    title.innerHTML = `Empleados <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal">(${selected}/${total})</span>`;
  }
}

// ── Render: user info ──────────────────────────────────────────────────────
function renderUserInfo(user) {
  if (!user) return;
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Usuario';
  const initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) || '?';

  $('user-info').innerHTML = `
    <div class="user-avatar">
      ${user.imageProfileURL
        ? `<img src="${user.imageProfileURL}" alt="${name}" onerror="this.style.display='none'" />`
        : initials}
    </div>
    <div class="user-details">
      <div class="user-name">${name}</div>
      <div class="user-role">${user.jobTitle || user.email || 'Sesame HR'}</div>
    </div>
  `;
  
  // Actualizar widgets adicionales si tenemos los datos
  updateProfileWidgets(user);
}

function updateProfileWidgets(user) {
  // 1. Antigüedad
  const hiringDate = user.hiringDate || user.dateOfJoined || user.joinedDate || user.contract?.startAt || user.createdAt;
  if (hiringDate) {
    const start = new Date(hiringDate);
    if (!isNaN(start.getTime())) {
      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const today = new Date();
      const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      let years = today.getFullYear() - start.getFullYear();
      let months = today.getMonth() - start.getMonth();
      
      if (months < 0 || (months === 0 && today.getDate() < start.getDate())) {
        years--;
        months += 12;
      }
      
      let text = `${years} ${years === 1 ? 'año' : 'años'}`;
      if (months > 0) text += ` y ${months} ${months === 1 ? 'mes' : 'meses'}`;
      if (years === 0 && months === 0) text = "¡Recién llegado! ✨";
      
      const el = $('seniority-text');
      if (el) el.textContent = text;
    }
  }

  // 2. Vacaciones (Carga asíncrona dedicada)
  if (user.id) {
    fetchVacationBalance(user.id).then(balance => {
      const subEl = $('vacation-subtitle');
      const leftEl = $('vacation-days-left');
      const barEl = $('vacation-progress-bar');

      if (!balance) {
        if (subEl) subEl.textContent = "Consulta restringida";
        return;
      }
      
      const total = balance.daysTotal || balance.totalDays || balance.maxDays || 22;
      const used = balance.daysUsed || balance.usedDays || 0;
      const left = total - used;
      const percent = Math.min(100, Math.max(0, (used / total) * 100));

      if (leftEl) leftEl.textContent = `${left} días`;
      if (barEl) barEl.style.width = `${percent}%`;
      
      if (subEl) {
        let label = `${used} consumidos de ${total}`;
        if (balance.isAutocalculated) label += " (Auto)";
        subEl.textContent = label;
        subEl.title = balance.isAutocalculated ? "Calculado escaneando tu calendario anual" : "Dato oficial de Sesame HR";
      }
    });
  }
}

// ── Render: calendar ───────────────────────────────────────────────────────
function updateMonthLabel() {
  const y = STATE.currentDate.getFullYear();
  const m = STATE.currentDate.getMonth();
  
  if (STATE.calView === 'day') {
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    $('current-month-label').textContent = `${days[STATE.currentDate.getDay()]} ${STATE.currentDate.getDate()} de ${MONTHS_ES[m]} ${y}`;
  } else if (STATE.calView === 'week') {
    const range = getWeekRange(STATE.currentDate);
    const from = new Date(range.from);
    const to = new Date(range.to);
    $('current-month-label').textContent = `${from.getDate()} ${MONTHS_ES[from.getMonth()].slice(0,3)} - ${to.getDate()} ${MONTHS_ES[to.getMonth()].slice(0,3)} ${y}`;
  } else {
    $('current-month-label').textContent = `${MONTHS_ES[m]} ${y}`;
  }

  // Count total absence events in current view range
  let range;
  if (STATE.calView === 'day') range = getDayRange(STATE.currentDate);
  else if (STATE.calView === 'week') range = getWeekRange(STATE.currentDate);
  else range = getMonthRange(STATE.currentDate);
  
  let total = 0;
  Object.entries(STATE.calendarData).forEach(([date, entries]) => {
    if (date >= range.from && date <= range.to) {
      entries.forEach(e => { total += e.numEmployees; });
    }
  });
  $('absence-count-label').textContent = total === 0
    ? '0 ausencias'
    : `${total} ausencia${total===1?'':'s'}`;
}

function renderCalendar() {
  const grid = $('calendar-grid');
  grid.innerHTML = '';

  const y = STATE.currentDate.getFullYear();
  const m = STATE.currentDate.getMonth();

  if (STATE.calView === 'day') {
    grid.style.gridTemplateColumns = '1fr';
    grid.appendChild(buildDayCell(new Date(STATE.currentDate), false));
    return;
  }

  if (STATE.calView === 'week') {
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    const range = getWeekRange(STATE.currentDate);
    let curr = new Date(range.from);
    for (let i = 0; i < 7; i++) {
      grid.appendChild(buildDayCell(new Date(curr), false));
      curr.setDate(curr.getDate() + 1);
    }
    return;
  }

  // Monthly View (Default)
  grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  
  const firstDay = new Date(y, m, 1);
  let startDow = firstDay.getDay(); // 0=Sun
  if (startDow === 0) startDow = 7; // make Sun=7

  const daysInMonth = new Date(y, m+1, 0).getDate();

  // Previous month fill
  const prevMonthDays = new Date(y, m, 0).getDate();
  for (let i = startDow - 2; i >= 0; i--) {
    const day = prevMonthDays - i;
    const d = new Date(y, m-1, day);
    grid.appendChild(buildDayCell(d, true));
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    grid.appendChild(buildDayCell(date, false));
  }

  // Next month fill to complete rows
  const totalCells = grid.children.length;
  const remaining  = Math.ceil(totalCells / 7) * 7 - totalCells;
  for (let d = 1; d <= remaining; d++) {
    const date = new Date(y, m+1, d);
    grid.appendChild(buildDayCell(date, true));
  }
}

function buildDayCell(date, otherMonth) {
  const dateStr = fmtDate(date);
  const dayOfWeek = date.getDay(); // 0=Sun,6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const holidayName = HOLIDAYS_ZGZ[dateStr];
  const isHoliday = !!holidayName;

  const cell = document.createElement('div');
  cell.className = 'cal-day'
    + (otherMonth ? ' other-month' : '')
    + (isWeekend  ? ' weekend'     : '')
    + (isHoliday  ? ' holiday'     : '')
    + (isToday(dateStr) ? ' today' : '');

  let html = `<div class="day-num">${date.getDate()}</div>`;
  if (isHoliday) {
    html += `<div class="holiday-label" title="${holidayName}">🏛️ ${holidayName}</div>`;
  }
  html += `<div class="day-events"></div>`;
  
  cell.innerHTML = html;

  const events = STATE.calendarData[dateStr] || [];
  const eventsContainer = cell.querySelector('.day-events');

  // Filter by active types AND visible employees
  const filteredEvents = events
    .filter(e => STATE.activeFilters.has(e.type.id))
    .map(evt => {
      const visibleEmps = evt.employees.filter(emp => !STATE.hiddenEmployeeIds.has(emp.id));
      return { ...evt, employees: visibleEmps, numEmployees: visibleEmps.length };
    })
    .filter(evt => evt.employees.length > 0);

  filteredEvents.forEach(evt => {
    const color  = resolveColor(evt.type.color);
    const isDark = STATE.theme === 'dark';
    const bg     = hexToRgba(color, isDark ? 0.35 : 0.22);
    const pill   = document.createElement('div');
    pill.className = 'day-event-pill';
    
    // Mejor contraste y grosor de borde
    pill.style.cssText = `
      background: ${bg}; 
      border-left: 3px solid ${color}; 
      font-weight: 700; 
      color: ${isDark ? '#ffffff' : '#1e293b'};
      margin-bottom: 3px;
    `;
    
    pill.innerHTML = `
      <span class="event-dot" style="background:${color}; width:8px; height:8px; box-shadow: 0 0 5px ${color}80"></span>
      ${evt.type.name || 'Ausencia'} <span style="opacity:0.8; font-size:0.9em">(${evt.numEmployees})</span>
    `;
    eventsContainer.appendChild(pill);
  });

  // Avatars
  if (filteredEvents.length > 0) {
    const avatarRow = document.createElement('div');
    avatarRow.className = 'day-avatars';
    const allEmployees = filteredEvents.flatMap(e => e.employees);
    const shown = allEmployees.slice(0, 6);
    shown.forEach(emp => {
      avatarRow.appendChild(buildAvatar(emp, 18));
    });
    if (allEmployees.length > 6) {
      const more = document.createElement('div');
      more.className = 'day-more-badge';
      more.textContent = `+${allEmployees.length - 6}`;
      avatarRow.appendChild(more);
    }
    cell.appendChild(avatarRow);
  }

  if (!otherMonth && filteredEvents.length > 0) {
    cell.addEventListener('click', () => openModal(dateStr, filteredEvents));
  }

  return cell;
}

function buildAvatar(emp, size = 28) {
  const name = `${emp.firstName||''} ${emp.lastName||''}`.trim();
  const initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) || '?';
  const div = document.createElement('div');
  div.className = 'day-avatar';
  div.style.cssText = `width:${size}px;height:${size}px;font-size:${size*0.4}px`;
  div.title = name;
  if (emp.imageProfileURL) {
    div.innerHTML = `<img src="${emp.imageProfileURL}" alt="${name}" loading="lazy" onerror="this.style.display='none'" />`;
  }
  div.textContent = div.textContent || initials;
  if (emp.imageProfileURL) {
    div.innerHTML = `<img src="${emp.imageProfileURL}" alt="${name}" loading="lazy" onerror="this.parentNode.textContent='${initials}'" />${div.textContent.includes(initials) ? '' : ''}`;
    div.querySelector('img').onerror = () => { div.textContent = initials; };
  } else {
    div.textContent = initials;
  }
  return div;
}

// ── Render: employee list ──────────────────────────────────────────────────
function renderEmployeeList() {
  const container = $('employee-list-container');
  container.innerHTML = '';

  const range  = getMonthRange(STATE.currentDate);
  const empMap = {};  // empId → { emp, absences: Map<typeId, count> }

  Object.entries(STATE.calendarData).forEach(([date, entries]) => {
    if (date < range.from || date > range.to) return;
    entries.forEach(evt => {
      if (!STATE.activeFilters.has(evt.type.id)) return;
      evt.employees.forEach(emp => {
        if (STATE.hiddenEmployeeIds.has(emp.id)) return;
        if (!empMap[emp.id]) empMap[emp.id] = { emp, absences: new Map() };
        
        const typeId = evt.type.id;
        const entry = empMap[emp.id].absences.get(typeId) || { type: evt.type, dates: [] };
        const day = date.split('-')[2];
        if (!entry.dates.includes(day)) entry.dates.push(day);
        empMap[emp.id].absences.set(typeId, entry);
      });
    });
  });

  const empList = Object.values(empMap).sort((a,b) => {
    const ta = [...a.absences.values()].reduce((s,v)=>s+v.dates.length, 0);
    const tb = [...b.absences.values()].reduce((s,v)=>s+v.dates.length, 0);
    return tb - ta;
  });

  if (empList.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:60px 0">Sin ausencias en este período</div>`;
    return;
  }

  empList.forEach(({ emp, absences }) => {
    const name = `${emp.firstName||''} ${emp.lastName||''}`.trim();
    const initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) || '?';
    const totalDays = [...absences.values()].reduce((s,v)=>s+v.dates.length, 0);

    const tags = [...absences.entries()].map(([,v]) => {
      const color = resolveColor(v.type.color);
      const bg = hexToRgba(color, 0.25);
      const daysStr = v.dates.sort().join(', ');
      return `<span class="emp-absence-tag" style="background:${bg};border:1px solid ${color}40">
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color}"></span>
        ${v.type.name || 'Ausencia'} · ${v.dates.length}d <span style="opacity:0.7;font-size:0.85em;margin-left:4px">(${daysStr})</span>
      </span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'emp-card';
    card.innerHTML = `
      <div class="emp-avatar">
        ${emp.imageProfileURL
          ? `<img src="${emp.imageProfileURL}" alt="${name}" onerror="this.style.display='none'" />${initials}`
          : initials}
      </div>
      <div class="emp-info">
        <div class="emp-name">${name}</div>
        <div class="emp-absences">${tags}</div>
      </div>
      <div class="emp-days">
        <div class="emp-days-count">${totalDays}</div>
        <div class="emp-days-label">días</div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ── Render: stats ──────────────────────────────────────────────────────────
function renderStats() {
  const container = $('stats-container');
  container.innerHTML = '<div class="stats-loading">Generando gráficos...</div>';

  const range = getMonthRange(STATE.currentDate);
  const typeTotals = {}; 
  const employeeTotals = {};
  const dailyData = {};
  let totalAbsences = 0;

  Object.entries(STATE.calendarData).forEach(([date, entries]) => {
    if (date < range.from || date > range.to) return;
    
    const visibleInDay = entries.reduce((acc, evt) => {
      if (!STATE.activeFilters.has(evt.type.id)) return acc;
      const visibleEmps = evt.employees.filter(e => !STATE.hiddenEmployeeIds.has(e.id));
      
      const id = evt.type.id;
      if (!typeTotals[id]) typeTotals[id] = { name: evt.type.name, total: 0, color: resolveColor(evt.type.color) };
      typeTotals[id].total += visibleEmps.length;
      totalAbsences += visibleEmps.length;

      visibleEmps.forEach(e => {
        const ename = `${e.firstName} ${e.lastName}`;
        employeeTotals[ename] = (employeeTotals[ename] || 0) + 1;
      });
      
      return acc + visibleEmps.length;
    }, 0);

    if (visibleInDay > 0) dailyData[date] = visibleInDay;
  });

  const totalEmployees = Object.keys(employeeTotals).length;
  const avgDays = totalEmployees > 0 ? (totalAbsences / totalEmployees).toFixed(1) : 0;

  if (totalAbsences === 0) {
    container.innerHTML = '<div class="no-data">No hay datos para el periodo seleccionado</div>';
    return;
  }

  container.innerHTML = `
    <!-- Summary Row -->
    <div class="stats-summary-row" style="grid-column: 1 / -1; display: flex; gap: 15px; margin-bottom: 10px;">
      <div class="stat-card" style="flex:1; padding: 15px;">
        <div class="stat-label">Total Ausencias</div>
        <div class="stat-value" style="font-size: 1.5rem;">${totalAbsences}</div>
      </div>
      <div class="stat-card" style="flex:1; padding: 15px;">
        <div class="stat-label">Personas</div>
        <div class="stat-value" style="font-size: 1.5rem;">${totalEmployees}</div>
      </div>
      <div class="stat-card" style="flex:1; padding: 15px;">
        <div class="stat-label">Promedio/Emp</div>
        <div class="stat-value" style="font-size: 1.5rem;">${avgDays} d</div>
      </div>
    </div>

    <div class="stats-chart-container glass">
      <h3>Reparto por Tipo de Ausencia</h3>
      <canvas id="typeChart"></canvas>
    </div>
    <div class="stats-chart-container glass">
      <h3>Carga Diaria (Ausencias/Día)</h3>
      <canvas id="dailyChart"></canvas>
    </div>
    <div class="stats-chart-container glass" style="grid-column: 1 / -1; height: 350px;">
      <h3>Ránking de Ausencias (Top 10)</h3>
      <canvas id="empChart"></canvas>
    </div>
  `;

  const isDark = STATE.theme === 'dark';
  
  // Colores de alto contraste garantizado para AMBOS temas
  const theme = {
    text: isDark ? '#FFFFFF' : '#000000',      // Blanco puro o Negro puro
    secondary: isDark ? '#E2E8F0' : '#475569', // Texto secundario muy claro en dark
    grid: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
    border: isDark ? '#131621' : '#ffffff'
  };

  const chartColors = ['#6C63FF', '#00D4AA', '#FF6B8A', '#FFB547', '#4ADE80', '#60A5FA', '#A78BFA', '#FB923C', '#2DD4BF', '#F87171'];

  // Chart 1: Types (Donut)
  new Chart($('typeChart'), {
    type: 'doughnut',
    data: {
      labels: Object.values(typeTotals).map(t => t.name),
      datasets: [{
        data: Object.values(typeTotals).map(t => t.total),
        backgroundColor: Object.values(typeTotals).map((t, i) => chartColors[i % chartColors.length]),
        borderWidth: 2,
        borderColor: theme.border
      }]
    },
    options: {
      plugins: { 
        legend: { 
          position: 'right', 
          labels: { color: theme.text, font: { size: 12, weight: '800' }, padding: 15, usePointStyle: true } 
        } 
      },
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      spacing: 5
    }
  });

  // Chart 2: Daily Load (Line/Area)
  const sortedDates = Object.keys(dailyData).sort();
  new Chart($('dailyChart'), {
    type: 'line',
    data: {
      labels: sortedDates.map(d => d.split('-')[2]),
      datasets: [{
        label: 'Ausencias',
        data: sortedDates.map(d => dailyData[d]),
        borderColor: '#6C63FF',
        backgroundColor: isDark ? 'rgba(108, 99, 255, 0.25)' : 'rgba(108, 99, 255, 0.15)',
        fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#6C63FF'
      }]
    },
    options: {
      scales: { 
        y: { 
          beginAtZero: true, grid: { color: theme.grid }, 
          ticks: { color: theme.secondary, precision: 0, font: { weight: '800' } } 
        },
        x: { grid: { display: false }, ticks: { color: theme.secondary, font: { weight: '800' } } }
      },
      plugins: { legend: { display: false } },
      responsive: true, maintainAspectRatio: false
    }
  });

  // Chart 3: Top Employees (Horizontal Bar)
  const topEmps = Object.entries(employeeTotals).sort((a,b) => b[1] - a[1]).slice(0, 10);
  new Chart($('empChart'), {
    type: 'bar',
    data: {
      labels: topEmps.map(e => e[0]),
      datasets: [{
        label: 'Días',
        data: topEmps.map(e => e[1]),
        backgroundColor: isDark ? 'rgba(0, 212, 170, 0.5)' : 'rgba(0, 212, 170, 0.7)',
        borderColor: '#00D4AA', borderWidth: 1.5, borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      scales: { 
        x: { 
          beginAtZero: true, grid: { color: theme.grid }, 
          ticks: { color: theme.secondary, stepSize: 1, font: { weight: '800' } } 
        },
        y: { 
          grid: { display: false }, 
          ticks: { color: theme.text, font: { size: 12, weight: '800' } } 
        }
      },
      plugins: { legend: { display: false } },
      responsive: true, maintainAspectRatio: false
    }
  });
}
// ── Modal ──────────────────────────────────────────────────────────────────
function openModal(dateStr, events) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m-1, d);
  const opts    = { weekday:'long', day:'numeric', month:'long', year:'numeric' };
  $('modal-date-title').textContent = dateObj.toLocaleDateString('es-ES', opts);

  const body = $('modal-body');
  body.innerHTML = '';

  events.forEach(evt => {
    const color = resolveColor(evt.type.color);
    const section = document.createElement('div');
    section.className = 'modal-type-section';
    section.innerHTML = `
      <div class="modal-type-header">
        <span class="modal-type-dot" style="background:${color}"></span>
        ${evt.type.name || 'Ausencia'}
        <span class="pill" style="margin-left:auto">${evt.employees.length}</span>
      </div>
    `;
    evt.employees.forEach(emp => {
      const name = `${emp.firstName||''} ${emp.lastName||''}`.trim();
      const initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)||'?';
      const row = document.createElement('div');
      row.className = 'modal-employee';
      row.innerHTML = `
        <div class="modal-emp-avatar">
          ${emp.imageProfileURL
            ? `<img src="${emp.imageProfileURL}" alt="${name}" onerror="this.parentNode.textContent='${initials}'" />`
            : initials}
        </div>
        <div class="modal-emp-name">${name}</div>
        ${emp.workStatus ? `<span class="pill" style="margin-left:auto">${emp.workStatus}</span>` : ''}
      `;
      section.appendChild(row);
    });
    body.appendChild(section);
  });

  $('day-modal').classList.remove('hidden');
}

function closeModal() {
  $('day-modal').classList.add('hidden');
}

// ── Export ──────────────────────────────────────────────────────────────────
/**
 * Genera y descarga un archivo .ics con los eventos actualmente visibles.
 * Útil para importar en Google Calendar, Outlook o Apple Calendar.
 */
function exportToIcal() {
  const events = [];
  Object.entries(STATE.calendarData).forEach(([dateStr, dayEntries]) => {
    dayEntries.forEach(evt => {
      if (!STATE.activeFilters.has(evt.type.id)) return;
      
      const visibleEmps = evt.employees.filter(emp => !STATE.hiddenEmployeeIds.has(emp.id));
      if (visibleEmps.length === 0) return;

      const date = dateStr.replace(/-/g, '');
      const typeName = evt.type.name || 'Ausencia';
      
      visibleEmps.forEach(emp => {
        const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
        events.push([
          'BEGIN:VEVENT',
          `DTSTART;VALUE=DATE:${date}`,
          `DTEND;VALUE=DATE:${date}`,
          `SUMMARY:${typeName}: ${empName}`,
          `DESCRIPTION:Ausencia de tipo ${typeName} para ${empName}`,
          'END:VEVENT'
        ].join('\r\n'));
      });
    });
  });

  if (events.length === 0) {
    alert('No hay eventos visibles para exportar con los filtros actuales.');
    return;
  }

  const icalContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sesame Vacation Calendar//ES',
    events.join('\r\n'),
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sesame_ausencias_${fmtDate(new Date())}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Muestra el modal/confirm con el enlace de suscripción iCal.
 */
async function showSubscriptionModal() {
  if (!isLocalProxy()) {
    alert("Esta función requiere que la app corra a través de server.py");
    return;
  }
  
  try {
    const secret = "sesame-vacation-secret-9182";
    const msgBuffer = new TextEncoder().encode(`${STATE.companyId}${secret}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const token = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    
    const host = window.location.host;
    const url = `http://${host}/feed.ics?token=${token}`;
    
    const choice = confirm(
      `🔗 Enlace de Suscripción para Google Calendar:\n\n` +
      `${url}\n\n` +
      `¿Deseas intentar copiar este enlace al portapapeles?\n` +
      `En Google Calendar móvil/web: Añadir -> 'Desde URL'.`
    );
    
    if (choice) {
      navigator.clipboard.writeText(url).then(() => {
        alert("✅ Enlace copiado. Pégalo en Google Calendar -> Añadir desde URL.");
      });
    }
  } catch (e) {
    console.error(e);
    alert("No se pudo generar el enlace.");
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────
function shiftPeriod(dir) {
  if (STATE.calView === 'day') {
    STATE.currentDate.setDate(STATE.currentDate.getDate() + dir);
  } else if (STATE.calView === 'week') {
    STATE.currentDate.setDate(STATE.currentDate.getDate() + dir * 7);
  } else {
    STATE.currentDate.setMonth(STATE.currentDate.getMonth() + dir);
  }
  loadData();
}

function switchView(view) {
  STATE.activeView = view;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => { v.classList.add('hidden'); v.classList.remove('active'); });
  const el = $(`view-${view}`);
  if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
}

function switchCalView(calView) {
  STATE.calView = calView;
  $$('.vt-btn').forEach(b => b.classList.toggle('active', b.dataset.calView === calView));
  loadData();
}

// ── Screen management ──────────────────────────────────────────────────────
function showApp() {
  $('setup-screen').classList.remove('active');
  $('setup-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  $('app-screen').classList.add('active');
}

function showSetup() {
  $('app-screen').classList.remove('active');
  $('app-screen').classList.add('hidden');
  $('setup-screen').classList.remove('hidden');
  $('setup-screen').classList.add('active');
}

function showLoading(show) {
  $('loading-overlay').classList.toggle('hidden', !show);
}

async function logout() {
  stopAutoRefresh();
  clearCredentials();

  // Limpiar también el servidor si es entorno local
  if (isLocalProxy()) {
    try {
      await fetch('/wipe-all-config', { method: 'POST' });
      console.log("✅ Configuración del servidor limpiada.");
    } catch (e) {
      console.warn("No se pudo limpiar la configuración del servidor:", e);
    }
  }

  STATE.token = STATE.companyId = STATE.currentUser = null;
  STATE.absenceTypes = [];
  STATE.calendarData = {};
  STATE.activeFilters = new Set();
  showSetup();
}

// ── Start ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

/**
 * --- METEOROLOGÍA (ZARAGOZA) ---
 */
async function loadWeather() {
  const container = $('weather-info');
  if (!container) return;

  try {
    // Zaragoza: Lat 41.65, Lon -0.87
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=41.6561&longitude=-0.8773&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FMadrid&forecast_days=3';
    
    const res = await fetch(url);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    
    renderWeather(data);
  } catch (e) {
    console.error("Weather error:", e);
    container.innerHTML = '<div class="weather-error">Zaragoza: Clima no disponible</div>';
  }
}

function renderWeather(data) {
  const current = data.current;
  const daily = data.daily;
  const info = $('weather-info');
  
  const weatherIcons = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌦️',
    61: '🌧️', 63: '🌧️', 65: '🌧️',
    71: '❄️', 73: '❄️', 75: '❄️',
    80: '🌦️', 81: '🌦️', 82: '🌦️',
    95: '⛈️'
  };

  const getIcon = (code) => weatherIcons[code] || '🌡️';

  let html = `
    <div class="weather-current">
      <div class="w-main">
        <span class="w-icon">${getIcon(current.weather_code)}</span>
        <span class="w-temp">${Math.round(current.temperature_2m)}°</span>
      </div>
      <div class="w-city">Zaragoza</div>
    </div>
    <div class="weather-forecast">
  `;

  for (let i = 0; i < daily.time.length; i++) {
    const dayName = i === 0 ? 'Hoy' : new Date(daily.time[i]).toLocaleDateString('es-ES', { weekday: 'short' });
    html += `
      <div class="w-day">
        <span class="wd-name">${dayName}</span>
        <span class="wd-icon">${getIcon(daily.weather_code[i])}</span>
        <span class="wd-temps">${Math.round(daily.temperature_2m_max[i])}°/${Math.round(daily.temperature_2m_min[i])}°</span>
      </div>
    `;
  }

  html += '</div>';
  info.innerHTML = html;
}
// --- FICHAJES MODULE LOGIC ---
/**
 * FichajesModule
 * Motor de gestión para la vista de actividad real.
 * Se encarga de la navegación temporal, filtrado por empleado,
 * exportación de reportes y visualización de la línea de tiempo.
 */
const FichajesModule = {
  currentDate: new Date(),
  currentView: 'month',
  data: [],
  selectedEmployee: 'all',
  searchQuery: '',
  presenceFilter: 'all', // 'all', 'working', 'paused'
  kioskoMode: false,
  failedIds: new Set(),
  
  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.setupEventListeners();
  },
  
  setupEventListeners() {
    // Navegación Temporal
    document.getElementById('prev-month-signings')?.addEventListener('click', () => {
      if (this.currentView === 'day') this.currentDate.setDate(this.currentDate.getDate() - 1);
      else if (this.currentView === 'week') this.currentDate.setDate(this.currentDate.getDate() - 7);
      else this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      
      this.updateMonthLabel();
      this.loadData();
    });
    
    document.getElementById('next-month-signings')?.addEventListener('click', () => {
      if (this.currentView === 'day') this.currentDate.setDate(this.currentDate.getDate() + 1);
      else if (this.currentView === 'week') this.currentDate.setDate(this.currentDate.getDate() + 7);
      else this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      
      this.updateMonthLabel();
      this.loadData();
    });

    // Botón Hoy
    document.getElementById('today-signings')?.addEventListener('click', () => {
      this.currentDate = new Date();
      this.updateMonthLabel();
      this.loadData();
    });

    // Selector de Vista (Día, Semana, Mes)
    const viewButtons = document.querySelectorAll('#fichajes-view-toggle .vt-btn');
    viewButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target.closest('.vt-btn');
        if (!target) return;
        
        const view = target.dataset.fichajeView;
        if (!view) return;
        
        // Actualizar UI activa
        viewButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        
        // Cargar datos
        this.currentView = view;
        this.updateMonthLabel();
        this.loadData();
      });
    });
    
    // Búsqueda en tiempo real
    document.getElementById('signings-employee-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderTable();
    });
    
    // Exportar a CSV
    document.getElementById('export-signings-csv')?.addEventListener('click', () => {
      this.exportToCSV();
    });
    
    // Filtro por Empleado
    document.getElementById('signings-employee-select')?.addEventListener('change', (e) => {
      this.selectedEmployee = e.target.value;
      this.renderTable();
    });
    // Theme toggle in signings header
    document.getElementById('theme-btn-signings')?.addEventListener('click', () => {
      toggleTheme();
    });

    // Refresh btn
    document.getElementById('refresh-signings-btn')?.addEventListener('click', () => {
      this.loadData();
    });

    // Sidebar toggle (needed for this module too)
    document.getElementById('sidebar-toggle-fichajes')?.addEventListener('click', () => {
      STATE.sidebarCollapsed = !STATE.sidebarCollapsed;
      document.body.classList.toggle('sidebar-collapsed', STATE.sidebarCollapsed);
      localStorage.setItem('ssm_sidebar_collapsed', STATE.sidebarCollapsed);
    });

    // Smart Presence Filters
    document.getElementById('filter-live-working')?.addEventListener('click', () => this.togglePresenceFilter('working'));
    document.getElementById('filter-live-paused')?.addEventListener('click', () => this.togglePresenceFilter('paused'));

    // Kiosko Mode
    document.getElementById('kiosko-mode-btn')?.addEventListener('click', () => this.toggleKioskoMode());
    
    // Listen for fullscreen change to sync state
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        this.kioskoMode = false;
        document.body.classList.remove('kiosko-mode-active');
      }
    });
  },

  togglePresenceFilter(type) {
    if (this.presenceFilter === type) {
      this.presenceFilter = 'all';
    } else {
      this.presenceFilter = type;
    }
    this.renderTable();
  },

  toggleKioskoMode() {
    this.kioskoMode = !this.kioskoMode;
    document.body.classList.toggle('kiosko-mode-active', this.kioskoMode);
    
    if (this.kioskoMode) {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
          console.warn("Fullscreen error", err);
        });
      }
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    }
  },
  
  updateMonthLabel() {
    const el = document.getElementById('current-month-signings');
    if (!el) return;
    
    if (this.currentView === 'day') {
      const hoy = new Date();
      if (this.currentDate.toDateString() === hoy.toDateString()) {
        el.textContent = "Hoy - " + this.currentDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      } else {
        el.textContent = this.currentDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
    } else if (this.currentView === 'week') {
      const start = new Date(this.currentDate);
      const day = start.getDay() || 7; // Sunday is 0, make it 7
      start.setDate(start.getDate() - day + 1);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      
      el.textContent = `${start.toLocaleDateString('es-ES', {day: 'numeric', month: 'short'})} al ${end.toLocaleDateString('es-ES', {day: 'numeric', month: 'short', year: 'numeric'})}`;
    } else {
      el.textContent = this.currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    }
  },
  
  async loadData() {
    let startDate = new Date(this.currentDate);
    let endDate = new Date(this.currentDate);
    
    if (this.currentView === 'day') {
      // startDate and endDate are the same
    } else if (this.currentView === 'week') {
      const day = startDate.getDay() || 7;
      startDate.setDate(startDate.getDate() - day + 1);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
    } else {
      startDate.setDate(1);
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    }

    const start = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    console.log("Loading Fichajes for", start, "to", end);
    
    try {
      this.renderSkeletons();
      
      // RESTAURACIÓN DEL SELECTOR: Cargamos el desplegable nada más empezar
      // para que el usuario pueda filtrar aunque la carga de datos falle.
      this.populateEmployeeSelect();
      
      let biData = [];
      try {
        const res = await apiFetchBi({
          "from": "schedule_context_check",
          "select": [
            {"field": "schedule_context_check.date", "alias": "date"},
            {"field": "schedule_context_check.check_in_check_datetime", "alias": "checkIn"},
            {"field": "schedule_context_check.check_out_check_datetime", "alias": "checkOut"},
            {"field": "schedule_context_check.seconds_worked", "alias": "secondsWorked"},
            {"field": "schedule_context_check.type", "alias": "type"},
            // {"field": "schedule_context_check.check_in_latitude", "alias": "checkInLat"},
            // {"field": "schedule_context_check.check_in_longitude", "alias": "checkInLon"},
            // {"field": "schedule_context_check.check_out_latitude", "alias": "checkOutLat"},
            // {"field": "schedule_context_check.check_out_longitude", "alias": "checkOutLon"},
            {"field": "schedule_context_check.origin", "alias": "origin"},
            {"field": "core_context_employee.name", "alias": "employeeName"},
            {"field": "core_context_employee.id", "alias": "employeeId"}
          ],
          "where": [
            {"field": "schedule_context_check.date", "operator": ">=", "value": start},
            {"field": "schedule_context_check.date", "operator": "<=", "value": end}
          ],
          "order_by": [{"field": "date", "direction": "DESC"}],
          "limit": 5000
        });
        biData = res.data || res || [];
      } catch (biErr) {
        console.warn("BI Engine failed (Expected 403):", biErr);
        // Silenciamos para Auditoría
      }
      
      // 2. Cargar ausencias/festivos en el mismo rango para ajustar jornada teórica
      const absRes = await fetchCalendarGrouped(start, end, []);
      const localAbsences = {};
      absRes.forEach(dayObj => {
        if (dayObj.date) {
          localAbsences[dayObj.date] = dayObj.calendar_types || [];
          // COSECHA INTELIGENTE: También extraemos perfiles desde aquí
          localAbsences[dayObj.date].forEach(ct => {
            (ct.employees || []).forEach(emp => upsertEmployee(emp));
          });
        }
      });

      // 3. Carga en paralelo de Presencia Real-time para contadores
      console.log("Fetching live presence...");
      const presenceRes = await fetchPresence();
      this.realtimePresence = presenceRes;
      
      // Sincronizar perfiles desde presencia (a veces trae fotos que otros no)
      presenceRes.forEach(p => {
        if (p.employee) upsertEmployee(p.employee);
      });

      this.data = this.parseRealSignings(biData, localAbsences);
      console.log(`BI Data parsed: ${this.data.length} employees with activity.`);

      // SUPER FALLBACK: Si no hay datos en BI, pedimos los fichajes emp a emp (Nuevo API Sesame 2026)
      if (this.data.length === 0) {
        console.warn("BI Engine failed. Trying Global Search Discovery...");
        AUDIT.isSearching = true;
        try {
          // 1. Intentar Búsqueda por Estadísticas Diarias o Búsqueda Global (Manager View)
          let globalData = null;
          
          if (DISCOVERY.workingChecks !== 'DISABLED') {
            const candidates = DISCOVERY.workingChecks 
              ? [DISCOVERY.workingChecks] 
              : [
                '/api/v3/statistics/daily-computed-hour-stats',
                '/api/v3/work-entries/search',
                '/api/v3/attendance/work-entries/search'
              ];

            for (const rawPath of candidates) {
              try {
                let path = rawPath.replace('{companyId}', STATE.companyId || '');
                const res = await apiFetch(path, { from: start, to: end, limit: 1000 });
                
                let records = [];
                if (res && res.data) {
                  records = Array.isArray(res.data) ? res.data : (res.data.items || []);
                }
                
                if (records.length > 0) {
                  console.log(`✅ Global Discovery Success at ${path}: Found ${records.length} records.`);
                  globalData = records;
                  if (!DISCOVERY.workingChecks) {
                    DISCOVERY.workingChecks = rawPath;
                    localStorage.setItem('ssm_path_checks', rawPath);
                  }
                  break;
                }
              } catch (e) {
                // Si ya teníamos una ruta guardada y falla, la invalidamos para re-descubrir
                if (DISCOVERY.workingChecks && (e.message.includes('404') || e.message.includes('405'))) {
                   DISCOVERY.workingChecks = null;
                   localStorage.removeItem('ssm_path_checks');
                }
                console.log(`Global discovery at ${rawPath} failed.`);
              }
            }
          }

          if (globalData) {
             // ESTRATEGIA HÍBRIDA: Si hemos recuperado datos globales (que suelen ser resúmenes sin pausas),
             // intentamos pedir los detalles específicos de "nuestro" usuario para no perder sus tipos/colores.
             const myId = getCurrentEmployeeId();
             if (myId) {
                try {
                   console.log("Hybrid Mode: Fetching personal details for timeline accuracy...");
                   const myChecks = await apiFetch(`/api/v3/employees/${myId}/checks?from=${start}&to=${end}&includeOut=true`, { method: 'GET' });
                   if (myChecks && myChecks.data && myChecks.data.length > 0) {
                      // Filtramos los registros resumidos de "mí mismo" que vienen del global
                      // y los reemplazamos por los detallados que traen pausas.
                      const others = globalData.filter(r => String(r.employeeId || (r.employee && r.employee.id)) !== String(myId));
                      globalData = [...others, ...myChecks.data.map(c => ({...c, employeeId: myId}))];
                   }
                } catch (e) {
                   console.warn("Could not enhance personal data with details.");
                }
             }

             this.realSignings = globalData;
             this.data = this.parseRealSignings(globalData, localAbsences);
             return; 
          }

          // 2. Si lo anterior falla (403/404), procedemos al fallback individual
          console.warn("Global Discovery failed. Proceeding with individual employee audit (Slow & Self-only if not admin)...");

          // Asegurarnos de tener la lista completa de IDs de la empresa
          if (STATE.allEmployees.size <= 1) {
             console.log("Refreshing employee list for broad search...");
             const freshEmps = await fetchEmployees();
             freshEmps.forEach(e => upsertEmployee(e));
          }

          let allIds = Array.from(STATE.allEmployees.keys());
          
          // Asegurar que estamos nosotros mismos
          const myId = getCurrentEmployeeId();
          if (myId && !allIds.includes(String(myId))) {
             allIds.push(String(myId));
          }

          if (allIds.length === 0) {
            console.warn("No employee IDs found for fetching checks.");
          } else {
            const rawData = [];
            const targetIds = allIds.slice(0, 100);

            // OPTIMIZACIÓN: No reintentar IDs que ya sabemos que dan 403 en esta sesión

            for (let i = 0; i < targetIds.length; i += 8) {
               const chunk = targetIds.slice(i, i + 8).filter(id => !this.failedIds.has(id));
               if (chunk.length === 0) continue;

               console.log(`Auditing batch of ${chunk.length} emps...`);
               const reqs = chunk.map(id => 
                 apiFetch(`/api/v3/employees/${id}/checks?from=${start}&to=${end}&includeOut=true`, { method: 'GET' })
                 .then(res => ({ id, res }))
                 .catch(err => {
                    const msg = err.message || "";
                    if (msg.includes('403')) {
                       console.warn(`Permission denied for ${id}. Skipping future attempts.`);
                       this.failedIds.add(id);
                    }
                    return { id, err: msg };
                 })
               );
               
               const results = await Promise.all(reqs);
               results.forEach(({ id, res }) => {
                 if (res && res.data && res.data.length > 0) {
                    res.data.forEach(hit => {
                        hit.employeeId = id;
                        rawData.push(hit);
                    });
                 }
               });
            }

            if (rawData.length > 0) {
               console.log(`Fallback recovered ${rawData.length} raw records. Parsing...`);
               this.data = this.parseRealSignings(rawData, localAbsences);
            }
          }
        } catch (err) {
          console.error("Master Fallback (Checks) failed:", err);
        } finally {
          AUDIT.isSearching = false;
        }
      }
      
      // FINAL MERGE: Si seguimos sin datos pero hay gente PRESENTE (fetchPresence), 
      // generamos registros "fantasma" para que al menos se vean en la lista.
      if (this.data.length === 0 && this.realtimePresence.length > 0) {
        console.log("Merging presence into empty findings...");
        this.realtimePresence.forEach(p => {
          if ((p.status === 'work' || p.status === 'pause') && p.employee) {
             const emp = p.employee;
             this.data.push({
               employeeId: emp.id,
               employeeName: `${emp.firstName} ${emp.lastName}`,
               photoUrl: emp.imageProfileURL || '',
               date: new Date().toISOString().split('T')[0],
               dayName: 'Hoy',
               entries: [{ in: 'En vivo', out: '--:--', type: p.status, typeLabel: p.status === 'work' ? 'Trabajando' : 'Pausa' }],
               workedSeconds: 0,
               theoreticSeconds: 28800,
               isLive: true
             });
          }
        });
      }

      if (this.data.length === 0) {
        const msg = AUDIT.isSearching ? "Buscando puerta de enlace alternativa..." : (isLocalProxy() ? "Sesame no ha devuelto registros para este periodo." : "Sin datos.");
        
        // Reporte de Auditoría para el usuario
        const auditInfo = [
          `Estadísticas(BI): ${AUDIT.lastBiStatus || '?' }`,
          `Registros(Raw): ${AUDIT.lastRawStatus || '?' }`,
          `Presencia: ${AUDIT.lastPresenceStatus || '?' }`,
          `Perfil Me: ${AUDIT.lastMeStatus || '?' }`
        ].join(' | ');

        document.getElementById('signings-tbody').innerHTML = `
          <tr>
            <td colspan="4" style="text-align:center; padding: 60px 40px; color: var(--text-muted);">
              <div style="font-size: 1.1rem; font-weight: 500; margin-bottom: 12px;">${msg}</div>
              <div style="font-size: 11px; opacity: 0.5; font-family: monospace;">Diagnóstico: ${auditInfo}</div>
              <div style="font-size: 10px; opacity: 0.4; margin-top: 4px;">Ruta pres. activa: ${DISCOVERY.workingPresence || 'Buscando...'}</div>
              <div style="margin-top: 20px;">
                <button class="btn-secondary" onclick="FichajesModule.loadData()" style="font-size: 0.75rem;">Reintentar auditoría profunda</button>
              </div>
            </td>
          </tr>`;
        this.renderPresenceSummaryOnly();
      } else {
        this.renderTable();
      }
      
      // REFRESCAR BARRA LATERAL: Para que los puntos de estado se vean al instante tras la carga
      renderEmployeeFilterList();

    } catch (err) {
      console.error("Error al cargar fichajes:", err);
      document.getElementById('signings-tbody').innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 40px; color: #ff5555;">Error al conectar con Sesame: ${err.message}</td></tr>`;
    } finally {
      // Finalizado
    }
  },

  renderSkeletons() {
    const tbody = document.getElementById('signings-tbody');
    if (!tbody) return;
    tbody.innerHTML = Array(6).fill(0).map(() => `
      <tr class="skeleton-row">
        <td><div class="skeleton-box" style="width: 150px;"></div></td>
        <td><div class="skeleton-box" style="width: 100px;"></div></td>
        <td><div class="skeleton-box" style="width: 120px;"></div></td>
        <td><div class="skeleton-box" style="width: 100%;"></div></td>
      </tr>
    `).join('');
  },

  setupAutoRefresh() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    
    const isToday = this.currentDate.toDateString() === new Date().toDateString();
    if (this.currentView === 'day' && isToday) {
      this.refreshInterval = setInterval(() => {
        if (STATE.currentModule === 'fichajes') {
          console.log("Auto-refreshing dashboard...");
          this.loadData();
        }
      }, 120000); // 2 minutos
    }
  },
  
  populateEmployeeSelect() {
    const select = document.getElementById('signings-employee-select');
    if (!select) return;
    
    // Guardar selección actual
    const current = select.value;
    select.innerHTML = '<option value="all">👥 Ver a todo el equipo</option>';
    
    const sorted = Array.from(STATE.allEmployees.values()).sort((a,b) => a.firstName.localeCompare(b.firstName));
    sorted.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = `${emp.firstName} ${emp.lastName}`;
      select.appendChild(opt);
    });
    
    select.value = current;
    if (select.value === "") select.value = "all";
  },
  
  /**
   * Algoritmo de orquestación y cruce (Smart Match).
   * Transforma los registros RAW de Sesame BI en una estructura agrupada por empleado/día,
   * asignando etiquetas de ausencia a los tramos de trabajo que coincidan temporalmente.
   * @param {Array} biData - Registros brutos de fichajes.
   * @param {Object} localAbsences - Mapa de ausencias del calendario por fecha.
   * @returns {Array} Listado procesado listo para renderizar.
   */
  parseRealSignings(biData, localAbsences = {}) {
    // Normalizar datos de entrada (Soporte para múltiples formatos de Sesame 2026)
    const normalizedData = biData.map(c => {
      // Manejo de checkIn/Out como objetos o strings
      const inStr = (c.checkIn && typeof c.checkIn === 'object') ? c.checkIn.date : c.checkIn;
      const outStr = (c.checkOut && typeof c.checkOut === 'object') ? c.checkOut.date : c.checkOut;
      
      return {
        ...c,
        date: c.date || (inStr || outStr || '').split('T')[0] || '1970-01-01',
        checkIn: inStr,
        checkOut: outStr,
        secondsWorked: c.secondsWorked || c.accumulatedSeconds || c.seconds || 0,
        type: (c.checkType || c.type || c.entryType || 'work').toLowerCase(),
        employeeName: c.employeeName || 
                      (c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : null) || 
                      (() => {
                        const eId = String(c.employeeId || (c.employee && c.employee.id) || c.employee_id || '');
                        const stored = STATE.allEmployees.get(eId);
                        return stored ? `${stored.firstName} ${stored.lastName}` : `ID ${eId}`;
                      })(),
        employeeId: String(c.employeeId || (c.employee && c.employee.id) || c.employee_id || '')
      };
    }).filter(c => c.employeeId);

    const out = [];
    // Group them by Employee + Date
    const grouped = {};
    for (const record of normalizedData) {

      const key = `${record.employeeId}_${record.date}`;
      if (!grouped[key]) {
        // Find if there's an absence for this date/employee
        let absenceLabel = "";
        let absenceSegments = [];
        const dayAbsences = localAbsences[record.date] || [];
        for (const ct of dayAbsences) {
          const emps = ct.employees || [];
          // Comparación robusta de IDs para vincular ausencias con fichajes
          const myAbs = emps.find(e => String(e.id) === String(record.employeeId));
          if (myAbs) {
            const rawType = ct.calendar_type || {};
            const masterType = STATE.absenceTypes.find(t => t.id === rawType.id) || {};
            absenceLabel = masterType.name || rawType.name || "Ausencia";
            
            // Búsqueda exhaustiva de horarios en múltiples formatos y sub-objetos
            let sTimeRaw = myAbs.start_time || myAbs.startTime || myAbs.time_start || myAbs.timeStart || myAbs.time_from || myAbs.timeFrom || myAbs.start ||
                             (myAbs.partialDay && (myAbs.partialDay.start_time || myAbs.partialDay.startTime)) ||
                             (myAbs.details && (myAbs.details.start_time || myAbs.details.startTime));
            
            let eTimeRaw = myAbs.end_time || myAbs.endTime || myAbs.time_end || myAbs.timeEnd || myAbs.time_to || myAbs.timeTo || myAbs.end ||
                             (myAbs.partialDay && (myAbs.partialDay.end_time || myAbs.partialDay.endTime)) ||
                             (myAbs.details && (myAbs.details.end_time || myAbs.details.endTime));

            // Soporte para segundos desde el inicio del día (formato Sesame BI)
            if (!sTimeRaw && myAbs.start_time_seconds !== undefined) {
              const h = Math.floor(myAbs.start_time_seconds / 3600);
              const m = Math.floor((myAbs.start_time_seconds % 3600) / 60);
              sTimeRaw = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:00`;
            }
            if (!eTimeRaw && myAbs.end_time_seconds !== undefined) {
              const h = Math.floor(myAbs.end_time_seconds / 3600);
              const m = Math.floor((myAbs.end_time_seconds % 3600) / 60);
              eTimeRaw = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:00`;
            }

            // Capturamos la ausencia para el panel de detalles (aunque no se vea en la línea de tiempo gráfica)
            absenceSegments.push({
              start: sTimeRaw || "00:00:00",
              end: eTimeRaw || "23:59:59",
              isFullDay: !sTimeRaw,
              label: absenceLabel,
              color: masterType.color || 'var(--accent)'
            });
            // No hacemos break para permitir múltiples ausencias parciales el mismo día
          }
        }

        // Find dayName
        const dObj = new Date(record.date + 'T00:00:00');
        let dayName = dObj.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });
        dayName = dayName.charAt(0).toUpperCase() + dayName.slice(1);
        
        grouped[key] = {
          employeeId: record.employeeId,
          employeeName: (record.employeeName || `Empleado #${record.employeeId || '?' }`).trim(),
          date: record.date,
          dayName: dayName,
          totalWorkedSeconds: 0,
          absenceLabel: absenceLabel,
          absenceSegments: absenceSegments,
          entries: []
        };
      }
      
      let inTime = "--:--";
      if (record.checkIn) {
        const inD = new Date(record.checkIn);
        inTime = `${String(inD.getHours()).padStart(2,'0')}:${String(inD.getMinutes()).padStart(2,'0')}`;
      }
      let outTime = "--:--";
      if (record.checkOut) {
        const outD = new Date(record.checkOut);
        outTime = `${String(outD.getHours()).padStart(2,'0')}:${String(outD.getMinutes()).padStart(2,'0')}`;
      }
      
      // CRUCE INTELIGENTE: Si el fichaje solapa con una ausencia programada, usar ese tipo
      let typeClass = record.type === 'work' ? 'work' : (record.type === 'pause' ? 'pause' : 'special');
      let typeLabel = record.type === 'work' ? 'Trabajo' : (record.type === 'pause' ? 'Pausa' : record.type);
      
      const dayAbsences = grouped[key].absenceSegments || [];
      const entryStart = record.checkIn ? new Date(record.checkIn).getTime() : 0;
      
      for (const abs of dayAbsences) {
        // Convertir horario de ausencia (HH:mm:ss) a timestamp para comparar
        const [h, m] = abs.start.split(':').map(Number);
        const absDate = new Date(record.date + 'T00:00:00');
        absDate.setHours(h, m, 0);
        const absStartTs = absDate.getTime();
        
        // Emparejar solo si el fichaje empieza dentro del bloque de la ausencia parcial
        if (entryStart >= absStartTs && entryStart < absStartTs + (4 * 3600 * 1000)) { // Margen de 4h
           typeClass = 'private';
           typeLabel = abs.label;
           break;
        }
      }

       let durationSeconds = 0;
       if (record.checkIn && record.checkOut) {
         durationSeconds = (new Date(record.checkOut) - new Date(record.checkIn)) / 1000;
       }
       const durH = Math.floor(durationSeconds / 3600);
       const durM = Math.round((durationSeconds % 3600) / 60);
       const durationLabel = durationSeconds > 0 ? `${durH}h ${durM}m` : '--';

       grouped[key].entries.push({
         inOriginal: record.checkIn,
         outOriginal: record.checkOut,
         in: inTime,
         out: outTime,
         duration: durationLabel,
         type: typeClass,
         typeLabel: typeLabel,
         loc: record.origin || 'Oficina'
       });
      
      grouped[key].totalWorkedSeconds += (record.secondsWorked || 0);
    }
    
    // Transform groups to array format expected by renderTable
    const todayStr = new Date().toISOString().split('T')[0];
    for (const key in grouped) {
      const g = grouped[key];
      // Sort entries by checkIn
      g.entries.sort((a,b) => (a.inOriginal > b.inOriginal ? 1 : -1));
      
      // Detect if "LIVE" (any entry still open today)
      const isLive = g.date === todayStr && g.entries.some(e => (!e.outOriginal || e.out === "--:--"));
      
      // Recuperar la jornada teórica y datos extra del empleado
      // Comparación robusta de IDs para asegurar el cruce con el directorio
      const emp = STATE.allEmployees.get(String(g.employeeId));
      
      // Forzar lectura en hora local para evitar desajustes de día de la semana
      const dObj = new Date(g.date + 'T00:00:00'); 
      const dayOfWeek = dObj.getDay(); // 0: Domingo, 1: Lunes...
      let theoreticSeconds = 28800; // 8h por defecto
      
      if (emp && emp.workdays) {
        theoreticSeconds = emp.workdays[dayOfWeek] ?? 28800;
      }
      
      // Si hay ausencia (festivo, vacaciones), la jornada teórica suele ser 0
      if (g.absenceLabel) {
        theoreticSeconds = 0;
      }
      
      out.push({
        employeeId: g.employeeId,
        employeeName: g.employeeName,
        photoUrl: emp?.imageProfileURL || '',
        jobTitle: emp?.jobTitle || '',
        date: g.date,
        dayName: g.dayName,
        absenceLabel: g.absenceLabel,
        inTime: g.entries[0]?.in ?? "--:--",
        outTime: g.entries[g.entries.length - 1]?.out ?? "--:--",
        workedSeconds: g.totalWorkedSeconds,
        theoreticSeconds: theoreticSeconds,
        absenceSegments: g.absenceSegments,
        isLive: isLive,
        entries: g.entries
      });
    }
    return out;
  },

  /**
   * Renderiza la tabla de fichajes y el resumen de horas en la interfaz.
   * Aplica filtros de búsqueda y selección de empleado en tiempo real.
   */
  renderTable() {
    const tbody = document.getElementById('signings-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const myId = getCurrentEmployeeId();
    const isTeamView = !this.selectedEmployee || this.selectedEmployee === 'all';
    const isOtherEmployeeSelected = this.selectedEmployee && this.selectedEmployee !== 'all' && String(this.selectedEmployee) !== String(myId);
    
    // UI Hint: Restricted Access (Detección de 403 en esta sesión)
    // Mostramos el aviso si:
    // 1. Estamos viendo todo el equipo y hay restricciones.
    // 2. Hemos seleccionado a un compañero y sabemos que no tenemos permiso (403).
    let showWarning = false;
    if (isTeamView && AUDIT.teamChecksRestricted) showWarning = true;
    if (isOtherEmployeeSelected && (AUDIT.teamChecksRestricted || this.failedIds?.has(String(this.selectedEmployee)))) showWarning = true;

    if (showWarning) {
       const warningRow = document.createElement('tr');
       const isSpecific = isOtherEmployeeSelected;
       warningRow.innerHTML = `
         <td colspan="4" style="background: rgba(239, 68, 68, 0.05); border-bottom: 1px solid rgba(239, 68, 68, 0.2); padding: 16px; text-align: center;">
            <div style="display: inline-flex; align-items: center; gap: 10px; color: #f87171; font-size: 0.85rem; max-width: 600px;">
               <span style="font-size: 1.2rem;">🛡️</span>
               <div style="text-align: left;">
                  <strong style="display: block; margin-bottom: 2px;">${isSpecific ? 'Sin Acceso a este Perfil' : 'Acceso de Equipo Restringido'}</strong>
                  <span style="opacity: 0.8;">Sesame ha denegado el acceso (403 Forbidden). ${isSpecific ? 'No tienes permisos para ver los fichajes de este compañero.' : 'Solo puedes ver tu propia actividad en esta sesión.'}</span>
               </div>
            </div>
         </td>
       `;
       tbody.appendChild(warningRow);
    }
    
    let filtered = this.data || [];
    if (this.selectedEmployee && this.selectedEmployee !== 'all') {
      const targetId = String(this.selectedEmployee);
      filtered = filtered.filter(row => String(row.employeeId) === targetId);
    }
    
    if (this.searchQuery) {
      const q = String(this.searchQuery).toLowerCase();
      filtered = filtered.filter(row => String(row.employeeName || '').toLowerCase().includes(q));
    }

    // Sort: Las más recientes primero
    filtered.sort((a,b) => (b.date || '').localeCompare(a.date || '') || (a.employeeName || '').localeCompare(b.employeeName || ''));
    
    if (filtered.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `
        <td colspan="4" style="text-align:center; padding: 40px; color: var(--text-muted);">
          No hay fichajes que coincidan con los filtros aplicados en este periodo.
        </td>`;
      tbody.appendChild(emptyRow);
      return;
    }

    let totalWorked = 0;
    let totalTheoretic = 0;
    
    filtered.forEach((row, idx) => {
      try {
        const worked = Number(row.workedSeconds || 0);
        const theoretic = Number(row.theoreticSeconds || 0);
        totalWorked += worked;
        totalTheoretic += theoretic;

        const empName = String(row.employeeName || 'Empleado');
        const empId = String(row.employeeId || '');

        const workedH = Math.floor(worked / 3600);
        const workedM = Math.floor((worked % 3600) / 60);
        const theoH = Math.floor(theoretic / 3600);
        
        let alertHtml = "";
        if (worked > 0) {
          if (worked < theoretic * 0.95 && !row.isLive) {
            alertHtml = '<span class="hour-alert alert-warning" title="Jornada incompleta">!</span>';
          } else if (worked > theoretic * 1.05) {
            alertHtml = '<span class="hour-alert alert-success" title="Horas extra">+</span>';
          }
        }

        // --- MULTI-SEGMENT TIMELINE ---
        const timelineSegments = (row.entries || []).map(e => {
          if (!e.in || !e.out || e.in === "--:--" || e.out === "--:--") return "";
          if (e.in.includes(' ')) return ""; 
          const [hIn, mIn] = e.in.split(':').map(Number);
          const [hOut, mOut] = e.out.split(':').map(Number);
          if (isNaN(hIn) || isNaN(hOut)) return "";
          const start = ((hIn + (mIn||0)/60) / 24) * 100;
          const width = (((hOut + (mOut||0)/60) - (hIn + (mIn||0)/60)) / 24) * 100;
          return `<div class="timeline-bar ${e.type || 'work'}" style="left: ${start}%; width: ${width}%;" title="${e.typeLabel || 'Trabajo'}: ${e.in} - ${e.out}"></div>`;
        }).join('');
        
        const tr = document.createElement('tr');
        tr.className = 'row-expandable';
        tr.innerHTML = `
          <td class="col-employee">
            <div class="employee-cell">
              <div class="emp-avatar-sm clickable" onclick="event.stopPropagation(); showContactCard('${empId}')" style="${row.photoUrl ? '' : `background: linear-gradient(135deg, var(--accent), var(--accent2));`}">
                ${row.photoUrl 
                  ? `<img src="${row.photoUrl}" alt="${empName}" onerror="this.parentElement.innerHTML='${empName.substring(0,2).toUpperCase()}';">` 
                  : empName.substring(0,2).toUpperCase()}
              </div>
              <div class="employee-info-cell">
                <span style="font-weight: 600;">${empName}</span>
                ${row.absenceLabel ? `<span class="badge-absence">📌 ${row.absenceLabel}</span>` : ''}
              </div>
              ${row.isLive ? '<span class="pulse-dot green"></span>' : ''}
            </div>
          </td>
          <td class="col-date">${row.dayName || ''}</td>
          <td class="col-hours text-center">
             <strong>${workedH}h ${workedM}m</strong> / ${theoH}h ${alertHtml}
          </td>
          <td class="col-timeline"><div class="timeline-track">${timelineSegments}</div></td>
        `;

        const trDetails = document.createElement('tr');
        trDetails.className = 'row-details';
        trDetails.innerHTML = `
          <td colspan="10">
            <div class="details-container">
              <div class="details-layout-split">
                <div class="signings-table-wrapper">
                  <table class="details-tech-table">
                    <thead><tr><th>HORARIO</th><th>DURACIÓN</th><th>TIPO</th></tr></thead>
                    <tbody>
                      ${(row.entries || []).map(e => {
                        const icon = e.type === 'work' ? '💼' : (e.type === 'pause' ? '☕' : '🚪');
                        const typeCls = e.type === 'work' ? 'type-work' : (e.type === 'pause' ? 'type-pause' : 'type-abs');
                        return `
                        <tr>
                          <td><strong>${e.in} - ${e.out}</strong></td>
                          <td><span class="td-duration">${e.duration || '--'}</span></td>
                          <td><span class="signing-type-badge ${typeCls}">${icon} ${e.typeLabel || 'Trabajo'}</span></td>
                        </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
                <div class="signings-stats-panel">
                   <div class="info-title">📊 Resumen de Jornada</div>
                   <div class="stat-value">${workedH}h ${workedM}m</div>
                   <div class="stat-subtext">Total trabajado en este día</div>
                   
                   ${row.absenceLabel ? `
                   <div class="info-title">📌 Nota</div>
                   <div class="stat-subtext" style="color:var(--accent)">${row.absenceLabel}</div>
                   ` : ''}
                </div>
              </div>
            </div>
          </td>
        `;

        tr.addEventListener('click', () => trDetails.classList.toggle('active'));
        tbody.appendChild(tr);
        tbody.appendChild(trDetails);

      } catch (err) {
        console.error("Error drawing row:", err);
      }
    });

    const totalEl = document.getElementById('total-worked-hours');
    if (totalEl) totalEl.textContent = `${Math.floor(totalWorked/3600)}h ${Math.floor((totalWorked%3600)/60)}m`;
    this.renderPresenceSummaryOnly();
  },

  renderPresenceSummaryOnly() {
    let currentlyWorking = 0;
    let currentlyPaused = 0;

    if (this.realtimePresence && this.realtimePresence.length > 0) {
      this.realtimePresence.forEach(p => {
        if (p.status === 'work' || p.status === 'working') currentlyWorking++;
        else if (p.status === 'pause' || p.status === 'paused') currentlyPaused++;
      });
    }

    const liveEl = document.getElementById('live-presence-summary');
    if (liveEl) {
      liveEl.style.display = (currentlyWorking > 0 || currentlyPaused > 0) ? 'flex' : 'none';
      const wEl = document.getElementById('live-count-working');
      const pEl = document.getElementById('live-count-paused');
      if (wEl) wEl.textContent = currentlyWorking;
      if (pEl) pEl.textContent = currentlyPaused;
    }
  },

  exportToCSV() {
    if (!this.data || this.data.length === 0) return alert("No hay datos para exportar");
    let csv = "Empleado;Fecha;Entrada;Salida;Duracion;Tipo;Localizacion\n";
    this.data.forEach(row => {
      row.entries.forEach(e => {
        csv += `${row.employeeName};${row.date};${e.in};${e.out};${e.duration};${e.typeLabel};${e.loc}\n`;
      });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fichajes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  }
};

/**
 * Muestra la ficha de contacto de un empleado al hacer clic en su avatar.
 * @param {string} employeeId - ID del empleado a mostrar.
 */
async function showContactCard(employeeId) {
  let emp = STATE.allEmployees.get(String(employeeId));
  if (!emp) return;

  // Si faltan datos clave (cumpleaños, etc), intentamos pedir el perfil completo para esta ficha
  if (!emp.birthDate || !emp.hiringDate || !emp.phone) {
    try {
      const res = await apiFetch(`/api/v3/employees/${employeeId}`);
      const full = res.data || res;
      if (full && full.id) {
        upsertEmployee(full);
        emp = STATE.allEmployees.get(String(employeeId));
      }
    } catch (e) {
      console.warn("Could not enhance employee profile:", e);
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'contact-card-overlay';
  overlay.innerHTML = `
    <div class="contact-card-v2 animate-pop">
      <button class="contact-card-close">&times;</button>
      <div class="contact-card-header" style="background: linear-gradient(135deg, var(--accent), var(--accent2))">
        <div class="header-content">
          <div class="header-avatar">
            ${emp.imageProfileURL ? `<img src="${emp.imageProfileURL}" alt="${emp.firstName}">` : emp.firstName.substring(0,2).toUpperCase()}
          </div>
          <div class="header-text">
            <h2>${emp.firstName} ${emp.lastName}</h2>
            <p>${emp.jobTitle || 'Empleado'}</p>
          </div>
        </div>
      </div>
      <div class="contact-card-body">
        <div class="contact-info-list">
          ${emp.email ? `
            <a href="mailto:${emp.email}" class="contact-info-item">
              <span>📧</span>
              <div style="flex:1">
                <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Email</div>
                <div>${emp.email}</div>
              </div>
            </a>
          ` : ''}
          ${emp.phone ? `
            <a href="tel:${emp.phone}" class="contact-info-item">
              <span>📱</span>
              <div style="flex:1">
                <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Teléfono</div>
                <div>${emp.phone}</div>
              </div>
            </a>
          ` : ''}
          <div class="contact-info-item">
            <span>🏢</span>
            <div style="flex:1">
              <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">Empresa</div>
              <div>${STATE.companies.find(c => String(c.companyId || c.id) === String(STATE.companyId))?.name || 'Mi Empresa'}</div>
            </div>
          </div>
        </div>

        <!-- Hitos del Equipo: Cumpleaños y Aniversarios -->
        <div class="contact-milestones">
          ${emp.birthDate ? `
            <div class="milestone-pill ${isBirthdayToday(emp.birthDate) ? 'active' : ''}">
              <span class="milestone-icon">🎂</span>
              <div class="milestone-text">
                <div class="milestone-label">Cumpleaños</div>
                <div class="milestone-value">${new Date(emp.birthDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}</div>
              </div>
            </div>
          ` : ''}
          ${emp.hiringDate ? `
            <div class="milestone-pill ${isAnniversaryToday(emp.hiringDate) ? 'active' : ''}">
              <span class="milestone-icon">🎖️</span>
              <div class="milestone-text">
                <div class="milestone-label">Aniversario</div>
                <div class="milestone-value">${new Date(emp.hiringDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} (${new Date().getFullYear() - new Date(emp.hiringDate).getFullYear()} años)</div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;


  document.body.appendChild(overlay);
  overlay.querySelector('.contact-card-close').onclick = () => overlay.remove();
}
