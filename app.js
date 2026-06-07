/* ============================================================
   SESAME VACATION CALENDAR - app.js
   Lógica de frontend, gestión de estado y filtrado.
   ============================================================ */

'use strict';

// ─── Debug Mode ───────────────────────────────────────────────────────────────
// false en producción (silencia console.log/info/warn).
// Cambiar a true para depurar. console.error siempre activo.
const DEBUG_MODE = false;
(function applyDebugMode() {
  if (!DEBUG_MODE) {
    const _noop = () => {};
    console.log  = _noop;
    console.info = _noop;
    console.warn = _noop;
    // console.error queda activo para errores críticos
  }
})();

// --- Global UI Helpers ---
function togglePassword(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isHidden = el.type === 'password';
  el.type = isHidden ? 'text' : 'password';
  const btn = document.querySelector(`.btn-toggle-pass[onclick="togglePassword('${id}')"]`);
  if (btn) {
    btn.textContent = isHidden ? '🙈' : '👁️';
    btn.setAttribute('aria-pressed', String(isHidden));
    btn.setAttribute('aria-label', `${isHidden ? 'Ocultar' : 'Mostrar'} ${id === 'token-input' ? 'token' : 'contraseña'}`);
  }
}

// Las contraseñas maestras (CIF) se validan en server.py — no están expuestas en el cliente.

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
  absenceTypes: [],
  absenceTimesIndex: new Map(),
  activeFilters: new Set(),
  currentDate:  readSessionDate('ssm_current_date'),
  calView:      'month', // 'month' | 'week'
  activeView:   'calendar',
  isLoading:    false,  // Guard to prevent redundant loads
  sidebarCollapsed: localStorage.getItem('ssm_sidebar_collapsed') === 'true',
  sidebarSections: {
    'absence-section': localStorage.getItem('sidebar_section_absence_collapsed') === 'true',
    'employee-section': localStorage.getItem('sidebar_section_employee_collapsed') === 'true'
  },
  currentModule: localStorage.getItem('ssm_current_module') || 'vacaciones',
  presenceMap: new Map(), // employeeId -> status ('work', 'pause', 'out')
  presenceList: [],
  presenceSummaryContext: null
};

let REFRESH_TIMER = null;
let APP_BOOTSTRAPPED = false;
let APP_LISTENERS_WIRED = false;
let SETUP_EDITING_COMPANY_ID = null;

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

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function safeClassToken(value, fallback = 'unknown') {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function safeHttpUrlAttr(value) {
  return isSafeHttpUrl(value) ? escapeHTML(value) : '';
}

function safeTelHref(value) {
  const href = String(value ?? '').replace(/[^\d+]/g, '');
  return href ? `tel:${escapeHTML(href)}` : '';
}

function safeMailHref(value) {
  const email = String(value ?? '').trim();
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) return '';
  return `mailto:${escapeHTML(email)}`;
}

function getInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

const TECHNICAL_ABSENCE_LABELS = {
  vacation: 'Vacaciones',
  vacations: 'Vacaciones',
  holiday: 'Vacaciones',
  holidays: 'Vacaciones',
  paid_vacation: 'Vacaciones',
  paid_holiday: 'Vacaciones',
  sick: 'Baja médica',
  sick_leave: 'Baja médica',
  medical_leave: 'Baja médica',
  illness: 'Baja médica',
  personal_day: 'Asuntos propios',
  personal_days: 'Asuntos propios',
  own_affairs: 'Asuntos propios',
  own_business: 'Asuntos propios',
  paid_leave: 'Permiso retribuido',
  unpaid_leave: 'Permiso no retribuido',
  absence: 'Ausencia',
  leave: 'Ausencia'
};

function normalizeAbsenceToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isTechnicalAbsenceValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return /^[a-z0-9_-]+$/.test(raw);
}

function titleCaseAbsenceToken(value) {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function normalizeRemuneratedType(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isRemuneratedAbsenceType(value) {
  const token = normalizeRemuneratedType(value);
  return ['remunerated', 'paid', 'paid_leave', 'paid_absence', 'with_pay'].includes(token);
}

function isKnownCompensatedAbsenceLabel(value) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\b(permiso\s+retribuido|medico|cabecera|seguridad\s+social)\b/.test(text);
}

function getAbsenceRemuneratedType(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const value = source.remuneratedType ?? source.remunerated_type ?? source.isRemunerated ?? source.paid;
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function parseTimeToSeconds(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] || 0);
  if (![h, m, s].every(Number.isFinite)) return null;
  return h * 3600 + m * 60 + s;
}

function getDayOffSeconds(dayOff) {
  const explicit = Number(dayOff?.seconds);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const start = parseTimeToSeconds(dayOff?.startTime || dayOff?.start_time);
  const end = parseTimeToSeconds(dayOff?.endTime || dayOff?.end_time);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

function displayAbsenceTypeName(type, fallback = 'Ausencia') {
  const candidates = [
    type?.alias,
    type?.label,
    type?.translatedName,
    type?.name,
    type?.category
  ].filter(Boolean);

  const humanName = candidates.find(value => {
    const token = normalizeAbsenceToken(value);
    return !TECHNICAL_ABSENCE_LABELS[token] && !isTechnicalAbsenceValue(value);
  });
  if (humanName) return String(humanName).trim();

  const mappedToken = candidates
    .map(normalizeAbsenceToken)
    .find(token => TECHNICAL_ABSENCE_LABELS[token]);
  if (mappedToken) return TECHNICAL_ABSENCE_LABELS[mappedToken];

  const firstValue = candidates[0];
  if (firstValue && isTechnicalAbsenceValue(firstValue)) {
    return titleCaseAbsenceToken(firstValue) || fallback;
  }
  return firstValue || fallback;
}

function renderLocalAvatar(name, photoUrl, className = '', extraStyle = '') {
  const safeName = escapeHTML(name);
  const safePhoto = isSafeHttpUrl(photoUrl) ? escapeHTML(photoUrl) : '';
  const initials = escapeHTML(getInitials(name));
  if (safePhoto) {
    return `<img src="${safePhoto}" alt="${safeName}" class="${className}" style="${extraStyle}" referrerpolicy="no-referrer">`;
  }
  return `<span class="local-avatar-fallback ${className}" style="${extraStyle}" aria-hidden="true">${initials}</span>`;
}

function hasProxyUnlockSession() {
  return isLocalProxy() && sessionStorage.getItem('ssm_unlocked') === 'true';
}

// ── STORAGE helpers ────────────────────────────────────────────────────────
function saveCredentials() {
  localStorage.setItem('ssm_companyId',  STATE.companyId);
  localStorage.setItem('ssm_backendUrl', STATE.backendUrl);
  if (isLocalProxy()) {
    localStorage.removeItem('ssm_token');
  } else if (STATE.token) {
    localStorage.setItem('ssm_token', STATE.token);
  }
}
function loadCredentials() {
  STATE.token     = isLocalProxy() ? null : (localStorage.getItem('ssm_token') || null);
  if (isLocalProxy()) localStorage.removeItem('ssm_token');
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

// ─── Company Mode (employee vs full) con TTL de 24h ──────────────────────────
const COMPANY_MODE_TTL_MS = 24 * 60 * 60 * 1000;

function getCompanyMode(key) {
  const mode = localStorage.getItem(key);
  if (mode !== 'employee') return mode; // 'full', null, o undefined
  // Verificar caducidad del modo empleado
  const ts = parseInt(localStorage.getItem(key + '_ts') || '0');
  if (ts && Date.now() - ts > COMPANY_MODE_TTL_MS) {
    localStorage.removeItem(key);
    localStorage.removeItem(key + '_ts');
    return null; // Forzar re-detección
  }
  return 'employee';
}

function setCompanyMode(key, mode) {
  if (mode) {
    localStorage.setItem(key, mode);
    localStorage.setItem(key + '_ts', Date.now().toString());
  } else {
    localStorage.removeItem(key);
    localStorage.removeItem(key + '_ts');
  }
}

// ─── Token Timestamp ─────────────────────────────────────────────────────────
function saveTokenTimestamp(companyId) {
  if (companyId) {
    localStorage.setItem(`ssm_token_ts_${companyId}`, Date.now().toString());
  }
}

function renderTokenStatus() {
  const bar = document.getElementById('token-status-bar');
  if (!bar || !STATE.companyId) return;

  const ts = parseInt(localStorage.getItem(`ssm_token_ts_${STATE.companyId}`) || '0');
  if (!ts) { bar.style.display = 'none'; return; }

  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));

  if (days < 7) {
    bar.style.display = 'none'; // Token reciente
    return;
  }

  const isCritical = days >= 14;
  const color      = isCritical ? '#ef4444' : '#fb923c';
  const bgAlpha    = isCritical ? '0.15' : '0.12';
  bar.style.cssText = [
    'display:flex', 'align-items:center', 'gap:8px',
    'padding:6px 14px', 'margin:4px 8px', 'border-radius:8px',
    `background:linear-gradient(90deg,rgba(${isCritical?'239,68,68':'251,146,60'},${bgAlpha}),transparent)`,
    `border:1px solid rgba(${isCritical?'239,68,68':'251,146,60'},0.3)`,
    'font-size:0.72rem'
  ].join(';');

  bar.innerHTML = `
    <span>${isCritical ? '🔴' : '🟡'}</span>
    <span style="color:var(--text-muted)">
      Token <strong style="color:${color}">${days}d</strong>
      ${isCritical ? '— Renueva ya' : '— Caduca pronto'}
    </span>
    <button
      onclick="showSetup(STATE.companies.find(c=>c.companyId===STATE.companyId))"
      style="margin-left:auto;font-size:0.65rem;padding:2px 8px;border-radius:5px;
             background:rgba(255,255,255,0.07);border:1px solid var(--border);
             color:var(--text-muted);cursor:pointer;">
      Renovar
    </button>`;
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
  workingBalance:  localStorage.getItem('ssm_path_balance')  || null,
  workingHoursBag: localStorage.getItem('ssm_path_hours_bag') || null
};

const LOCATION_MODAL_STATE = {
  lat: null,
  lon: null,
  zoom: 15
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
        return finalPath;
      } catch (e) {
        console.warn(`Deep Discovery: Failed ${method} ${path}: ${e.message}`);
        // Seguimos al siguiente método o ruta
      }
    }
  }

  // Si todo falla, marcamos ambos como desactivados para evitar reintentos infinitos
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
  localStorage.removeItem('ssm_path_hours_bag');
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
    if (k === 'method' || k === 'body' || k === 'overrideBackend' || k === 'headers') return;
    if (Array.isArray(v)) v.forEach(i => finalUrl.searchParams.append(k, i));
    else finalUrl.searchParams.set(k, v);
  });

  // 3. Cabeceras que el proxy necesita reenviar a Sesame
  const headers = {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'x-company-id':  STATE.companyId || '',
    'csid':          STATE.companyId || '',
    'X-Sesame-Region': 'eu1',
    'X-Backend-Url': params.overrideBackend || sesameBaseUrl, // El proxy leerá esto y sabrá a dónde ir
    ...(params.headers || {})
  };
  if (STATE.token) headers.Authorization = `Bearer ${STATE.token}`;

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
      if (!isRetry && (res.status === 502 || res.status === 503 || res.status === 504)) {
        return apiFetch(path, params, true);
      }
      if (res.status === 401) {
        throw new Error("Sesión caducada (401). Por favor vuelve a conectar.");
      }

      let serverDetail = '';
      try {
        const errorJson = await res.json();
        serverDetail = `: ${JSON.stringify(errorJson)}`;
      } catch (e) {}

      throw new Error(`Error de API ${res.status}${serverDetail || ` (${res.statusText})`}`);
    }

    return await res.json();
  } catch (err) {
    // Si el error es "Failed to fetch", probablemente el servidor local python3 server.py no está corriendo
    if (!isRetry && (err instanceof TypeError || err.message === 'Failed to fetch')) {
      return apiFetch(path, params, true);
    }
    if (err.message === 'Failed to fetch') {
       throw new Error("Error de Red: El puente local (servidor Python) no responde. ¿Está iniciado?");
    }
    throw err;
  }
}

async function apiFetchBi(query) {
  // Usamos apiFetch para pasar por el proxy local y evitar CORS
  const url = '/api/v3/analytics/report-query';

  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(query),
    // Forzamos el backend a bi-engine para esta llamada específica
    overrideBackend: 'https://bi-engine.sesametime.com',
    headers: {
      'Origin': 'https://app.sesametime.com',
      'Referer': 'https://app.sesametime.com/'
    }
  });
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

  const photo = emp.imageProfileURL || emp.imageProfile || emp.photoUrl || emp.photo || emp.avatarUrl || emp.avatar || '';
  updated.imageProfileURL = photo || existing.imageProfileURL || '';

  // Extraer balance acumulado si viene en el payload
  if (typeof emp.accumulatedSeconds !== 'undefined') {
    updated.accumulatedSeconds = emp.accumulatedSeconds;
  }

  // Extraer horario teórico desde scheduleTemplateViews si viene en el payload
  if (emp.scheduleTemplateViews && emp.scheduleTemplateViews.length > 0) {
    const tmpl = emp.scheduleTemplateViews[0].scheduleTemplate;
    if (tmpl) {
      updated.workdays = {
        1: (tmpl.mondayMinutes || 0) * 60,
        2: (tmpl.tuesdayMinutes || 0) * 60,
        3: (tmpl.wednesdayMinutes || 0) * 60,
        4: (tmpl.thursdayMinutes || 0) * 60,
        5: (tmpl.fridayMinutes || 0) * 60,
        6: (tmpl.saturdayMinutes || 0) * 60,
        0: (tmpl.sundayMinutes || 0) * 60
      };
    }
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
      name:  displayAbsenceTypeName(t),
      rawName: t.name || '',
      alias: t.alias || '',
      category: t.category || '',
      type: t.type || '',
      pickMode: t.pickMode || '',
      remuneratedType: t.remuneratedType ?? t.remunerated_type ?? '',
      isRemunerated: isRemuneratedAbsenceType(t.remuneratedType ?? t.remunerated_type),
      color: paletteColor,
    };
  });
}

async function fetchCalendarGrouped(from, to, typeIds) {
  const params = {
    from, to,
    'types[]': typeIds.length ? typeIds : [],
    // Nota: NO pasar view:'employee' — provoca 403 en cuentas con acceso de equipo (manager/admin)
  };
  const data = await apiFetch(
    `/api/v3/companies/${STATE.companyId}/calendars-grouped`,
    params
  );
  return data.data || data || [];
}

async function fetchAbsenceTimesIndex(from, to) {
  try {
    const data = await apiFetch(`/api/v3/companies/${STATE.companyId}/calendars?from=${from}&to=${to}`);
    const list = data.data || data || [];
    const index = new Map();
    list.forEach(cal => {
      const empId = cal.employee?.id || cal.entityReference?.id;
      if (!empId || !cal.daysOff) return;
      cal.daysOff.forEach(doff => {
        if (!doff.date) return;
        if (doff.startTime || doff.endTime || doff.dayOffTimeType === 'partial_day') {
          index.set(String(empId) + '_' + doff.date, {
            startTime: doff.startTime || null,
            endTime:   doff.endTime   || null,
            seconds:   doff.seconds   || 0
          });
        }
      });
    });
    return index;
  } catch(e) {
    console.warn('fetchAbsenceTimesIndex failed (non-critical):', e.message);
    return new Map();
  }
}

async function fetchPresence() {
  try {
    if (DISCOVERY.workingPresence === 'DISABLED') return [];

    let list = [];
    if (DISCOVERY.workingPresence) {
      AUDIT.lastPresencePathTried = DISCOVERY.workingPresence;
      const data = await apiFetch(DISCOVERY.workingPresence);
      list = data.data || data || [];
    } else {
      AUDIT.isSearching = true;
      const found = await discoverEndpoint(DISCOVERY.presencePaths);
      if (found) {
        DISCOVERY.workingPresence = found;
        localStorage.setItem('ssm_path_presence', found);
        return fetchPresence();
      }
    }

    // Actualizar el mapa global de presencia para acceso O(1)
    if (Array.isArray(list)) {
      STATE.presenceList = list;
      STATE.presenceMap.clear();
      list.forEach(p => {
        const employeeId = getPresenceEmployeeId(p);
        if (employeeId) STATE.presenceMap.set(String(employeeId), classifyPresenceRecord(p));
      });
      renderTeamPresenceSummary(list);
    }
    return list;
  } catch (e) {
    console.warn("Could not fetch presence data:", e);
    return [];
  } finally {
    AUDIT.isSearching = false;
  }
}

function getPresenceEmployeeId(record) {
  if (!record || typeof record !== 'object') return null;
  return record.employeeId ||
    record.employee?.id ||
    record.employee?.employeeId ||
    record.userId ||
    record.personId ||
    null;
}

function classifyPresenceRecord(record) {
  if (!record) return 'out';
  const values = typeof record === 'object'
    ? [
        record.status,
        record.workStatus,
        record.presenceStatus,
        record.type,
        record.mode,
        record.locationType,
        record.workplaceType,
        record.workplace,
        record.origin,
        record.employee?.status,
        record.employee?.workStatus
      ]
    : [record];
  const text = values.filter(Boolean).join(' ').toLowerCase();

  if (/teletrab|remote|remoto|home|wfh|work.?from.?home|distance/.test(text)) return 'remote';
  if (/pause|paused|pausa|break|rest/.test(text)) return 'paused';
  if (/work|working|trabaj|online|active|clocked.?in|present/.test(text)) return 'working';
  return 'out';
}

function getPresenceRank(kind) {
  if (kind === 'remote') return 3;
  if (kind === 'paused') return 2;
  if (kind === 'working') return 1;
  return 0;
}

function mergePresenceKind(byEmployee, employeeId, kind) {
  if (!employeeId || !kind || kind === 'out') return;
  const key = String(employeeId);
  const current = byEmployee.get(key) || 'out';
  if (getPresenceRank(kind) > getPresenceRank(current)) {
    byEmployee.set(key, kind);
  }
}

function classifySigningRowPresence(row) {
  if (!row?.isLive) return 'out';
  const entries = Array.isArray(row.entries) ? row.entries : [];
  const openEntry = [...entries].reverse().find(entry =>
    !entry.outOriginal || !entry.out || entry.out === '--:--'
  );
  const entryKind = classifyPresenceRecord(openEntry || {});
  return entryKind === 'paused' || entryKind === 'remote' ? entryKind : 'working';
}

function getLocalDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return getLocalDateKey(value);
}

function addLocalDays(dateKey, amount) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return '';
  const date = new Date(`${normalized}T00:00:00`);
  if (isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + amount);
  return getLocalDateKey(date);
}

function isWeekdayDateKey(dateKey) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return false;
  const date = new Date(`${normalized}T00:00:00`);
  if (isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function isLocalHolidayDateKey(dateKey) {
  return Boolean(HOLIDAYS_ZGZ[normalizeDateKey(dateKey)]);
}

function readSessionDate(key, fallback = new Date()) {
  const saved = sessionStorage.getItem(key);
  if (!saved) return new Date(fallback);
  const date = new Date(saved);
  return isNaN(date.getTime()) ? new Date(fallback) : date;
}

function getPresenceRecordDateKey(record) {
  if (!record || typeof record !== 'object') return '';
  const candidates = [
    record.date,
    record.day,
    record.currentDate,
    record.checkIn,
    record.checkInAt,
    record.clockInAt,
    record.startedAt,
    record.startAt,
    record.updatedAt,
    record.createdAt,
    record.lastActivityAt,
    record.lastSeenAt,
    record.employee?.updatedAt,
    record.workEntryIn?.realDate
  ];

  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!isNaN(date.getTime())) return getLocalDateKey(date);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
  }
  return '';
}

function isCurrentPresenceRecord(record, todayKey = getLocalDateKey()) {
  const recordDate = getPresenceRecordDateKey(record);
  return !!recordDate && recordDate === todayKey;
}

function getTeamPresenceStats(presenceList = STATE.presenceList, options = {}) {
  const stats = { working: 0, paused: 0, remote: 0, out: 0, total: STATE.allEmployees.size };
  const byEmployee = buildTeamPresenceKindMap(presenceList, options);

  byEmployee.forEach(kind => {
    if (kind === 'remote') stats.remote++;
    else if (kind === 'paused') stats.paused++;
    else if (kind === 'working') stats.working++;
  });

  const activeCount = stats.working + stats.paused + stats.remote;
  if (stats.total === 0 && byEmployee.size > 0) stats.total = byEmployee.size;
  stats.out = Math.max(0, stats.total - activeCount);
  return stats;
}

function buildTeamPresenceKindMap(presenceList = STATE.presenceList, options = {}) {
  const byEmployee = new Map();
  const records = Array.isArray(presenceList) ? presenceList : [];
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const currentDayRowsAuthority = !!options.currentDayRowsAuthority;
  const todayKey = getLocalDateKey();

  records.forEach((record, index) => {
    if (currentDayRowsAuthority && !isCurrentPresenceRecord(record, todayKey)) return;
    const key = getPresenceEmployeeId(record) || `presence-${index}`;
    mergePresenceKind(byEmployee, key, classifyPresenceRecord(record));
  });

  if (!currentDayRowsAuthority && byEmployee.size === 0 && STATE.presenceMap?.size) {
    STATE.presenceMap.forEach((status, employeeId) => {
      mergePresenceKind(byEmployee, employeeId, classifyPresenceRecord(status));
    });
  }

  if (!currentDayRowsAuthority && STATE.presenceMap?.size) {
    STATE.presenceMap.forEach((status, employeeId) => {
      mergePresenceKind(byEmployee, employeeId, classifyPresenceRecord(status));
    });
  }

  rows.forEach(row => {
    mergePresenceKind(byEmployee, row.employeeId, classifySigningRowPresence(row));
  });

  return byEmployee;
}

function getTeamPresenceEmployeesByKind(kind, presenceList = STATE.presenceList, options = {}) {
  const byEmployee = buildTeamPresenceKindMap(presenceList, options);
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const liveEmployeeIds = new Set();

  rows.forEach(row => {
    if (!row?.employeeId) return;
    liveEmployeeIds.add(String(row.employeeId));
  });

  return Array.from(STATE.allEmployees.values())
    .filter(emp => {
      if (!emp?.id) return false;
      const employeeKind = byEmployee.get(String(emp.id)) || 'out';
      return employeeKind === kind;
    })
    .map(emp => {
      const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email || 'Empleado';
      return {
        id: String(emp.id),
        name,
        initials: getInitials(name),
        jobTitle: emp.jobTitle || '',
        photoUrl: emp.imageProfileURL || '',
        hasTodayRow: liveEmployeeIds.has(String(emp.id))
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

function getTeamPresenceOutEmployees(presenceList = STATE.presenceList, options = {}) {
  return getTeamPresenceEmployeesByKind('out', presenceList, options);
}

function renderPresencePeoplePopover(popover, kind, employees) {
  if (!popover) return;
  const labels = {
    working: 'Trabajando ahora',
    paused: 'En pausa',
    remote: 'Teletrabajando',
    out: 'Fuera ahora'
  };
  const emptyLabels = {
    working: 'No hay empleados trabajando ahora.',
    paused: 'No hay empleados en pausa ahora.',
    remote: 'No hay empleados teletrabajando ahora.',
    out: 'No hay empleados fuera ahora.'
  };
  const safeKind = ['working', 'paused', 'remote', 'out'].includes(kind) ? kind : 'out';
  const list = Array.isArray(employees) ? employees : [];
  const fallbackMeta = {
    working: 'Trabajando ahora',
    paused: 'En pausa ahora',
    remote: 'Teletrabajando ahora',
    out: 'Sin actividad ahora'
  };

  const listHtml = list.length
    ? list.map(emp => {
        const safeName = escapeHTML(emp.name);
        const safeJobTitle = escapeHTML(emp.jobTitle || fallbackMeta[safeKind]);
        const safePhoto = safeHttpUrlAttr(emp.photoUrl);
        const initials = escapeHTML(emp.initials || getInitials(emp.name));
        return `
          <div class="presence-out-person">
            <div class="presence-out-avatar" style="${safePhoto ? '' : 'background: linear-gradient(135deg, var(--accent), var(--accent2));'}">
              ${safePhoto ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer">` : initials}
            </div>
            <div class="presence-out-info">
              <strong>${safeName}</strong>
              <span>${safeJobTitle}</span>
            </div>
          </div>
        `;
      }).join('')
    : `<div class="presence-out-empty">${emptyLabels[safeKind]}</div>`;

  popover.innerHTML = `
    <div class="presence-out-head">
      <strong>${labels[safeKind]}</strong>
      <span>${list.length}</span>
    </div>
    <div class="presence-out-list">${listHtml}</div>
  `;
}

function closeVacacionesPresencePopover() {
  const popover = document.getElementById('vacaciones-presence-popover');
  if (!popover) return;
  popover.classList.add('hidden');
  popover.style.top = '';
  popover.style.left = '';
  popover.style.right = '';
  document.querySelectorAll('[data-presence-list-trigger].active').forEach(btn => btn.classList.remove('active'));
}

function positionFixedPopover(popover, anchor, preferredWidth = 280) {
  if (!popover || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(preferredWidth, window.innerWidth - 16);
  let left = rect.left + (rect.width / 2) - (width / 2);
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (left < 8) left = 8;

  popover.style.width = `${width}px`;
  popover.style.top = `${rect.bottom + 10}px`;
  popover.style.left = `${left}px`;
  popover.style.right = 'auto';
}

function toggleVacacionesPresencePopover(kind, trigger) {
  const popover = document.getElementById('vacaciones-presence-popover');
  if (!popover) return;

  const currentKind = popover.dataset.kind || '';
  if (!popover.classList.contains('hidden') && currentKind === kind) {
    closeVacacionesPresencePopover();
    return;
  }

  const context = STATE.presenceSummaryContext || { presenceList: STATE.presenceList, options: {} };
  const employees = getTeamPresenceEmployeesByKind(kind, context.presenceList, context.options);
  renderPresencePeoplePopover(popover, kind, employees);
  popover.dataset.kind = kind;
  popover.classList.remove('hidden');
  positionFixedPopover(popover, trigger);

  document.querySelectorAll('[data-presence-list-trigger].active').forEach(btn => btn.classList.remove('active'));
  trigger?.classList.add('active');
}

function renderTeamPresenceSummary(presenceList = STATE.presenceList, options = {}) {
  STATE.presenceSummaryContext = { presenceList, options };
  const stats = getTeamPresenceStats(presenceList, options);
  const hasTeam = stats.total > 0 || stats.working > 0 || stats.paused > 0 || stats.remote > 0;

  document.querySelectorAll('[data-presence-summary]').forEach(summary => {
    summary.classList.toggle('is-empty', !hasTeam);
    summary.title = hasTeam
      ? `Ahora: ${stats.working} trabajando, ${stats.paused} en pausa, ${stats.remote} teletrabajando, ${stats.out} fuera`
      : 'Presencia en tiempo real pendiente de sincronizar';
  });

  Object.entries(stats).forEach(([key, value]) => {
    document.querySelectorAll(`[data-presence-count="${key}"]`).forEach(el => {
      el.textContent = value;
    });
  });

  let activeFilter = 'all';
  try {
    activeFilter = FichajesModule?.presenceFilter || 'all';
  } catch (_) {
    activeFilter = 'all';
  }

  const workingBtn = document.getElementById('filter-live-working');
  const pausedBtn = document.getElementById('filter-live-paused');
  const outBtn = document.getElementById('filter-live-out');
  const outPopover = document.getElementById('presence-out-popover');
  if (workingBtn) workingBtn.classList.toggle('active', activeFilter === 'working');
  if (pausedBtn) pausedBtn.classList.toggle('active', activeFilter === 'paused');
  if (outBtn) outBtn.classList.toggle('active', !!outPopover && !outPopover.classList.contains('hidden'));
}

async function refreshPresenceSummaryFromTodaySignings() {
  if (STATE.currentModule === 'fichajes') return;
  if (typeof FichajesModule === 'undefined' || FichajesModule.isLoading) return;
  if (!STATE.companyId || !(STATE.token || hasProxyUnlockSession())) return;

  const previousDate = new Date(FichajesModule.currentDate);
  const previousView = FichajesModule.currentView;

  try {
    FichajesModule.currentDate = new Date();
    FichajesModule.currentView = 'day';
    await FichajesModule.loadData(true, { silent: true });
  } catch (err) {
    console.warn('Presence summary signing snapshot failed:', err.message);
  } finally {
    FichajesModule.currentDate = previousDate;
    FichajesModule.currentView = previousView;
  }
}

/**
 * Obtiene los calendarios detallados (incluyendo excepciones de jornada)
 */
async function fetchCalendarsRaw(from, to) {
  try {
    const data = await apiFetch(`/api/v3/companies/${STATE.companyId}/calendars?from=${from}&to=${to}`);
    return data.data || data || [];
  } catch (e) {
    console.warn("Could not fetch raw calendars:", e);
    return [];
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

    const currentYear = new Date().getFullYear();
    const from = `${currentYear}-01-01`;
    const to = `${currentYear}-12-31`;

    const vacationType = STATE.absenceTypes.find(t =>
      t.name.toLowerCase().includes('vacac')
    );

    if (!vacationType) return null;

    // Consultamos el calendario agrupado para todo el año
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
    let data = await apiFetch(`/api/v3/employees?limit=500&include=personalData,details`);
    let results = data.data || data || [];

    // 2. Fallback final: endpoint de empresa
    if (results.length <= 1) {
      const companyData = await apiFetch(`/api/v3/companies/${STATE.companyId}/employees?limit=500&include=personalData,details`);
      results = companyData.data || companyData || [];
    }

    // 3. Enriquecer con los horarios teóricos (contracts/scheduleTemplateViews)
    // Hacemos llamadas en paralelo para obtener el detalle real de cada empleado
    const detailedResults = await Promise.allSettled(
      results.map(e => apiFetch(`/api/v3/employees/${e.id}`).catch(() => null))
    );

    return results.map((e, index) => {
      const detailRes = detailedResults[index];
      let detail = {};
      if (detailRes.status === 'fulfilled' && detailRes.value) {
         detail = detailRes.value.data || detailRes.value || {};
      }

      let workdays = null;
      // Extraer desde scheduleTemplateViews (la fuente de verdad de Sesame en 2026)
      if (detail.scheduleTemplateViews && detail.scheduleTemplateViews.length > 0) {
        const tmpl = detail.scheduleTemplateViews[0].scheduleTemplate;
        if (tmpl) {
          workdays = {
            1: (tmpl.mondayMinutes || 0) * 60,
            2: (tmpl.tuesdayMinutes || 0) * 60,
            3: (tmpl.wednesdayMinutes || 0) * 60,
            4: (tmpl.thursdayMinutes || 0) * 60,
            5: (tmpl.fridayMinutes || 0) * 60,
            6: (tmpl.saturdayMinutes || 0) * 60,
            0: (tmpl.sundayMinutes || 0) * 60
          };
        }
      }
      // Fallback a contracts por si acaso
      else if (detail.contracts && detail.contracts.length > 0) {
         const contract = detail.contracts[0];
         workdays = {
            1: contract.mondaySeconds ?? 28800,
            2: contract.tuesdaySeconds ?? 28800,
            3: contract.wednesdaySeconds ?? 28800,
            4: contract.thursdaySeconds ?? 28800, // Fix typo here (was fridaySeconds)
            5: contract.fridaySeconds ?? 28800,
            6: contract.saturdaySeconds ?? 0,
            0: contract.sundaySeconds ?? 0
         };
      }

      return {
        id: e.id,
        firstName: detail.firstName || e.firstName,
        lastName: detail.lastName || e.lastName,
        imageProfileURL: detail.imageProfileURL || e.imageProfileURL || e.photoUrl || e.avatarUrl || '',
        email: detail.email || e.email || e.companyEmail || '',
        phone: detail.phone || e.personalPhone || e.companyPhone || e.phone || '',
        jobTitle: detail.jobTitle || e.jobTitle || e.position?.name || '',
        birthDate: e.birthDate || e.birthday || e.dateOfBirth || e.date_of_birth ||
                   (e.personalData && (e.personalData.birthDate || e.personalData.birthday)) ||
                   (e.details && e.details.birthDate) || '',
        hiringDate: e.hiringDate || e.dateOfJoined || e.joinedDate || e.createdAt || '',
        workdays: workdays,
        accumulatedSeconds: typeof detail.accumulatedSeconds === 'number' ? detail.accumulatedSeconds : undefined,
        status: e.status
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

function isSafeHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
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
        STATE.token = active.token || null;
        STATE.companyId = active.companyId;
        STATE.backendUrl = active.backendUrl;
        saveCredentials();
      }
      renderCompanySelector();
    }
  } catch (e) { console.error("Error loading config:", e); }
}

function applyThemeUI() {
  document.documentElement.setAttribute('data-theme', STATE.theme);
  localStorage.setItem('theme', STATE.theme);

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.textContent = STATE.theme === 'light' ? '🌙' : '☀️';
  });

  const active = STATE.companies.find(c => c.companyId === STATE.companyId);
  if (active) applyCompanyBranding(active);

  refreshAllViews();
}

function toggleTheme() {
  STATE.theme = STATE.theme === 'light' ? 'dark' : 'light';
  applyThemeUI();
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
  if (nameDisplay) {
    nameDisplay.textContent = name;
    nameDisplay.title = name; // Tooltip para nombres largos
  }

  // Custom Branding Logic
  let brandColor = company.brandColor;
  let logoUrl = company.logoUrl || company.logo;

  // Fallback to corporate defaults if no manual color is provided
  if (!brandColor) {
    if (name.toUpperCase().includes('FIBERCOM')) {
      brandColor = '#e63946';
    } else if (name.toUpperCase().includes('ARAGON')) {
      brandColor = '#1d3557';
    } else {
      brandColor = '#60A5FA';
    }
  }

  if (logoContainer) {
    if (logoUrl && isSafeHttpUrl(logoUrl)) {
      logoContainer.textContent = '';
      const img = document.createElement('img');
      img.src = logoUrl;
      img.alt = name;
      img.referrerPolicy = 'no-referrer';
      img.style.cssText = 'width:24px;height:24px;object-fit:contain;border-radius:4px;';
      img.onerror = () => {
        logoContainer.textContent = '📅';
      };
      logoContainer.appendChild(img);
    } else {
      // Avatar con iniciales si no hay logo
      const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      logoContainer.textContent = '';
      const fallback = document.createElement('div');
      fallback.textContent = initials;
      fallback.style.cssText = `width:24px;height:24px;background:${brandColor};color:white;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;`;
      logoContainer.appendChild(fallback);
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

  STATE.token = next.token || null;
  STATE.companyId = next.companyId;
  STATE.backendUrl = next.backendUrl;
  saveCredentials();

  // Apply branding immediately for better UX
  applyCompanyBranding(next);

  // Persist choice to server
  if (isLocalProxy()) {
    fetch('/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next)
    });
  }

  // Limpiamos el estado anterior antes de la carga completa
  STATE.allEmployees.clear();
  STATE.presenceMap.clear();
  STATE.calendarData = {};
  STATE.hiddenEmployeeIds.clear();

  // Limpiamos datos del módulo de fichajes si existe
  if (typeof FichajesModule !== 'undefined') {
    FichajesModule.data = [];
    if (FichajesModule.failedIds) FichajesModule.failedIds.clear();
    FichajesModule.biSchemaFields = null;
  }

  // Limpiar caché de rutas y modo de empresa (cada empresa puede tener permisos distintos)
  DISCOVERY.workingPresence = null;
  DISCOVERY.workingChecks   = null;
  localStorage.removeItem('ssm_path_presence');
  localStorage.removeItem('ssm_path_checks');
  // Nota: NO borramos ssm_company_mode ni ssm_bi_waf porque son correctos por empresa
  // Solo los borramos si el admin cambió el rol del usuario en Sesame.

  // Cargamos TODO de la nueva empresa (Metadatos + Calendario)
  loadInitialData();
  startAutoRefresh();
}

/**
 * Inicia el temporizador de auto-refresco cada 5 minutos.
 */
function startAutoRefresh() {
  if (REFRESH_TIMER) clearInterval(REFRESH_TIMER);
  REFRESH_TIMER = setInterval(async () => {
    const isAppVisible = !$('app-screen').classList.contains('hidden');
    const canRefresh = isAppVisible && !STATE.isLoading && STATE.companyId && (STATE.token || hasProxyUnlockSession());
    if (!canRefresh) return;

    if (STATE.currentModule === 'fichajes') {
      if (typeof FichajesModule !== 'undefined' && FichajesModule.initialized) {
        await FichajesModule.loadData(true, { silent: true });
      }
      return;
    }

    await loadData();
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
  if (APP_BOOTSTRAPPED) return;
  APP_BOOTSTRAPPED = true;

  // --- Master Password Protection ---
  await loadSavedConfig();
  const needsInitialSetup = isLocalProxy() && (
    STATE.companies.length === 0 ||
    STATE.companies.every(company => !company.hasMasterPassword)
  );
  if (needsInitialSetup) {
    sessionStorage.removeItem('ssm_unlocked');
    await startApp();
    return;
  }

  const isUnlocked = sessionStorage.getItem('ssm_unlocked') === 'true';
  const lockScreen = $('lock-screen');
  const unlockBtn = $('unlock-btn');
  const passInput = $('master-pass');

  if (!isUnlocked) {
    showScreen('lock-screen');

    const handleUnlock = async () => {
      const val = passInput.value.trim().toUpperCase();
      const errEl = $('lock-error');
      errEl.classList.add('hidden');

      // Validación server-side: el CIF no viaja en el JS del cliente
      let ok = false;
      try {
        const res = await fetch('/validate-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: val })
        });
        const data = await res.json();
        ok = data.ok === true;
      } catch {
        // Fallback offline: solo si el servidor no está disponible
        ok = false;
      }

      if (ok) {
        try {
          unlockBtn.disabled = true;
          unlockBtn.innerHTML = '<span class="spinner-sm"></span> Verificando...';
          sessionStorage.setItem('ssm_unlocked', 'true');
          await startApp();
          lockScreen.classList.remove('active');
          lockScreen.classList.add('hidden');
        } catch (err) {
          console.error("Critical login error:", err);
          unlockBtn.disabled = false;
          unlockBtn.innerHTML = '🔓 Desbloquear Dashboard';
          errEl.textContent = `Error técnico: ${err.message || 'Fallo en el arranque del sistema'}`;
          errEl.classList.remove('hidden');
        }
      } else {
        const card = lockScreen.querySelector('.setup-card');
        card.classList.add('shake');
        errEl.textContent = 'Clave incorrecta. Por favor revisa el CIF introducido.';
        errEl.classList.remove('hidden');
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
  await startApp();
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
function syncModuleSwitcherActive(module) {
  $$('.module-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.module === module);
  });
}

function switchModule(module, options = {}) {
  const requestedModule = module === 'balances' ? 'balances' : module;
  const actualModule = requestedModule === 'balances' ? 'fichajes' : requestedModule;
  STATE.currentModule = requestedModule;
  localStorage.setItem('ssm_current_module', requestedModule);
  closeVacacionesPresencePopover();

  // Actualizar estados visuales de los botones del switcher
  syncModuleSwitcherActive(requestedModule);

  // Ocultar/Mostrar wrappers de cada módulo con sus clases correspondientes
  $$('.module-wrapper').forEach(w => {
    w.style.display = 'none';
    w.classList.remove('active');
  });

  let activeWrapper = document.getElementById(`module-${actualModule}-wrapper`);
  // Fallback para nombres antiguos o simplificados
  if (!activeWrapper && actualModule === 'vacaciones') activeWrapper = document.getElementById('calendar-wrapper');

  if (activeWrapper) {
    activeWrapper.style.display = 'block';
    activeWrapper.classList.add('active');
  }

  // Control de visibilidad del sidebar según el módulo
  const vacacionesNav = document.getElementById('vacaciones-nav');
  const absenceSection = document.getElementById('absence-section');
  const employeeSection = document.getElementById('employee-section');

  if (actualModule === 'fichajes') {
    if (vacacionesNav) vacacionesNav.classList.add('is-module-hidden');
    if (absenceSection) absenceSection.style.display = 'none';
    // Mantenemos la sección de empleados visible para permitir el filtrado múltiple
    if (employeeSection) employeeSection.style.display = 'block';

    // Inicialización específica de Fichajes
    FichajesModule.init();
    if (requestedModule === 'balances') {
      FichajesModule.currentView = 'balance';
      FichajesModule.balanceScope = 'exercise';
      FichajesModule.requestBalanceTopPin();
    } else if (FichajesModule.currentView === 'balance') {
      FichajesModule.currentView = 'month';
      FichajesModule.balanceScope = 'exercise';
    }
    FichajesModule.persistPeriodState();
    FichajesModule.syncViewButtons();
    FichajesModule.updateMonthLabel();
    if (!options.skipLoad) {
      if (requestedModule === 'balances') {
        FichajesModule.scheduleBalanceLoadAfterWarmup();
      } else {
        FichajesModule.cancelBalanceWarmup();
        FichajesModule.loadData();
      }
    }
  } else {
    FichajesModule.cancelBalanceWarmup();
    if (vacacionesNav) vacacionesNav.classList.remove('is-module-hidden');
    if (absenceSection) absenceSection.style.display = 'block';
    if (employeeSection) employeeSection.style.display = 'block';
    if (!options.skipLoad) loadData();
  }
}

function initMonthPickers() {
  // ── Portal: mover los popovers a <body> para escapar del stacking context ──
  // backdrop-filter en .top-bar crea un containing block que atrapa position:fixed.
  // La solución es elevar los popovers al nivel del <body>.
  ['vacaciones-month-picker', 'fichajes-month-picker', 'vacaciones-presence-popover'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  });

  // ── Renderiza la cuadrícula de meses dentro del popover ──────────────────
  const _renderPicker = (pickerEl, year, isSignings) => {
    const activeDate = isSignings ? FichajesModule.currentDate : STATE.currentDate;
    const selYear  = activeDate.getFullYear();
    const selMonth = activeDate.getMonth();
    pickerEl.innerHTML = `
      <div class="month-picker-header">
        <button class="mp-year-btn prev-year" type="button">‹</button>
        <span class="mp-year-display">${year}</span>
        <button class="mp-year-btn next-year" type="button">›</button>
      </div>
      <div class="month-picker-grid">
        ${MONTHS_ES.map((m, i) =>
          `<button type="button" class="mp-month-btn${(year === selYear && i === selMonth) ? ' selected' : ''}" data-month="${i}" data-year="${year}">${m.substring(0, 3)}</button>`
        ).join('')}
      </div>`;
  };

  // ── Posiciona el popover justo debajo del título trigger ─────────────────
  const _positionPicker = (picker, titleEl) => {
    const rect = titleEl.getBoundingClientRect();
    const popoverW = 220;
    let leftPos = rect.left + rect.width / 2 - popoverW / 2;
    if (leftPos + popoverW > window.innerWidth - 8) leftPos = window.innerWidth - popoverW - 8;
    if (leftPos < 8) leftPos = 8;
    picker.style.top  = (rect.bottom + 8) + 'px';
    picker.style.left = leftPos + 'px';
  };

  const _closeAll = () => {
    document.querySelectorAll('.month-picker-popover.active').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.month-selector-title.active').forEach(t => t.classList.remove('active'));
  };

  // ── Un único listener por delegación en document ─────────────────────────
  document.addEventListener('click', (e) => {
    // Navegación de año (‹ ›)
    const yearBtn = e.target.closest('.mp-year-btn');
    if (yearBtn) {
      e.stopPropagation();
      const picker = yearBtn.closest('.month-picker-popover');
      if (!picker) return;
      const cur = parseInt(picker.querySelector('.mp-year-display').textContent, 10);
      const newY = yearBtn.classList.contains('prev-year') ? cur - 1 : cur + 1;
      _renderPicker(picker, newY, picker.id === 'fichajes-month-picker');
      return;
    }

    // Selección de mes
    const monthBtn = e.target.closest('.mp-month-btn');
    if (monthBtn) {
      e.stopPropagation();
      const picker = monthBtn.closest('.month-picker-popover');
      if (!picker) return;
      const month = parseInt(monthBtn.dataset.month, 10);
      const year  = parseInt(monthBtn.dataset.year,  10);
      const isSignings = picker.id === 'fichajes-month-picker';
      if (isSignings) {
        if (FichajesModule.currentView === 'balance') {
          FichajesModule.goToBalanceMonth(year, month, true);
        } else {
          FichajesModule.currentDate = new Date(year, month, 1);
          FichajesModule.persistPeriodState();
          FichajesModule.updateMonthLabel();
          FichajesModule.loadData();
        }
      } else {
        STATE.currentDate = new Date(year, month, 1);
        sessionStorage.setItem('ssm_current_date', STATE.currentDate.toISOString());
        updateMonthLabel();
        loadData();
      }
      _closeAll();
      return;
    }

    // Click en el título → abrir picker
    const titleEl = e.target.closest('.month-selector-title');
    if (titleEl) {
      e.stopPropagation();
      let pickerId = null, isSignings = false;
      if      (titleEl.id === 'current-month-label')    { pickerId = 'vacaciones-month-picker'; isSignings = false; }
      else if (titleEl.id === 'current-month-signings') { pickerId = 'fichajes-month-picker';   isSignings = true;  }
      if (!pickerId) return;
      const picker = document.getElementById(pickerId);
      if (!picker) return;
      const wasActive = picker.classList.contains('active');
      _closeAll();
      if (!wasActive) {
        const d = isSignings ? FichajesModule.currentDate : STATE.currentDate;
        _renderPicker(picker, d.getFullYear(), isSignings);
        _positionPicker(picker, titleEl);
        picker.classList.add('active');
        titleEl.classList.add('active');
      }
      return;
    }

    // Click fuera → cerrar todos
    if (!e.target.closest('.month-picker-popover')) {
      _closeAll();
    }
  }, true); // useCapture=true para mayor fiabilidad
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
  $$('[data-cal-view]').forEach(btn => btn.addEventListener('click', () => switchCalView(btn.dataset.calView)));
  $$('.module-btn').forEach(btn => btn.addEventListener('click', () => switchModule(btn.dataset.module)));

  $('prev-month').addEventListener('click', () => shiftPeriod(-1));
  $('next-month').addEventListener('click', () => shiftPeriod(1));
  $('today-btn').addEventListener('click', () => {
    STATE.currentDate = new Date();
    sessionStorage.setItem('ssm_current_date', STATE.currentDate.toISOString());
    loadData();
  });
  $('refresh-btn').addEventListener('click', loadData);
  $('logout-btn').addEventListener('click', logout);
  initMonthPickers();

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-presence-list-trigger]');
    if (trigger) {
      event.stopPropagation();
      toggleVacacionesPresencePopover(trigger.dataset.presenceListTrigger, trigger);
      return;
    }

    if (!event.target.closest('#vacaciones-presence-popover')) {
      closeVacacionesPresencePopover();
    }
  });

  // Expand/Collapse all – delegado en document para no depender del init de FichajesModule
  document.addEventListener('click', (e) => {
    if (e.target.closest('#toggle-all-signings-btn')) {
      FichajesModule.toggleAll();
    }
  });

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
      const empFilterList = $('employee-filters');
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
    refreshAllViews();
  });

  const empSelNone = $('emp-sel-none');
  if(empSelNone) empSelNone.addEventListener('click', (e) => {
    e.preventDefault();
    STATE.allEmployees.forEach((emp, id) => STATE.hiddenEmployeeIds.add(String(id)));
    refreshAllViews();
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

  const editCompanyBtn = $('edit-company-btn');
  if (editCompanyBtn) editCompanyBtn.addEventListener('click', () => {
    const selectedId = $('company-select')?.value;
    const active = STATE.companies.find(c => String(c.companyId).trim() === String(STATE.companyId).trim())
                || STATE.companies.find(c => String(c.companyId).trim() === String(selectedId).trim())
                || STATE.companies[0];

    if (active) {
      showSetup(active);
    } else {
      // Si no hay nada, al menos mostramos el setup vacío con opción de cancelar si hay empresas
      showSetup();
    }
  });

  const deleteCompanyBtn = $('delete-company-btn');
  if (deleteCompanyBtn) {
    deleteCompanyBtn.addEventListener('click', handleDeleteCompany);
  }

  const cancelSetupBtn = $('cancel-setup-btn');
  if (cancelSetupBtn) {
    cancelSetupBtn.addEventListener('click', () => {
      const hasLocalProxySession = isLocalProxy() && sessionStorage.getItem('ssm_unlocked') === 'true';
      if (STATE.companyId && (STATE.token || hasLocalProxySession)) {
        showApp();
      } else {
        showScreen('lock-screen');
      }
    });
  }

  $('modal-close').addEventListener('click', closeModal);
  $('day-modal').addEventListener('click', e => { if (e.target === $('day-modal')) closeModal(); });
  $('location-modal-close')?.addEventListener('click', closeLocationModal);
  $('location-modal')?.addEventListener('click', e => { if (e.target === $('location-modal')) closeLocationModal(); });
  $('location-zoom-in')?.addEventListener('click', () => updateLocationZoom(1));
  $('location-zoom-out')?.addEventListener('click', () => updateLocationZoom(-1));

  const themeToggleButtons = document.querySelectorAll('.theme-toggle');
  themeToggleButtons.forEach(btn => {
    btn.textContent = STATE.theme === 'light' ? '🌙' : '☀️';
    btn.addEventListener('click', toggleTheme);
  });

  // Try loading credentials saved by get-token.py via server
  await loadSavedConfig();

  // Auto-login if credentials available
  const canUseLocalProxySession = isLocalProxy() && sessionStorage.getItem('ssm_unlocked') === 'true';
  if (STATE.companyId && (STATE.token || canUseLocalProxySession)) {
    showApp();
    await loadInitialData();
    switchModule(STATE.currentModule, { skipLoad: STATE.currentModule === 'vacaciones' });
    startAutoRefresh();
    loadWeather();
  } else {
    showSetup();
  }
}

function showSetup(editData = null) {
  showScreen('setup-screen');

  // Limpiar cualquier error previo (no mostrar errores de sesiones anteriores)
  const prevErr = $('setup-error');
  if (prevErr) { prevErr.textContent = ''; prevErr.classList.add('hidden'); }

  // Si no nos pasan datos pero estamos logueados, intentamos recuperar la activa
  if (!editData && STATE.companyId) {
    editData = STATE.companies.find(c => String(c.companyId).trim() === String(STATE.companyId).trim());
  }

  const isEditing = !!editData;
  SETUP_EDITING_COMPANY_ID = isEditing ? String(editData.companyId || '') : null;

  // Actualizar Título
  const titleEl = $('setup-title');
  if (titleEl) titleEl.textContent = (isEditing || STATE.token) ? 'Editar Configuración' : 'Configuración Inicial';

  // Actualizar Texto Botón
  const btnText = $('connect-btn-text');
  if (btnText) btnText.textContent = (isEditing || STATE.token) ? 'Guardar Cambios' : 'Sincronizar Panel';

  // Mostrar/Ocultar Cancelar
  const cancelBtn = $('cancel-setup-btn');
  if (cancelBtn) {
    // Si tenemos empresas O estamos logueados, permitimos cancelar siempre
    const canCancel = (STATE.companies && STATE.companies.length > 0) || !!STATE.token;
    cancelBtn.classList.toggle('hidden', !canCancel);
  }

  const fields = {
    'token-input':   '',
    'company-input': editData ? editData.companyId : '',
    'name-input':    editData ? editData.name : '',
    'color-input':   editData ? editData.brandColor : '',
    'logo-input':    editData ? editData.logoUrl : '',
    'masterpwd-input': '',
    'backend-input': editData ? editData.backendUrl : 'https://back-eu1.sesametime.com'
  };

  for (const [id, val] of Object.entries(fields)) {
    const el = $(id);
    if (el) el.value = val || '';
  }

  const tokenInput = $('token-input');
  const tokenHint = $('token-preserve-hint');
  if (tokenInput) {
    const hasStoredToken = isEditing && editData.hasToken;
    tokenInput.dataset.hasStoredToken = hasStoredToken ? 'true' : 'false';
    tokenInput.placeholder = hasStoredToken
      ? 'Token guardado; déjalo vacío para conservarlo'
      : 'Pega tu cookie USID aquí...';
    if (tokenHint) tokenHint.classList.toggle('hidden', !hasStoredToken);
  }

  const masterPwdInput = $('masterpwd-input');
  const masterPwdHint = $('masterpwd-preserve-hint');
  if (masterPwdInput) {
    const hasStoredPassword = isEditing && editData.hasMasterPassword;
    masterPwdInput.dataset.hasStoredPassword = hasStoredPassword ? 'true' : 'false';
    masterPwdInput.placeholder = hasStoredPassword
      ? 'Contraseña guardada; déjala vacía para conservarla'
      : 'Escribe la contraseña maestra...';
    if (masterPwdHint) masterPwdHint.classList.toggle('hidden', !hasStoredPassword);
  }
}


// ── Setup / Connect ────────────────────────────────────────────────────────
async function handleConnect() {
  const token     = $('token-input').value.trim();
  const companyId = $('company-input').value.trim();
  const backendUrl= $('backend-input').value.trim().replace(/\/+$/, '');
  const manualName = $('name-input')?.value.trim();
  const manualColor = $('color-input')?.value.trim();
  const manualLogo = $('logo-input')?.value.trim();
  const masterPassword = $('masterpwd-input')?.value.trim();

  const err = $('setup-error');
  err.textContent = '';
  err.classList.add('hidden');

  const isEditingSameCompany = SETUP_EDITING_COMPANY_ID && String(companyId) === String(SETUP_EDITING_COMPANY_ID);
  const canReuseStoredToken = isLocalProxy() && isEditingSameCompany && $('token-input')?.dataset.hasStoredToken === 'true';
  const canReuseStoredPassword = isLocalProxy() && isEditingSameCompany && $('masterpwd-input')?.dataset.hasStoredPassword === 'true';

  if (!token && !canReuseStoredToken) return showSetupError('Por favor introduce el token de sesión (USID).');
  if (!companyId)      return showSetupError('Por favor introduce el Company ID.');
  if (!masterPassword && !canReuseStoredPassword) return showSetupError('Por favor introduce una Contraseña Maestra obligatoria.');

  STATE.token     = token || null;
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
  const masterPassword = $('masterpwd-input')?.value.trim();

  saveCredentials();
  if (typeof persistConfigToServer === 'function') {
    await persistConfigToServer(companyName, brandColor, logoUrl, masterPassword);
  }

  // Guardar timestamp solo cuando se introduce un token nuevo.
  if (STATE.token) saveTokenTimestamp(STATE.companyId);

  // Recargar la lista de empresas guardadas y actualizar el selector inmediatamente
  await loadSavedConfig();
  renderCompanySelector();

  applyCompanyBranding({
    id: STATE.companyId,
    name: companyName,
    brandColor: brandColor,
    logoUrl: logoUrl
  });

  showApp();
  sessionStorage.setItem('ssm_unlocked', 'true');
  await loadInitialData();
  switchModule(STATE.currentModule, { skipLoad: STATE.currentModule === 'vacaciones' });
  renderTokenStatus(); // Mostrar banner si el token es antiguo
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
async function persistConfigToServer(name, brandColor, logoUrl, masterPassword) {
  if (!isLocalProxy()) return;
  try {
    const payload = {
        name:       name || 'Mi Empresa',
        token:      STATE.token,
        companyId:  STATE.companyId,
        backendUrl: STATE.backendUrl,
        brandColor: brandColor,
        logoUrl:    logoUrl,
        masterPassword: masterPassword
    };

    await fetch('/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) { /* non-critical */ }
}

// ── Load data ──────────────────────────────────────────────────────────────
// ── Load data ──────────────────────────────────────────────────────────────
async function loadInitialData() {
  if (STATE.isLoading) return;
  STATE.isLoading = true;
  showLoading(true);

  // Limpieza preventiva de listas antes de la nueva carga
  STATE.allEmployees.clear();
  STATE.presenceMap.clear();

  try {
    // 1. Parallel fetch of core metadata (siempre datos reales)
    const [absTypes, meData, teamEmps, presenceData] = await Promise.all([
      fetchAbsenceTypes(),
      fetchMe(),
      fetchEmployees(),
      fetchPresence()
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
    renderTeamPresenceSummary(presenceData);

    // 5. Initial calendar load
    await loadDataInternal();
    await refreshPresenceSummaryFromTodaySignings();

    // 6. Sincronizar Módulo de Fichajes si está activo
    if (typeof FichajesModule !== 'undefined' && FichajesModule.initialized) {
      FichajesModule.loadData();
    }
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
    let rawData = [];
    let employeeMode = false;

    try {
      rawData = await fetchCalendarGrouped(fmtDate(fromDate), fmtDate(toDate), []);
    } catch (calErr) {
      const is403 = calErr.message.includes('403') || calErr.message.includes('401');
      if (is403 && STATE.currentUser) {
        // Modo empleado: usar calendario personal
        employeeMode = true;
        const myId = getCurrentEmployeeId();
        if (myId) {
          try {
            const personal = await apiFetch(
              `/api/v3/employees/${myId}/calendars?from=${fmtDate(fromDate)}&to=${fmtDate(toDate)}`
            );
            const items = personal?.data || (Array.isArray(personal) ? personal : []);
            // La estructura real es: item.calendarType + item.daysOff[].date
            items.forEach(item => {
              const calType = item.calendarType || {};
              const typeName = displayAbsenceTypeName(calType);
              const typeColor = calType.color || 'ssmv2-purple';
              const typeId = calType.id || 'personal';

              (item.daysOff || []).forEach(dayOff => {
                const date = dayOff.date;
                if (!date) return;
                // Si ya existe ese día, añadir el tipo de ausencia al array existente
                const existing = rawData.find(d => d.date === date);
                const calEntry = {
                  calendar_type: { id: typeId, name: typeName, color: typeColor },
                  employees: [STATE.currentUser || { id: myId }],
                  num_employees: 1
                };
                if (existing) {
                  existing.calendar_types.push(calEntry);
                } else {
                  rawData.push({ date, calendar_types: [calEntry] });
                }
              });
            });
            console.info(`Modo empleado: ${items.length} calendarios → ${rawData.length} días con ausencias`);

            // Registrar los tipos de ausencia personal en STATE para que pasen el filtro del renderer
            items.forEach(item => {
              const calType = item.calendarType || {};
              if (!calType.id) return;
              // Añadir al catálogo de tipos si no existe ya
	              if (!STATE.absenceTypes.find(t => t.id === calType.id)) {
	                STATE.absenceTypes.push({
	                  id: calType.id,
	                  name: displayAbsenceTypeName(calType),
	                  rawName: calType.name || '',
	                  alias: calType.alias || '',
	                  type: calType.type || '',
	                  pickMode: calType.pickMode || '',
	                  remuneratedType: calType.remuneratedType ?? calType.remunerated_type ?? '',
	                  isRemunerated: isRemuneratedAbsenceType(calType.remuneratedType ?? calType.remunerated_type),
	                  color: calType.color || 'ssmv2-purple',
	                  category: calType.category || 'vacation'
	                });
	              }
              // Activar el filtro para que se muestre (no oculto por defecto)
              STATE.activeFilters.add(calType.id);
            });
          } catch (pe) {
            console.warn('Personal calendar fetch failed:', pe.message);
          }
        }
      } else {
        console.error('Calendar fetch failed (non-permission error):', calErr.message);
      }
    }

    // Index by date and extract all employees seen
    STATE.calendarData = {};
    rawData.forEach(dayObj => {
      const date = dayObj.date;
      if (!date) return;
      STATE.calendarData[date] = (dayObj.calendar_types || []).map(ct => {
        const emps = ct.employees || [];
        emps.forEach(e => {
          const emp = STATE.allEmployees.get(String(e.id));
          if (emp) { /* enriquecimiento opcional */ }
        });

        const rawType = ct.calendar_type || {};

        // Registrar dinámicamente el tipo si no existía (ej. ausencias históricas o parciales no devueltas en /absence-types)
	        if (rawType.id && !STATE.absenceTypes.find(t => t.id === rawType.id)) {
	          STATE.absenceTypes.push({
	            id: rawType.id,
	            name: displayAbsenceTypeName(rawType),
	            rawName: rawType.name || '',
	            alias: rawType.alias || '',
	            type: rawType.type || '',
	            pickMode: rawType.pickMode || '',
	            remuneratedType: rawType.remuneratedType ?? rawType.remunerated_type ?? '',
	            isRemunerated: isRemuneratedAbsenceType(rawType.remuneratedType ?? rawType.remunerated_type),
	            color: rawType.color || 'ssmv2-purple',
	            category: rawType.category || 'vacation'
	          });
	          STATE.activeFilters.add(rawType.id);
	        }

        const masterType = STATE.absenceTypes.find(t => t.id === rawType.id) || {};

        return {
          type: {
            ...rawType,
            name: masterType.name || displayAbsenceTypeName(rawType),
            color: masterType.color || 'ssmv2-purple'
          },
          employees: emps,
          numEmployees: ct.num_employees || 0,
        };
      });
    });

    updateMonthLabel();

    // Poblar índice de horarios de ausencias parciales (asíncrono, no bloqueante)
    fetchAbsenceTimesIndex(fmtDate(fromDate), fmtDate(toDate)).then(idx => {
      STATE.absenceTimesIndex = idx;
    });

    // Añadir nota de modo empleado en el label del mes si aplica
    if (employeeMode) {
      const lbl = $('absence-count-label');
      if (lbl) { lbl.textContent = '👤 Solo tus datos'; lbl.title = 'Esta cuenta no tiene acceso al calendario del equipo'; }
    }
    refreshAllViews();
  } catch(e) {
    console.error('Internal data fetch failed:', e);
    // Siempre renderizar aunque sea vacío — no dejar el calendario bloqueado
    STATE.calendarData = STATE.calendarData || {};
    updateMonthLabel();
    refreshAllViews();
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
      const visibleEmps = e.employees.filter(emp => !STATE.hiddenEmployeeIds.has(String(emp.id)));
      if (id) counts[id] = (counts[id] || 0) + visibleEmps.length;
    });
  });

  STATE.absenceTypes.forEach(type => {
    const count = counts[type.id] || 0;
    if (count === 0) return; // Ocultar si el conteo es 0

    const color = resolveColor(type.color);
    const chip = document.createElement('button');
    chip.className = 'absence-filter-chip' + (STATE.activeFilters.has(type.id) ? ' active' : '');
    chip.innerHTML = `
      <span class="filter-dot" style="background:${color}"></span>
      <span class="filter-name">${escapeHTML(type.name || 'Ausencia')}</span>
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
  refreshAllViews();
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
    const presenceStatus = STATE.presenceMap?.get(String(emp.id)) || 'out';
    const presenceClass = safeClassToken(presenceStatus, 'out');
    const safePresence = escapeHTML(presenceStatus);
    const safeId = escapeHTML(emp.id);
    const safeName = escapeHTML(name || 'Empleado');
    const safeJobTitle = escapeHTML(emp.jobTitle || '');
    const safePhoto = safeHttpUrlAttr(emp.imageProfileURL);
    const initials = escapeHTML(getInitials(name));

    const label = document.createElement('label');
    label.className = 'emp-filter-item-premium';
    label.innerHTML = `
      <div class="emp-filter-main">
        <input type="checkbox" value="${safeId}" ${isHidden ? '' : 'checked'} class="ssm-checkbox">
        <div class="emp-avatar-filter" style="${safePhoto ? '' : `background: linear-gradient(135deg, var(--accent), var(--accent2));`}">
          ${safePhoto
            ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer">`
            : initials}
          <span class="status-indicator ${presenceClass}" title="Estado: ${safePresence}"></span>
        </div>
        <div class="emp-filter-info">
          <span class="emp-filter-name" title="${safeName}">${safeName}</span>
          ${safeJobTitle ? `<span class="emp-filter-job">${safeJobTitle}</span>` : ''}
        </div>
      </div>
    `;
    const avatar = label.querySelector('.emp-avatar-filter');
    label.querySelector('.emp-avatar-filter img')?.addEventListener('error', event => {
      event.currentTarget.remove();
      avatar?.insertAdjacentText('afterbegin', getInitials(name));
      if (avatar) avatar.style.background = 'linear-gradient(135deg, var(--accent), var(--accent2))';
    });

    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) STATE.hiddenEmployeeIds.delete(String(emp.id));
      else STATE.hiddenEmployeeIds.add(String(emp.id));

      refreshAllViews();
    });

    container.appendChild(label);
  });

  // Update counter in title
  if (title) {
    const total = STATE.allEmployees.size;
    const hidden = STATE.hiddenEmployeeIds.size;
    const selected = total - hidden;
    title.innerHTML = `Empleados <span class="emp-filter-count">(${selected}/${total})</span>`;
  }
}

// ── Render: user info ──────────────────────────────────────────────────────
function renderUserInfo(user) {
  if (!user) return;
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Usuario';
  const safeName = escapeHTML(name);
  const safeRole = escapeHTML(user.jobTitle || user.email || 'Sesame HR');
  const safePhoto = safeHttpUrlAttr(user.imageProfileURL);
  const initials = escapeHTML(getInitials(name));

  $('user-info').innerHTML = `
    <div class="user-avatar">
      ${safePhoto
        ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer" />`
        : initials}
    </div>
    <div class="user-details">
      <div class="user-name">${safeName}</div>
      <div class="user-role">${safeRole}</div>
    </div>
  `;
  const userAvatar = $('user-info')?.querySelector('.user-avatar');
  userAvatar?.querySelector('img')?.addEventListener('error', event => {
    event.currentTarget.remove();
    userAvatar.textContent = getInitials(name);
  });

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
      const visibleEmps = evt.employees.filter(emp => !STATE.hiddenEmployeeIds.has(String(emp.id)));
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
      ${escapeHTML(evt.type.name || 'Ausencia')} <span style="opacity:0.8; font-size:0.9em">(${evt.numEmployees})</span>
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

  const safePhoto = isSafeHttpUrl(emp.imageProfileURL) ? emp.imageProfileURL : '';
  if (safePhoto) {
    const img = document.createElement('img');
    img.src = safePhoto;
    img.alt = name;
    img.loading = 'lazy';
    img.onerror = () => {
      div.innerHTML = '';
      div.textContent = initials;
    };
    div.appendChild(img);
  } else {
    div.textContent = initials;
  }
  return div;
}

/**
 * Función maestra para refrescar todas las vistas de la aplicación.
 * Centraliza las llamadas de renderizado para asegurar consistencia.
 */
function refreshAllViews() {
  renderFilters();
  renderEmployeeFilterList();
  renderCalendar();
  renderEmployeeList();
  renderStats();

  // Sincronizar Fichajes si el módulo está cargado
  if (typeof FichajesModule !== 'undefined' && FichajesModule.initialized) {
    FichajesModule.renderTable();
  }
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
        if (STATE.hiddenEmployeeIds.has(String(emp.id))) return;
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
    container.innerHTML = '<div class="empty-state-inline">Sin ausencias en este período</div>';
    return;
  }

  empList.forEach(({ emp, absences }) => {
    const name = `${emp.firstName||''} ${emp.lastName||''}`.trim();
    const safeName = escapeHTML(name || 'Empleado');
    const safePhoto = safeHttpUrlAttr(emp.imageProfileURL);
    const initials = escapeHTML(getInitials(name));
    const totalDays = [...absences.values()].reduce((s,v)=>s+v.dates.length, 0);

    const tags = [...absences.entries()].map(([,v]) => {
      const color = resolveColor(v.type.color);
      const bg = hexToRgba(color, 0.25);
      const daysStr = v.dates.sort().join(', ');
      const safeTypeName = escapeHTML(v.type.name || 'Ausencia');
      const safeDaysStr = escapeHTML(daysStr);
      return `<span class="emp-absence-tag" style="background:${bg};border-color:${color}40">
        <span class="emp-absence-dot" style="background:${color}"></span>
        ${safeTypeName} · ${v.dates.length}d <span class="emp-absence-dates">(${safeDaysStr})</span>
      </span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'emp-card';
    card.innerHTML = `
      <div class="emp-avatar">
        ${safePhoto
          ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer" />${initials}`
          : initials}
      </div>
      <div class="emp-info">
        <div class="emp-name">${safeName}</div>
        <div class="emp-absences">${tags}</div>
      </div>
      <div class="emp-days">
        <div class="emp-days-count">${totalDays}</div>
      <div class="emp-days-label">días</div>
      </div>
    `;
    card.querySelector('.emp-avatar img')?.addEventListener('error', event => {
      event.currentTarget.remove();
    });
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
      const visibleEmps = evt.employees.filter(e => !STATE.hiddenEmployeeIds.has(String(e.id)));

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

  const sortedDates = Object.keys(dailyData).sort();
  const topEmps = Object.entries(employeeTotals).sort((a,b) => b[1] - a[1]).slice(0, 10);
  const chartColors = ['#6C63FF', '#00D4AA', '#FF6B8A', '#FFB547', '#4ADE80', '#60A5FA', '#A78BFA', '#FB923C', '#2DD4BF', '#F87171'];

  const summaryHtml = `
    <div class="stats-summary-row">
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Total Ausencias</div>
        <div class="stat-value stats-summary-value">${totalAbsences}</div>
      </div>
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Personas</div>
        <div class="stat-value stats-summary-value">${totalEmployees}</div>
      </div>
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Promedio/Emp</div>
        <div class="stat-value stats-summary-value">${avgDays} d</div>
      </div>
    </div>`;

  if (!window.Chart) {
    const typeRows = Object.values(typeTotals).sort((a, b) => b.total - a.total);
    const maxType = Math.max(...typeRows.map(t => t.total), 1);
    const dailyRows = sortedDates.map(date => ({ date, total: dailyData[date] }));
    const maxDaily = Math.max(...dailyRows.map(row => row.total), 1);
    const maxEmp = Math.max(...topEmps.map(row => row[1]), 1);

    container.innerHTML = `
      ${summaryHtml}
      <div class="stats-fallback-notice" role="status">
        <strong>Gráficos no disponibles</strong>
        <span>Chart.js no se ha cargado. Se muestra una lectura tabular con los mismos datos.</span>
      </div>
      <div class="stats-fallback-card">
        <h3>Reparto por Tipo de Ausencia</h3>
        <div class="stats-fallback-list">
          ${typeRows.map((type, index) => {
            const pct = Math.round((type.total / maxType) * 100);
            const color = chartColors[index % chartColors.length];
            return `
              <div class="stats-fallback-row">
                <span class="stats-fallback-label"><i style="background:${color}"></i>${escapeHTML(type.name || 'Ausencia')}</span>
                <span class="stats-fallback-value">${type.total}</span>
                <span class="stats-fallback-bar"><b style="width:${pct}%;background:${color}"></b></span>
              </div>`;
          }).join('')}
        </div>
      </div>
      <div class="stats-fallback-card">
        <h3>Carga Diaria</h3>
        <div class="stats-fallback-list stats-fallback-list-compact">
          ${dailyRows.map(row => {
            const pct = Math.round((row.total / maxDaily) * 100);
            const day = escapeHTML(row.date.split('-').reverse().slice(0, 2).join('/'));
            return `
              <div class="stats-fallback-row">
                <span class="stats-fallback-label">${day}</span>
                <span class="stats-fallback-value">${row.total}</span>
                <span class="stats-fallback-bar"><b style="width:${pct}%"></b></span>
              </div>`;
          }).join('')}
        </div>
      </div>
      <div class="stats-fallback-card stats-fallback-card-wide">
        <h3>Ránking de Ausencias (Top 10)</h3>
        <div class="stats-fallback-list">
          ${topEmps.map(([name, total]) => {
            const pct = Math.round((total / maxEmp) * 100);
            return `
              <div class="stats-fallback-row">
                <span class="stats-fallback-label">${escapeHTML(name || 'Empleado')}</span>
                <span class="stats-fallback-value">${total}</span>
                <span class="stats-fallback-bar"><b style="width:${pct}%"></b></span>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${summaryHtml}

    <div class="stats-chart-container glass">
      <h3>Reparto por Tipo de Ausencia</h3>
      <canvas id="typeChart"></canvas>
    </div>
    <div class="stats-chart-container glass">
      <h3>Carga Diaria (Ausencias/Día)</h3>
      <canvas id="dailyChart"></canvas>
    </div>
    <div class="stats-chart-container stats-chart-container-wide glass">
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
    const safeTypeName = escapeHTML(evt.type.name || 'Ausencia');
    const section = document.createElement('div');
    section.className = 'modal-type-section';
    section.innerHTML = `
      <div class="modal-type-header">
        <span class="modal-type-dot" style="background:${color}"></span>
        ${safeTypeName}
        <span class="pill pill-trailing">${evt.employees.length}</span>
      </div>
    `;
    evt.employees.forEach(emp => {
      const name = `${emp.firstName||''} ${emp.lastName||''}`.trim();
      const safeName = escapeHTML(name || 'Empleado');
      const safePhoto = safeHttpUrlAttr(emp.imageProfileURL);
      const initials = escapeHTML(getInitials(name));
      const row = document.createElement('div');
      row.className = 'modal-employee';
      const safeWorkStatus = emp.workStatus ? escapeHTML(emp.workStatus) : '';
      const statusClass = emp.workStatus ? safeClassToken(emp.workStatus) : '';
      row.innerHTML = `
        <div class="modal-emp-avatar">
          ${safePhoto
            ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer" />`
            : initials}
        </div>
        <div class="modal-emp-name">
          ${safeName}
          ${(() => {
            const tk = String(emp.id || '') + '_' + dateStr;
            const ti = STATE.absenceTimesIndex && STATE.absenceTimesIndex.get(tk);
            if (!ti || !ti.startTime || !ti.endTime) return '';
            const durH = ti.seconds ? Math.floor(ti.seconds / 3600) : 0;
            const durTxt = durH ? ' <span class="modal-emp-duration">(' + durH + 'h)</span>' : '';
            return '<span class="modal-emp-time">\u{1F550} ' + escapeHTML(ti.startTime.substring(0,5)) + ' \u2013 ' + escapeHTML(ti.endTime.substring(0,5)) + durTxt + '</span>';
          })()}
        </div>
        ${emp.workStatus
          ? `<span class="pill pill-trailing status-${statusClass}">${safeWorkStatus}</span>`
          : ''}
      `;
      const modalAvatar = row.querySelector('.modal-emp-avatar');
      modalAvatar?.querySelector('img')?.addEventListener('error', event => {
        event.currentTarget.remove();
        modalAvatar.textContent = getInitials(name);
      });
      section.appendChild(row);
    });
    body.appendChild(section);
  });

  $('day-modal').classList.remove('hidden');
}

function closeModal() {
  $('day-modal').classList.add('hidden');
}

function locationMapUrl(lat, lon, zoom) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}&z=${zoom}&output=embed`;
}

function updateLocationMapFrame() {
  const { lat, lon, zoom } = LOCATION_MODAL_STATE;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const frame = $('location-map-frame');
  if (frame) frame.src = locationMapUrl(lat, lon, zoom);
  const label = $('location-zoom-label');
  if (label) label.textContent = zoom;
}

function updateLocationZoom(delta) {
  LOCATION_MODAL_STATE.zoom = Math.max(3, Math.min(20, LOCATION_MODAL_STATE.zoom + delta));
  updateLocationMapFrame();
}

function openLocationModal({ lat, lon, kind = 'Ubicación', time = '', employee = '' }) {
  const safeLat = Number(lat);
  const safeLon = Number(lon);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return;

  LOCATION_MODAL_STATE.lat = safeLat;
  LOCATION_MODAL_STATE.lon = safeLon;
  LOCATION_MODAL_STATE.zoom = 15;

  const title = $('location-modal-title');
  if (title) title.textContent = `${kind} del fichaje`;

  const subtitleParts = [employee, time].filter(Boolean);
  const subtitle = $('location-modal-subtitle');
  if (subtitle) subtitle.textContent = subtitleParts.join(' · ');

  const coords = $('location-coords');
  if (coords) coords.textContent = `${safeLat.toFixed(6)}, ${safeLon.toFixed(6)}`;

  const external = $('location-open-external');
  if (external) external.href = `https://www.google.com/maps?q=${safeLat},${safeLon}`;

  updateLocationMapFrame();
  $('location-modal')?.classList.remove('hidden');
}

function closeLocationModal() {
  $('location-modal')?.classList.add('hidden');
  const frame = $('location-map-frame');
  if (frame) frame.src = 'about:blank';
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

      const visibleEmps = evt.employees.filter(emp => !STATE.hiddenEmployeeIds.has(String(emp.id)));
      if (visibleEmps.length === 0) return;

      const date = dateStr.replace(/-/g, '');
      const endDate = new Date(`${dateStr}T00:00:00`);
      endDate.setDate(endDate.getDate() + 1);
      const end = fmtDate(endDate).replace(/-/g, '');
      const typeName = evt.type.name || 'Ausencia';

      visibleEmps.forEach(emp => {
        const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
        events.push([
          'BEGIN:VEVENT',
          `DTSTART;VALUE=DATE:${date}`,
          `DTEND;VALUE=DATE:${end}`,
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

    const url = `${window.location.origin}/feed.ics?token=${token}`;

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

  // Persistir fecha para que no se resetee al cambiar de módulo
  sessionStorage.setItem('ssm_current_date', STATE.currentDate.toISOString());

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
  if (!['month', 'week', 'day'].includes(calView)) return;
  STATE.calView = calView;
  $$('[data-cal-view]').forEach(b => b.classList.toggle('active', b.dataset.calView === calView));
  loadData();
}

// ── Screen management ──────────────────────────────────────────────────────
function showApp() {
  $('setup-screen').classList.remove('active');
  $('setup-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  $('app-screen').classList.add('active');
}

// NOTE: showSetup() is defined earlier in the file (with editData parameter support)

function showLoading(show) {
  $('loading-overlay').classList.toggle('hidden', !show);
}

async function logout() {
  stopAutoRefresh();
  clearCredentials();
  sessionStorage.removeItem('ssm_unlocked');
  sessionStorage.removeItem('ssm_current_date');
  sessionStorage.removeItem('ssm_signings_date');
  sessionStorage.removeItem('ssm_signings_view');
  sessionStorage.removeItem('ssm_fichajes_cache');

  STATE.token = STATE.companyId = STATE.currentUser = null;
  STATE.absenceTypes = [];
  STATE.calendarData = {};
  STATE.activeFilters = new Set();
  const passInput = $('master-pass');
  if (passInput) passInput.value = '';
  showScreen('lock-screen');
}

// El arranque se registra al final del archivo, después de declarar todos los módulos.

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
  currentDate: readSessionDate('ssm_signings_date'),
  currentView: (() => {
    const saved = sessionStorage.getItem('ssm_signings_view');
    return ['month', 'week', 'day', 'balance'].includes(saved) ? saved : 'month';
  })(),
  balanceScope: (() => {
    const saved = sessionStorage.getItem('ssm_signings_balance_scope');
    return ['exercise', 'month'].includes(saved) ? saved : 'exercise';
  })(),
  data: [],
  selectedEmployee: 'all',
  searchQuery: '',
  presenceFilter: 'all', // 'all', 'working', 'paused'
  kioskoMode: false,
  failedIds: new Set(),
  biSchemaFields: null,  // { companyId, aliases[] } — esquema BI descubierto para la empresa activa
  biTheoreticMap: null,
  dayOverrides: null,
  officialHoursBagMap: new Map(),
  officialHoursBagError: '',
  officialHoursBagErrors: new Map(),
  officialHoursBagLoading: false,
  officialHoursBagRunId: 0,
  hoursBagRuleHistoryMap: new Map(),
  hoursBagRuleHistoryErrors: new Map(),
  hoursBagRuleHistoryError: '',
  officialHoursBagProgress: {
    endpoint: '',
    range: '',
    total: 0,
    done: 0,
    pending: 0,
    lastError: ''
  },
  realtimePresence: [],
  isLoading: false,
  balanceWarmupRunId: 0,
  balanceLocalPulseTimer: null,
  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.setupEventListeners();
    this.syncViewButtons();
    this.updateMonthLabel();
  },

  persistPeriodState() {
    sessionStorage.setItem('ssm_signings_date', this.currentDate.toISOString());
    sessionStorage.setItem('ssm_signings_view', this.currentView);
    sessionStorage.setItem('ssm_signings_balance_scope', this.balanceScope);
  },

  isBalanceMonthScope() {
    return this.currentView === 'balance' && this.balanceScope === 'month';
  },

  syncViewButtons() {
    document.querySelectorAll('#fichajes-view-toggle .vt-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.fichajeView === this.currentView);
    });
    this.updateTodayActionLabel();
  },

  updateTodayActionLabel() {
    const button = document.getElementById('today-signings');
    if (!button) return;

    if (this.currentView === 'balance') {
      button.textContent = 'Ejercicio actual';
      button.title = 'Volver al balance del ejercicio actual';
      button.setAttribute('aria-label', 'Volver al balance del ejercicio actual');
    } else {
      button.textContent = 'Hoy';
      button.title = 'Ir al dia actual';
      button.setAttribute('aria-label', 'Ir al dia actual');
    }
  },

  renderBalanceWarmup() {
    if (this.currentView !== 'balance') return;

    const tbody = document.getElementById('signings-tbody');
    if (!tbody) return;

    this.syncInsightsVisibility();

    const thead = document.querySelector('.signings-table thead');
    if (thead) {
      const balanceScopeHeader = this.isBalanceMonthScope() ? 'Balance Mes' : 'Balance Ejercicio';
      thead.innerHTML = `
        <tr>
          <th class="col-employee balance-col-employee">Empleado</th>
          <th class="text-center">${balanceScopeHeader}</th>
          <th class="text-center">Acumulado Sesame</th>
          <th class="text-center">Estado</th>
          <th style="min-width:150px">Visualización</th>
        </tr>
      `;
    }

    const workedEl = document.getElementById('total-worked-hours');
    const theoreticEl = document.getElementById('total-theoretic-hours');
    if (workedEl) workedEl.textContent = '--';
    if (theoreticEl) theoreticEl.textContent = '--';

    const { start, end } = this.getCurrentRangeKeys();
    const scopeLabel = this.isBalanceMonthScope() ? 'mes' : 'ejercicio';
    const candidateIds = this.getBalanceEmployeeIds({ applySearch: true }).slice(0, 5);
    const peopleHtml = candidateIds.length ? `
      <div class="balance-warmup-people">
        ${candidateIds.map(id => {
          const info = this.getBalanceEmployeeInfo(id);
          return `<span title="${escapeHTML(info.name)}">${escapeHTML(info.name)}</span>`;
        }).join('')}
      </div>
    ` : '';

    const skeletonRows = Array(4).fill(0).map(() => `
      <tr class="balance-warmup-skeleton-row">
        <td><span></span></td>
        <td><span></span></td>
        <td><span></span></td>
        <td><span></span></td>
        <td><span></span></td>
      </tr>
    `).join('');

    tbody.innerHTML = `
      <tr class="balance-warmup-row">
        <td colspan="5">
          <div class="balance-warmup-panel" role="status" aria-live="polite">
            <div class="balance-warmup-orb" aria-hidden="true"></div>
            <div class="balance-warmup-copy">
              <strong>Abriendo Balance</strong>
              <span>Preparando ${escapeHTML(scopeLabel)} ${escapeHTML(start)} - ${escapeHTML(end)}</span>
              ${peopleHtml}
            </div>
            <div class="balance-warmup-track" aria-hidden="true"><span></span></div>
          </div>
        </td>
      </tr>
      ${skeletonRows}
    `;

    this.requestBalanceTopPin();
  },

  scheduleBalanceLoadAfterWarmup(ignoreCache = false) {
    const runId = ++this.balanceWarmupRunId;
    this.renderBalanceWarmup();

    const startLoad = () => {
      if (runId !== this.balanceWarmupRunId || this.currentView !== 'balance') return;
      this.loadData(ignoreCache);
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.setTimeout(startLoad, 220));
      });
    } else {
      window.setTimeout(startLoad, 220);
    }
  },

  cancelBalanceWarmup() {
    this.balanceWarmupRunId += 1;
  },

  startBalanceLocalPulse() {
    if (this.balanceLocalPulseTimer) {
      clearInterval(this.balanceLocalPulseTimer);
      this.balanceLocalPulseTimer = null;
    }

    this.officialHoursBagProgress = {
      ...(this.officialHoursBagProgress || {}),
      localPulse: 10
    };

    this.balanceLocalPulseTimer = window.setInterval(() => {
      const progress = this.officialHoursBagProgress || {};
      if (this.currentView !== 'balance' || progress.phase !== 'local' || !this.officialHoursBagLoading) {
        this.stopBalanceLocalPulse();
        return;
      }

      const current = Number(progress.localPulse || 10);
      const next = current >= 96 ? 10 : current + 9;
      this.officialHoursBagProgress = {
        ...progress,
        localPulse: next
      };
      this.renderTable();
    }, 280);
  },

  stopBalanceLocalPulse() {
    if (!this.balanceLocalPulseTimer) return;
    clearInterval(this.balanceLocalPulseTimer);
    this.balanceLocalPulseTimer = null;
  },

  startSigningsTopProgress() {
    const progressBar = $('signings-progress-bar');
    const progressContainer = $('signings-progress-container');
    if (!progressContainer || !progressBar) return;
    progressContainer.classList.remove('hidden');
    progressContainer.classList.add('is-indeterminate');
    progressBar.style.width = '38%';
  },

  updateSigningsTopProgress(percent) {
    const progressBar = $('signings-progress-bar');
    const progressContainer = $('signings-progress-container');
    if (!progressContainer || !progressBar) return;
    progressContainer.classList.remove('hidden', 'is-indeterminate');
    progressBar.style.width = `${Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))}%`;
  },

  finishSigningsTopProgress() {
    const progressBar = $('signings-progress-bar');
    const progressContainer = $('signings-progress-container');
    if (!progressContainer || !progressBar) return;
    progressContainer.classList.remove('is-indeterminate');
    progressBar.style.width = '100%';
    window.setTimeout(() => {
      progressContainer.classList.add('hidden');
      progressBar.style.width = '0%';
    }, 450);
  },

  renderBalanceEmptyLoading(tbody) {
    const { start, end } = this.getCurrentRangeKeys();
    const scopeLabel = this.isBalanceMonthScope() ? 'mes' : 'ejercicio';
    const progressState = this.officialHoursBagProgress || {};
    const phase = progressState.phase || 'local';
    const phaseLabel = phase === 'statistics'
      ? 'Consultando Sesame Statistics'
      : phase === 'history'
        ? 'Aplicando bolsa de horas'
        : 'Preparando base local';
    const rangeLabel = progressState.range || `${start} -> ${end}`;
    const total = Number(progressState.total || this.getBalanceEmployeeIds().length || STATE.allEmployees.size || 0);
    const done = Number(progressState.done || 0);
    const pending = Math.max(0, Number(progressState.pending ?? total));
    const activeIds = (progressState.activeEmployeeIds || progressState.employeeIds || this.getBalanceEmployeeIds()).slice(0, 6);
    const activePeopleHtml = activeIds.length ? `
      <div class="balance-load-people" aria-label="Empleados en preparacion">
        <span>Preparando</span>
        ${activeIds.map(id => {
          const info = this.getBalanceEmployeeInfo(id);
          return `<b title="${escapeHTML(info.name)}">${escapeHTML(info.name)}</b>`;
        }).join('')}
      </div>
    ` : '';
    const skeletonRows = Array(5).fill(0).map(() => `
      <tr class="balance-warmup-skeleton-row">
        <td><span></span></td>
        <td><span></span></td>
        <td><span></span></td>
        <td><span></span></td>
        <td><span></span></td>
      </tr>
    `).join('');

    tbody.innerHTML = `
      <tr class="balance-source-audit-row">
        <td colspan="5" style="padding: 12px 14px; background: rgba(45, 212, 191, 0.07); border-bottom: 1px solid rgba(45, 212, 191, 0.16);">
          <div class="balance-load-panel balance-load-panel-empty">
            <div class="balance-load-main">
              <strong class="balance-load-title">${escapeHTML(phaseLabel)}</strong>
              <span title="${escapeHTML(rangeLabel)}">Preparando rango ${escapeHTML(scopeLabel)}: ${escapeHTML(rangeLabel)}</span>
            </div>
            <div class="balance-load-metrics">
              <span><strong>${done}</strong> procesados</span>
              <span><strong>${total}</strong> empleados</span>
              <span><strong>${pending}</strong> pendientes</span>
            </div>
            <div class="balance-load-track balance-load-track-pending" aria-hidden="true">
              <div class="balance-load-fill"></div>
            </div>
            <div class="balance-load-steps">
              <span class="balance-load-step active">Base local</span>
              <span class="balance-load-step">Statistics</span>
              <span class="balance-load-step">Bolsa</span>
              <span class="balance-load-step">Listo</span>
            </div>
            ${activePeopleHtml}
          </div>
        </td>
      </tr>
      ${skeletonRows}
    `;
  },

  goToCurrentExerciseBalance(ignoreCache = true) {
    STATE.currentModule = 'balances';
    localStorage.setItem('ssm_current_module', 'balances');
    syncModuleSwitcherActive('balances');
    this.currentView = 'balance';
    this.balanceScope = 'exercise';
    this.currentDate = new Date();
    this.requestBalanceTopPin();
    this.persistPeriodState();
    this.syncViewButtons();
    this.updateMonthLabel();
    this.scheduleBalanceLoadAfterWarmup(ignoreCache);
  },

  goToBalanceMonth(year, month, ignoreCache = true) {
    STATE.currentModule = 'balances';
    localStorage.setItem('ssm_current_module', 'balances');
    syncModuleSwitcherActive('balances');
    this.currentView = 'balance';
    this.balanceScope = 'month';
    this.currentDate = new Date(year, month, 1);
    this.requestBalanceTopPin();
    this.persistPeriodState();
    this.syncViewButtons();
    this.updateMonthLabel();
    this.scheduleBalanceLoadAfterWarmup(ignoreCache);
  },

  requestBalanceTopPin() {
    if (this.currentView !== 'balance') return;
    this.balanceTopPinPasses = 3;
    this.pinBalanceViewTop();
  },

  consumeBalanceTopPin() {
    if (this.currentView !== 'balance' || !this.balanceTopPinPasses) return;
    this.balanceTopPinPasses -= 1;
    this.pinBalanceViewTop();
  },

  pinBalanceViewTop() {
    if (this.currentView !== 'balance') return;
    const reset = () => {
      [
        document.querySelector('.signings-table-container'),
        document.getElementById('module-fichajes-wrapper'),
        document.querySelector('.main-content')
      ].forEach(target => {
        if (!target) return;
        target.scrollTop = 0;
        target.scrollLeft = 0;
      });
      if (window.scrollY || window.scrollX) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    };
    reset();
    requestAnimationFrame(reset);
  },

  setupEventListeners() {
    // Navegación Temporal
    document.getElementById('prev-month-signings')?.addEventListener('click', () => {
      if (this.currentView === 'day') this.currentDate.setDate(this.currentDate.getDate() - 1);
      else if (this.currentView === 'week') this.currentDate.setDate(this.currentDate.getDate() - 7);
      else if (this.isBalanceMonthScope()) this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      else if (this.currentView === 'balance') this.currentDate.setFullYear(this.currentDate.getFullYear() - 1);
      else this.currentDate.setMonth(this.currentDate.getMonth() - 1);

      this.persistPeriodState();
      this.updateMonthLabel();
      this.loadData();
    });

    document.getElementById('next-month-signings')?.addEventListener('click', () => {
      if (this.currentView === 'day') this.currentDate.setDate(this.currentDate.getDate() + 1);
      else if (this.currentView === 'week') this.currentDate.setDate(this.currentDate.getDate() + 7);
      else if (this.isBalanceMonthScope()) this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      else if (this.currentView === 'balance') this.currentDate.setFullYear(this.currentDate.getFullYear() + 1);
      else this.currentDate.setMonth(this.currentDate.getMonth() + 1);

      this.persistPeriodState();
      this.updateMonthLabel();
      this.loadData();
    });

    // Botón Hoy
    document.getElementById('today-signings')?.addEventListener('click', () => {
      if (this.currentView === 'balance') {
        this.goToCurrentExerciseBalance(true);
        return;
      }
      this.currentDate = new Date();
      this.persistPeriodState();
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
        if (view === 'balance') {
          STATE.currentModule = 'balances';
          localStorage.setItem('ssm_current_module', 'balances');
          syncModuleSwitcherActive('balances');
          this.balanceScope = 'exercise';
          this.requestBalanceTopPin();
        } else {
          STATE.currentModule = 'fichajes';
          localStorage.setItem('ssm_current_module', 'fichajes');
          syncModuleSwitcherActive('fichajes');
        }
        this.persistPeriodState();
        this.updateMonthLabel();
        if (view === 'balance') {
          this.scheduleBalanceLoadAfterWarmup();
        } else {
          this.cancelBalanceWarmup();
          this.loadData();
        }
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
    document.getElementById('export-signings-json')?.addEventListener('click', () => {
      this.exportToJSON();
    });

    // Filtro por Empleado
    document.getElementById('signings-employee-select')?.addEventListener('change', (e) => {
      this.selectedEmployee = e.target.value;
      this.renderTable();
    });
    // Refresh btn
    document.getElementById('refresh-signings-btn')?.addEventListener('click', () => {
      this.loadData(true);
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
    document.getElementById('filter-live-out')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleOutPresencePopover();
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('#presence-out-popover, #filter-live-out')) return;
      this.closeOutPresencePopover();
    });

    // Kiosko Mode
    document.getElementById('kiosko-mode-btn')?.addEventListener('click', () => this.toggleKioskoMode());

    // Listen for fullscreen change to sync state
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        this.kioskoMode = false;
        document.body.classList.remove('kiosko-mode-active');
      }
    });

    // Botón de Cumpleaños
    document.getElementById('birthdays-btn')?.addEventListener('click', () => {
      this.showBirthdaysModal();
    });

    document.getElementById('birthdays-modal-close')?.addEventListener('click', () => {
      document.getElementById('birthdays-modal').classList.add('hidden');
    });

    // Cerrar modal al hacer clic fuera
    document.getElementById('birthdays-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'birthdays-modal') {
        e.target.classList.add('hidden');
      }
    });

  },

  togglePresenceFilter(type) {
    if (this.presenceFilter === type) {
      this.presenceFilter = 'all';
    } else {
      this.presenceFilter = type;
    }
    this.closeOutPresencePopover();
    renderTeamPresenceSummary(this.realtimePresence?.length ? this.realtimePresence : STATE.presenceList, {
      rows: this.data,
      currentDayRowsAuthority: this.currentRangeIncludesToday()
    });
    this.renderTable();
  },

  toggleOutPresencePopover() {
    const popover = document.getElementById('presence-out-popover');
    if (!popover) return;

    if (!popover.classList.contains('hidden')) {
      this.closeOutPresencePopover();
      return;
    }

    this.presenceFilter = 'all';
    this.renderTable();
    this.renderOutPresencePopover();
  },

  closeOutPresencePopover() {
    const popover = document.getElementById('presence-out-popover');
    if (!popover) return;
    popover.classList.add('hidden');
    document.getElementById('filter-live-out')?.classList.remove('active');
  },

  renderOutPresencePopover() {
    const popover = document.getElementById('presence-out-popover');
    if (!popover) return;

    const source = this.realtimePresence?.length ? this.realtimePresence : STATE.presenceList;
    const outEmployees = getTeamPresenceOutEmployees(source, {
      rows: this.data,
      currentDayRowsAuthority: this.currentRangeIncludesToday()
    });
    const count = outEmployees.length;

    const listHtml = outEmployees.length
      ? outEmployees.map(emp => {
          const safeName = escapeHTML(emp.name);
          const safeJobTitle = escapeHTML(emp.jobTitle || 'Sin actividad ahora');
          const safePhoto = safeHttpUrlAttr(emp.photoUrl);
          const initials = escapeHTML(emp.initials || getInitials(emp.name));
          return `
            <div class="presence-out-person">
              <div class="presence-out-avatar" style="${safePhoto ? '' : 'background: linear-gradient(135deg, var(--accent), var(--accent2));'}">
                ${safePhoto ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer">` : initials}
              </div>
              <div class="presence-out-info">
                <strong>${safeName}</strong>
                <span>${safeJobTitle}</span>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="presence-out-empty">No hay empleados fuera ahora.</div>';

    popover.innerHTML = `
      <div class="presence-out-head">
        <strong>Fuera ahora</strong>
        <span>${count}</span>
      </div>
      <div class="presence-out-list">${listHtml}</div>
    `;
    popover.classList.remove('hidden');
    document.getElementById('filter-live-out')?.classList.add('active');
  },

  getCurrentActivityKind(employeeId, rows = this.data) {
    const id = String(employeeId || '');
    if (!id) return 'out';

    const todayKey = getLocalDateKey();
    const todayRows = (Array.isArray(rows) ? rows : []).filter(row =>
      String(row.employeeId || '') === id && String(row.date || '') === todayKey
    );
    const rowKind = todayRows
      .map(row => classifySigningRowPresence(row))
      .sort((a, b) => getPresenceRank(b) - getPresenceRank(a))[0] || 'out';
    if (rowKind !== 'out') return rowKind;

    const presence = (this.realtimePresence || [])
      .find(p => String(getPresenceEmployeeId(p) || '') === id);
    if (!presence || getPresenceRecordDateKey(presence) !== todayKey) return 'out';

    return classifyPresenceRecord(presence);
  },

  getCurrentRangeKeys() {
    const cursor = new Date(this.currentDate);
    let startDate = new Date(cursor);
    let endDate = new Date(cursor);

    if (this.currentView === 'balance' && this.balanceScope !== 'month') {
      startDate = new Date(cursor.getFullYear(), 0, 1);
      endDate = new Date(cursor.getFullYear(), 11, 31);
    } else if (this.currentView === 'week') {
      const day = startDate.getDay() || 7;
      startDate.setDate(startDate.getDate() - day + 1);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
    } else if (this.currentView !== 'day') {
      startDate.setDate(1);
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    }

    return {
      start: getLocalDateKey(startDate),
      end: getLocalDateKey(endDate),
      startDate,
      endDate
    };
  },

  currentRangeIncludesToday() {
    const todayKey = getLocalDateKey();
    const { start, end } = this.getCurrentRangeKeys();
    return start <= todayKey && todayKey <= end;
  },

  syncCurrentPresenceMap(source = this.realtimePresence, rows = this.data) {
    const nextMap = new Map();
    const todayKey = getLocalDateKey();

    (Array.isArray(source) ? source : []).forEach(record => {
      if (!isCurrentPresenceRecord(record, todayKey)) return;
      const employeeId = getPresenceEmployeeId(record);
      const kind = classifyPresenceRecord(record);
      if (employeeId && kind !== 'out') {
        mergePresenceKind(nextMap, employeeId, kind);
      }
    });

    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (String(row.date || '') !== todayKey) return;
      const kind = classifySigningRowPresence(row);
      if (row.employeeId && kind !== 'out') {
        mergePresenceKind(nextMap, row.employeeId, kind);
      }
    });

    STATE.presenceMap.clear();
    nextMap.forEach((kind, employeeId) => {
      STATE.presenceMap.set(String(employeeId), kind);
    });
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

  toggleAll() {
    const tbody = document.getElementById('signings-tbody');
    if (!tbody) return;
    const detailsRows = Array.from(tbody.querySelectorAll('.row-details'));
    if (detailsRows.length === 0) return;

    const anyCollapsed = detailsRows.some(row => !row.classList.contains('active'));

    detailsRows.forEach(rowDetails => {
      if (anyCollapsed) {
        if (!rowDetails.classList.contains('active')) {
          rowDetails.classList.add('active');
          const empId = rowDetails.dataset.employeeId;
          const date = rowDetails.dataset.date;
          if (empId && date) {
            this.loadDeepAudit(empId, date);
          }
        }
      } else {
        rowDetails.classList.remove('active');
      }
    });
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
    } else if (this.currentView === 'balance') {
      if (this.isBalanceMonthScope()) {
        el.textContent = `Balance ${this.currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`;
      } else {
        const currentYear = new Date().getFullYear();
        const year = this.currentDate.getFullYear();
        el.textContent = year === currentYear ? `Ejercicio actual ${year}` : `Ejercicio ${year}`;
      }
    } else {
      el.textContent = this.currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    }

    this.updateTodayActionLabel();
  },

  showBirthdaysModal() {
    const modal = document.getElementById('birthdays-modal');
    const dateDisplay = document.getElementById('current-date-display');
    if (!modal) return;

    const today = new Date();
    if (dateDisplay) {
      dateDisplay.textContent = today.toLocaleDateString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    }

    this.renderBirthdays();
    modal.classList.remove('hidden');

    // Intentar carga profunda si no hay datos o para asegurar frescura
    this.fetchBirthdaysBI();
  },

  async fetchBirthdaysBI() {
    try {
      console.log("Deep Birthday Harvest started...");
      const res = await apiFetchBi({
        "from": "core_context_employee",
        "select": [
          {"field": "core_context_employee.id", "alias": "id"},
          {"field": "core_context_employee.name", "alias": "name"},
          {"field": "core_context_employee.birth_date", "alias": "birthDate"},
          {"field": "core_context_employee.birthday", "alias": "birthday"},
          {"field": "core_context_employee.date_of_birth", "alias": "dob"},
          {"field": "core_context_employee.image_profile_url", "alias": "photo"}
        ],
        "limit": 1000
      });

      const raw = res.data || res || [];
      let updatedCount = 0;
      raw.forEach(row => {
        const bDate = row.birthDate || row.birthday || row.dob;
        if (row.id && bDate) {
          const emp = STATE.allEmployees.get(String(row.id));
          if (emp) {
            emp.birthDate = bDate;
            if (row.photo && !emp.imageProfileURL) emp.imageProfileURL = row.photo;
            updatedCount++;
          } else {
            upsertEmployee({
              id: row.id,
              firstName: row.name,
              birthDate: bDate,
              imageProfileURL: row.photo
            });
            updatedCount++;
          }
        }
      });

      if (updatedCount > 0) {
        console.log(`Deep Birthday Harvest: Updated ${updatedCount} profiles.`);
        this.renderBirthdays();
      }

      // Si después del BI seguimos sin datos, iniciamos escaneo serial (uno a uno)
      // Solo para los empleados que no tengan fecha y máximo 50 para no saturar
      this.startSerialBirthdayScan();

    } catch (e) {
      console.warn("Deep Birthday Harvest failed:", e);
      this.startSerialBirthdayScan();
    }
  },

  async startSerialBirthdayScan() {
    if (this.isScanning) return;
    this.isScanning = true;

    const employees = Array.from(STATE.allEmployees.values())
      .filter(e => !e.birthDate)
      .slice(0, 40); // Limitamos a 40 para evitar baneo del WAF

    console.log(`Serial Scan: ${employees.length} candidates.`);

    for (const emp of employees) {
      if (!this.isScanning) break;
      try {
        // Pequeña pausa para no saturar el WAF
        await new Promise(r => setTimeout(r, 500));

        const res = await apiFetch(`/api/v3/employees/${emp.id}`);
        const full = res.data || res;
        // IGUAL que showContactCard: siempre upsertear si el perfil tiene id
        // upsertEmployee extrae birthDate de campos anidados (personalData.birthDate, etc.)
        if (full && full.id) {
          upsertEmployee(full);
          // Re-renderizar si ahora tiene birthDate (lo detecta upsertEmployee)
          const updated = STATE.allEmployees.get(String(full.id));
          if (updated && updated.birthDate) {
            this.renderBirthdays();
          }
        }
      } catch (e) {
        console.warn(`Serial Scan failed for ${emp.id}:`, e);
      }
    }
    this.isScanning = false;
    this.renderBirthdays(); // Renderizado final al completar
  },

  renderBirthdays() {
    const container = document.getElementById('birthdays-modal-body');
    if (!container) return;

    const employees = Array.from(STATE.allEmployees.values());
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    // Procesar todos los empleados que tengan fecha de nacimiento
    const birthdayList = employees
      .map(emp => {
        if (!emp.birthDate) return null;
        const d = new Date(emp.birthDate);
        if (isNaN(d.getTime())) return null;

        const bMonth = d.getMonth() + 1;
        const bDay = d.getDate();

        return {
          ...emp,
          bMonth,
          bDay,
          isToday: bMonth === currentMonth && bDay === currentDay
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.bMonth !== b.bMonth) return a.bMonth - b.bMonth;
        return a.bDay - b.bDay;
      });

    if (birthdayList.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No hay datos de cumpleaños disponibles.</p>
          ${this.isScanning ? '<div class="sync-loader"><span class="spinner-sm"></span> Sincronizando datos profundos...</div>' : ''}
        </div>`;
      return;
    }

    let html = '<div class="birthday-full-year">';

    if (this.isScanning) {
      html += `
        <div class="sync-banner">
          <span class="spinner-sm"></span>
          <span>Sincronizando perfiles... (${birthdayList.length} encontrados)</span>
        </div>
      `;
    }

    // Agrupar por mes
    for (let m = 1; m <= 12; m++) {
      const monthEmps = birthdayList.filter(b => b.bMonth === m);
      if (monthEmps.length === 0) continue;

      html += `
        <div class="birthday-month-group ${m === currentMonth ? 'current-month' : ''}">
          <h4 class="month-title">${MONTHS_ES[m-1]}</h4>
          <div class="birthday-list-compact">
            ${monthEmps.map(emp => this.renderBirthdayCard(emp, emp.isToday)).join('')}
          </div>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;
  },

  renderBirthdayCard(emp, isToday) {
    const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
    const dateStr = `${emp.bDay} de ${MONTHS_ES[emp.bMonth - 1]}`;

    return `
      <div class="birthday-card ${isToday ? 'is-today' : ''}">
        ${renderLocalAvatar(fullName, emp.imageProfileURL, 'birthday-avatar')}
        <div class="birthday-info">
          <span class="birthday-name">${escapeHTML(fullName)}</span>
          <span class="birthday-date">${escapeHTML(dateStr)} ${isToday ? '🎉' : ''}</span>
        </div>
      </div>
    `;
  },

  async loadData(ignoreCache = false, options = {}) {
    if (typeof ignoreCache === 'object' && ignoreCache !== null) {
      options = ignoreCache;
      ignoreCache = !!options.ignoreCache;
    }

    if (this.isLoading) return;
    this.isLoading = true;

    const isSilent = !!options.silent;
    if (!isSilent && this.currentView === 'balance') {
      this.requestBalanceTopPin();
    } else if (!isSilent) {
      this.startSigningsTopProgress();
    }
    const previousState = isSilent ? {
      data: Array.isArray(this.data) ? [...this.data] : [],
      realSignings: Array.isArray(this.realSignings) ? [...this.realSignings] : [],
      biTheoreticMap: this.biTheoreticMap instanceof Map ? new Map(this.biTheoreticMap) : this.biTheoreticMap,
      dayOverrides: this.dayOverrides instanceof Map ? new Map(this.dayOverrides) : this.dayOverrides,
      officialHoursBagMap: this.officialHoursBagMap instanceof Map ? new Map(this.officialHoursBagMap) : new Map(),
      officialHoursBagError: this.officialHoursBagError,
      officialHoursBagErrors: this.officialHoursBagErrors instanceof Map ? new Map(this.officialHoursBagErrors) : new Map(),
      officialHoursBagLoading: this.officialHoursBagLoading,
      hoursBagRuleHistoryMap: this.hoursBagRuleHistoryMap instanceof Map ? new Map(this.hoursBagRuleHistoryMap) : new Map(),
      hoursBagRuleHistoryErrors: this.hoursBagRuleHistoryErrors instanceof Map ? new Map(this.hoursBagRuleHistoryErrors) : new Map(),
      hoursBagRuleHistoryError: this.hoursBagRuleHistoryError,
      officialHoursBagProgress: { ...(this.officialHoursBagProgress || {}) },
      absenceTimesMap: this.absenceTimesMap instanceof Map ? new Map(this.absenceTimesMap) : this.absenceTimesMap,
      realtimePresence: Array.isArray(this.realtimePresence) ? [...this.realtimePresence] : []
    } : null;
    const restoreSilentState = () => {
      if (!previousState) return;
      this.data = previousState.data;
      this.realSignings = previousState.realSignings;
      this.biTheoreticMap = previousState.biTheoreticMap;
      this.dayOverrides = previousState.dayOverrides;
      this.officialHoursBagMap = previousState.officialHoursBagMap;
      this.officialHoursBagError = previousState.officialHoursBagError;
      this.officialHoursBagErrors = previousState.officialHoursBagErrors;
      this.officialHoursBagLoading = previousState.officialHoursBagLoading;
      this.hoursBagRuleHistoryMap = previousState.hoursBagRuleHistoryMap;
      this.hoursBagRuleHistoryErrors = previousState.hoursBagRuleHistoryErrors;
      this.hoursBagRuleHistoryError = previousState.hoursBagRuleHistoryError;
      this.officialHoursBagProgress = previousState.officialHoursBagProgress;
      this.absenceTimesMap = previousState.absenceTimesMap;
      this.realtimePresence = previousState.realtimePresence;
    };

    if (!isSilent) {
      this.persistPeriodState();
      this.syncViewButtons();
      this.updateMonthLabel();
    }

    const { start, end } = this.getCurrentRangeKeys();


    try {
      // 0. Cache check: Si ya tenemos los datos en esta sesión, mostrarlos inmediatamente
      const cacheKey = `ssm_fichajes_cache_${STATE.companyId}_${this.currentView}_${start}_${end}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached && !ignoreCache && !isSilent) {
        try {
          const parsed = JSON.parse(cached);
          this.data = parsed.data || [];
          this.realSignings = parsed.realSignings || [];
          // Map no se serializa a JSON: hay que reconstruirlo
          if (parsed.biTheoreticMap) {
            this.biTheoreticMap = new Map(Object.entries(parsed.biTheoreticMap));
          }
          this.populateEmployeeSelect();
          this.renderTable();
          console.info(`Fichajes: Cache hits for ${start}/${end} (${this.data.length} registros).`);
        } catch (e) {
          console.warn("Fichajes cache parse error:", e);
        }
      }

      if (!isSilent && this.currentView === 'balance') {
        this.data = [];
        this.realSignings = [];
        this.biTheoreticMap = new Map();
        this.dayOverrides = new Map();
        this.balanceCalendarSummaryMap = new Map();
        this.absenceTimesMap = new Map();
        this.prepareOfficialWorkedHoursLoad(start, end);
        this.populateEmployeeSelect();
        this.renderTable();
      } else if (!isSilent) {
        this.renderSkeletons();
      }

      // RESTAURACIÓN DEL SELECTOR: Cargamos el desplegable nada más empezar
      // para que el usuario pueda filtrar aunque la carga de datos falle.
      if (!isSilent) {
        this.populateEmployeeSelect();
      }

      // Claves de configuración por empresa (scope externo para ser accesibles en todo loadData)
      const BI_SCHEMA_CACHE_KEY = `ssm_bi_schema_${STATE.companyId}`;
      const BI_WAF_KEY          = `ssm_bi_waf_${STATE.companyId}`;
      const COMPANY_MODE_KEY    = `ssm_company_mode_${STATE.companyId}`;
      const biWafBlocked        = localStorage.getItem(BI_WAF_KEY) === 'blocked';

      let biData = [];
      let biTheoreticMap = new Map();

      try {
        // ── ESQUEMA BI POR EMPRESA ─────────────────────────────────────────

        const BI_CORE_SELECT = [
          {"field": "schedule_context_check.date", "alias": "date"},
          {"field": "schedule_context_check.check_in_check_datetime", "alias": "checkIn"},
          {"field": "schedule_context_check.check_out_check_datetime", "alias": "checkOut"},
          {"field": "schedule_context_check.seconds_worked", "alias": "secondsWorked"},
          {"field": "schedule_context_check.type", "alias": "type"},
          {"field": "core_context_employee.name", "alias": "employeeName"},
          {"field": "core_context_employee.id", "alias": "employeeId"}
        ];

        const BI_ENRICHMENT_SELECT = [
          {"field": "schedule_context_check.check_in_latitude", "alias": "checkInLat"},
          {"field": "schedule_context_check.check_in_longitude", "alias": "checkInLon"},
          {"field": "schedule_context_check.check_out_latitude", "alias": "checkOutLat"},
          {"field": "schedule_context_check.check_out_longitude", "alias": "checkOutLon"},
          {"field": "schedule_context_check.check_in_address", "alias": "checkInAddr"},
          {"field": "schedule_context_check.check_out_address", "alias": "checkOutAddr"},
          {"field": "schedule_context_check.check_in_device_name", "alias": "deviceNameIn"},
          {"field": "schedule_context_check.check_out_device_name", "alias": "deviceNameOut"},
          {"field": "schedule_context_check.check_in_ip", "alias": "ipIn"},
          {"field": "schedule_context_check.check_out_ip", "alias": "ipOut"},
          {"field": "schedule_context_check.check_in_office_name", "alias": "officeNameIn"},
          {"field": "schedule_context_check.check_out_office_name", "alias": "officeNameOut"},
          {"field": "schedule_context_check.check_in_inside_office", "alias": "insideOfficeIn"},
          {"field": "schedule_context_check.check_in_performed_by_employee_name", "alias": "performedByNameIn"},
          {"field": "schedule_context_check.check_out_performed_by_employee_name", "alias": "performedByNameOut"},
          {"field": "schedule_context_check.check_in_performed_by_employee_id", "alias": "performedByIdIn"},
          {"field": "schedule_context_check.check_out_performed_by_employee_id", "alias": "performedByIdOut"}
        ];

        const BI_WHERE = [
          {"field": "schedule_context_check.date", "operator": ">=", "value": start},
          {"field": "schedule_context_check.date", "operator": "<=", "value": end}
        ];

        // Leer el esquema cacheado para esta empresa
        let cachedSchemaAliases = null;
        if (!biWafBlocked) {
          try {
            const raw = localStorage.getItem(BI_SCHEMA_CACHE_KEY);
            if (raw) cachedSchemaAliases = JSON.parse(raw);
          } catch (e) { cachedSchemaAliases = null; }

          if (this.biSchemaFields && this.biSchemaFields.companyId === STATE.companyId) {
            cachedSchemaAliases = this.biSchemaFields.aliases;
          }
        } else {
          console.info(`BI Engine [${STATE.companyId.substring(0,8)}]: Bloqueado por WAF (cachéd) — saltando al fallback REST.`);
        }

        let enrichmentOk = false;
        let activeEnrichmentFields = BI_ENRICHMENT_SELECT;

        // Si el caché dice que esta empresa tiene esquema reducido, usarlo directamente
        if (cachedSchemaAliases !== null) {
          activeEnrichmentFields = BI_ENRICHMENT_SELECT.filter(f => cachedSchemaAliases.includes(f.alias));
          if (activeEnrichmentFields.length === 0) {
            // Esta empresa no tiene ningún campo de enriquecimiento: usar sólo core
            try {
              const res = await apiFetchBi({
                "from": "schedule_context_check",
                "select": BI_CORE_SELECT,
                "where": BI_WHERE,
                "order_by": [{"field": "date", "direction": "DESC"}],
                "limit": 5000
              });
              biData = res.data || res || [];
            } catch (coreErr) {
              console.error("BI Engine [cached-core]: Query failed.", coreErr.message);
            }
          } else {
            // Empresa con enriquecimiento parcial cacheado
            try {
              const res = await apiFetchBi({
                "from": "schedule_context_check",
                "select": [...BI_CORE_SELECT, ...activeEnrichmentFields],
                "where": BI_WHERE,
                "order_by": [{"field": "date", "direction": "DESC"}],
                "limit": 5000
              });
              biData = res.data || res || [];
              enrichmentOk = true;
            } catch (e) {
              // El caché puede haberse quedado obsoleto: forzar re-descubrimiento
              console.warn("BI Engine [cached]: Query failed, clearing schema cache and retrying.", e.message);
              localStorage.removeItem(BI_SCHEMA_CACHE_KEY);
              this.biSchemaFields = null;
              cachedSchemaAliases = null;
            }
          }
        }

        // Sin caché (primera vez con esta empresa) o caché invalidado: descubrimiento completo
        if (cachedSchemaAliases === null && !biWafBlocked) {
          try {
            // Intento 1: Query completa (más eficiente si el esquema BI está al día)
            const res = await apiFetchBi({
              "from": "schedule_context_check",
              "select": [...BI_CORE_SELECT, ...BI_ENRICHMENT_SELECT],
              "where": BI_WHERE,
              "order_by": [{"field": "date", "direction": "DESC"}],
              "limit": 5000
            });
            biData = res.data || res || [];
            enrichmentOk = true;
            // Guardar el esquema completo para esta empresa
            const allAliases = BI_ENRICHMENT_SELECT.map(f => f.alias);
            localStorage.setItem(BI_SCHEMA_CACHE_KEY, JSON.stringify(allAliases));
            this.biSchemaFields = { companyId: STATE.companyId, aliases: allAliases };
          } catch (fullQueryErr) {
            // ¿Es un bloqueo WAF (HTML 403) o un error de esquema?
            const isWafBlock = fullQueryErr.message.includes('administrative rules') ||
                               (fullQueryErr.message.includes('403') && !fullQueryErr.message.includes('{'));
            if (isWafBlock) {
              localStorage.setItem(BI_WAF_KEY, 'blocked');
              console.warn(`BI Engine [${STATE.companyId.substring(0,8)}]: Bloqueado por WAF. Cacheando para futuras cargas.`);
            } else {
              // Intento 2: Sólo campos core (solo si no es WAF)
              console.warn(`BI Engine [${STATE.companyId.substring(0,8)}]: Esquema completo no disponible. Descubriendo campos activos...`, fullQueryErr.message);
              try {
                const resFallback = await apiFetchBi({
                  "from": "schedule_context_check",
                  "select": BI_CORE_SELECT,
                  "where": BI_WHERE,
                  "order_by": [{"field": "date", "direction": "DESC"}],
                  "limit": 5000
                });
                biData = resFallback.data || resFallback || [];

                // Intento 3: Descubrir campo a campo cuáles están activos en esta empresa
                const workingAliases = [];
                const workingEnrichmentFields = [];
                const probeWhere = [{ "field": "schedule_context_check.date", "operator": ">=", "value": end }];
                for (const fieldDef of BI_ENRICHMENT_SELECT) {
                  try {
                    await apiFetchBi({
                      "from": "schedule_context_check",
                      "select": [BI_CORE_SELECT[6], fieldDef],
                      "where": probeWhere,
                      "limit": 1
                    });
                    workingAliases.push(fieldDef.alias);
                    workingEnrichmentFields.push(fieldDef);
                  } catch (fieldErr) {
                    console.warn(`BI Engine [${STATE.companyId.substring(0,8)}]: Campo no disponible → ${fieldDef.alias}`);
                  }
                }

                // Guardar el esquema descubierto (puede ser vacío = sólo core)
                localStorage.setItem(BI_SCHEMA_CACHE_KEY, JSON.stringify(workingAliases));
                this.biSchemaFields = { companyId: STATE.companyId, aliases: workingAliases };

                if (workingEnrichmentFields.length > 0) {
                  try {
                    const resEnrich = await apiFetchBi({
                      "from": "schedule_context_check",
                      "select": [...BI_CORE_SELECT, ...workingEnrichmentFields],
                      "where": BI_WHERE,
                      "order_by": [{"field": "date", "direction": "DESC"}],
                      "limit": 5000
                    });
                    biData = resEnrich.data || resEnrich || [];
                    enrichmentOk = true;
                    console.info(`BI Engine [${STATE.companyId.substring(0,8)}]: Enriquecimiento parcial OK — ${workingEnrichmentFields.length}/${BI_ENRICHMENT_SELECT.length} campos activos.`);
                  } catch (e2) { /* usamos biData del core fallback */ }
                }
              } catch (coreErr) {
                console.error(`BI Engine [${STATE.companyId.substring(0,8)}]: Core query también falló.`, coreErr.message);
              }
            } // end else (not WAF block)
          }
        }

        if (!enrichmentOk && biData.length > 0) {
          console.info(`BI Engine [${STATE.companyId.substring(0,8)}]: Fichajes OK · Sin geolocalización/IP (campos eliminados del esquema BI de esta empresa).`);
        }

	        // --- FALLBACK: Escaneo de metadatos de fichajes para encontrar jornada teórica ---
	        // A veces Sesame inyecta el dato en cada fichaje aunque no lo pidamos explícitamente
	        biData.forEach(row => {
	          const employeeId = row.employeeId ?? row.employee_id ?? row.employee?.id;
	          const dateKey = normalizeDateKey(row.date);
	          if (employeeId && dateKey && row.theoreticSeconds) {
	            biTheoreticMap.set(`${employeeId}_${dateKey}`, Number(row.theoreticSeconds));
	          }
	        });

        // 2. Obtener JORNADA TEÓRICA REAL (La que manda sobre todo, festivos incluidos)
        try {
          const resTheo = await apiFetchBi({
             "from": "schedule_context_daily_computed",
             "select": [
                {"field": "schedule_context_daily_computed.date", "alias": "date"},
                {"field": "schedule_context_daily_computed.employee_id", "alias": "employeeId"},
                {"field": "schedule_context_daily_computed.theoretic_seconds", "alias": "theoreticSeconds"}
             ],
             "where": [
                {"field": "schedule_context_daily_computed.date", "operator": ">=", "value": start},
                {"field": "schedule_context_daily_computed.date", "operator": "<=", "value": end}
             ],
	             "limit": 10000
	          });
	          const theoData = resTheo.data || resTheo || [];
	          theoData.forEach(row => {
	             const employeeId = row.employeeId ?? row.employee_id ?? row.employee?.id;
	             const dateKey = normalizeDateKey(row.date);
	             if (employeeId && dateKey) {
	               biTheoreticMap.set(`${employeeId}_${dateKey}`, Number(row.theoreticSeconds));
	             }
	          });
        } catch (e) {
          console.warn("Sub-query BI failed (Expected if not advanced):", e);
        }
        this.biTheoreticMap = biTheoreticMap;

      } catch (biErr) {
        console.warn("BI Engine data fetch error:", biErr);
      }

      // 2. Cargar ausencias/festivos
      // Envuelto en try/catch: si el token no tiene permisos de equipo (403 permisos)
      // detectamos "modo empleado" y usamos endpoints personales en su lugar.
      const localAbsences = {};
      let _coreApiIs403 = false;
      let _employeeMode = getCompanyMode(COMPANY_MODE_KEY) === 'employee';

      if (!_employeeMode) {
        try {
          const absRes = await fetchCalendarGrouped(start, end, []);
          absRes.forEach(dayObj => {
            if (dayObj.date) {
              localAbsences[dayObj.date] = dayObj.calendar_types || [];
              localAbsences[dayObj.date].forEach(ct => {
                (ct.employees || []).forEach(emp => upsertEmployee(emp));
              });
            }
          });
          // Si llegó aquí, tenemos acceso de equipo
          if (getCompanyMode(COMPANY_MODE_KEY) !== 'full') {
            setCompanyMode(COMPANY_MODE_KEY, 'full');
          }
        } catch (absErr) {
          const is403 = absErr.message.includes('403') || absErr.message.includes('401');
          if (is403 && STATE.currentUser) {
            // 403 con token válido = sin permisos de equipo = modo empleado
            _employeeMode = true;
            setCompanyMode(COMPANY_MODE_KEY, 'employee');
            console.error(`Empresa ${STATE.companyId.substring(0,8)}: Sin permisos de equipo. Activando modo empleado.`);
          } else if (is403) {
            _coreApiIs403 = true;
          } else {
            console.error('fetchCalendarGrouped falló (no crítico):', absErr.message);
          }
        }
      }

      // En modo empleado: cargar solo el calendario personal
      if (_employeeMode) {
        const myId = getCurrentEmployeeId();
        if (myId) {
          try {
            const personalCal = await apiFetch(`/api/v3/employees/${myId}/calendars?from=${start}&to=${end}`);
            const calItems = Array.isArray(personalCal?.data) ? personalCal.data : (Array.isArray(personalCal) ? personalCal : []);
            calItems.forEach(item => {
              const date = item.date || item.startDate?.split('T')[0];
              if (date) {
                if (!localAbsences[date]) localAbsences[date] = [];
                localAbsences[date].push(item);
              }
            });
          } catch (e) {
            console.warn('Personal calendar fetch failed:', e.message);
          }
        }
      }

      // 2.5 Excepciones de jornada + mapa de horarios de ausencias parciales
      const dayOverrides = new Map();
      this.balanceCalendarSummaryMap = new Map();
      const balanceCalendarSeen = new Set();
      const todayKeyForBalanceSummary = getLocalDateKey();
      const balanceSummaryEnd = this.currentView === 'balance' && start <= todayKeyForBalanceSummary && todayKeyForBalanceSummary <= end
        ? todayKeyForBalanceSummary
        : end;
      const getBalanceCalendarTypeInfo = (type = {}) => {
        const masterType = STATE.absenceTypes.find(t => String(t.id || '') === String(type.id || '')) || {};
        const label = masterType.name || displayAbsenceTypeName(type || masterType);
        const rawText = [
          type.alias,
          type.name,
          type.category,
          type.type,
          type.pickMode,
          masterType.alias,
          masterType.rawName,
          masterType.type,
          masterType.pickMode
        ].filter(Boolean).join(' ');
        const normalizeText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const normalizedRaw = normalizeText(rawText);
        const normalizedLabel = normalizeText(label);
        const looksLikeCompanyCalendar = (
          /\b(festivo|holiday|company_holiday|bank_holiday|calendario)\b/.test(normalizedRaw) ||
          /\bfibercom\b.*\b20\d{2}\b/.test(normalizedLabel) ||
          /\b20\d{2}\b/.test(label) && !/\b(gestion|permiso|medico|asuntos|vacacion|vacaciones|baja)\b/.test(normalizedLabel)
        );
        const isVacation = /\b(vacacion|vacaciones|vacation|vacations|paid_vacation)\b/.test(normalizedRaw) ||
          (/\b(vacacion|vacaciones)\b/.test(normalizedLabel) && !looksLikeCompanyCalendar);
        const isCompanyCalendar = !isVacation && looksLikeCompanyCalendar;
        const safeLabel = isVacation && looksLikeCompanyCalendar ? 'Vacaciones' : label;
        return { label: safeLabel, isVacation, isCompanyCalendar };
      };
      const addBalanceCalendarSummaryItem = (employeeId, date, label, options = {}) => {
        const empId = String(employeeId || '');
        const dateKey = normalizeDateKey(date);
        if (!empId || !dateKey || dateKey < start || dateKey > balanceSummaryEnd) return;
        const typeLabel = label || 'Ausencia';
        const seenKey = `${empId}_${dateKey}_${typeLabel}_${options.isVacation ? 'vacation' : 'absence'}`;
        if (balanceCalendarSeen.has(seenKey)) return;
        balanceCalendarSeen.add(seenKey);
        const current = this.balanceCalendarSummaryMap.get(empId) || {
          absenceEvents: 0,
          vacationEvents: 0,
          labels: new Set()
        };
        if (options.isVacation) {
          current.vacationEvents += 1;
          current.labels.add(typeLabel);
        } else if (!options.isCompanyCalendar) {
          current.absenceEvents += 1;
          current.labels.add(typeLabel);
        }
        this.balanceCalendarSummaryMap.set(empId, current);
      };
      Object.entries(localAbsences).forEach(([date, dayEntries]) => {
        (dayEntries || []).forEach(entry => {
          const rawType = entry.calendar_type || entry.calendarType || entry.type || {};
          const typeInfo = getBalanceCalendarTypeInfo(rawType);
          (entry.employees || []).forEach(emp => {
            addBalanceCalendarSummaryItem(emp.id, date, typeInfo.label, typeInfo);
          });
        });
      });
      const markEveOfNonWorkingDay = (employeeId, nonWorkingDate, label) => {
        const dateKey = normalizeDateKey(nonWorkingDate);
        const prevDate = addLocalDays(dateKey, -1);
        if (!employeeId || !dateKey || !prevDate || !isWeekdayDateKey(dateKey) || !isWeekdayDateKey(prevDate)) return;
        const key = `${employeeId}_${prevDate}`;
        const existing = dayOverrides.get(key) || { workdayOverride: null, compensatedSeconds: 0, compensatedItems: [] };
        existing.eveOfNonWorkingDaySeconds = 25200; // 7h
        existing.eveOfNonWorkingDayLabel = label || 'Víspera de festivo';
        dayOverrides.set(key, existing);
	      };
	      this.absenceTimesMap = new Map();
	      const eveScanEnd = addLocalDays(end, 1) || end;
	      Object.entries(HOLIDAYS_ZGZ).forEach(([holidayDate, holidayName]) => {
	        if (holidayDate < start || holidayDate > eveScanEnd || !isLocalHolidayDateKey(holidayDate)) return;
	        STATE.allEmployees.forEach((_, employeeId) => {
	          markEveOfNonWorkingDay(employeeId, holidayDate, holidayName);
	        });
	      });
	      if (!_coreApiIs403 && !_employeeMode) {
	        try {
	          const calendarsRaw = await fetchCalendarsRaw(start, eveScanEnd);
          calendarsRaw.forEach(cal => {
            const typeId = cal.calendarType?.id || cal.typeReference?.id || cal.absenceType?.id || cal.absenceCalendar?.absenceType?.id;
            const masterType = STATE.absenceTypes.find(t => String(t.id) === String(typeId)) || {};
            const remuneratedType = getAbsenceRemuneratedType(
              cal.calendarType,
              cal.typeReference,
              cal.absenceType,
              cal.absenceCalendar?.absenceType,
              masterType
            );
            const typeName = displayAbsenceTypeName(cal.calendarType || cal.typeReference || cal.absenceType || cal.absenceCalendar?.absenceType || masterType);
            const isRemunerated = isRemuneratedAbsenceType(remuneratedType) || isKnownCompensatedAbsenceLabel(typeName);
            const empId = cal.employee?.id || cal.entityReference?.id;
            const calendarTypeInfo = getBalanceCalendarTypeInfo(cal.calendarType || cal.typeReference || cal.absenceType || cal.absenceCalendar?.absenceType || masterType);
            if (empId && cal.daysOff) {
              cal.daysOff.forEach(doff => {
                if (!doff.date) return;
                addBalanceCalendarSummaryItem(empId, doff.date, calendarTypeInfo.label || typeName || 'Ausencia', calendarTypeInfo);
                const key = `${empId}_${doff.date}`;
                const dayOffSeconds = getDayOffSeconds(doff);
                if (doff.startTime || doff.endTime || doff.dayOffTimeType === 'partial_day') {
                  this.absenceTimesMap.set(key, {
                    startTime: doff.startTime || null,
                    endTime:   doff.endTime   || null,
                    seconds:   dayOffSeconds,
                    remuneratedType: remuneratedType || '',
                    isRemunerated,
                    label: typeName || ''
                  });
                }
                const existing = dayOverrides.get(key) || { workdayOverride: null, compensatedSeconds: 0, compensatedItems: [] };
                if (doff.dayOffTimeType === 'full_day' && dayOffSeconds > 0) {
                  existing.workdayOverride = dayOffSeconds;
                  markEveOfNonWorkingDay(empId, doff.date, typeName || 'Día no laborable');
                }
                if (isRemunerated && dayOffSeconds > 0) {
                  existing.compensatedSeconds += dayOffSeconds;
                  existing.compensatedItems.push({
                    label: typeName || 'Ausencia retribuida',
                    seconds: dayOffSeconds,
                    startTime: doff.startTime || null,
                    endTime: doff.endTime || null,
                    date: doff.date,
                    remuneratedType: remuneratedType || 'remunerated'
                  });
                }
                dayOverrides.set(key, existing);
              });
            }
          });
        } catch (calErr) {
          console.warn('fetchCalendarsRaw falló (no crítico):', calErr.message);
        }
      }
      this.dayOverrides = dayOverrides;

      // Si el token está realmente caducado (no es modo empleado), mostrar aviso
      if (_coreApiIs403 && !STATE.currentUser) {
        if (isSilent) {
          restoreSilentState();
          return;
        }

        const company = STATE.companies.find(c => c.companyId === STATE.companyId);
        const companyName = company?.name || STATE.companyId?.substring(0, 8) || 'Esta empresa';
        const safeCompanyName = escapeHTML(companyName);
        document.getElementById('signings-tbody').innerHTML = `
          <tr><td colspan="4" style="text-align:center; padding: 50px 30px;">
            <div style="font-size:2rem; margin-bottom:12px;">🔑</div>
            <div style="font-size:1.1rem; font-weight:600; color:var(--warn); margin-bottom:8px;">Token de ${safeCompanyName} caducado</div>
            <div style="font-size:0.85rem; color:var(--text-muted); max-width:480px; margin:0 auto 20px;">
              Sesame ha rechazado el acceso (403 Forbidden).<br>El token necesita renovarse.
            </div>
            <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
              <button class="btn-primary" onclick="window.open('https://app.sesametime.com','_blank')" style="font-size:0.8rem;">🌐 Abrir Sesame</button>
              <button class="btn-secondary" onclick="FichajesModule.loadData()" style="font-size:0.8rem;">🔄 Reintentar</button>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:12px; opacity:0.6;">Terminal: <code>python3 get-token.py</code></div>
          </td></tr>`;
        return;
      }

      // 3. Presencia Real-time (solo en modo equipo)
      let presenceRes = [];
      if (!_employeeMode) {
        try {
          presenceRes = await fetchPresence();
        } catch (presErr) {
          console.warn('fetchPresence falló (no crítico):', presErr.message);
        }
      }
      this.realtimePresence = presenceRes;

      // Mostrar banner de modo empleado si aplica
      const modeBar = document.getElementById('employee-mode-bar');
      if (modeBar) modeBar.style.display = _employeeMode ? 'flex' : 'none';


      // Sincronizar perfiles desde presencia (a veces trae fotos que otros no)
      presenceRes.forEach(p => {
        if (p.employee) upsertEmployee(p.employee);
      });

      this.data = this.parseRealSignings(biData, localAbsences);

      // SUPER FALLBACK: Si no hay datos en BI, pedimos los fichajes emp a emp
      if (this.data.length === 0 && !(this.currentView === 'balance' && this.officialHoursBagMap.size > 0)) {
        AUDIT.isSearching = true;
        try {

          // ── MODO EMPLEADO: ir directo al endpoint personal (sin probar endpoints de equipo) ──
          if (_employeeMode) {
            const myId = getCurrentEmployeeId();
            if (myId) {
              try {
                const myChecks = await apiFetch(
                  `/api/v3/employees/${myId}/checks?from=${start}&to=${end}&includeOut=true`,
                  { method: 'GET' }
                );
                const records = myChecks?.data || (Array.isArray(myChecks) ? myChecks : []);
                if (records.length > 0) {
                  const rawData = records.map(c => ({ ...c, employeeId: myId }));
                  this.data = this.parseRealSignings(rawData, localAbsences);
                  console.info(`Modo empleado: ${records.length} fichajes cargados desde endpoint personal.`);
                }
              } catch (e) {
                console.warn('Employee mode personal checks failed:', e.message);
              }
            }
          } else {

          // 1. Intentar Búsqueda Global (Manager View) — solo en modo equipo
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
              }
            }
          }

          if (globalData) {
             // ESTRATEGIA HÍBRIDA: Si hemos recuperado datos globales (que suelen ser resúmenes sin pausas),
             // intentamos pedir los detalles específicos de "nuestro" usuario para no perder sus tipos/colores.
             const myId = getCurrentEmployeeId();
             if (myId) {
                try {
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

          // Asegurarnos de tener la lista completa de IDs de la empresa
          if (STATE.allEmployees.size <= 1) {
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

            // Barra de progreso visible
            if (!isSilent) this.updateSigningsTopProgress(6);

            for (let i = 0; i < targetIds.length; i += 8) {
               // Actualizar barra de progreso
               if (!isSilent) {
                  const pct = Math.round((i / targetIds.length) * 100);
                  this.updateSigningsTopProgress(pct);
               }

               const chunk = targetIds.slice(i, i + 8).filter(id => !this.failedIds.has(id));
               if (chunk.length === 0) continue;

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

            // Ocultar barra de progreso
            if (!isSilent) {
              this.updateSigningsTopProgress(100);
            }

            if (rawData.length > 0) {
               this.data = this.parseRealSignings(rawData, localAbsences);
            }
          }
          } // end else (modo equipo)
        } catch (err) {
          console.error("Master Fallback (Checks) failed:", err);
        } finally {
          AUDIT.isSearching = false;
        }
      }

      // FINAL MERGE: Si seguimos sin datos pero hay gente PRESENTE (fetchPresence),
      // generamos registros "fantasma" para que al menos se vean en la lista.
      if (this.data.length === 0 && this.realtimePresence.length > 0) {
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

      if (this.currentView === 'balance') {
        this.prepareOfficialWorkedHoursLoad(start, end);
      } else {
        this.resetOfficialWorkedHoursState({ cancel: true });
      }

      if (this.data.length === 0 && this.currentView !== 'balance') {
        const msg = AUDIT.isSearching ? "Buscando puerta de enlace alternativa..." : (isLocalProxy() ? "Sesame no ha devuelto registros para este periodo." : "Sin datos.");

        // Reporte de Auditoría para el usuario
        const auditInfo = [
          `Estadísticas(BI): ${AUDIT.lastBiStatus || '?' }`,
          `Registros(Raw): ${AUDIT.lastRawStatus || '?' }`,
          `Presencia: ${AUDIT.lastPresenceStatus || '?' }`,
          `Perfil Me: ${AUDIT.lastMeStatus || '?' }`
        ].join(' | ');
        const safeMsg = escapeHTML(msg);
        const safeAuditInfo = escapeHTML(auditInfo);
        const safePresencePath = escapeHTML(DISCOVERY.workingPresence || 'Buscando...');

        document.getElementById('signings-tbody').innerHTML = `
          <tr>
            <td colspan="4" style="text-align:center; padding: 60px 40px; color: var(--text-muted);">
              <div style="font-size: 1.1rem; font-weight: 500; margin-bottom: 12px;">${safeMsg}</div>
              <div style="font-size: 11px; opacity: 0.5; font-family: monospace;">Diagnóstico: ${safeAuditInfo}</div>
              <div style="font-size: 10px; opacity: 0.4; margin-top: 4px;">Ruta pres. activa: ${safePresencePath}</div>
              <div style="margin-top: 20px;">
                <button class="btn-secondary" onclick="FichajesModule.loadData()" style="font-size: 0.75rem;">Reintentar auditoría profunda</button>
              </div>
            </td>
          </tr>`;
        this.renderPresenceSummaryOnly();
      } else {
        this.populateEmployeeSelect(); // Re-poblar para incluir los empleados recién cosechados
        this.renderTable();
        if (this.currentView === 'balance') {
          this.startOfficialWorkedHoursLoad(start, end);
        }
      }


      // REFRESCAR BARRA LATERAL: Para que los puntos de estado se vean al instante tras la carga
      renderEmployeeFilterList();

      // GUARDAR EN CACHÉ
      // Balance trabaja con el ejercicio completo y puede superar la cuota de sessionStorage.
      // La caché es una optimización: si no cabe, la carga no debe mostrarse como error de Sesame.
      if (this.currentView !== 'balance') {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            data: this.data,
            realSignings: this.realSignings,
            biTheoreticMap: Object.fromEntries(this.biTheoreticMap || new Map())
          }));
        } catch (cacheError) {
          console.info('Fichajes: caché omitida por límite del navegador.', cacheError?.name || cacheError?.message || cacheError);
        }
      }

      // WIDGETS AVANZADOS: Mostrar patrones de trabajo y radar
      if (document.getElementById('patterns-widget')) {
        this.updateAnalyticsWidgets();
      }

    } catch (err) {
      console.error("Error al cargar fichajes:", err);
      if (isSilent) {
        restoreSilentState();
        return;
      }

      const is403 = err.message.includes('403') || err.message.includes('Forbidden');
      const is401 = err.message.includes('401') || err.message.includes('caducada');
      const company = STATE.companies.find(c => c.companyId === STATE.companyId);
      const companyName = company?.name || 'Esta empresa';
      const safeCompanyName = escapeHTML(companyName);
      const safeErrorMessage = escapeHTML(err.message || 'Error desconocido');

      if (is403 || is401) {
        document.getElementById('signings-tbody').innerHTML = `
          <tr><td colspan="4" style="text-align:center; padding: 50px 30px;">
            <div style="font-size:2rem; margin-bottom:12px;">🔑</div>
            <div style="font-size:1.1rem; font-weight:600; color:var(--warn); margin-bottom:8px;">
              Token de ${safeCompanyName} caducado
            </div>
            <div style="font-size:0.85rem; color:var(--text-muted); max-width:480px; margin:0 auto 20px;">
              Sesame rechaza el acceso con el token guardado (${is401 ? '401 Unauthorized' : '403 Forbidden'}).<br>
              Los tokens de sesión caducan periódicamente y necesitan renovarse.
            </div>
            <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
              <button class="btn-primary" onclick="window.open('https://app.sesametime.com','_blank')" style="font-size:0.8rem;">
                🌐 Abrir Sesame (renovar token)
              </button>
              <button class="btn-secondary" onclick="showSetup()" style="font-size:0.8rem;">
                ✏️ Editar credenciales
              </button>
              <button class="btn-secondary" onclick="FichajesModule.loadData()" style="font-size:0.8rem;">
                🔄 Reintentar
              </button>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:16px; opacity:0.6;">
              En terminal: <code>python3 get-token.py</code> → renovación automática del token
            </div>
          </td></tr>`;
      } else {
        document.getElementById('signings-tbody').innerHTML = `
          <tr><td colspan="4" style="text-align:center; padding: 40px; color: #ff5555;">
            Error al conectar con Sesame: ${safeErrorMessage}
            <br><button class="btn-secondary" onclick="FichajesModule.loadData()" style="margin-top:12px; font-size:0.75rem;">🔄 Reintentar</button>
          </td></tr>`;
      }
    } finally {
      if (!isSilent && this.currentView !== 'balance') {
        this.finishSigningsTopProgress();
      }
      this.isLoading = false;
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

  updateAnalyticsWidgets() {
    // Restauramos la visibilidad de los bloques
    const pw = document.getElementById('patterns-widget');
    const rw = document.getElementById('radar-widget');
    if (pw) pw.style.display = 'block';
    if (rw) rw.style.display = 'block';

    // La lógica de cálculo ahora vive en renderOperationalInsights para ser reactiva
  },

  syncInsightsVisibility() {
    const insights = document.getElementById('fichajes-insights');
    if (!insights) return;
    insights.classList.toggle('hidden', this.currentView === 'balance');
  },

  setupAutoRefresh() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);

    const isToday = this.currentDate.toDateString() === new Date().toDateString();
    if (this.currentView === 'day' && isToday) {
      this.refreshInterval = setInterval(() => {
        if (STATE.currentModule === 'fichajes') {
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

  getBalanceEmployeeInfo(employeeId) {
    const id = String(employeeId || '');
    const emp = STATE.allEmployees.get(id) || {};
    const fallbackRow = (this.data || []).find(row => String(row.employeeId) === id) || {};
    const name = fallbackRow.employeeName ||
      `${emp.firstName || ''} ${emp.lastName || ''}`.trim() ||
      emp.name ||
      `Empleado ${id}`;
    return {
      id,
      name,
      photo: fallbackRow.photoUrl || emp.imageProfileURL || '',
      annualBalance: typeof emp.accumulatedSeconds === 'number' ? emp.accumulatedSeconds : null
    };
  },

  getBalanceEmployeeIds(options = {}) {
    const applySearch = !!options.applySearch;
    const ids = new Set();

    if (this.selectedEmployee && this.selectedEmployee !== 'all') {
      ids.add(String(this.selectedEmployee));
    } else {
      STATE.allEmployees.forEach((_, id) => ids.add(String(id)));
      (this.data || []).forEach(row => {
        if (row.employeeId) ids.add(String(row.employeeId));
      });
      const myId = getCurrentEmployeeId();
      if (myId) ids.add(String(myId));
    }

    const search = String(this.searchQuery || '').trim().toLowerCase();
    return Array.from(ids).filter(id => {
      if (!applySearch || !search) return true;
      const info = this.getBalanceEmployeeInfo(id);
      return info.name.toLowerCase().includes(search);
    });
  },

  getOfficialWorkedHoursSkipKey() {
    return `ssm_skip_worked_hours_report_${STATE.companyId || 'default'}`;
  },

  isOfficialWorkedHoursSkipped() {
    return localStorage.getItem(this.getOfficialWorkedHoursSkipKey()) === '1';
  },

  useLocalBalanceOnly() {
    localStorage.setItem(this.getOfficialWorkedHoursSkipKey(), '1');
    this.resetOfficialWorkedHoursState({ cancel: true });
    this.renderTable();
  },

  retryOfficialWorkedHours() {
    localStorage.removeItem(this.getOfficialWorkedHoursSkipKey());
    this.loadData(true);
  },

  resetOfficialWorkedHoursState(options = {}) {
    if (options.cancel) this.officialHoursBagRunId += 1;
    this.stopBalanceLocalPulse();
    this.officialHoursBagMap = new Map();
    this.officialHoursBagErrors = new Map();
    this.officialHoursBagError = '';
    this.hoursBagRuleHistoryMap = new Map();
    this.hoursBagRuleHistoryErrors = new Map();
    this.hoursBagRuleHistoryError = '';
    this.officialHoursBagLoading = false;
    this.officialHoursBagProgress = {
      endpoint: '',
      range: '',
      total: 0,
      done: 0,
      pending: 0,
      lastError: ''
    };
  },

  prepareOfficialWorkedHoursLoad(start, end) {
    const employeeIds = this.getBalanceEmployeeIds();
    const estimatedTotal = Math.max(employeeIds.length, STATE.allEmployees.size, 1);
    if (this.isOfficialWorkedHoursSkipped()) {
      this.officialHoursBagRunId += 1;
      this.stopBalanceLocalPulse();
      this.officialHoursBagMap = new Map();
      this.officialHoursBagErrors = new Map();
      this.officialHoursBagError = 'Sesame Statistics omitido por el usuario';
      this.hoursBagRuleHistoryMap = new Map();
      this.hoursBagRuleHistoryErrors = new Map();
      this.hoursBagRuleHistoryError = '';
      this.officialHoursBagLoading = false;
      this.officialHoursBagProgress = {
        endpoint: 'calculo-local',
        range: `${start} -> ${end}`,
        total: estimatedTotal,
        done: estimatedTotal,
        pending: 0,
        employeeIds,
        phase: 'done',
        activeEmployeeIds: [],
        lastError: 'Sesame Statistics omitido por el usuario'
      };
      return;
    }

    this.officialHoursBagRunId += 1;
    this.officialHoursBagMap = new Map();
    this.officialHoursBagErrors = new Map();
    this.officialHoursBagError = '';
    this.hoursBagRuleHistoryMap = new Map();
    this.hoursBagRuleHistoryErrors = new Map();
    this.hoursBagRuleHistoryError = '';
    this.officialHoursBagLoading = true;
    this.officialHoursBagProgress = {
      endpoint: '/schedule/v1/reports/worked-hours',
      range: `${start} -> ${end}`,
      total: estimatedTotal,
      done: 0,
      pending: estimatedTotal,
      employeeIds,
      phase: 'local',
      activeEmployeeIds: employeeIds.slice(0, 6),
      localPulse: 10,
      lastError: ''
    };
    this.startBalanceLocalPulse();
  },

  normalizeOfficialWorkedHoursRow(row) {
    if (!row || typeof row !== 'object') return null;
    const toNullableSeconds = value => {
      if (value === null || typeof value === 'undefined' || value === '') return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const employeeId = String(row.employeeId ?? row.employee?.id ?? '');
    if (!employeeId) return null;
    return {
      employeeId,
      secondsWorked: toNullableSeconds(row.secondsWorked),
      secondsToWork: toNullableSeconds(row.secondsToWork),
      secondsBalance: toNullableSeconds(row.secondsBalance),
      source: 'sesame-statistics',
      rawSource: '/schedule/v1/reports/worked-hours',
      queryVariant: row.queryVariant || ''
    };
  },

  summarizeBalanceApiError(error) {
    const raw = String(error?.message || error || 'Error desconocido');
    return raw
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [oculto]')
      .replace(/Authorization["']?\s*:\s*["'][^"']+["']/gi, 'Authorization: [oculto]')
      .replace(/Cookie["']?\s*:\s*["'][^"']+["']/gi, 'Cookie: [oculto]')
      .slice(0, 260);
  },

  async loadOfficialWorkedHoursReport(startDate, endDate, employeeIds, options = {}) {
    const endpoint = '/schedule/v1/reports/worked-hours';
    const ids = Array.from(new Set((employeeIds || []).map(id => String(id)).filter(Boolean)));
    const resultMap = new Map();
    const errorMap = new Map();
    const chunkSize = 40;
    let processed = 0;
    let lastError = '';
    const buildQueryVariants = chunk => [
      {
        label: 'employeeIds[in]=csv',
        params: { 'employeeIds[in]': chunk.join(',') }
      },
      {
        label: 'employeeIds[in]=repeat',
        params: { 'employeeIds[in]': chunk }
      },
      {
        label: 'sin employeeIds[in]',
        params: {}
      }
    ];

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const chunkSet = new Set(chunk.map(String));
      const variantErrors = [];
      let chunkHadResponse = false;
      let chunkHadRows = false;

      for (const variant of buildQueryVariants(chunk)) {
        let page = 1;
        let lastPage = 1;
        let variantRows = 0;
        try {
        do {
          if (options.runId && options.runId !== this.officialHoursBagRunId) {
            return { map: resultMap, errors: errorMap, aborted: true, lastError };
          }

          const payload = await apiFetch(endpoint, {
            from: startDate,
            to: endDate,
            withChecks: true,
            limit: 100,
            page,
            method: 'GET',
            overrideBackend: 'https://api-eu1.sesametime.com',
            ...variant.params,
            headers: {
              'Origin': 'https://app.sesametime.com',
              'Referer': 'https://app.sesametime.com/'
            }
          });

          const rows = Array.isArray(payload?.data)
            ? payload.data
            : (Array.isArray(payload) ? payload : []);
          const normalizedRows = [];
          rows.forEach(row => {
            const normalized = this.normalizeOfficialWorkedHoursRow({ ...row, queryVariant: variant.label });
            if (normalized?.employeeId) {
              if (!chunkSet.has(String(normalized.employeeId))) return;
              resultMap.set(normalized.employeeId, normalized);
              normalizedRows.push(normalized);
            }
          });
          variantRows += normalizedRows.length;
          chunkHadResponse = true;
          if (normalizedRows.length && typeof options.onRows === 'function') {
            options.onRows(normalizedRows);
          }

          const meta = payload?.meta || {};
          const currentPage = Number(meta.currentPage ?? page);
          lastPage = Number(meta.lastPage ?? currentPage);
          page = currentPage + 1;
        } while (page <= lastPage);

          if (variantRows > 0) {
            chunkHadRows = true;
            break;
          }
        } catch (error) {
          const summary = this.summarizeBalanceApiError(error);
          variantErrors.push(`${variant.label}: ${summary}`);
          lastError = summary;
          if (/403|401|Forbidden|Unauthorized/i.test(summary)) break;
        }
      }

      if (!chunkHadRows) {
        const message = variantErrors.length
          ? variantErrors.slice(0, 3).join(' | ')
          : (chunkHadResponse ? 'Sesame Statistics respondio sin filas para este rango' : 'Sin respuesta Sesame Statistics');
        chunk.forEach(id => errorMap.set(String(id), message));
        lastError = message;
      }

      processed += chunk.length;
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          done: Math.min(processed, ids.length),
          total: ids.length,
          pending: Math.max(0, ids.length - processed),
          lastError
        });
      }
    }

    ids.forEach(id => {
      if (!resultMap.has(id) && !errorMap.has(id)) {
        errorMap.set(id, 'Sin dato Sesame Statistics para este rango');
      }
    });

    return { map: resultMap, errors: errorMap, aborted: false, lastError };
  },

  normalizeHoursBagRuleHistoryItem(item) {
    if (!item || typeof item !== 'object') return null;

    const employeeId = String(item.employee?.id ?? item.employeeId ?? item.employee_id ?? '');
    if (!employeeId) return null;

    const seconds = Number(item.seconds);
    const checkSeconds = Number(item.checkSeconds);
    const checkSecondsWithVariation = Number(item.checkSecondsWithVariation);
    let adjustmentSeconds = Number.isFinite(seconds) ? seconds : NaN;
    if (!Number.isFinite(adjustmentSeconds) && Number.isFinite(checkSecondsWithVariation) && Number.isFinite(checkSeconds)) {
      adjustmentSeconds = checkSecondsWithVariation - checkSeconds;
    }
    if (!Number.isFinite(adjustmentSeconds)) return null;

    return {
      employeeId,
      date: item.date || '',
      adjustmentSeconds,
      checkSeconds: Number.isFinite(checkSeconds) ? checkSeconds : null,
      checkSecondsWithVariation: Number.isFinite(checkSecondsWithVariation) ? checkSecondsWithVariation : null,
      ruleName: item.hoursBagRule?.name || item.hoursBagRule?.variationName || '',
      rawSource: '/schedule/v1/hours-bag-rule-history'
    };
  },

  addHoursBagRuleHistoryItem(map, item) {
    const normalized = this.normalizeHoursBagRuleHistoryItem(item);
    if (!normalized) return null;

    const current = map.get(normalized.employeeId) || {
      employeeId: normalized.employeeId,
      adjustmentSeconds: 0,
      checkSeconds: 0,
      checkSecondsWithVariation: 0,
      itemsCount: 0,
      ruleNames: new Set(),
      dates: new Set(),
      rawSource: '/schedule/v1/hours-bag-rule-history'
    };

    current.adjustmentSeconds += normalized.adjustmentSeconds;
    if (typeof normalized.checkSeconds === 'number') current.checkSeconds += normalized.checkSeconds;
    if (typeof normalized.checkSecondsWithVariation === 'number') current.checkSecondsWithVariation += normalized.checkSecondsWithVariation;
    current.itemsCount += 1;
    if (normalized.ruleName) current.ruleNames.add(normalized.ruleName);
    if (normalized.date) current.dates.add(normalized.date);
    map.set(normalized.employeeId, current);
    return current;
  },

  async loadHoursBagRuleHistoryAdjustments(startDate, endDate, employeeIds, options = {}) {
    const endpoint = '/schedule/v1/hours-bag-rule-history';
    const ids = Array.from(new Set((employeeIds || []).map(id => String(id)).filter(Boolean)));
    const resultMap = new Map();
    const errorMap = new Map();
    const chunkSize = 40;
    let lastError = '';
    let processed = 0;
    const buildQueryVariants = chunk => [
      {
        label: 'employeeIds=csv',
        params: { employeeIds: chunk.join(',') }
      },
      {
        label: 'employeeIds=repeat',
        params: { employeeIds: chunk }
      },
      {
        label: 'sin employeeIds',
        params: {}
      }
    ];

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const chunkSet = new Set(chunk.map(String));
      const variantErrors = [];
      let chunkHadResponse = false;
      let chunkHadAdjustment = false;

      for (const variant of buildQueryVariants(chunk)) {
        let page = 1;
        let lastPage = 1;
        let variantAdjustments = 0;

        try {
          do {
            if (options.runId && options.runId !== this.officialHoursBagRunId) {
              return { map: resultMap, errors: errorMap, aborted: true, lastError };
            }

            const payload = await apiFetch(endpoint, {
              from: startDate,
              to: endDate,
              limit: 100,
              page,
              method: 'GET',
              overrideBackend: 'https://api-eu1.sesametime.com',
              ...variant.params,
              headers: {
                'Origin': 'https://app.sesametime.com',
                'Referer': 'https://app.sesametime.com/'
              }
            });

            const rows = Array.isArray(payload?.data)
              ? payload.data
              : (Array.isArray(payload) ? payload : []);
            rows.forEach(row => {
              const employeeId = String(row.employee?.id ?? row.employeeId ?? row.employee_id ?? '');
              if (!chunkSet.has(employeeId)) return;
              const current = this.addHoursBagRuleHistoryItem(resultMap, row);
              if (current) variantAdjustments += 1;
            });

            chunkHadResponse = true;
            const meta = payload?.meta || {};
            const currentPage = Number(meta.currentPage ?? page);
            lastPage = Number(meta.lastPage ?? currentPage);
            page = currentPage + 1;
          } while (page <= lastPage);

          if (variantAdjustments > 0) {
            chunkHadAdjustment = true;
            break;
          }
        } catch (error) {
          const summary = this.summarizeBalanceApiError(error);
          variantErrors.push(`${variant.label}: ${summary}`);
          lastError = summary;
          if (/403|401|Forbidden|Unauthorized/i.test(summary)) break;
        }
      }

      if (!chunkHadAdjustment && variantErrors.length) {
        chunk.forEach(id => errorMap.set(String(id), variantErrors.slice(0, 2).join(' | ')));
      } else if (!chunkHadAdjustment && !chunkHadResponse) {
        chunk.forEach(id => errorMap.set(String(id), 'Sin respuesta hours-bag-rule-history'));
      }

      processed += chunk.length;
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          done: Math.min(processed, ids.length),
          total: ids.length,
          pending: Math.max(0, ids.length - processed),
          lastError
        });
      }
    }

    resultMap.forEach(value => {
      value.ruleNames = Array.from(value.ruleNames || []);
      value.dates = Array.from(value.dates || []);
    });

    return { map: resultMap, errors: errorMap, aborted: false, lastError };
  },

  async startOfficialWorkedHoursLoad(start, end) {
    if (this.currentView !== 'balance' || !this.officialHoursBagLoading) return;

    const runId = this.officialHoursBagRunId;
    const employeeIds = this.officialHoursBagProgress.employeeIds || this.getBalanceEmployeeIds();
    if (employeeIds.length === 0) {
      this.stopBalanceLocalPulse();
      this.officialHoursBagLoading = false;
      this.renderTable();
      return;
    }

    const updateBalanceProgress = (phase, extra = {}) => {
      if (runId !== this.officialHoursBagRunId || this.currentView !== 'balance') return;
      if (phase !== 'local') this.stopBalanceLocalPulse();
      this.officialHoursBagProgress = {
        ...(this.officialHoursBagProgress || {}),
        phase,
        endpoint: phase === 'history'
          ? '/schedule/v1/hours-bag-rule-history'
          : '/schedule/v1/reports/worked-hours',
        range: `${start} -> ${end}`,
        employeeIds,
        ...extra
      };
      this.renderTable();
    };

    try {
      updateBalanceProgress('statistics', {
        done: 0,
        total: employeeIds.length,
        pending: employeeIds.length,
        activeEmployeeIds: employeeIds.slice(0, 5)
      });

      const result = await this.loadOfficialWorkedHoursReport(start, end, employeeIds, {
        runId,
        onProgress: progress => {
          const activeStart = Math.min(Number(progress.done || 0), employeeIds.length);
          updateBalanceProgress('statistics', {
            ...progress,
            activeEmployeeIds: employeeIds.slice(activeStart, activeStart + 5)
          });
        },
        onRows: rows => {
          if (runId !== this.officialHoursBagRunId || this.currentView !== 'balance') return;
          rows.forEach(row => {
            if (row?.employeeId) {
              this.officialHoursBagMap.set(String(row.employeeId), row);
              this.officialHoursBagErrors.delete(String(row.employeeId));
            }
          });
          this.renderTable();
        }
      });

      if (result.aborted || runId !== this.officialHoursBagRunId || this.currentView !== 'balance') return;

      this.officialHoursBagMap = result.map;
      this.officialHoursBagErrors = result.errors;
      this.officialHoursBagError = result.lastError || '';
      updateBalanceProgress('history', {
        done: 0,
        total: employeeIds.length,
        pending: employeeIds.length,
        activeEmployeeIds: employeeIds.slice(0, 5),
        lastError: result.lastError || ''
      });
      const historyResult = await this.loadHoursBagRuleHistoryAdjustments(start, end, employeeIds, {
        runId,
        onProgress: progress => {
          const activeStart = Math.min(Number(progress.done || 0), employeeIds.length);
          updateBalanceProgress('history', {
            ...progress,
            activeEmployeeIds: employeeIds.slice(activeStart, activeStart + 5),
            lastError: progress.lastError || result.lastError || ''
          });
        }
      });
      if (historyResult.aborted || runId !== this.officialHoursBagRunId || this.currentView !== 'balance') return;
      this.hoursBagRuleHistoryMap = historyResult.map;
      this.hoursBagRuleHistoryErrors = historyResult.errors;
      this.hoursBagRuleHistoryError = historyResult.lastError || '';
      this.officialHoursBagLoading = false;
      this.officialHoursBagProgress = {
        ...(this.officialHoursBagProgress || {}),
        endpoint: '/schedule/v1/reports/worked-hours + /schedule/v1/hours-bag-rule-history',
        range: `${start} -> ${end}`,
        total: employeeIds.length,
        done: employeeIds.length,
        pending: 0,
        employeeIds,
        phase: 'done',
        activeEmployeeIds: [],
        lastError: result.lastError || ''
      };
      this.renderTable();
    } catch (error) {
      if (runId !== this.officialHoursBagRunId || this.currentView !== 'balance') return;
      const message = this.summarizeBalanceApiError(error);
      this.officialHoursBagError = message;
      try {
        updateBalanceProgress('history', {
          done: 0,
          total: employeeIds.length,
          pending: employeeIds.length,
          activeEmployeeIds: employeeIds.slice(0, 5),
          lastError: message
        });
        const historyResult = await this.loadHoursBagRuleHistoryAdjustments(start, end, employeeIds, {
          runId,
          onProgress: progress => {
            const activeStart = Math.min(Number(progress.done || 0), employeeIds.length);
            updateBalanceProgress('history', {
              ...progress,
              activeEmployeeIds: employeeIds.slice(activeStart, activeStart + 5),
              lastError: progress.lastError || message
            });
          }
        });
        if (historyResult.aborted || runId !== this.officialHoursBagRunId || this.currentView !== 'balance') return;
        this.hoursBagRuleHistoryMap = historyResult.map;
        this.hoursBagRuleHistoryErrors = historyResult.errors;
        this.hoursBagRuleHistoryError = historyResult.lastError || '';
      } catch (historyError) {
        this.hoursBagRuleHistoryError = this.summarizeBalanceApiError(historyError);
      }
      this.officialHoursBagLoading = false;
      this.officialHoursBagErrors = new Map(employeeIds.map(id => [String(id), message]));
      this.officialHoursBagProgress = {
        ...(this.officialHoursBagProgress || {}),
        done: employeeIds.length,
        pending: 0,
        phase: 'done',
        activeEmployeeIds: [],
        lastError: message
      };
      this.renderTable();
    }
  },

  normalizeOfficialHoursBag(employeeId, payload) {
    if (payload?.message && /no route|not found|unauthenticated/i.test(String(payload.message))) return null;
    if (payload?.error?.message && /no route|route_not_found|not found/i.test(String(payload.error.message))) return null;

    const data = payload?.data?.item ??
                 payload?.data?.result ??
                 payload?.data?.hoursBag ??
                 payload?.data ??
                 payload?.item ??
                 payload?.result ??
                 payload?.hoursBag ??
                 payload;
    const body = Array.isArray(data) ? data[0] : data;
    if (!body || typeof body !== 'object') return null;

    const balanceSeconds = Number(
      body.balanceSecondsInSelectedPeriod ??
      body.balanceSeconds ??
      body.secondsBalance ??
      body.currentBalance ??
      body.totalHoursPending ??
      body.accumulatedBalance ??
      body.availableBalance ??
      body.balance ??
      NaN
    );
    if (!Number.isFinite(balanceSeconds)) return null;

    const workedSeconds = Number(body.secondsWorked ?? body.workedSeconds ?? NaN);
    const theoreticSeconds = Number(
      body.secondsToWork ??
      body.theoreticSeconds ??
      body.theoricSeconds ??
      NaN
    );
    const compensationSeconds = Number(body.compensationSeconds ?? 0);
    const employee = body.employee || body.employeeReference || {};
    const resolvedEmployeeId = String(employeeId || employee.id || body.employeeId || body.id || '');

    return {
      employeeId: resolvedEmployeeId,
      employeeName: employee.name || body.employeeName || '',
      periodBalance: balanceSeconds,
      workedSeconds: Number.isFinite(workedSeconds) ? workedSeconds : null,
      theoreticSeconds: Number.isFinite(theoreticSeconds) ? theoreticSeconds : null,
      compensationSeconds: Number.isFinite(compensationSeconds) ? compensationSeconds : 0,
      source: 'Sesame oficial'
    };
  },

  extractOfficialHoursBagItems(payload) {
    const data = payload?.data?.items ??
                 payload?.data?.data ??
                 payload?.data?.results ??
                 payload?.data ??
                 payload?.items ??
                 payload?.results ??
                 payload;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return [data];
    return [];
  },

  async fetchOfficialHoursBagList(start, end) {
    const candidates = [
      {
        key: 'private-employees-hours-bags-list-back',
        path: '/private/schedule/v1/hours-bag-overtime/employees-hours-bags',
        backend: 'https://back-eu1.sesametime.com'
      },
      {
        key: 'private-employees-hours-bags-list-api',
        path: '/private/schedule/v1/hours-bag-overtime/employees-hours-bags',
        backend: 'https://api-eu1.sesametime.com'
      },
      {
        key: 'employees-hours-bags-list-back',
        path: '/schedule/v1/hours-bag-overtime/employees-hours-bags',
        backend: 'https://back-eu1.sesametime.com'
      },
      {
        key: 'employees-hours-bags-list-api',
        path: '/schedule/v1/hours-bag-overtime/employees-hours-bags',
        backend: 'https://api-eu1.sesametime.com'
      }
    ];

    const errors = [];
    for (const candidate of candidates) {
      try {
        const payload = await apiFetch(candidate.path, {
          from: start,
          to: end,
          page: 1,
          limit: 500,
          method: 'GET',
          overrideBackend: candidate.backend,
          headers: {
            'Origin': 'https://app.sesametime.com',
            'Referer': 'https://app.sesametime.com/employee/portal'
          }
        });
        const items = this.extractOfficialHoursBagItems(payload);
        const map = new Map();
        items.forEach(item => {
          const employeeId = item.employee?.id || item.employeeId || item.id;
          const normalized = this.normalizeOfficialHoursBag(employeeId, item);
          if (normalized?.employeeId) map.set(String(normalized.employeeId), normalized);
        });
        if (map.size > 0) {
          DISCOVERY.workingHoursBag = candidate.key;
          localStorage.setItem('ssm_path_hours_bag', candidate.key);
          return map;
        }
        errors.push(`${candidate.key}: ${this.describeHoursBagMiss(payload)}`);
      } catch (e) {
        errors.push(`${candidate.key}: ${e.message || e}`);
      }
    }
    throw new Error(errors.slice(0, 4).join(' | '));
  },

  getOfficialHoursBagCandidates(employeeId) {
    const id = encodeURIComponent(String(employeeId));
    const candidates = [
      {
        key: 'private-employee-back',
        path: `/private/schedule/v1/hours-bag-overtime/employee/${id}`,
        backend: 'https://back-eu1.sesametime.com'
      },
      {
        key: 'private-employee-api',
        path: `/private/schedule/v1/hours-bag-overtime/employee/${id}`,
        backend: 'https://api-eu1.sesametime.com'
      },
      {
        key: 'employee-back',
        path: `/schedule/v1/hours-bag-overtime/employee/${id}`,
        backend: 'https://back-eu1.sesametime.com'
      },
      {
        key: 'employee-api',
        path: `/schedule/v1/hours-bag-overtime/employee/${id}`,
        backend: 'https://api-eu1.sesametime.com'
      },
      {
        key: 'private-employees-hours-bags-back',
        path: `/private/schedule/v1/hours-bag-overtime/employees-hours-bags/${id}`,
        backend: 'https://back-eu1.sesametime.com'
      },
      {
        key: 'private-employees-hours-bags-api',
        path: `/private/schedule/v1/hours-bag-overtime/employees-hours-bags/${id}`,
        backend: 'https://api-eu1.sesametime.com'
      }
    ];

    if (DISCOVERY.workingHoursBag && DISCOVERY.workingHoursBag !== 'DISABLED') {
      const cached = candidates.find(candidate => candidate.key === DISCOVERY.workingHoursBag);
      if (cached) return [cached, ...candidates.filter(candidate => candidate.key !== cached.key)];
    }
    return candidates;
  },

  describeHoursBagMiss(payload) {
    if (!payload) return 'Respuesta vacia';
    if (payload.message) return String(payload.message);
    if (payload.error?.message) return String(payload.error.message);
    const keys = Object.keys(payload).slice(0, 6).join(', ');
    return keys ? `Sin campos de balance (${keys})` : 'Sin campos de balance';
  },

  async fetchOfficialHoursBagForEmployee(employeeId, start, end) {
    const id = String(employeeId || '');
    if (!id) return null;

    const cacheKey = `ssm_hours_bag_${STATE.companyId}_${id}_${start}_${end}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed && typeof parsed === 'object' ? parsed : null;
      }
    } catch (e) {
      sessionStorage.removeItem(cacheKey);
    }

    if (DISCOVERY.workingHoursBag === 'DISABLED') return null;

    const errors = [];
    for (const candidate of this.getOfficialHoursBagCandidates(id)) {
      try {
        const payload = await apiFetch(candidate.path, {
          from: start,
          to: end,
          method: 'GET',
          overrideBackend: candidate.backend,
          headers: {
            'Origin': 'https://app.sesametime.com',
            'Referer': 'https://app.sesametime.com/employee/portal'
          }
        });
        const normalized = this.normalizeOfficialHoursBag(id, payload);
        if (normalized) {
          DISCOVERY.workingHoursBag = candidate.key;
          localStorage.setItem('ssm_path_hours_bag', candidate.key);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(normalized));
          } catch (e) {}
          return normalized;
        }
        errors.push(`${candidate.key}: ${this.describeHoursBagMiss(payload)}`);
      } catch (e) {
        errors.push(`${candidate.key}: ${e.message || e}`);
      }
    }

    throw new Error(errors.slice(0, 4).join(' | '));
  },

  async loadOfficialHoursBagBalances(start, end) {
    this.officialHoursBagMap = new Map();
    this.officialHoursBagError = '';

    if (this.currentView !== 'balance') return;

    const ids = new Set();
    if (this.selectedEmployee && this.selectedEmployee !== 'all') {
      ids.add(String(this.selectedEmployee));
    } else {
      (this.data || []).forEach(row => {
        if (row.employeeId) ids.add(String(row.employeeId));
      });
      const myId = getCurrentEmployeeId();
      if (myId) ids.add(String(myId));
    }

    const employeeIds = Array.from(ids).slice(0, 80);
    if (employeeIds.length === 0) return;

    const errors = [];
    try {
      const listMap = await this.fetchOfficialHoursBagList(start, end);
      listMap.forEach((value, id) => {
        if (employeeIds.includes(String(id))) {
          this.officialHoursBagMap.set(String(id), value);
        }
      });
    } catch (e) {
      errors.push(e.message || String(e));
    }

    const missingEmployeeIds = employeeIds.filter(id => !this.officialHoursBagMap.has(String(id)));
    if (missingEmployeeIds.length === 0) {
      this.officialHoursBagError = errors[0] || '';
      return;
    }

    let firstError = errors[0] || '';
    let routeMisses = 0;
    for (let i = 0; i < missingEmployeeIds.length; i += 4) {
      const chunk = missingEmployeeIds.slice(i, i + 4);
      const results = await Promise.allSettled(
        chunk.map(id => this.fetchOfficialHoursBagForEmployee(id, start, end))
      );
      results.forEach((result, index) => {
        const id = chunk[index];
        if (result.status === 'fulfilled' && result.value) {
          this.officialHoursBagMap.set(String(id), result.value);
        } else if (result.status === 'rejected' && !firstError) {
          firstError = result.reason?.message || String(result.reason || 'No disponible');
          if (/no route|route_not_found|No route found|404|500|Unknown error/i.test(firstError)) routeMisses += 1;
        }
      });
    }

    this.officialHoursBagError = firstError;
    if (routeMisses > 0 && this.officialHoursBagMap.size === 0) {
      DISCOVERY.workingHoursBag = null;
      localStorage.removeItem('ssm_path_hours_bag');
    }
    if (firstError && this.officialHoursBagMap.size === 0) {
      console.warn('Balance oficial Sesame no disponible, usando cálculo local:', firstError);
    }
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

      // Helper para extraer coordenadas de forma robusta
      const extractCoord = (obj, field) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj[field] !== undefined) return obj[field];
        if (obj.coordinates && obj.coordinates[field] !== undefined) return obj.coordinates[field];
        // Aliases comunes
        const altField = field === 'latitude' ? 'lat' : 'lon';
        const altField2 = field === 'longitude' ? 'lng' : null;
        if (obj[altField] !== undefined) return obj[altField];
        if (altField2 && obj[altField2] !== undefined) return obj[altField2];
        return null;
      };

      return {
        ...c,
        date: c.date || (inStr || outStr || '').split('T')[0] || '1970-01-01',
        checkIn: inStr,
        checkOut: outStr,
        checkInLat: c.checkInLat || extractCoord(c.checkIn, 'latitude') || c.latitude || c.locLat,
        checkInLon: c.checkInLon || extractCoord(c.checkIn, 'longitude') || c.longitude || c.locLon,
        checkOutLat: c.checkOutLat || extractCoord(c.checkOut, 'latitude'),
        checkOutLon: c.checkOutLon || extractCoord(c.checkOut, 'longitude'),
        checkInAddr: c.checkInAddr || (c.checkIn && c.checkIn.address),
        checkOutAddr: c.checkOutAddr || (c.checkOut && c.checkOut.address),
        originIn: (c.checkIn && c.checkIn.origin) || c.originIn || c.checkInOrigin || c.origin || '',
        originOut: (c.checkOut && c.checkOut.origin) || c.originOut || c.checkOutOrigin || c.origin || '',
        // Enriched audit metadata (BI Engine fields + REST API nested fallback)
        recordCreatedAt: c.recordCreatedAt || c.createdAt || '',
        recordUpdatedAt: c.recordUpdatedAt || c.updatedAt || '',
        deviceNameIn: c.deviceNameIn || (c.checkIn && c.checkIn.deviceName) || (c.workEntryIn && c.workEntryIn.deviceName) || '',
        deviceNameOut: c.deviceNameOut || (c.checkOut && c.checkOut.deviceName) || (c.workEntryOut && c.workEntryOut.deviceName) || '',
        ipIn: c.ipIn || (c.checkIn && c.checkIn.ip) || '',
        ipOut: c.ipOut || (c.checkOut && c.checkOut.ip) || '',
        officeNameIn: c.officeNameIn || (c.checkIn && c.checkIn.officeName) || '',
        officeNameOut: c.officeNameOut || (c.checkOut && c.checkOut.officeName) || '',
        insideOfficeIn: c.insideOfficeIn ?? (c.checkIn ? c.checkIn.insideOffice : null) ?? null,
        performedByNameIn: c.performedByNameIn || (c.checkIn && c.checkIn.performedByEmployeeName) || '',
        performedByNameOut: c.performedByNameOut || (c.checkOut && c.checkOut.performedByEmployeeName) || '',
        performedByIdIn: c.performedByIdIn || (c.checkIn && c.checkIn.performedByEmployeeId) || '',
        performedByIdOut: c.performedByIdOut || (c.checkOut && c.checkOut.performedByEmployeeId) || '',
        secondsWorked: Number(c.secondsWorked ?? c.workedSeconds ?? c.accumulatedSeconds ?? c.seconds ?? 0),
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
            absenceLabel = masterType.name || displayAbsenceTypeName(rawType);

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

            // Cruzar con absenceTimesMap para obtener horario exacto de la API /calendars
            const _atKey = String(record.employeeId) + '_' + record.date;
            const _atVal = this.absenceTimesMap && this.absenceTimesMap.get(_atKey);
            if (_atVal) {
              if (_atVal.startTime) sTimeRaw = _atVal.startTime;
              if (_atVal.endTime)   eTimeRaw = _atVal.endTime;
            }

            // Capturamos la ausencia para el panel de detalles
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

      // SOLO emparejar si no es un fichaje de trabajo o pausa real (para evitar tapar fichajes reales)
      if (record.type !== 'work' && record.type !== 'pause') {
        for (const abs of dayAbsences) {
          // Convertir horario de ausencia (HH:mm:ss) a timestamp para comparar
          const [h, m] = abs.start.split(':').map(Number);
          const absDate = new Date(record.date + 'T00:00:00');
          absDate.setHours(h, m, 0);
          const absStartTs = absDate.getTime();

          const [eH, eM] = (abs.end || "23:59:59").split(':').map(Number);
          const absEndDate = new Date(record.date + 'T00:00:00');
          absEndDate.setHours(eH, eM, 0);
          const absEndTs = absEndDate.getTime();

          // Emparejar solo si el fichaje empieza dentro del bloque exacto de la ausencia parcial
          // Margen de 15 min al inicio, y debe empezar antes del final de la ausencia para no pisar el fichaje de vuelta
          if (entryStart >= (absStartTs - 900000) && entryStart < (absEndTs - 60000)) {
             typeClass = 'private';
             typeLabel = abs.label;
             break;
          }
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
         durationSec: durationSeconds,
         type: typeClass,
         typeLabel: typeLabel,
         originIn: record.originIn || 'Oficina',
         originOut: record.originOut || 'Oficina',
         latIn: record.latIn || record.checkInLat,
         lonIn: record.lonIn || record.checkInLon,
         latOut: record.latOut || record.checkOutLat,
         lonOut: record.lonOut || record.checkOutLon,
         addrIn: record.checkInAddr,
         addrOut: record.checkOutAddr,
         // Enriched audit data
         deviceNameIn: record.deviceNameIn || '',
         deviceNameOut: record.deviceNameOut || '',
         ipIn: record.ipIn || '',
         ipOut: record.ipOut || '',
         officeNameIn: record.officeNameIn || '',
         officeNameOut: record.officeNameOut || '',
         insideOfficeIn: record.insideOfficeIn,
         performedByNameIn: record.performedByNameIn || '',
         performedByNameOut: record.performedByNameOut || '',
         performedByIdIn: record.performedByIdIn || '',
         performedByIdOut: record.performedByIdOut || '',
         recordCreatedAt: record.recordCreatedAt || '',
         recordUpdatedAt: record.recordUpdatedAt || ''
       });

       if (record.type === 'work') {
         grouped[key].totalWorkedSeconds += (record.secondsWorked || 0);
       }
    }

    // Transform groups to array format expected by renderTable
    const todayStr = getLocalDateKey();
    for (const key in grouped) {
      const g = grouped[key];
      // Sort entries by checkIn
      g.entries.sort((a,b) => (a.inOriginal > b.inOriginal ? 1 : -1));

      // Detect if "LIVE" (any entry still open today)
      const isLive = g.date === todayStr && g.entries.some(e => (!e.outOriginal || e.out === "--:--"));

      // Recuperar la jornada teórica y datos extra del empleado
      const emp = STATE.allEmployees.get(String(g.employeeId));

      // Forzar lectura en hora local para evitar desajustes de día de la semana
      const dObj = new Date(g.date + 'T00:00:00');
      const dayOfWeek = dObj.getDay();

      // Prioridad 1: DATO MAESTRO DEL BI ENGINE (La verdad absoluta de Sesame)
      // Prioridad 2: Excepción del Calendario (ej: jornada intensiva, víspera festivo)
      // Prioridad 3: Plantilla Semanal del empleado
      // Prioridad 4: 8h por defecto
      let theoreticSeconds = 28800;
      let compensatedSeconds = 0;
      let compensatedItems = [];
      let theoreticSource = 'Estimado';
      let theoreticBeforeCompensation = 28800;
      let compensatedAppliedToTheoretic = 0;
	      const overrideKey = `${g.employeeId}_${g.date}`;
	      const dayOverride = this.dayOverrides && this.dayOverrides.get(overrideKey);
	      if (dayOverride) {
	        compensatedSeconds = Number(dayOverride.compensatedSeconds || 0);
	        compensatedItems = Array.isArray(dayOverride.compensatedItems) ? dayOverride.compensatedItems : [];
	      }

	      const isSesameComputedTheoretic = this.biTheoreticMap && this.biTheoreticMap.has(overrideKey);
	      if (isSesameComputedTheoretic) {
	        // El BI Engine ya nos da la jornada teórica final calculada por Sesame
	        theoreticSeconds = this.biTheoreticMap.get(overrideKey);
	        theoreticSource = compensatedSeconds > 0 ? 'Sesame BI + Calendario' : 'Sesame BI';
	      } else if (dayOverride && dayOverride.workdayOverride !== null) {
	        theoreticSeconds = dayOverride.workdayOverride;
	        theoreticSource = 'Calendario';
	      } else if (emp && emp.workdays && typeof emp.workdays[dayOfWeek] !== 'undefined') {
	        theoreticSeconds = emp.workdays[dayOfWeek];
	        theoreticSource = compensatedSeconds > 0 ? 'Plantilla + Calendario' : 'Plantilla';
	      }
	      if (dayOverride?.eveOfNonWorkingDaySeconds && theoreticSeconds > dayOverride.eveOfNonWorkingDaySeconds) {
	        theoreticSeconds = dayOverride.eveOfNonWorkingDaySeconds;
	        theoreticSource = `${theoreticSource} + Víspera`;
	      }

	      // IMPORTANTE: Ya no ponemos la jornada teórica a 0 si hay ausencia.
	      // Sesame sigue mostrando la jornada teórica (ej: 7h o 8h) aunque sea festivo/ausencia.
	      // En permisos retribuidos por horas, Sesame descuenta ese tiempo de la jornada a cubrir.
	      theoreticBeforeCompensation = theoreticSeconds;
	      if (!isSesameComputedTheoretic && compensatedSeconds > 0) {
	        compensatedAppliedToTheoretic = Math.min(theoreticSeconds, compensatedSeconds);
	        theoreticSeconds = Math.max(0, theoreticSeconds - compensatedAppliedToTheoretic);
	        theoreticSource = `${theoreticSource} + Permiso retribuido`;
	      }

      // --- Computed enriched metrics for the detail panel ---
      const workEntries = g.entries.filter(e => e.type === 'work' || e.type === 'special' || e.type === 'private');
      const pauseEntries = g.entries.filter(e => e.type === 'pause');
      const totalPauseSec = pauseEntries.reduce((sum, e) => sum + (e.durationSec || 0), 0);
      const pauseH = Math.floor(totalPauseSec / 3600);
      const pauseM = Math.round((totalPauseSec % 3600) / 60);
      const originsUsed = [...new Set(g.entries.map(e => e.originIn).filter(o => o && o !== 'Oficina'))];
      const devicesUsed = [...new Set(g.entries.map(e => e.deviceNameIn).filter(Boolean))];
      const officesUsed = [...new Set(g.entries.map(e => e.officeNameIn).filter(Boolean))];
      const thirdPartyEdits = g.entries.filter(e => e.performedByNameIn && String(e.performedByIdIn) !== String(g.employeeId));
      const hasBeenEdited = g.entries.some(e => {
        const isThirdParty = (e.performedByNameIn && String(e.performedByIdIn) !== String(g.employeeId)) ||
                             e.originIn === 'request' ||
                             e.originOut === 'request';
        return isThirdParty;
      });

      // El balance compara lo fichado contra la jornada final a cubrir.
      // Si el BI de Sesame no está disponible, los permisos retribuidos reducen la jornada teórica local.
      const totalEquivalentSeconds = g.totalWorkedSeconds;
      const balanceSec = totalEquivalentSeconds - theoreticSeconds;
      const balanceH = Math.floor(Math.abs(balanceSec) / 3600);
      const balanceM = Math.floor((Math.abs(balanceSec) % 3600) / 60);
      const balanceLabel = (balanceSec >= 0 ? '+' : '-') + `${balanceH}h ${balanceM}m`;

      out.push({
        employeeId: g.employeeId,
        employeeName: g.employeeName,
        photoUrl: emp?.imageProfileURL || '',
        jobTitle: emp?.jobTitle || emp?.jobChargeName || '',
        date: g.date,
        dayName: g.dayName,
        absenceLabel: g.absenceLabel,
        inTime: g.entries[0]?.in ?? "--:--",
        outTime: g.entries[g.entries.length - 1]?.out ?? "--:--",
        workedSeconds: g.totalWorkedSeconds,
        compensatedSeconds: compensatedSeconds,
        compensatedItems: compensatedItems,
        compensatedAppliedToTheoretic: compensatedAppliedToTheoretic,
        theoreticBeforeCompensation: theoreticBeforeCompensation,
        eveOfNonWorkingDayLabel: dayOverride?.eveOfNonWorkingDayLabel || '',
        totalEquivalentSeconds: totalEquivalentSeconds,
        theoreticSeconds: theoreticSeconds,
        theoreticSource: theoreticSource,
        balanceSec: balanceSec,
        balanceLabel: balanceLabel,
        absenceSegments: g.absenceSegments,
        isLive: isLive,
        entries: g.entries,
        // Enriched computed metrics
        workSegments: workEntries.length,
        pauseSegments: pauseEntries.length,
        totalPauseSec: totalPauseSec,
        pauseLabel: totalPauseSec > 0 ? `${pauseH > 0 ? pauseH + 'h ' : ''}${pauseM}m` : '--',
        originsUsed: originsUsed,
        devicesUsed: devicesUsed,
        officesUsed: officesUsed,
        thirdPartyEdits: thirdPartyEdits,
        hasBeenEdited: hasBeenEdited
      });
    }

    // Second pass: Cumulative weekly balance per employee in this view
    const empWeeklyBalance = new Map();
    out.sort((a,b) => a.date.localeCompare(b.date)).forEach(row => {
      const current = empWeeklyBalance.get(row.employeeId) || 0;
      const updated = current + row.balanceSec;
      empWeeklyBalance.set(row.employeeId, updated);
      row.weeklyBalanceSec = updated;
      const wh = Math.floor(Math.abs(updated) / 3600);
      const wm = Math.floor((Math.abs(updated) % 3600) / 60);
      row.weeklyBalanceLabel = (updated >= 0 ? '+' : '-') + `${wh}h ${wm}m`;
    });

    return out;
  },

  /**
   * Renderiza la tabla de fichajes y el resumen de horas en la interfaz.
   * Aplica filtros de búsqueda y selección de empleado en tiempo real.
   */
  renderTable() {
    const tbody = document.getElementById('signings-tbody');
    if (!tbody) return;
    this.syncInsightsVisibility();

    // Actualizar el header de la tabla según la vista activa
    const thead = document.querySelector('.signings-table thead');
    if (thead) {
      if (this.currentView === 'balance') {
        const balanceScopeHeader = this.isBalanceMonthScope() ? 'Balance Mes' : 'Balance Ejercicio';
        thead.innerHTML = `
          <tr>
            <th class="col-employee balance-col-employee">Empleado</th>
            <th class="text-center">${balanceScopeHeader}</th>
            <th class="text-center">Acumulado Sesame</th>
            <th class="text-center">Estado</th>
            <th style="min-width:150px">Visualización</th>
          </tr>
        `;
      } else {
        thead.innerHTML = `
          <tr>
            <th class="col-employee">Empleado</th>
            <th class="col-date">Fecha</th>
            <th class="col-hours text-center">Horas</th>
            <th class="col-timeline">
              <div class="timeline-header">
                <span>0:00</span>
                <span>6:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>24:00</span>
              </div>
            </th>
          </tr>
        `;
      }
    }

    tbody.innerHTML = '';

    if (this.currentView === 'balance') {
      this.renderBalanceTable();
      this.consumeBalanceTopPin();
      return;
    }

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

    let filtered = this.getFilteredRows();

    // Refresh insights whenever the table filters update
    this.renderOperationalInsights();

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

    // ── Helpers: HTML de ausencias (sin backticks anizados) ──────────────
    const _absTimelineHtml = (segs) => {
      if (!segs || !segs.length) return '';
      return segs.filter(a => !a.isFullDay).map(abs => {
        const p = abs.start.split(':').map(Number);
        const q = abs.end.split(':').map(Number);
        if (isNaN(p[0]) || isNaN(q[0])) return '';
        const ps = ((p[0] + (p[1]||0)/60) / 24) * 100;
        const pw = (((q[0] + (q[1]||0)/60) - (p[0] + (p[1]||0)/60)) / 24) * 100;
        const lbl = (abs.label || 'Ausencia') + ': ' + abs.start.substring(0,5) + '-' + abs.end.substring(0,5);
        return '<div class="mini-timeline-bar absence" style="left:' + ps.toFixed(2) + '%;width:' + pw.toFixed(2) + '%;" title="' + escapeHTML(lbl) + '"></div>';
      }).join('');
    };
    const _absTableRowsHtml = (segs, entries) => {
      if (!segs || !segs.length) return '';
      // Mostrar solo ausencias parciales cuyo tramo NO está cubierto por un fichaje físico.
      // (si ya hay un fichaje que solapa exactamente ese periodo, no duplicamos)
      const isCoveredByEntry = (absStartStr, absEndStr) => {
        const [ah, am] = (absStartStr || '00:00').split(':').map(Number);
        const [bh, bm] = (absEndStr   || '23:59').split(':').map(Number);
        const aMin = ah*60 + (am||0);
        const bMin = bh*60 + (bm||0);
        return (entries || []).some(e => {
          if (!e.in || !e.out || e.type === 'work' || e.type === 'pause') return false;
          const [ih, im] = e.in.split(':').map(Number);
          const [oh, om] = e.out.split(':').map(Number);
          const iMin = ih*60 + (im||0);
          const oMin = oh*60 + (om||0);
          // Solapamiento: la entrada empieza antes de que acabe la ausencia
          // Y termina después de que empiece la ausencia
          return iMin < bMin && oMin > aMin;
        });
      };
      return segs.filter(abs => {
        if (abs.isFullDay) return false; // día completo: sin franja horaria concreta
        return !isCoveredByEntry(abs.start, abs.end); // solo si el tramo NO está en los fichajes
      }).map(abs => {
        let durStr = '--';
        const p1 = abs.start.split(':').map(Number);
        const p2 = abs.end.split(':').map(Number);
        if (!isNaN(p1[0]) && !isNaN(p2[0])) {
          const dm = (p2[0]*60 + (p2[1]||0)) - (p1[0]*60 + (p1[1]||0));
          if (dm > 0) durStr = Math.floor(dm/60) + 'h ' + (dm%60) + 'm';
        }
        const st = abs.start ? abs.start.substring(0,5) : '00:00';
        const et = abs.end   ? abs.end.substring(0,5)   : '23:59';
        const lbl = escapeHTML(abs.label || 'Ausencia');
        return '<tr class="row-is-absence" style="background:rgba(139,92,246,0.06);">'
          + '<td><strong>' + st + ' \u2013 ' + et + '</strong></td>'
          + '<td><span class="td-duration">' + durStr + '</span></td>'
          + '<td><span style="background:rgba(139,92,246,0.15);border:1px dashed #a78bfa;padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;color:#a78bfa;">'
          + '\uD83D\uDCCC ' + lbl + '</span></td>'
          + '<td><span class="td-loc">\uD83D\uDCC5 Sesame (Ausencia)</span></td>'
          + '<td><span style="opacity:0.3">--</span></td>'
          + '</tr>';
      }).join('');
    };

    filtered.forEach((row, idx) => {
      try {
        const realWorked = Number(row.workedSeconds || 0);
        const compensated = Number(row.compensatedSeconds || 0);
        const worked = Number(row.totalEquivalentSeconds ?? realWorked); // Base real usada para el balance
        const theoretic = Number(row.theoreticSeconds || 0);
        totalWorked += worked;
        totalTheoretic += theoretic;

        const empName = String(row.employeeName || 'Empleado');
        const empId = String(row.employeeId || '');
        const safeEmpName = escapeHTML(empName);
        const safeEmpId = escapeHTML(empId);
        const safePhoto = safeHttpUrlAttr(row.photoUrl);
        const initials = escapeHTML(getInitials(empName));
        const safeAbsenceLabel = row.absenceLabel ? escapeHTML(row.absenceLabel) : '';
        const safeDayName = escapeHTML(row.dayName || '');
        const safeBalanceLabel = escapeHTML(row.balanceLabel || '');
        const safeWeeklyBalanceLabel = escapeHTML(row.weeklyBalanceLabel || '');
        const safeInTime = escapeHTML(row.inTime || '--:--');
        const safeOutTime = escapeHTML(row.outTime || '--:--');
        const safePauseLabel = escapeHTML(row.pauseLabel || '0m');
        const safeEveLabel = row.eveOfNonWorkingDayLabel ? escapeHTML(row.eveOfNonWorkingDayLabel) : '';

        const workedH = Math.floor(worked / 3600);
        const workedM = Math.floor((worked % 3600) / 60);
        const theoH = Math.floor(theoretic / 3600);
        const theoM = Math.floor((theoretic % 3600) / 60);
        const theoreticLabel = `${theoH}h ${theoM}m`;
        const compensatedItemsHtml = (row.compensatedItems || []).map(item => {
          const seconds = Number(item.seconds || 0);
          const h = Math.floor(seconds / 3600);
          const m = Math.round((seconds % 3600) / 60);
          const timeLabel = item.startTime && item.endTime
            ? ` · ${escapeHTML(String(item.startTime).slice(0,5))}-${escapeHTML(String(item.endTime).slice(0,5))}`
            : '';
          return `<div class="stat-subtext" style="color:var(--text-secondary);">+ ${h}h ${m}m ${escapeHTML(item.label || 'Ausencia retribuida')}${timeLabel}</div>`;
        }).join('');

        let alertHtml = "";
        if (worked > 0) {
          if (worked < theoretic * 0.95 && !row.isLive) {
            alertHtml = '<span class="hour-alert alert-warning" title="Jornada incompleta">!</span>';
          } else if (worked > theoretic * 1.05) {
            alertHtml = '<span class="hour-alert alert-success" title="Horas extra">+</span>';
          }
        }

        // --- MULTI-SEGMENT TIMELINE (fichajes + ausencias parciales) ---
        const timelineSegments = [
          ...(row.entries || []).map(e => {
            if (!e.in || !e.out || e.in === "--:--" || e.out === "--:--") return "";
            if (e.in.includes(' ')) return "";
            const [hIn, mIn] = e.in.split(':').map(Number);
            const [hOut, mOut] = e.out.split(':').map(Number);
            if (isNaN(hIn) || isNaN(hOut)) return "";
            const ps = ((hIn + (mIn||0)/60) / 24) * 100;
            const pw = (((hOut + (mOut||0)/60) - (hIn + (mIn||0)/60)) / 24) * 100;
            const typeClass = safeClassToken(e.type || 'work', 'work');
            const title = `${e.typeLabel || 'Trabajo'}: ${e.in} - ${e.out}`;
            return '<div class="timeline-bar ' + typeClass + '" style="left:' + ps + '%;width:' + pw + '%" title="' + escapeHTML(title) + '"></div>';
          }),
          ...(row.absenceSegments || []).filter(a => !a.isFullDay).map(abs => {
            const [hIn, mIn] = abs.start.split(':').map(Number);
            const [hOut, mOut] = abs.end.split(':').map(Number);
            if (isNaN(hIn) || isNaN(hOut)) return "";
            const ps = ((hIn + (mIn||0)/60) / 24) * 100;
            const pw = (((hOut + (mOut||0)/60) - (hIn + (mIn||0)/60)) / 24) * 100;
            const title = `${abs.label || 'Ausencia'}: ${abs.start.substring(0,5)} - ${abs.end.substring(0,5)}`;
            return '<div class="timeline-bar absence" style="left:' + ps + '%;width:' + pw + '%" title="' + escapeHTML(title) + '"></div>';
          })
        ].join('');

        const tr = document.createElement('tr');
        tr.className = 'row-expandable';
        tr.innerHTML = `
          <td class="col-employee">
            <div class="employee-cell">
              <div class="emp-avatar-sm clickable" data-employee-id="${safeEmpId}" style="${safePhoto ? '' : `background: linear-gradient(135deg, var(--accent), var(--accent2));`}">
                ${safePhoto
                  ? `<img src="${safePhoto}" alt="${safeEmpName}" referrerpolicy="no-referrer">`
                  : initials}
              </div>
              <div class="employee-info-cell">
                <span class="employee-info-name">${safeEmpName}</span>
                ${safeAbsenceLabel ? `<span class="badge-absence">📌 ${safeAbsenceLabel}</span>` : ''}
              </div>
              ${row.isLive ? '<span class="pulse-dot green"></span>' : ''}
            </div>
          </td>
          <td class="col-date">${safeDayName}</td>
          <td class="col-hours text-center">
             <strong>${workedH}h ${workedM}m</strong> / ${theoreticLabel} ${alertHtml}
          </td>
          <td class="col-timeline"><div class="timeline-track">${timelineSegments}</div></td>
        `;
        tr.querySelector('.emp-avatar-sm.clickable')?.addEventListener('click', event => {
          event.stopPropagation();
          showContactCard(empId);
        });
        const rowAvatar = tr.querySelector('.emp-avatar-sm.clickable');
        rowAvatar?.querySelector('img')?.addEventListener('error', event => {
          event.currentTarget.remove();
          rowAvatar.textContent = getInitials(empName);
          rowAvatar.style.background = 'linear-gradient(135deg, var(--accent), var(--accent2))';
        });

        const trDetails = document.createElement('tr');
        trDetails.className = 'row-details';
        trDetails.dataset.employeeId = empId;
        trDetails.dataset.date = row.date;
        trDetails.innerHTML = `
          <td colspan="10">
            <div class="details-container">
              <div class="details-layout-split">
                <div class="signings-stats-panel" id="stats-panel-${safeClassToken(empId, 'emp')}-${safeClassToken(row.date, 'date')}">
                   <!-- COL 1: OVERVIEW -->
                   <div class="stats-bento-section">
                     <div class="info-title">📊 RESUMEN JORNADA</div>
                     <div class="stat-value">${workedH}h ${workedM}m</div>
                     <div class="stat-subtext">Real fichado</div>

                     ${row.compensatedSeconds > 0 ? `
                     <div class="stat-value" style="font-size: 1.1rem; color: var(--success); margin-top: 8px;">+ ${Math.floor(row.compensatedSeconds/3600)}h ${Math.round((row.compensatedSeconds%3600)/60)}m</div>
                     <div class="stat-subtext">Compensado (Retribuido)</div>
                     ${row.compensatedAppliedToTheoretic > 0 ? `<div class="stat-subtext">Jornada ajustada: ${Math.floor((row.theoreticBeforeCompensation || 0)/3600)}h ${Math.round(((row.theoreticBeforeCompensation || 0)%3600)/60)}m → ${Math.floor(row.theoreticSeconds/3600)}h ${Math.round((row.theoreticSeconds%3600)/60)}m</div>` : ''}
                     ${compensatedItemsHtml}
                     ` : ''}
                     ${safeEveLabel ? `<div class="stat-subtext" style="color:var(--accent); margin-top:8px;">Víspera: ${safeEveLabel} · jornada 7h</div>` : ''}

                     <div class="detail-divider"></div>
                     <div class="detail-meta-grid">
                       <div class="detail-meta-item"><span class="detail-meta-label">Balance Día</span><span class="detail-meta-val" style="color: ${row.balanceSec >= 0 ? '#4ade80' : '#f87171'}">${safeBalanceLabel}</span></div>
                       <div class="detail-meta-item"><span class="detail-meta-label">Balance Sem.</span><span class="detail-meta-val" style="color: ${row.weeklyBalanceSec >= 0 ? '#4ade80' : '#f87171'}">${safeWeeklyBalanceLabel}</span></div>
                     </div>

                     ${theoretic > 0 ? (() => {
                       const pct = Math.min(Math.round((worked / theoretic) * 100), 150);
                       const pctColor = pct >= 100 ? 'var(--success)' : (pct >= 80 ? 'var(--accent)' : 'var(--warn)');
                       return `
                       <div class="detail-divider"></div>
                       <div class="detail-ratio-wrap">
                         <div class="detail-ratio-bar"><div class="detail-ratio-fill" style="width: ${Math.min(pct, 100)}%; background: ${pctColor};"></div></div>
                         <div class="stat-subtext">${pct}% de ${theoreticLabel} teóricas</div>
                       </div>`;
                     })() : ''}
                   </div>

                   <!-- COL 2: ACTIVITY -->
                   <div class="stats-bento-section">
                     <div class="info-title">📈 LÍNEA DE ACTIVIDAD</div>
                     <div class="detail-activity-timeline">
                       ${_absTimelineHtml(row.absenceSegments)}
                       ${(row.entries || []).map(e => {
                         if (!e.in || !e.out || e.in === "--:--" || e.out === "--:--") return "";
                         const [hIn, mIn] = e.in.split(':').map(Number);
                         const [hOut, mOut] = e.out.split(':').map(Number);
                         const start = ((hIn + (mIn||0)/60) / 24) * 100;
                         const width = (((hOut + (mOut||0)/60) - (hIn + (mIn||0)/60)) / 24) * 100;
                         const typeClass = safeClassToken(e.type || 'work', 'work');
                         const title = `${e.typeLabel || 'Trabajo'}: ${e.in}-${e.out}`;
                         return `<div class="mini-timeline-bar ${typeClass}" style="left: ${start}%; width: ${width}%;" title="${escapeHTML(title)}"></div>`;
                       }).join('')}
                     </div>

                     <div class="detail-meta-grid">
                       <div class="detail-meta-item"><span class="detail-meta-label">Primera Entrada</span><span class="detail-meta-val">${safeInTime}</span></div>
                       <div class="detail-meta-item"><span class="detail-meta-label">Última Salida</span><span class="detail-meta-val">${safeOutTime}</span></div>
                     </div>

                     <div class="detail-divider"></div>
                     <div class="detail-stat-row">
                       <span class="detail-stat-val">💼 ${row.workSegments} tramos trabajo</span>
                       <span class="detail-stat-badge">${(row.entries || []).length} total</span>
                     </div>
                     ${row.pauseSegments > 0 ? `
                     <div class="detail-stat-row">
                       <span class="detail-stat-val">☕ ${safePauseLabel} pausas</span>
                       <span class="detail-stat-badge">${row.pauseSegments} tramos</span>
                     </div>
                     ` : ''}
                   </div>

                   <!-- COL 3: AUDITORÍA -->
                   <div class="stats-bento-section">
                     <div class="info-title">🔍 AUTORÍA Y CONTROL</div>
                     ${row.thirdPartyEdits.length > 0
                       ? `<div class="detail-audit-alert">
                           <span class="detail-audit-icon">✏️</span>
                           <div class="detail-audit-text">
                             <strong>Modificado por tercero</strong>
                             <span>${escapeHTML([...new Set(row.thirdPartyEdits.map(e => e.performedByNameIn))].filter(Boolean).join(', '))}</span>
                           </div>
                         </div>`
                       : (row.hasBeenEdited ? '<div class="detail-audit-warn"><span>⚠️</span> <span>Registro editado</span></div>' : '<div class="detail-audit-ok"><span>✅</span> <span>Registro original</span></div>')
                     }

                     <div class="detail-divider"></div>
                     <div class="info-title" style="font-size:0.6rem; opacity:0.6">CANALES UTILIZADOS</div>
                     <div class="detail-chips">
                       ${row.originsUsed.map(o => {
                         const ol = o.toLowerCase();
                         const icon = ol.includes('web') ? '🌐' : (ol.includes('app') ? '📱' : (ol.includes('tablet') ? '📟' : '📍'));
                         return '<span class="detail-chip">' + icon + ' ' + escapeHTML(ol.includes('web')?'Web':ol.includes('app')?'App':ol.includes('tablet')?'Tablet':o) + '</span>';
                       }).join('')}
                     </div>

                     <div class="detail-divider"></div>
                     <div class="info-title" style="font-size:0.6rem; opacity:0.6">DETALLES TÉCNICOS</div>
                     <div class="detail-chips">
                       ${row.devicesUsed.map(d => '<span class="detail-chip">💻 ' + escapeHTML(d) + '</span>').join('')}
                       ${row.officesUsed.map(o => '<span class="detail-chip">🏢 ' + escapeHTML(o) + '</span>').join('')}
                     </div>
                   </div>
                   <!-- COL 4: SEGURIDAD E HISTORIAL -->
                   <div class="stats-bento-section" style="border-left: 1px solid var(--accent2)">
                     <div class="info-title">🛡️ SEGURIDAD E HISTORIAL</div>
                     <div class="detail-meta-grid" style="grid-template-columns: 1fr; gap: 4px;" id="audit-level-3-${safeClassToken(empId, 'emp')}-${safeClassToken(row.date, 'date')}">
                        ${(() => {
                           let preAuditHTML = '';
                           const seenEditors = new Set();

                           row.entries.forEach(e => {
                             const isEditedIn = e.performedByNameIn && String(e.performedByIdIn) !== String(row.employeeId);
                             const isEditedOut = e.performedByNameOut && String(e.performedByIdOut) !== String(row.employeeId);

                             if (isEditedIn && !seenEditors.has('in_'+e.performedByNameIn)) {
                                 preAuditHTML += `<div class="detail-meta-item" style="flex-direction:row; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px; border:1px solid rgba(251,191,36,0.3)">
                                    <span class="detail-meta-label" style="margin:0; font-size:0.6rem;">✏️ Edición In</span>
                                    <span class="detail-meta-val" style="font-size:0.6rem; font-weight:600; color:var(--warn)">${escapeHTML(e.performedByNameIn)}</span>
                                 </div>`;
                                 seenEditors.add('in_'+e.performedByNameIn);
                              }
                              if (isEditedOut && !seenEditors.has('out_'+e.performedByNameOut)) {
                                 preAuditHTML += `<div class="detail-meta-item" style="flex-direction:row; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px; border:1px solid rgba(251,191,36,0.3)">
                                    <span class="detail-meta-label" style="margin:0; font-size:0.6rem;">✏️ Edición Out</span>
                                    <span class="detail-meta-val" style="font-size:0.6rem; font-weight:600; color:var(--warn)">${escapeHTML(e.performedByNameOut)}</span>
                                 </div>`;
                                 seenEditors.add('out_'+e.performedByNameOut);
                              }

                              if (e.originIn === 'request' && !seenEditors.has('req_in')) {
                                 preAuditHTML += `<div class="detail-meta-item" style="flex-direction:row; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px; border:1px solid rgba(251,191,36,0.3)">
                                    <span class="detail-meta-label" style="margin:0; font-size:0.6rem;">📝 Origen Entrada</span>
                                    <span class="detail-meta-val" style="font-size:0.6rem; font-weight:600; color:var(--warn)">Por Solicitud (Aprobada)</span>
                                 </div>`;
                                 seenEditors.add('req_in');
                              }
                              if (e.originOut === 'request' && !seenEditors.has('req_out')) {
                                 preAuditHTML += `<div class="detail-meta-item" style="flex-direction:row; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px; border:1px solid rgba(251,191,36,0.3)">
                                    <span class="detail-meta-label" style="margin:0; font-size:0.6rem;">📝 Origen Salida</span>
                                    <span class="detail-meta-val" style="font-size:0.6rem; font-weight:600; color:var(--warn)">Por Solicitud (Aprobada)</span>
                                 </div>`;
                                 seenEditors.add('req_out');
                              }
                           });

                           return preAuditHTML || '<div class="stat-subtext" style="font-style:italic">Cargando incidencias...</div>';
                        })()}
                     </div>

                     ${row.absenceLabel ? `
                     <div class="detail-divider"></div>
                     <div class="info-title">📌 NOTA AUSENCIA</div>
                     <div class="stat-subtext" style="color:var(--accent2); font-weight:600">${safeAbsenceLabel}</div>
                     ` : ''}

                     ${row.isLive ? `
                     <div class="detail-divider"></div>
                     <div class="detail-audit-ok" style="background:rgba(248, 113, 113, 0.1)"><span>🔴</span> <span>Jornada Activa</span></div>
                     ` : ''}
                   </div>
                </div>

                <!-- 2. Detailed Table (Bottom) -->
                <div class="signings-table-wrapper">
                  <table class="details-tech-table">
                    <thead><tr><th>HORARIO</th><th>DURACIÓN</th><th>TIPO</th><th>ORIGEN</th><th>UBICACIÓN</th></tr></thead>
                    <tbody>
	                      ${_absTableRowsHtml(row.absenceSegments, row.entries)}
	                      ${(row.entries || []).map(e => {
	                        const icon = e.type === 'work' ? '💼' : (e.type === 'pause' ? '☕' : '🚪');
	                        const typeCls = e.type === 'work' ? 'type-work' : (e.type === 'pause' ? 'type-pause' : 'type-abs');
	                        const latIn = Number(e.latIn);
	                        const lonIn = Number(e.lonIn);
	                        const latOut = Number(e.latOut);
	                        const lonOut = Number(e.lonOut);
	                        const hasCoordIn = Number.isFinite(latIn) && Number.isFinite(lonIn);
		                        const hasCoordOut = Number.isFinite(latOut) && Number.isFinite(lonOut);
		                        const safeAddrIn = escapeHTML(e.addrIn || '');
		                        const safeAddrOut = escapeHTML(e.addrOut || '');
		                        const safeLocInTime = escapeHTML(e.in || '--:--');
		                        const safeLocOutTime = escapeHTML(e.out || '--:--');
		                        const locIn = hasCoordIn ? `<button type="button" title="Ver entrada en mapa: ${latIn}, ${lonIn}" class="loc-link" data-lat="${latIn}" data-lon="${lonIn}" data-kind="Entrada" data-time="${safeLocInTime}" data-employee="${safeEmpName}">📍 In</button>` : (safeAddrIn ? `<span class="loc-addr" title="Dirección entrada: ${safeAddrIn}">📍 ${safeAddrIn}</span>` : '');
		                        const locOut = hasCoordOut ? `<button type="button" title="Ver salida en mapa: ${latOut}, ${lonOut}" class="loc-link" data-lat="${latOut}" data-lon="${lonOut}" data-kind="Salida" data-time="${safeLocOutTime}" data-employee="${safeEmpName}">📍 Out</button>` : (safeAddrOut ? `<span class="loc-addr" title="Dirección salida: ${safeAddrOut}">📍 ${safeAddrOut}</span>` : '');
		                        const locContent = (locIn || locOut) ? `<div class="td-loc-group">${locIn}${locOut}</div>` : `<span style="opacity:0.3" title="Sin datos de geolocalización en este fichaje">--</span>`;

                        // Map origin to nice labels/icons
                        const getOInfo = (val) => {
                          const o = (val || '').toLowerCase();
                          if (o.includes('request')) return { label: 'Solicitud', icon: '📝' };
                          if (o.includes('automatic_pause')) return { label: 'Auto Pausa', icon: '🤖' };
                          if (o.includes('web')) return { label: 'Web', icon: '🌐' };
                          if (o.includes('app') || o.includes('mobile')) return { label: 'App', icon: '📱' };
                          if (o.includes('wall') || o.includes('tablet')) return { label: 'Tablet', icon: '📟' };
                          return { label: val || 'Oficina', icon: '📍' };
                        };

                        const oIn = getOInfo(e.originIn);
                        const oOut = getOInfo(e.originOut);

                        const isEditedIn = (e.performedByNameIn && String(e.performedByIdIn) !== String(row.employeeId)) || e.originIn === 'request';
                        const isEditedOut = (e.performedByNameOut && String(e.performedByIdOut) !== String(row.employeeId)) || e.originOut === 'request';

                        // Human edit detection: Only if timestamps are > 30 mins apart or edited by someone else
                        let isTimeEdited = false;
                        if (e.recordCreatedAt && e.recordUpdatedAt) {
                          const diff = Math.abs(new Date(e.recordUpdatedAt) - new Date(e.recordCreatedAt));
                          if (diff > 1800000) isTimeEdited = true;
                        }

                        const auditTooltip = [
                          e.recordCreatedAt ? `Creado: ${new Date(e.recordCreatedAt).toLocaleString('es-ES')}` : '',
                          e.recordUpdatedAt && isTimeEdited ? `Modificado: ${new Date(e.recordUpdatedAt).toLocaleString('es-ES')}` : '',
                          isEditedIn ? `Entrada por: ${e.performedByNameIn}` : '',
                          isEditedOut ? `Salida por: ${e.performedByNameOut}` : '',
                          e.ipIn ? `IP In: ${e.ipIn}` : '',
	                          e.deviceNameIn ? `Disp: ${e.deviceNameIn}` : ''
	                        ].filter(Boolean).join('\n');
		                        const safeAuditTooltip = escapeHTML(auditTooltip);
		                        const safeOriginInLabel = escapeHTML(oIn.label);
		                        const safeOriginOutLabel = escapeHTML(oOut.label);
		                        const safeIn = escapeHTML(e.in || '--:--');
	                        const safeOut = escapeHTML(e.out || '--:--');
	                        const safeDuration = escapeHTML(e.duration || '--');
	                        const safeTypeLabel = escapeHTML(e.typeLabel || 'Trabajo');

	                        let originContent = `<span class="td-loc" title="${safeAuditTooltip}">${oIn.icon} ${safeOriginInLabel}${isEditedIn ? ' ✏️' : ''}</span>`;
	                        if (e.originIn !== e.originOut && e.originOut && e.out !== '--:--') {
	                           const multiTitle = `${oIn.label}${isEditedIn ? ' (Editado por '+(e.performedByNameIn || '')+')' : ''} → ${oOut.label}${isEditedOut ? ' (Editado por '+(e.performedByNameOut || '')+')' : ''}\n${auditTooltip}`;
	                           originContent = `<div class="td-loc-multi" title="${escapeHTML(multiTitle)}">
	                             <span class="td-loc">${oIn.icon}${isEditedIn ? '✏️' : ''}</span>
	                             <span style="opacity:0.5; font-size:0.7rem;">→</span>
	                             <span class="td-loc">${oOut.icon}${isEditedOut ? '✏️' : ''}</span>
                           </div>`;
                        }

                        // Use a class that only applies if there is an explicit THIRD PARTY edit or request
                        const highlightClass = (isEditedIn || isEditedOut) ? 'row-is-edited' : '';

	                        return `
	                        <tr class="${highlightClass}">
	                          <td><strong title="${safeAuditTooltip}">${safeIn} - ${safeOut}</strong></td>
	                          <td><span class="td-duration">${safeDuration}</span></td>
	                          <td><span class="signing-type-badge ${typeCls}">${icon} ${safeTypeLabel}</span></td>
	                          <td>${originContent}</td>
	                          <td>${locContent}</td>
                        </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </td>
        `;

	        tr.addEventListener('click', () => {
	          const isOpening = !trDetails.classList.contains('active');
	          trDetails.classList.toggle('active');
	          if (isOpening) {
	            FichajesModule.loadDeepAudit(empId, row.date);
	          }
	        });
	        trDetails.querySelectorAll('.loc-link').forEach(button => {
	          button.addEventListener('click', event => {
	            event.preventDefault();
	            openLocationModal({
	              lat: button.dataset.lat,
	              lon: button.dataset.lon,
	              kind: button.dataset.kind,
	              time: button.dataset.time,
	              employee: button.dataset.employee
	            });
	          });
	        });
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
    const source = this.realtimePresence?.length ? this.realtimePresence : STATE.presenceList;
    const currentDayRowsAuthority = this.currentRangeIncludesToday();
    if (currentDayRowsAuthority) this.syncCurrentPresenceMap(source, this.data);
    renderTeamPresenceSummary(source, {
      rows: this.data,
      currentDayRowsAuthority
    });
  },

  async loadDeepAudit(employeeId, date) {
    const container = document.querySelector(`#audit-level-3-${safeClassToken(employeeId, 'emp')}-${safeClassToken(date, 'date')}`);
    if (!container) return;

    try {
      // Use the individual checks path as the default since it's the fallback that works
      let wePath = `/api/v3/employees/${employeeId}/checks?from=${date}&to=${date}&includeOut=true`;

      // Only override if we have a proven working global path
      if (DISCOVERY.workingChecks && !DISCOVERY.workingChecks.includes('DISABLED')) {
        const base = DISCOVERY.workingChecks.split('?')[0];
        wePath = `${base}?employeeId=${employeeId}&from=${date}&to=${date}`;
      }

      const [weRes, ciRes] = await Promise.allSettled([
        apiFetch(wePath),
        apiFetch(`/api/v3/check-incidences?employeeId=${employeeId}&fromDate[gte]=${date}&toDate[lte]=${date}`)
      ]);

      let workEntries = weRes.status === 'fulfilled' ? (weRes.value?.data || weRes.value?.items || weRes.value || []) : [];
      let incidences = ciRes.status === 'fulfilled' ? (ciRes.value?.data || ciRes.value?.items || ciRes.value || []) : [];

      if (!Array.isArray(workEntries)) workEntries = [];
      if (!Array.isArray(incidences)) incidences = [];

      const auditItems = [];

      incidences.forEach(ci => {
        const check = ci.check || {};
        const checkIn = check.checkIn || ci.checkIn || {};
        if (ci.performedByEmployeeName) {
          const safeEditorPhoto = safeHttpUrlAttr(ci.performedByEmployeeImageProfile);
          const img = safeEditorPhoto
            ? `<img src="${safeEditorPhoto}" alt="" referrerpolicy="no-referrer" style="width:14px;height:14px;border-radius:50%;margin-right:4px;vertical-align:middle;">`
            : '👤';
          auditItems.push({icon: img, label: 'Autoría', value: ci.performedByEmployeeName});
        }
        if (checkIn.ip) auditItems.push({icon: '🌐', label: 'IP', value: checkIn.ip});
        if (ci.insideOffice === true) auditItems.push({icon: '📍', label: 'GPS', value: 'En Oficina'});
        else if (ci.insideOffice === false) auditItems.push({icon: '📍', label: 'GPS', value: 'Fuera Rango'});
        if (ci.isSuprema) auditItems.push({icon: '📟', label: 'Terminal', value: 'Suprema (Bio)'});
        if (ci.checkIncidenceStatus) auditItems.push({icon: '⚠️', label: 'Estado', value: ci.checkIncidenceStatus === 'pending' ? 'Pendiente' : 'Revisada'});
        if (ci.canEdit === false) auditItems.push({icon: '🔒', label: 'Edición', value: 'Bloqueada'});
        if (ci.incidence?.description) auditItems.push({icon: '💬', label: 'Nota', value: ci.incidence.description});
      });

      workEntries.forEach(we => {
        if (we.comment) auditItems.push({icon: '📝', label: 'Coment.', value: we.comment});

        const extractEditor = (obj) => {
          if (!obj) return null;
          // Strategy 1: Direct name field
          if (obj.performedByEmployeeName) return obj.performedByEmployeeName;
          // Strategy 2: Nested employee object
          const pEmp = obj.performedByEmployee || obj.performedBy;
          if (pEmp && typeof pEmp === 'object') {
            const name = [pEmp.firstName, pEmp.lastName].filter(Boolean).join(' ') || pEmp.name || pEmp.firstName;
            if (name) return name;
          }
          return null;
        };

        const editorIn = extractEditor(we.workEntryIn);
        const editorOut = extractEditor(we.workEntryOut);

        const pIdIn = we.workEntryIn?.performedByEmployeeId || we.workEntryIn?.performedByEmployee?.id || we.workEntryIn?.performedBy?.id;
        const pIdOut = we.workEntryOut?.performedByEmployeeId || we.workEntryOut?.performedByEmployee?.id || we.workEntryOut?.performedBy?.id;

        if (editorIn && String(pIdIn) !== String(employeeId)) {
          auditItems.push({icon: '✏️', label: 'Editor Entrada', value: editorIn});
        }
        if (editorOut && String(pIdOut) !== String(employeeId)) {
          auditItems.push({icon: '✏️', label: 'Editor Salida', value: editorOut});
        }

        if (we.workEntryIn?.realDate && we.workEntryIn?.date && we.workEntryIn.realDate !== we.workEntryIn.date) {
          const h = new Date(we.workEntryIn.realDate).toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
          auditItems.push({icon: '⏰', label: 'Hora Real', value: h});
        }
      });

      const seen = new Set();
      const unique = auditItems.filter(a => { const k = a.label + a.value; if (seen.has(k)) return false; seen.add(k); return true; });

      // Remove the "Cargando incidencias..." placeholder if it exists
      if (container.innerHTML.includes('Cargando incidencias...')) {
         container.innerHTML = '';
      }

      if (unique.length > 0) {
        let html = '';
        unique.forEach(a => {
          html += `<div class="detail-meta-item" style="flex-direction:row; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.05)">
            <span class="detail-meta-label" style="margin:0; font-size:0.6rem;">${a.icon} ${escapeHTML(a.label)}</span>
            <span class="detail-meta-val" style="font-size:0.6rem; font-weight:600">${escapeHTML(a.value)}</span>
          </div>`;
        });
        container.insertAdjacentHTML('beforeend', html);
      } else if (container.innerHTML.trim() === '') {
        container.innerHTML = '<div class="stat-subtext">Sin incidencias técnicas extra.</div>';
      }
    } catch (err) {
      console.error("Error Level 3:", err);
      if (container.innerHTML.includes('Cargando incidencias...')) {
         container.innerHTML = '<div class="stat-subtext" style="color:var(--danger)">Error al cargar metadatos.</div>';
      }
    }
  },

  exportToCSV() {
    const visibleRows = this.getFilteredRows();
    if (!visibleRows || visibleRows.length === 0) return alert("No hay datos visibles para exportar");

    let csv = "Empleado;Fecha;Entrada;Salida;Duracion;Tipo;Localizacion\n";
    visibleRows.forEach(row => {
      row.entries.forEach(e => {
        csv += `${row.employeeName};${row.date};${e.in};${e.out};${e.duration};${e.typeLabel};${e.loc}\n`;
      });
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fichajes_sesame_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  },

  exportToJSON() {
    const visibleRows = this.getFilteredRows();
    if (!visibleRows || visibleRows.length === 0) return alert("No hay datos visibles para exportar");

    const dataStr = JSON.stringify(visibleRows, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fichajes_sesame_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  },

  formatDurationCompact(seconds) {
    const safe = Number(seconds || 0);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    return `${h}h ${m}m`;
  },

  getFilteredRows(options = {}) {
    const includePresenceFilter = options.includePresenceFilter !== false;
    let filtered = [...(this.data || [])];
    const { start, end } = this.getCurrentRangeKeys();

    filtered = filtered.filter(row => {
      const date = String(row.date || '');
      return date >= start && date <= end;
    });

    if (this.selectedEmployee && this.selectedEmployee !== 'all') {
      const targetId = String(this.selectedEmployee);
      filtered = filtered.filter(row => String(row.employeeId) === targetId);
    }

    if (this.searchQuery) {
      const q = String(this.searchQuery).toLowerCase();
      filtered = filtered.filter(row => String(row.employeeName || '').toLowerCase().includes(q));
    }

    if (includePresenceFilter && this.presenceFilter && this.presenceFilter !== 'all') {
      const todayKey = getLocalDateKey();
      filtered = filtered.filter(row => {
        if (String(row.date || '') !== todayKey) return false;
        const status = this.getCurrentActivityKind(row.employeeId, [row]);
        if (this.presenceFilter === 'working') return status === 'working' || status === 'remote';
        if (this.presenceFilter === 'paused') return status === 'paused';
        return true;
      });
    }

    return filtered;
  },

  buildUpcomingAbsenceItems() {
    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 14);
    const rows = [];

    Object.entries(STATE.calendarData || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([date, entries]) => {
        const d = new Date(`${date}T00:00:00`);
        if (d < new Date(today.toDateString()) || d > maxDate) return;

        entries.forEach(entry => {
          (entry.employees || []).forEach(emp => {
            const empId = String(emp.id);
            const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();

            if (STATE.hiddenEmployeeIds.has(String(empId))) return;
            if (this.selectedEmployee && this.selectedEmployee !== 'all' && String(this.selectedEmployee) !== empId) return;
            if (this.searchQuery && !name.toLowerCase().includes(this.searchQuery)) return;

            rows.push({
              date,
              employeeId: empId,
              employeeName: name || 'Empleado',
              typeName: entry.type?.name || 'Ausencia'
            });
          });
        });
      });

    return rows.slice(0, 4);
  },

  renderOperationalInsights() {
    const rows = this.getFilteredRows();
    const incidents = [];
    const validations = [];
    const anomalies = [];

    const selectedId = String(this.selectedEmployee || 'all');
    const isSingleUser = selectedId !== 'all';

    rows.forEach(row => {
      const missingCheckout = (row.entries || []).some(e => e.out === '--:--') && !row.isLive;
      const underworked = row.theoreticSeconds > 0 && row.workedSeconds < row.theoreticSeconds * 0.95 && !row.absenceLabel && !row.isLive;
      const overtime = row.theoreticSeconds > 0 && row.workedSeconds > row.theoreticSeconds * 1.15;
      const fragmented = (row.entries || []).length >= 4;
      const absenceConflict = !!row.absenceLabel && row.workedSeconds > 0;

      if (missingCheckout) {
        incidents.push({ label: 'Salida no registrada', employeeName: row.employeeName, meta: row.dayName });
        validations.push({ label: 'Revisar cierre de jornada', employeeName: row.employeeName, meta: row.dayName });
      }
      if (underworked) {
        incidents.push({ label: 'Jornada incompleta', employeeName: row.employeeName, meta: this.formatDurationCompact(row.workedSeconds) });
      }
      if (overtime) {
        incidents.push({ label: 'Posibles horas extra', employeeName: row.employeeName, meta: this.formatDurationCompact(row.workedSeconds) });
      }
      if (fragmented) {
        anomalies.push({ label: 'Día muy fragmentado', employeeName: row.employeeName, meta: `${row.entries.length} tramos` });
        validations.push({ label: 'Validar múltiples tramos', employeeName: row.employeeName, meta: row.dayName });
      }
      if (absenceConflict) {
        anomalies.push({ label: 'Ausencia con actividad', employeeName: row.employeeName, meta: row.absenceLabel });
        validations.push({ label: 'Cruce ausencia/fichaje', employeeName: row.employeeName, meta: row.dayName });
      }
    });

    // Filtrar solicitudes próximas si hay un usuario seleccionado
    let upcoming = this.buildUpcomingAbsenceItems();
    if (isSingleUser) {
      upcoming = upcoming.filter(u => String(u.employeeId) === selectedId);
    }

    const complianceBase = rows.filter(r => r.theoreticSeconds > 0);
    const compliancePct = complianceBase.length
      ? Math.round(complianceBase.reduce((acc, row) => acc + Math.min(100, Math.round((row.workedSeconds / row.theoreticSeconds) * 100)), 0) / complianceBase.length)
      : 0;

    // --- ACTUALIZACIÓN DEL RADAR ---
    const radarList = document.getElementById('radar-list');
    if (radarList) {
      radarList.innerHTML = '';
      if (isSingleUser) {
        // MODO INDIVIDUAL: Mostrar estado detallado del seleccionado
        const emp = STATE.allEmployees.get(selectedId);

        if (emp) {
          const status = this.getCurrentActivityKind(selectedId, rows);
          const isWorking = status === 'working' || status === 'remote';
          const isPaused = status === 'paused';

          const dotColor = isWorking ? '#22c55e' : (isPaused ? '#f59e0b' : '#ef4444');
          const statusText = isWorking ? 'Trabajando' : (isPaused ? 'En pausa' : 'Desconectado');

          radarList.innerHTML = `
            <div class="radar-status-card">
              <div class="radar-status-head">
                <div class="radar-status-dot" style="--radar-color:${dotColor};"></div>
                <strong>${statusText}</strong>
              </div>
              <div class="radar-status-copy">
                ${isWorking ? 'Actualmente registrando jornada laboral.' : (isPaused ? 'El empleado ha pausado su jornada.' : 'No hay actividad en tiempo real registrada hoy.')}
              </div>
            </div>
          `;
        }
      } else {
        // MODO EQUIPO: Lista de compañeros activos (Radar original)
        const meId = String(STATE.currentUser?.id || '');
        const activePeers = Array.from(STATE.allEmployees.values())
          .map(emp => ({ emp, status: this.getCurrentActivityKind(emp.id, rows) }))
          .filter(({ emp, status }) => emp.id && String(emp.id) !== meId && status !== 'out')
          .sort((a, b) => {
            const rank = getPresenceRank(b.status) - getPresenceRank(a.status);
            if (rank !== 0) return rank;
            return (a.emp.firstName || '').localeCompare(b.emp.firstName || '');
          });

        if (activePeers.length === 0) {
          radarList.innerHTML = '<div class="insight-empty">Nadie conectado en la empresa.</div>';
        } else {
          radarList.innerHTML = activePeers.slice(0, 5).map(({ emp, status }) => {
            const isWorking = status === 'working' || status === 'remote';
            const dotColor = isWorking ? '#22c55e' : '#f59e0b';
            const safePeerName = escapeHTML(`${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Empleado');
            return `
              <div class="insight-line">
                <div class="radar-peer-main">
                  <div class="radar-peer-dot" style="--radar-color:${dotColor};"></div>
                  <span>${safePeerName}</span>
                </div>
                <span class="radar-peer-state">${isWorking ? 'Trabajando' : 'Pausa'}</span>
              </div>
            `;
          }).join('');
        }
      }
    }

    // Actualizar contadores y cuerpos
    const liveCount = Array.from(STATE.allEmployees.values())
      .filter(emp => this.getCurrentActivityKind(emp.id, rows) !== 'out').length;

    const setBadge = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    const setBody = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

    setBadge('insight-incidencias-count', incidents.length);
    setBadge('insight-validaciones-count', validations.length);
    setBadge('insight-anomalias-count', anomalies.length);
    setBadge('insight-solicitudes-count', upcoming.length);

    // --- CÁLCULO DE PATRONES REACTIVOS (Hora Media / Jornada Larga) ---
    const targetPatternId = isSingleUser ? selectedId : String(STATE.currentUser?.id || '');
    const patternData = (this.data || []).filter(d => String(d.employeeId) === targetPatternId && !d.isGhost && !d.isLive);

    let avgIn = '--:--';
    let maxDay = '--';

    if (patternData.length > 0) {
      let totalMins = 0, validIns = 0, maxSeconds = -1, maxDate = '';
      patternData.forEach(d => {
        const firstEntry = d.entries && d.entries.find(e => e.in && e.in !== '--:--' && e.type === 'work');
        if (firstEntry) {
          const [h, m] = firstEntry.in.split(':').map(Number);
          if (!isNaN(h) && !isNaN(m)) { totalMins += (h * 60 + m); validIns++; }
        }
        if (d.workedSeconds > maxSeconds) { maxSeconds = d.workedSeconds; maxDate = d.dayName; }
      });
      if (validIns > 0) {
        const avgMins = Math.round(totalMins / validIns);
        avgIn = `${String(Math.floor(avgMins/60)).padStart(2,'0')}:${String(avgMins%60).padStart(2,'0')}`;
      }
      if (maxSeconds > 0) {
        maxDay = `${maxDate} (${Math.floor(maxSeconds/3600)}h ${Math.floor((maxSeconds%3600)/60)}m)`;
      }
    }
    const elAvg = document.getElementById('pattern-avg-in');
    const elMax = document.getElementById('pattern-max-day');
    if (elAvg) elAvg.textContent = avgIn;
    if (elMax) elMax.textContent = maxDay;

    // --- CUERPOS DE INSIGHTS ---
    setBody('insight-incidencias-body', incidents.length ? `
      ${incidents.slice(0, 4).map(item => `
        <div class="insight-line">
          <div><strong>${escapeHTML(item.label)}</strong><br><span>${escapeHTML(item.employeeName)}</span></div>
          <span class="insight-tag warning">${escapeHTML(item.meta)}</span>
        </div>
      `).join('')}
    ` : `<div class="insight-empty">Sin incidencias en este rango.</div>`);

    setBody('insight-validaciones-body', validations.length ? `
      ${validations.slice(0, 4).map(item => `
        <div class="insight-line">
          <div><strong>${escapeHTML(item.label)}</strong><br><span>${escapeHTML(item.employeeName)}</span></div>
          <span class="insight-tag danger">${escapeHTML(item.meta)}</span>
        </div>
      `).join('')}
    ` : `<div class="insight-empty">Todo validado correctamente.</div>`);

    setBody('insight-anomalias-body', `
      <div class="insight-kpi">
        <div class="insight-kpi-item">
          <span class="label">Cumplimiento</span>
          <span class="value">${compliancePct}%</span>
        </div>
        <div class="insight-kpi-item">
          <span class="label">En vivo</span>
          <span class="value">${isSingleUser ? (rows.some(r=>r.isLive) ? 'SÍ' : 'NO') : liveCount}</span>
        </div>
        <div class="insight-kpi-item">
          <span class="label">Fragmentados</span>
          <span class="value">${anomalies.filter(a => a.label === 'Día muy fragmentado').length}</span>
        </div>
        <div class="insight-kpi-item">
          <span class="label">Cruces</span>
          <span class="value">${anomalies.filter(a => a.label === 'Ausencia con actividad').length}</span>
        </div>
      </div>
    `);

    setBody('insight-solicitudes-body', upcoming.length ? `
      ${upcoming.map(item => `
        <div class="insight-line">
          <div><strong>${escapeHTML(item.employeeName)}</strong><br><span>${escapeHTML(item.typeName)}</span></div>
          <span class="insight-tag success">${escapeHTML(item.date)}</span>
        </div>
      `).join('')}
    ` : `<div class="insight-empty">Sin ausencias próximas para este perfil.</div>`);
  },

  buildBalanceEmployeeSummary(employeeId) {
    const id = String(employeeId || '');
    const info = this.getBalanceEmployeeInfo(id);
    const rows = (this.data || [])
      .filter(row => String(row.employeeId) === id)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const clockToMinutes = value => {
      const raw = String(value || '');
      if (!raw) return null;
      if (raw.includes('T')) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
          return (parsed.getHours() * 60) + parsed.getMinutes() + (parsed.getSeconds() / 60);
        }
      }
      const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (!match) return null;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3] || 0);
      if (![hours, minutes, seconds].every(Number.isFinite)) return null;
      return (hours * 60) + minutes + (seconds / 60);
    };
    const isVacationLabel = label => /vacaciones|vacation/i.test(String(label || ''));

    const totals = rows.reduce((acc, row) => {
      const worked = Number(row.workedSeconds || 0);
      const compensated = Number(row.compensatedSeconds || 0);
      const equivalent = Number(row.totalEquivalentSeconds ?? (worked + compensated));
      const theoretic = Number(row.theoreticSeconds || 0);
      const entries = Array.isArray(row.entries) ? row.entries : [];
      const workEntries = entries.filter(entry => entry?.type === 'work');
      const firstWorkIn = workEntries
        .map(entry => clockToMinutes(entry.inOriginal) ?? clockToMinutes(entry.in))
        .find(minutes => minutes !== null);
      const lastWorkOut = workEntries
        .slice()
        .reverse()
        .map(entry => clockToMinutes(entry.outOriginal) ?? clockToMinutes(entry.out))
        .find(minutes => minutes !== null);
      const absenceSegments = Array.isArray(row.absenceSegments) ? row.absenceSegments : [];
      const absenceLabels = absenceSegments
        .map(segment => segment?.label || segment?.typeName || segment?.name)
        .filter(Boolean);
      if (!absenceLabels.length && row.absenceLabel) absenceLabels.push(row.absenceLabel);

      acc.worked += worked;
      acc.compensated += compensated;
      acc.compensatedApplied += Number(row.compensatedAppliedToTheoretic || 0);
      acc.equivalent += equivalent;
      acc.theoretic += theoretic;
      acc.balance += Number(row.balanceSec || 0);
      acc.pause += Number(row.totalPauseSec || 0);
      acc.workSegments += Number(row.workSegments || 0);
      acc.pauseSegments += Number(row.pauseSegments || 0);
      acc.entries += entries.length;
      if (worked > 0) acc.workedDays += 1;
      if (theoretic > 0) acc.theoreticDays += 1;
      if (firstWorkIn !== null) {
        acc.entryMinutes += firstWorkIn;
        acc.entryCount += 1;
      }
      if (lastWorkOut !== null) {
        acc.exitMinutes += lastWorkOut;
        acc.exitCount += 1;
      }
      absenceLabels.forEach(label => acc.absences.add(label));
      acc.absenceEvents += absenceSegments.length || (row.absenceLabel ? 1 : 0);
      acc.vacationEvents += absenceLabels.filter(isVacationLabel).length;
      if (Array.isArray(row.compensatedItems)) {
        row.compensatedItems.forEach(item => acc.compensatedItems.push({ ...item, date: item.date || row.date }));
      }
      if (row.isLive) acc.liveDays += 1;
      return acc;
    }, {
      worked: 0,
      compensated: 0,
      compensatedApplied: 0,
      equivalent: 0,
      theoretic: 0,
      balance: 0,
      pause: 0,
      workSegments: 0,
      pauseSegments: 0,
      entries: 0,
      workedDays: 0,
      theoreticDays: 0,
      entryMinutes: 0,
      entryCount: 0,
      exitMinutes: 0,
      exitCount: 0,
      absences: new Set(),
      absenceEvents: 0,
      vacationEvents: 0,
      compensatedItems: [],
      liveDays: 0
    });

    const official = this.officialHoursBagMap?.get(id) || null;
    const history = this.hoursBagRuleHistoryMap?.get(id) || null;
    const bagAdjustment = Number(history?.adjustmentSeconds || 0);
    const localAdjustedBalance = totals.balance + bagAdjustment;
    const officialBalance = official?.secondsBalance ?? official?.periodBalance ?? null;
    const calendarSummary = this.balanceCalendarSummaryMap?.get(id) || null;
    const absenceLabels = new Set(totals.absences);
    if (calendarSummary?.labels) {
      calendarSummary.labels.forEach(label => absenceLabels.add(label));
    }

    return {
      employeeId: id,
      name: info.name,
      photo: info.photo,
      annualBalance: info.annualBalance,
      rows,
      worked: totals.worked,
      compensated: totals.compensated,
      compensatedApplied: totals.compensatedApplied,
      equivalent: totals.equivalent,
      theoretic: totals.theoretic,
      localBaseBalance: totals.balance,
      bagAdjustment,
      localAdjustedBalance,
      officialBalance,
      officialWorked: official?.secondsWorked ?? official?.workedSeconds ?? null,
      officialTheoretic: official?.secondsToWork ?? official?.theoreticSeconds ?? null,
      source: officialBalance !== null ? 'Sesame Statistics' : (bagAdjustment ? 'Local + bolsa' : 'Calculado local'),
      pause: totals.pause,
      workSegments: totals.workSegments,
      pauseSegments: totals.pauseSegments,
      entries: totals.entries,
      workedDays: totals.workedDays,
      theoreticDays: totals.theoreticDays,
      averageEntryMinutes: totals.entryCount ? Math.floor(totals.entryMinutes / totals.entryCount) : null,
      averageExitMinutes: totals.exitCount ? Math.floor(totals.exitMinutes / totals.exitCount) : null,
      averageWorkdaySeconds: totals.workedDays ? Math.round(totals.worked / totals.workedDays) : 0,
      averagePauseSeconds: totals.pauseSegments ? Math.round(totals.pause / totals.pauseSegments) : 0,
      absences: Array.from(absenceLabels),
      absenceEvents: calendarSummary ? Number(calendarSummary.absenceEvents || 0) : totals.absenceEvents,
      vacationEvents: calendarSummary ? Number(calendarSummary.vacationEvents || 0) : totals.vacationEvents,
      compensatedItems: totals.compensatedItems,
      liveDays: totals.liveDays,
      history
    };
  },

  openBalanceEmployeeModal(employeeId) {
    const summary = this.buildBalanceEmployeeSummary(employeeId);
    const formatSigned = seconds => {
      const value = Number(seconds || 0);
      const h = Math.floor(Math.abs(value) / 3600);
      const m = Math.floor((Math.abs(value) % 3600) / 60);
      return `${value >= 0 ? '+' : '-'}${h}h ${m}m`;
    };
    const formatDuration = seconds => this.formatDurationCompact(Number(seconds || 0));
    const balanceUsed = summary.officialBalance ?? summary.localAdjustedBalance;
    const workedUsed = summary.officialWorked ?? summary.worked;
    const theoreticUsed = summary.officialTheoretic ?? summary.theoretic;
    const balanceTone = balanceUsed > 0 ? 'positive' : balanceUsed < 0 ? 'negative' : 'neutral';
    const safeName = escapeHTML(summary.name);
    const safePhoto = safeHttpUrlAttr(summary.photo);
    const initials = escapeHTML(getInitials(summary.name));
    const { start, end } = this.getCurrentRangeKeys();
    const lastRowDate = summary.rows
      .map(row => normalizeDateKey(row.date))
      .filter(Boolean)
      .sort()
      .pop();
    const todayKey = getLocalDateKey();
    const effectiveEnd = this.currentView === 'balance' && !this.isBalanceMonthScope()
      ? (start <= todayKey && todayKey <= end ? todayKey : (lastRowDate || end))
      : end;
    const safeRange = escapeHTML(`${start} - ${effectiveEnd}`);
    const scopeLabel = this.currentView === 'balance'
      ? (this.isBalanceMonthScope() ? 'mes' : 'ejercicio')
      : 'periodo';
    const scopeTitle = this.currentView === 'balance'
      ? (this.isBalanceMonthScope() ? 'Balance del mes' : 'Balance del ejercicio')
      : 'Balance del periodo';
    const completionPct = summary.theoretic > 0
      ? Math.min(140, Math.round((summary.equivalent / summary.theoretic) * 100))
      : 0;
    const formatClock = minutes => {
      if (minutes === null || minutes === undefined) return '--';
      const normalized = Math.max(0, Math.floor(Number(minutes) || 0));
      return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')} h`;
    };
    const formatDayTitle = row => {
      const dateKey = String(row?.date || '');
      const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return row?.dayName || dateKey || 'Dia';
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      const label = date.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });
      return label.charAt(0).toUpperCase() + label.slice(1);
    };
    const dayRowsHtml = summary.rows.length ? summary.rows.map((row, index) => {
      const entriesHtml = (row.entries || []).map(entry => {
        const type = entry.type === 'pause' ? 'Pausa' : (entry.typeLabel || 'Trabajo');
        return `
          <div class="balance-day-entry">
            <span>${escapeHTML(entry.in || '--:--')} - ${escapeHTML(entry.out || '--:--')}</span>
            <strong>${escapeHTML(entry.duration || '--')}</strong>
            <em>${escapeHTML(type)}</em>
          </div>
        `;
      }).join('');
      const openAttr = index === 0 ? ' open' : '';
      return `
        <details class="balance-day-card"${openAttr}>
          <summary class="balance-day-head">
            <div>
              <strong>${escapeHTML(formatDayTitle(row))}</strong>
              ${row.absenceLabel ? `<span>${escapeHTML(row.absenceLabel)}</span>` : ''}
            </div>
            <b class="${Number(row.balanceSec || 0) >= 0 ? 'positive' : 'negative'}">${formatSigned(row.balanceSec)}</b>
            <span class="balance-day-toggle">Detalles</span>
          </summary>
          <div class="balance-day-metrics">
            <span>Trabajo ${formatDuration(row.workedSeconds)}</span>
            <span>Teorico ${formatDuration(row.theoreticSeconds)}</span>
            <span>Pausas ${formatDuration(row.totalPauseSec)}</span>
          </div>
          <div class="balance-day-entries">${entriesHtml || '<span class="balance-empty-line">Sin tramos detallados</span>'}</div>
        </details>
      `;
    }).join('') : '<div class="balance-empty-line">No hay jornadas locales cargadas para este periodo.</div>';
    const compensatedRowsHtml = summary.compensatedItems.length ? summary.compensatedItems.map(item => {
      const seconds = Number(item.seconds || 0);
      const timeLabel = item.startTime && item.endTime
        ? `${String(item.startTime).slice(0,5)} - ${String(item.endTime).slice(0,5)}`
        : 'Sin tramo horario';
      return `
        <div class="balance-compensated-line">
          <span>${escapeHTML(item.date || '')}</span>
          <strong>${formatDuration(seconds)}</strong>
          <em>${escapeHTML(item.label || 'Ausencia retribuida')} · ${escapeHTML(timeLabel)}</em>
        </div>
      `;
    }).join('') : '<span class="balance-empty-line">Sin ajustes retribuidos de jornada en el periodo.</span>';

    const overlay = document.createElement('div');
    overlay.className = 'contact-card-overlay balance-employee-overlay';
    overlay.innerHTML = `
      <div class="balance-employee-modal animate-pop" role="dialog" aria-modal="true" aria-label="Detalle de balance de ${safeName}">
        <button class="contact-card-close balance-employee-close" type="button" aria-label="Cerrar detalle">&times;</button>
        <div class="balance-employee-hero">
          <div class="balance-employee-avatar">
            ${safePhoto ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer">` : initials}
          </div>
          <div class="balance-employee-title">
            <span>${scopeTitle}</span>
            <h2>${safeName}</h2>
            <p>${safeRange} · ${summary.rows.length} jornadas · ${summary.source}</p>
          </div>
          <div class="balance-employee-score ${balanceTone}">
            <small>Balance usado</small>
            <strong>${formatSigned(balanceUsed)}</strong>
          </div>
        </div>

        <div class="balance-employee-body">
          <div class="balance-kpi-grid">
            <div class="balance-kpi"><span>Trabajado</span><strong>${formatDuration(workedUsed)}</strong></div>
            <div class="balance-kpi"><span>Teorico</span><strong>${formatDuration(theoreticUsed)}</strong></div>
            <div class="balance-kpi"><span>Ajuste jornada</span><strong>${formatDuration(summary.compensated)}</strong></div>
            <div class="balance-kpi"><span>Pausas</span><strong>${formatDuration(summary.pause)}</strong></div>
          </div>

          <div class="balance-modal-section">
            <div class="balance-modal-section-head">
              <strong>Resumen del periodo</strong>
              <span>Indicadores locales equivalentes al portal</span>
            </div>
            <div class="balance-period-grid">
              <div><span>Entrada media</span><strong>${formatClock(summary.averageEntryMinutes)}</strong></div>
              <div><span>Salida media</span><strong>${formatClock(summary.averageExitMinutes)}</strong></div>
              <div><span>Jornada media</span><strong>${formatDuration(summary.averageWorkdaySeconds)}</strong></div>
              <div><span>Días trabajados</span><strong>${summary.workedDays} / ${summary.theoreticDays}</strong></div>
              <div><span>Descansos</span><strong>${summary.pauseSegments}</strong></div>
              <div><span>Prom. descanso</span><strong>${summary.pauseSegments ? formatDuration(summary.averagePauseSeconds) : '--'}</strong></div>
              <div><span>Ausencias</span><strong>${summary.absenceEvents}</strong></div>
              <div><span>Vacaciones</span><strong>${summary.vacationEvents}</strong></div>
            </div>
          </div>

          <div class="balance-modal-section">
            <div class="balance-modal-section-head">
              <strong>Comparativa de balance</strong>
              <span>${completionPct}% de cumplimiento equivalente del ${scopeLabel}</span>
            </div>
            <div class="balance-compare-grid">
              <div><span>Base local</span><strong>${formatSigned(summary.localBaseBalance)}</strong></div>
              <div><span>Ajuste bolsa</span><strong>${formatSigned(summary.bagAdjustment)}</strong></div>
              <div><span>Local ajustado</span><strong>${formatSigned(summary.localAdjustedBalance)}</strong></div>
              <div><span>Sesame Statistics</span><strong>${summary.officialBalance !== null ? formatSigned(summary.officialBalance) : '--'}</strong></div>
              <div><span>Trabajo Sesame</span><strong>${summary.officialWorked !== null ? formatDuration(summary.officialWorked) : '--'}</strong></div>
              <div><span>Teorico Sesame</span><strong>${summary.officialTheoretic !== null ? formatDuration(summary.officialTheoretic) : '--'}</strong></div>
            </div>
          </div>

          <div class="balance-modal-section">
            <div class="balance-modal-section-head">
              <strong>Actividad</strong>
              <span>${summary.entries} fichajes · ${summary.workSegments} trabajo · ${summary.pauseSegments} pausas</span>
            </div>
            <div class="balance-activity-strip">
              <span>Ausencias: ${summary.absences.length ? escapeHTML(summary.absences.join(', ')) : 'Sin ausencias en el periodo'}</span>
              <span>Bolsa: ${summary.history?.itemsCount || 0} eventos</span>
              <span>En vivo: ${summary.liveDays}</span>
            </div>
          </div>

          <div class="balance-modal-section">
            <div class="balance-modal-section-head">
              <strong>Ajustes de jornada retribuidos</strong>
              <span>${formatDuration(summary.compensated)} detectado · ${formatDuration(summary.compensatedApplied)} aplicado</span>
            </div>
            <div class="balance-compensated-list">${compensatedRowsHtml}</div>
          </div>

          <div class="balance-modal-section">
            <div class="balance-modal-section-head">
              <strong>Jornadas y fichajes</strong>
              <span>${summary.rows.length} dias · abre cada jornada</span>
            </div>
            <div class="balance-days-list">${dayRowsHtml}</div>
          </div>
        </div>
      </div>
    `;

    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close();
    };
    overlay.querySelector('.balance-employee-close')?.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    overlay.querySelectorAll('.balance-day-card').forEach(card => {
      card.addEventListener('toggle', () => {
        if (!card.open) return;
        window.setTimeout(() => {
          card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 80);
      });
    });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
    const pinModalTop = () => {
      overlay.scrollTop = 0;
      const modal = overlay.querySelector('.balance-employee-modal');
      const body = overlay.querySelector('.balance-employee-body');
      if (modal) modal.scrollTop = 0;
      if (body) body.scrollTop = 0;
    };
    pinModalTop();
    requestAnimationFrame(pinModalTop);
    window.setTimeout(pinModalTop, 80);
    overlay.querySelector('.balance-employee-close')?.focus({ preventScroll: true });
    pinModalTop();
  },

  /**
   * Renderiza una vista resumen de balances acumulados por empleado.
   */
  renderBalanceTable() {
    const tbody = document.getElementById('signings-tbody');
    if (!tbody) return;

    // Agregamos por empleado usando las mismas filas visibles del periodo activo.
    const stats = new Map();
    const balanceRows = this.getFilteredRows({ includePresenceFilter: false });

    balanceRows.forEach(row => {
      const rowId = String(row.employeeId);
      if (!stats.has(rowId)) {
        const empInfo = this.getBalanceEmployeeInfo(rowId);
        stats.set(rowId, {
          employeeId: rowId,
          name: empInfo.name,
          photo: empInfo.photo,
          periodBalance: 0,
          localPeriodBalance: 0,
          localBaseBalance: 0,
          localEquivalentSeconds: 0,
          localTheoreticSeconds: 0,
          annualBalance: empInfo.annualBalance,
          sources: new Set(),
          days: 0
        });
      }
      const stat = stats.get(rowId);
      stat.periodBalance += row.balanceSec;
      stat.localPeriodBalance += row.balanceSec;
      stat.localBaseBalance = (stat.localBaseBalance || 0) + row.balanceSec;
      stat.localEquivalentSeconds += Number(row.totalEquivalentSeconds || row.workedSeconds || 0);
      stat.localTheoreticSeconds += Number(row.theoreticSeconds || 0);
      stat.sources.add(row.theoreticSource || 'Estimado');
      stat.days += 1;
    });

    this.getBalanceEmployeeIds({ applySearch: true }).forEach(id => {
      const rowId = String(id);
      if (stats.has(rowId)) return;
      const empInfo = this.getBalanceEmployeeInfo(rowId);
      stats.set(rowId, {
        employeeId: rowId,
        name: empInfo.name,
        photo: empInfo.photo,
        periodBalance: 0,
        localPeriodBalance: 0,
        localBaseBalance: 0,
        localEquivalentSeconds: 0,
        localTheoreticSeconds: 0,
        annualBalance: empInfo.annualBalance,
        sources: new Set(),
        days: 0
      });
    });

    if (this.hoursBagRuleHistoryMap?.size) {
      this.hoursBagRuleHistoryMap.forEach((history, id) => {
        const rowId = String(id);
        const empInfo = this.getBalanceEmployeeInfo(rowId);
        const matchesEmployee = !this.selectedEmployee || this.selectedEmployee === 'all' || String(this.selectedEmployee) === rowId;
        const matchesSearch = !this.searchQuery || empInfo.name.toLowerCase().includes(String(this.searchQuery).toLowerCase());
        if (!matchesEmployee || !matchesSearch) return;

        if (!stats.has(rowId)) {
          stats.set(rowId, {
            employeeId: rowId,
            name: empInfo.name,
            photo: empInfo.photo,
            periodBalance: 0,
            localPeriodBalance: 0,
            localBaseBalance: 0,
            localEquivalentSeconds: 0,
            localTheoreticSeconds: 0,
            annualBalance: empInfo.annualBalance,
            sources: new Set(),
            days: 0
          });
        }

        const adjustment = Number(history.adjustmentSeconds || 0);
        if (!adjustment) return;
        const stat = stats.get(rowId);
        if (typeof stat.localBaseBalance !== 'number') stat.localBaseBalance = Number(stat.localPeriodBalance || 0);
        stat.localRuleAdjustmentSeconds = (stat.localRuleAdjustmentSeconds || 0) + adjustment;
        stat.localPeriodBalance += adjustment;
        stat.periodBalance += adjustment;
        stat.hoursBagRuleHistory = history;
        stat.sources.add('Bolsa Sesame');
      });
    }

    if (this.officialHoursBagMap?.size) {
      this.officialHoursBagMap.forEach((official, id) => {
        const empInfo = this.getBalanceEmployeeInfo(id);
        const name = official.employeeName || empInfo.name || `Empleado ${id}`;
        const matchesEmployee = !this.selectedEmployee || this.selectedEmployee === 'all' || String(this.selectedEmployee) === String(id);
        const matchesSearch = !this.searchQuery || name.toLowerCase().includes(String(this.searchQuery).toLowerCase());
        if (!matchesEmployee || !matchesSearch) return;

        if (!stats.has(id)) {
          stats.set(id, {
            employeeId: String(id),
            name,
            photo: empInfo.photo,
            periodBalance: 0,
            localPeriodBalance: 0,
            localBaseBalance: 0,
            localEquivalentSeconds: 0,
            localTheoreticSeconds: 0,
            annualBalance: empInfo.annualBalance,
            sources: new Set(),
            days: 0
          });
        }

        const stat = stats.get(id);
        const officialBalance = official.secondsBalance ?? official.periodBalance;
        if (typeof officialBalance === 'number') {
          stat.periodBalance = officialBalance;
          stat.hasOfficialBalance = true;
          stat.officialWorkedSeconds = official.secondsWorked ?? official.workedSeconds ?? null;
          stat.officialTheoreticSeconds = official.secondsToWork ?? official.theoreticSeconds ?? null;
          stat.officialCompensationSeconds = official.compensationSeconds ?? 0;
          stat.officialBalanceSeconds = officialBalance;
          stat.officialRawSource = official.rawSource || '/schedule/v1/reports/worked-hours';
          stat.officialQueryVariant = official.queryVariant || '';
          stat.sources = new Set(['Sesame Statistics']);
        }
      });
    }

    const rows = Array.from(stats.values()).sort((a, b) => {
      return a.periodBalance - b.periodBalance || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });

    const totalEquivalent = rows.reduce((sum, stat) => {
      if (stat.hasOfficialBalance && typeof stat.officialWorkedSeconds === 'number') {
        return sum + stat.officialWorkedSeconds;
      }
      return sum + Number(stat.localEquivalentSeconds || 0);
    }, 0);
    const totalTheoretic = rows.reduce((sum, stat) => {
      if (stat.hasOfficialBalance && typeof stat.officialTheoreticSeconds === 'number') {
        return sum + stat.officialTheoreticSeconds;
      }
      return sum + Number(stat.localTheoreticSeconds || 0);
    }, 0);
    const workedEl = document.getElementById('total-worked-hours');
    const theoreticEl = document.getElementById('total-theoretic-hours');
    if (workedEl) workedEl.textContent = this.formatDurationCompact(totalEquivalent);
    if (theoreticEl) theoreticEl.textContent = this.formatDurationCompact(totalTheoretic);

    if (rows.length === 0 && this.currentView === 'balance' && (this.isLoading || this.officialHoursBagLoading)) {
      this.renderBalanceEmptyLoading(tbody);
      return;
    }

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 40px; color: var(--text-muted);">No hay datos suficientes para calcular balances en este rango.</td></tr>';
      return;
    }

    const format = (sec) => {
      const h = Math.floor(Math.abs(sec) / 3600);
      const m = Math.floor((Math.abs(sec) % 3600) / 60);
      return (sec >= 0 ? '+' : '-') + `${h}h ${m}m`;
    };
    const progressState = this.officialHoursBagProgress || {};
    const scopeLabel = this.currentView === 'balance'
      ? (this.isBalanceMonthScope() ? 'mes' : 'ejercicio')
      : 'periodo';
    const officialCount = rows.filter(stat => stat.hasOfficialBalance).length;
    const pendingCount = this.officialHoursBagLoading
      ? Math.max(0, Number(progressState.pending || 0))
      : 0;
    const errorCount = rows.filter(stat => {
      return !stat.hasOfficialBalance && this.officialHoursBagErrors?.has(String(stat.employeeId));
    }).length;
    const adjustedLocalCount = rows.filter(stat => Number(stat.localRuleAdjustmentSeconds || 0) !== 0).length;
    const localCount = rows.filter(stat => {
      const rowId = String(stat.employeeId);
      const hasError = this.officialHoursBagErrors?.has(rowId);
      const isStillPending = this.officialHoursBagLoading && !stat.hasOfficialBalance && !hasError;
      return !stat.hasOfficialBalance && !hasError && !isStillPending;
    }).length;
    const endpointLabel = progressState.endpoint || '/schedule/v1/reports/worked-hours';
    const rangeLabel = progressState.range || `${this.getCurrentRangeKeys().start} -> ${this.getCurrentRangeKeys().end}`;
    const progressTotal = Math.max(1, Number(progressState.total || rows.length || 1));
    const progressDone = Math.min(progressTotal, Number(progressState.done || 0));
    const progressLabel = this.officialHoursBagLoading
      ? (progressState.phase === 'local'
          ? `Preparando rango ${scopeLabel}: ${rangeLabel}`
          : `Calculando balances ${progressDone}/${progressTotal}`)
      : `Balances procesados ${Number(progressState.done || rows.length)}/${Number(progressState.total || rows.length)}`;
    const progressPct = this.officialHoursBagLoading
      ? Math.max(4, Math.round((progressDone / progressTotal) * 100))
      : 100;
    const officialSkipped = this.isOfficialWorkedHoursSkipped();
    const phase = progressState.phase || (this.officialHoursBagLoading ? 'statistics' : 'done');
    const phaseLabel = phase === 'statistics'
      ? 'Consultando Sesame Statistics'
      : phase === 'history'
        ? 'Aplicando bolsa de horas'
        : phase === 'local'
          ? 'Preparando base local'
          : officialSkipped
            ? 'Modo cálculo local'
            : 'Balances listos';
    const phaseSteps = [
      { key: 'local', label: 'Base local' },
      { key: 'statistics', label: 'Statistics' },
      { key: 'history', label: 'Bolsa' },
      { key: 'done', label: 'Listo' }
    ];
    const phaseRank = { local: 0, statistics: 1, history: 2, done: 3 };
    const activeEmployeeIds = new Set((progressState.activeEmployeeIds || []).map(String));
    const activeIds = (progressState.activeEmployeeIds || []).length
      ? progressState.activeEmployeeIds
      : (this.officialHoursBagLoading ? (progressState.employeeIds || []).slice(0, 6) : []);
    const activePeopleHtml = activeIds.length ? `
            <div class="balance-load-people" aria-label="Empleados en proceso">
              <span>En curso</span>
              ${activeIds.slice(0, 6).map(id => {
                const info = this.getBalanceEmployeeInfo(id);
                return `<b title="${escapeHTML(info.name)}">${escapeHTML(info.name)}</b>`;
              }).join('')}
            </div>
    ` : '';
    const lastError = progressState.lastError || this.officialHoursBagError || '';
    const currentExerciseYear = new Date().getFullYear();
    const isCurrentExercise = this.currentDate.getFullYear() === currentExerciseYear && !this.isBalanceMonthScope();
    const exerciseButtonLabel = isCurrentExercise
      ? 'Recargar ejercicio actual'
      : `Ver ejercicio actual ${currentExerciseYear}`;
    const balanceScopeActionHtml = `
      <button
        type="button"
        class="btn-secondary balance-scope-btn"
        onclick="FichajesModule.goToCurrentExerciseBalance(true)"
        title="Ver el balance del ejercicio actual completo"
      >
        ${exerciseButtonLabel}
      </button>
    `;
    const sourceActionsHtml = officialSkipped
      ? '<button type="button" class="btn-secondary" onclick="FichajesModule.retryOfficialWorkedHours()" style="font-size:0.65rem; padding:4px 8px;">Probar Sesame Statistics</button>'
      : '<button type="button" class="btn-secondary" onclick="FichajesModule.useLocalBalanceOnly()" style="font-size:0.65rem; padding:4px 8px;">Usar solo cálculo local</button>';
    const useIndeterminateProgress = this.officialHoursBagLoading && (phase === 'local' || progressDone === 0);
    const progressTrackClass = useIndeterminateProgress
      ? 'balance-load-track balance-load-track-pending'
      : 'balance-load-track';
    const localPulsePct = Math.max(8, Math.min(96, Number(progressState.localPulse || 10)));
    const progressFillStyle = useIndeterminateProgress
      ? ` style="width:${localPulsePct}%;" data-pulse="${localPulsePct}"`
      : ` style="width:${progressPct}%;"`;
    const loadingPanelHtml = this.officialHoursBagLoading ? `
          <div class="balance-load-panel">
            <div class="balance-load-main">
              <strong class="balance-load-title">${escapeHTML(phaseLabel)}</strong>
              <span title="${escapeHTML(`${endpointLabel} · ${rangeLabel}`)}">${escapeHTML(progressLabel)}</span>
            </div>
            <div class="balance-load-metrics">
              <span><strong>${progressDone}</strong> procesados</span>
              <span><strong>${officialCount}</strong> Sesame</span>
              <span><strong>${pendingCount}</strong> pendientes</span>
            </div>
            <div class="${progressTrackClass}" aria-hidden="true">
              <div class="balance-load-fill"${progressFillStyle}></div>
            </div>
            <div class="balance-load-steps">
              ${phaseSteps.map(step => {
                const done = officialSkipped
                  ? step.key === 'local' || step.key === 'done'
                  : phaseRank[step.key] <= phaseRank[phase];
                const active = step.key === phase;
                return `<span class="balance-load-step ${done ? 'done' : ''} ${active ? 'active' : ''}">${escapeHTML(step.label)}</span>`;
              }).join('')}
            </div>
            ${activePeopleHtml}
          </div>
    ` : '';
    const sourceAuditHtml = `
      <tr class="balance-source-audit-row">
        <td colspan="5" style="padding: 10px 14px; background: rgba(45, 212, 191, 0.07); border-bottom: 1px solid rgba(45, 212, 191, 0.16);">
          ${loadingPanelHtml}
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:0.72rem; color:var(--text-muted); ${loadingPanelHtml ? 'margin-top:10px;' : ''}">
            <strong style="color:var(--text-primary); font-size:0.74rem;">Fuente del balance</strong>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span style="width:7px; height:7px; border-radius:50%; background:#2dd4bf;"></span>
              ${officialCount} Sesame Statistics
            </span>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span style="width:7px; height:7px; border-radius:50%; background:#f59e0b;"></span>
              ${localCount} calculado local
            </span>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span style="width:7px; height:7px; border-radius:50%; background:#94a3b8;"></span>
              ${pendingCount} pendientes
            </span>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span style="width:7px; height:7px; border-radius:50%; background:#60a5fa;"></span>
              ${adjustedLocalCount} ajuste bolsa
            </span>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span style="width:7px; height:7px; border-radius:50%; background:#f87171;"></span>
              ${errorCount} error/sin datos
            </span>
            ${officialSkipped ? '<span style="color:#f59e0b;">Modo local manual</span>' : ''}
            ${lastError && !officialSkipped ? `<span title="${escapeHTML(lastError)}" style="color:#f59e0b;">Ultimo error resumido</span>` : ''}
            <span class="balance-source-actions">
              ${balanceScopeActionHtml}
              ${sourceActionsHtml}
            </span>
          </div>
        </td>
      </tr>
    `;

    tbody.innerHTML = sourceAuditHtml + rows.map(stat => {

      const balanceTone = stat.periodBalance > 0
        ? { color: '#4ade80', label: 'Superávit' }
        : stat.periodBalance < 0
          ? { color: '#f87171', label: 'Déficit' }
          : { color: '#60a5fa', label: 'Cuadrado' };
      const mColor = balanceTone.color;
      const hasAnnualBalance = typeof stat.annualBalance === 'number';
      const aColor = !hasAnnualBalance ? 'var(--text-muted)' : (stat.annualBalance >= 0 ? '#4ade80' : '#f87171');
      const sourceList = Array.from(stat.sources);
      const officialError = this.officialHoursBagErrors?.get(String(stat.employeeId)) || '';
      const isPending = this.officialHoursBagLoading && !stat.hasOfficialBalance && !officialError;
      const localRuleAdjustment = Number(stat.localRuleAdjustmentSeconds || 0);
      const hasLocalRuleAdjustment = localRuleAdjustment !== 0;
      const ruleNames = Array.isArray(stat.hoursBagRuleHistory?.ruleNames)
        ? stat.hoursBagRuleHistory.ruleNames.filter(Boolean).join(', ')
        : '';
      const sourceLabel = stat.hasOfficialBalance
        ? 'Sesame Statistics'
        : isPending
          ? 'Pendiente'
          : officialError
            ? 'Fallback local'
            : hasLocalRuleAdjustment
              ? 'Calculado + bolsa Sesame'
            : sourceList.length === 0
              ? 'Sin fichajes'
              : sourceList.length === 1
                ? sourceList[0]
                : sourceList.includes('Estimado')
                  ? 'Mixto/estimado'
                  : 'Mixto';
      const sourceColor = sourceLabel.startsWith('Sesame Statistics') || sourceLabel.startsWith('Sesame BI')
        ? '#2dd4bf'
        : sourceLabel === 'Pendiente'
          ? '#94a3b8'
        : sourceLabel === 'Estimado' || sourceLabel === 'Mixto/estimado'
          ? '#f59e0b'
          : sourceLabel === 'Fallback local'
            ? '#f59e0b'
            : sourceLabel === 'Calculado + bolsa Sesame'
              ? '#60a5fa'
              : '#60a5fa';
      const annualTitle = hasAnnualBalance
        ? 'Acumulado horario devuelto por el perfil de Sesame'
        : 'Sesame no ha devuelto acumulado horario para este empleado';
      const sourceBadgeLabel = stat.hasOfficialBalance
        ? 'Sesame Statistics'
        : isPending
          ? 'Pendiente'
          : officialError
            ? 'Fallback local'
            : hasLocalRuleAdjustment
              ? 'Local + bolsa'
              : 'Calculado local';
      const sourceBadgeColor = stat.hasOfficialBalance ? '#2dd4bf' : (isPending ? '#94a3b8' : (hasLocalRuleAdjustment ? '#60a5fa' : '#f59e0b'));
      const rowId = String(stat.employeeId);
      const rowIsActive = activeEmployeeIds.has(rowId);
      const rowIsLoading = this.officialHoursBagLoading && (isPending || rowIsActive);
      const rowPhaseLabel = rowIsActive
        ? (phase === 'local'
            ? 'Preparando base...'
            : phase === 'history'
              ? 'Aplicando bolsa...'
              : 'Consultando Sesame...')
        : stat.hasOfficialBalance
          ? 'Confirmado por Sesame'
          : hasLocalRuleAdjustment
            ? 'Ajustado con bolsa'
            : isPending
              ? 'En cola'
              : officialError
                ? 'Fallback local'
                : 'Base local';
      const rowClass = [
        'balance-row',
        rowIsLoading ? 'is-loading' : '',
        rowIsActive ? 'is-active' : '',
        stat.hasOfficialBalance ? 'has-official' : '',
        hasLocalRuleAdjustment ? 'has-bag-adjustment' : '',
        officialError ? 'has-error' : ''
      ].filter(Boolean).join(' ');
      const localComparison = stat.hasOfficialBalance && stat.days > 0
        ? ` Calculo local ajustado para comparar: ${format(stat.localPeriodBalance)}. Diferencia Sesame-local: ${format(stat.periodBalance - stat.localPeriodBalance)}.`
        : '';
      const localBreakdown = [
        `Balance local base: ${format(stat.localBaseBalance ?? stat.localPeriodBalance)}.`,
        hasLocalRuleAdjustment ? `Ajuste bolsa Sesame: ${format(localRuleAdjustment)}.` : 'Ajuste bolsa Sesame: 0h 0m.',
        hasLocalRuleAdjustment && ruleNames ? `Reglas: ${ruleNames}.` : '',
        hasLocalRuleAdjustment ? `Eventos bolsa: ${stat.hoursBagRuleHistory?.itemsCount || 0}.` : '',
        `Balance local ajustado: ${format(stat.localPeriodBalance)}.`
      ].filter(Boolean).join(' ');
      const officialDiagnostics = stat.hasOfficialBalance
        ? [
            `Balance usado: ${format(stat.periodBalance)}.`,
            `Fuente usada: Sesame Statistics.`,
            localBreakdown,
            `Balance Sesame Statistics: ${format(stat.officialBalanceSeconds ?? stat.periodBalance)}.`,
            `Variante consulta: ${stat.officialQueryVariant || 'no indicada'}.`,
            `secondsWorked oficial: ${stat.officialWorkedSeconds ?? 'no disponible'}.`,
            `secondsToWork oficial: ${stat.officialTheoreticSeconds ?? 'no disponible'}.`,
            `secondsBalance oficial: ${stat.officialBalanceSeconds ?? stat.periodBalance}.`
          ].join(' ')
        : [
            `Balance usado: ${format(stat.periodBalance)}.`,
            `Fuente usada: ${sourceBadgeLabel}.`,
            localBreakdown,
            officialError ? `Error API: ${officialError}.` : '',
            this.hoursBagRuleHistoryError ? `Error bolsa: ${this.hoursBagRuleHistoryError}.` : '',
            isPending ? 'Sesame Statistics pendiente de respuesta.' : ''
          ].filter(Boolean).join(' ');
      const sourceTitle = sourceLabel === 'Mixto/estimado'
        ? `Teórico calculado con varias fuentes (${sourceList.join(', ')}). Revisa los días estimados si necesitas auditoría exacta.`
        : stat.hasOfficialBalance
          ? `Balance oficial devuelto por Sesame Statistics (${stat.officialRawSource || '/schedule/v1/reports/worked-hours'}) para este ${scopeLabel}.${localComparison} ${officialDiagnostics}`
          : isPending
            ? `Cargando balance oficial desde Sesame Statistics. Mientras tanto se muestra el cálculo local. ${officialDiagnostics}`
            : `Balance calculado localmente porque Sesame Statistics no devolvió balance oficial para este empleado en este ${scopeLabel}. Fuente del teórico: ${sourceLabel}. ${officialDiagnostics}`;
      const daysLabel = stat.days > 0 ? stat.days : (stat.hasOfficialBalance ? 'Of.' : '0');
      const daysTitle = stat.days > 0
        ? `${stat.days} dias con fichaje en el periodo`
        : stat.hasOfficialBalance
          ? 'Fila creada desde Sesame Statistics'
          : 'Fila base sin fichajes locales en el periodo';

      // Progresión visual (0.5 es neutro, escala +- 20h)
      const progress = Math.min(100, Math.max(0, 50 + (stat.periodBalance / 72000) * 50));

      return `
        <tr class="${rowClass}">
          <td>
            <div class="balance-employee-cell">
              <button type="button" class="balance-avatar-trigger" data-employee-id="${escapeHTML(rowId)}" title="Ver resumen ampliado de ${escapeHTML(stat.name)}">
                ${renderLocalAvatar(stat.name, stat.photo, 'balance-avatar', 'width:32px; height:32px; border-radius:50%; object-fit:cover; border: 1px solid var(--border);')}
              </button>
              <div class="balance-employee-main">
                <span class="balance-employee-name-line" title="${escapeHTML(stat.name)}">${escapeHTML(stat.name)}</span>
                <span class="balance-row-processing">${escapeHTML(rowPhaseLabel)}</span>
              </div>
              <span class="balance-days-pill" title="${escapeHTML(daysTitle)}">${escapeHTML(String(daysLabel))}</span>
            </div>
          </td>
          <td class="text-center">
            <div style="display:inline-flex; flex-direction:column; align-items:center; gap:4px;" title="${escapeHTML(sourceTitle)}">
              <span style="font-size: 1.1rem; font-weight: 800; color: ${mColor}">${format(stat.periodBalance)}</span>
              <span style="display:inline-flex; align-items:center; gap:5px; padding:2px 7px; border-radius:999px; border:1px solid ${sourceBadgeColor}40; background:${sourceBadgeColor}17; color:${sourceBadgeColor}; font-size:0.58rem; font-weight:900; text-transform:uppercase; letter-spacing:0.4px;">
                <span style="width:5px; height:5px; border-radius:50%; background:${sourceBadgeColor};"></span>
                ${sourceBadgeLabel}
              </span>
            </div>
          </td>
          <td class="text-center">
            <span title="${escapeHTML(annualTitle)}" style="font-size: 0.95rem; font-weight: 500; color: ${aColor}; opacity: 0.8">${hasAnnualBalance ? format(stat.annualBalance) : '--'}</span>
          </td>
          <td class="text-center">
             <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:20px; background:${mColor}15; border: 1px solid ${mColor}30; color:${mColor}; font-size:0.65rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
               <span style="width:6px; height:6px; border-radius:50%; background:${mColor}"></span>
               ${balanceTone.label}
             </div>
          </td>
          <td style="vertical-align: middle;">
            <div style="height:6px; width:100%; background:rgba(255,255,255,0.05); border-radius:3px; position:relative; overflow:hidden;">
              <div style="position:absolute; left:0; top:0; height:100%; width:${progress}%; background:${mColor}; opacity:0.5; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
              <div style="position:absolute; left:50%; top:0; height:100%; width:1px; background:rgba(255,255,255,0.2);"></div>
            </div>
            <div title="${escapeHTML(sourceTitle)}" style="margin-top:6px; display:inline-flex; align-items:center; gap:5px; color:${sourceColor}; font-size:0.62rem; font-weight:800; text-transform:uppercase; letter-spacing:0.4px;">
              <span style="width:5px; height:5px; border-radius:50%; background:${sourceColor};"></span>
              ${escapeHTML(sourceLabel)}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    tbody.querySelectorAll('.balance-avatar-trigger').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.openBalanceEmployeeModal(button.dataset.employeeId);
      });
    });
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

  const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Empleado';
  const safeFullName = escapeHTML(fullName);
  const safeFirstName = escapeHTML(emp.firstName || fullName);
  const safeJobTitle = escapeHTML(emp.jobTitle || 'Empleado');
  const safePhoto = safeHttpUrlAttr(emp.imageProfileURL);
  const initials = escapeHTML(getInitials(fullName));
  const emailHref = safeMailHref(emp.email);
  const phoneHref = safeTelHref(emp.phone);
  const safeEmail = escapeHTML(emp.email || '');
  const safePhone = escapeHTML(emp.phone || '');
  const activeCompanyName = STATE.companies.find(c => String(c.companyId || c.id) === String(STATE.companyId))?.name || 'Mi Empresa';
  const safeCompanyName = escapeHTML(activeCompanyName);
  const birthDate = emp.birthDate ? new Date(emp.birthDate) : null;
  const hiringDate = emp.hiringDate ? new Date(emp.hiringDate) : null;
  const safeBirthLabel = birthDate && !isNaN(birthDate.getTime())
    ? escapeHTML(birthDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }))
    : '';
  const safeHiringLabel = hiringDate && !isNaN(hiringDate.getTime())
    ? escapeHTML(`${hiringDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} (${new Date().getFullYear() - hiringDate.getFullYear()} años)`)
    : '';

  const overlay = document.createElement('div');
  overlay.className = 'contact-card-overlay';
  overlay.innerHTML = `
    <div class="contact-card-v2 animate-pop">
      <button class="contact-card-close">&times;</button>
      <div class="contact-card-header">
        <div class="contact-card-avatar">
          ${safePhoto ? `<img src="${safePhoto}" alt="${safeFirstName}" referrerpolicy="no-referrer">` : initials}
        </div>
        <div class="contact-card-text">
          <h2>${safeFullName}</h2>
          <p>${safeJobTitle}</p>
        </div>
      </div>
      <div class="contact-card-body">
        <div class="contact-info-list">
          ${emailHref ? `
            <a href="${emailHref}" class="contact-info-item">
              <span>📧</span>
              <div class="contact-info-copy">
                <div class="contact-info-label">Email</div>
                <div>${safeEmail}</div>
              </div>
            </a>
          ` : ''}
          ${phoneHref ? `
            <a href="${phoneHref}" class="contact-info-item">
              <span>📱</span>
              <div class="contact-info-copy">
                <div class="contact-info-label">Teléfono</div>
                <div>${safePhone}</div>
              </div>
            </a>
          ` : ''}
          <div class="contact-info-item">
            <span>🏢</span>
            <div class="contact-info-copy">
              <div class="contact-info-label">Empresa</div>
              <div>${safeCompanyName}</div>
            </div>
          </div>
        </div>

        <!-- Hitos del Equipo: Cumpleaños y Aniversarios -->
        <div class="contact-milestones">
          ${safeBirthLabel ? `
            <div class="milestone-pill ${isBirthdayToday(emp.birthDate) ? 'active' : ''}">
              <span class="milestone-icon">🎂</span>
              <div class="milestone-text">
                <div class="milestone-label">Cumpleaños</div>
                <div class="milestone-value">${safeBirthLabel}</div>
              </div>
            </div>
          ` : ''}
          ${safeHiringLabel ? `
            <div class="milestone-pill ${isAnniversaryToday(emp.hiringDate) ? 'active' : ''}">
              <span class="milestone-icon">🎖️</span>
              <div class="milestone-text">
                <div class="milestone-label">Aniversario</div>
                <div class="milestone-value">${safeHiringLabel}</div>
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

// ── Kick off ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
