/* ============================================================
   SESAME VACATION CALENDAR - app.js
   Lógica de frontend, gestión de estado y filtrado.
   ============================================================ */

'use strict';

const APP_VERSION = '1.9.15';

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
  presenceSummaryContext: null,
  // Timestamps de última actualización por módulo (para "Actualizado hace X min")
  lastUpdateVacaciones: null,
  lastUpdateFichajes: null,
  // Plantillas de jornada disponibles en la empresa (id, name, minutes por día).
  scheduleTemplates: [],
  // Plantillas custom locales creadas por el usuario en el dashboard
  customScheduleTemplates: [], // [{ id, name, mondayMinutes,... isLocal:true }]
  // Cache de minutos por plantilla (combinada: Sesame + locales)
  scheduleTemplateMinutes: new Map(),
  // Overrides locales: { companyId: { employeeId: { 'YYYY-MM-DD': templateId } } }
  scheduleOverrides: {}
};

let REFRESH_TIMER = null;
let APP_BOOTSTRAPPED = false;
let APP_LISTENERS_WIRED = false;
let SETUP_EDITING_COMPANY_ID = null;

// ─── Sistema de "Actualizado hace X min" ──────────────────────────────────
function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins === 1) return 'hace 1 min';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return 'hace 1 h';
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}
function refreshLastUpdateLabels() {
  // Versiones cortas:
  // - "ahora" en vez de "ahora mismo"
  // - "hace 2 min" en vez de "Actualizado hace 2 min" → ocupa la mitad
  // - El title del span sigue contando la historia completa
  const fmtShort = (ts) => {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h} h`;
    const d = Math.floor(h / 24);
    return `${d} d`;
  };
  const apply = (el, ts) => {
    if (!el) return;
    if (!ts) { el.textContent = ''; el.removeAttribute('title'); return; }
    el.textContent = fmtShort(ts);
    el.title = `Última actualización ${formatRelativeTime(ts)}`;
    el.classList.toggle('is-stale', (Date.now() - ts) > 5 * 60 * 1000);
    el.classList.toggle('is-very-stale', (Date.now() - ts) > 15 * 60 * 1000);
  };
  apply(document.getElementById('last-update-vacaciones'), STATE.lastUpdateVacaciones);
  apply(document.getElementById('last-update-fichajes'), STATE.lastUpdateFichajes);
}
// Tick cada 30s para actualizar el texto relativo
setInterval(refreshLastUpdateLabels, 30000);

// ─── Sistema de TOASTS (notificaciones no bloqueantes) ─────────────────────
// Reemplaza alert() y window.alert() en todo el código. Cuatro variantes:
// success (verde), error (rojo), warn (ámbar), info (azul/violeta).
const TOAST_ICONS = {
  success: '✓',
  error:   '✕',
  warn:    '⚠',
  info:    'ⓘ'
};
function ssmToast(msg, opts = {}) {
  const variant = opts.variant || 'info';
  const duration = opts.duration ?? (variant === 'error' ? 6000 : (variant === 'warn' ? 4500 : 3000));
  let container = document.getElementById('ssm-toast-stack');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ssm-toast-stack';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `ssm-toast ssm-toast-${variant}`;
  toast.innerHTML = `
    <span class="ssm-toast-icon" aria-hidden="true">${TOAST_ICONS[variant] || 'ⓘ'}</span>
    <span class="ssm-toast-msg">${escapeHTML(String(msg))}</span>
    <button class="ssm-toast-close" aria-label="Cerrar">×</button>
  `;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('ssm-toast-show'));
  let timer = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    toast.classList.remove('ssm-toast-show');
    toast.classList.add('ssm-toast-hide');
    setTimeout(() => toast.remove(), 320);
  };
  if (duration > 0) timer = setTimeout(close, duration);
  toast.querySelector('.ssm-toast-close').onclick = close;
  // Pausar el timer al pasar el ratón por encima
  toast.addEventListener('mouseenter', () => { if (timer) { clearTimeout(timer); timer = null; } });
  toast.addEventListener('mouseleave', () => { if (!timer && duration > 0) timer = setTimeout(close, 1500); });
  return { close };
}
const toastOk    = (m, o) => ssmToast(m, { ...(o || {}), variant: 'success' });
const toastErr   = (m, o) => ssmToast(m, { ...(o || {}), variant: 'error' });
const toastWarn  = (m, o) => ssmToast(m, { ...(o || {}), variant: 'warn' });
const toastInfo  = (m, o) => ssmToast(m, { ...(o || {}), variant: 'info' });

// ─── Diálogo de confirmación propio (sustituye window.confirm) ──────────────
// Devuelve Promise<boolean>. Opciones: { title, body, okLabel, cancelLabel, danger }
function ssmConfirm(opts = {}) {
  const title = opts.title || '¿Confirmar acción?';
  const body  = opts.body  || '';
  const okLabel = opts.okLabel || 'Continuar';
  const cancelLabel = opts.cancelLabel || 'Cancelar';
  const danger = !!opts.danger;
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ssm-confirm-overlay';
    overlay.innerHTML = `
      <div class="ssm-confirm-dialog animate-pop" role="dialog" aria-modal="true" aria-labelledby="ssm-confirm-title">
        <h3 id="ssm-confirm-title">${escapeHTML(title)}</h3>
        ${body ? `<p>${escapeHTML(body).replace(/\n/g, '<br>')}</p>` : ''}
        <div class="ssm-confirm-actions">
          <button class="btn-secondary" data-action="cancel" type="button">${escapeHTML(cancelLabel)}</button>
          <button class="btn-primary ${danger ? 'ssm-confirm-danger' : ''}" data-action="ok" type="button">${escapeHTML(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (val) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector('[data-action="cancel"]').onclick = () => close(false);
    overlay.querySelector('[data-action="ok"]').onclick = () => close(true);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-action="ok"]').focus({ preventScroll: true });
  });
}

// ─── Cache local de empleados (arranque inmediato) ─────────────────────────
// Guarda STATE.allEmployees serializado en localStorage. Al arrancar, si hay
// cache válida para la empresa activa con TTL < 1h, hidratamos antes de hacer
// el fetch. El fetch sigue ocurriendo en background y sobrescribe la cache.
const EMP_CACHE_TTL_MS = 60 * 60 * 1000; // 1h
function getEmployeesCacheKey() {
  return STATE.companyId ? `ssm_emp_cache_${STATE.companyId}` : null;
}
function saveEmployeesCache() {
  const key = getEmployeesCacheKey();
  if (!key || STATE.allEmployees.size === 0) return;
  try {
    const payload = {
      v: 1,
      companyId: STATE.companyId,
      timestamp: Date.now(),
      employees: Array.from(STATE.allEmployees.entries())
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    // Quota exceeded o JSON.stringify falla con Maps/Sets profundos: ignorar.
    console.warn('saveEmployeesCache falló:', e?.message || e);
  }
}
function loadEmployeesCache() {
  const key = getEmployeesCacheKey();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.v !== 1) return false;
    if (data.companyId !== STATE.companyId) return false;
    if (Date.now() - data.timestamp > EMP_CACHE_TTL_MS) return false;
    STATE.allEmployees.clear();
    (data.employees || []).forEach(([id, emp]) => {
      STATE.allEmployees.set(String(id), emp);
    });
    console.info(`[cache] Empleados hidratados desde cache (${STATE.allEmployees.size}, edad ${Math.round((Date.now()-data.timestamp)/1000)}s)`);
    return true;
  } catch (e) {
    return false;
  }
}

// ─── Stack global de modales para breadcrumbs y navegación ────────────────
// Cada entrada: { id, title, openFn } para reabrir el modal anterior si se cierra
// el actual. La pila es manualmente gestionada por las funciones que abren modales.
const MODAL_STACK = [];
function pushModalToStack(entry) {
  if (!entry || !entry.title) return;
  MODAL_STACK.push(entry);
}
function popModalFromStack() {
  return MODAL_STACK.pop();
}
function getModalStackSnapshot() {
  return [...MODAL_STACK];
}
// Render del breadcrumb HTML para insertar en un header de modal
function renderBreadcrumbHTML(currentTitle) {
  if (MODAL_STACK.length === 0) return '';
  const parts = MODAL_STACK.map((m, i) => {
    return `<button class="ssm-breadcrumb-step" data-modal-step="${i}" type="button">${escapeHTML(m.title)}</button>`;
  }).join('<span class="ssm-breadcrumb-sep">›</span>');
  return `
    <nav class="ssm-breadcrumb" aria-label="Navegación entre modales">
      ${parts}
      <span class="ssm-breadcrumb-sep">›</span>
      <span class="ssm-breadcrumb-current">${escapeHTML(currentTitle)}</span>
    </nav>
  `;
}
// Conecta el click en pasos del breadcrumb a la función openFn registrada
function wireBreadcrumb(overlay) {
  overlay.querySelectorAll('.ssm-breadcrumb-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const stepIndex = Number(btn.dataset.modalStep);
      const target = MODAL_STACK[stepIndex];
      if (!target || typeof target.openFn !== 'function') return;
      // Quita este modal y todos los posteriores en el stack
      overlay.remove();
      MODAL_STACK.length = stepIndex;
      target.openFn();
    });
  });
}

// Helper para registrar ESC + click fuera de forma consistente en todos los modales
// Devuelve una función para desregistrar manualmente si hace falta.
function attachOverlayCloseHandlers(overlay, closeFn) {
  if (!overlay || typeof closeFn !== 'function') return () => {};
  const onOverlayClick = (e) => { if (e.target === overlay) closeFn(); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // Solo cierra si este overlay es el de más arriba en el DOM
    const allOverlays = document.querySelectorAll('.contact-card-overlay, .ssm-confirm-overlay');
    const visible = Array.from(allOverlays).filter(o => o.style.visibility !== 'hidden');
    if (visible[visible.length - 1] === overlay) closeFn();
  };
  overlay.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onKey);
  return () => {
    overlay.removeEventListener('click', onOverlayClick);
    document.removeEventListener('keydown', onKey);
  };
}

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

// \u2500\u2500\u2500 Clasificaci\u00f3n de ausencias retribuidas (basada en API oficial Sesame) \u2500\u2500\u2500
// Endpoint /api/v3/companies/{id}/absence-types devuelve `remuneratedType` con
// exactamente DOS valores enum: "remunerated" | "not_remunerated".
// Ref: apidocs.sesametime.com \u2014 Sesame Public API 3.0.0 OAS 3.0
function isRemuneratedAbsenceType(value) {
  const token = normalizeRemuneratedType(value);
  // "remunerated" es el valor oficial. El resto son fallbacks defensivos
  // por si llegamos a verlos en formato legacy/proxy intermedio.
  return ['remunerated', 'paid', 'paid_leave', 'paid_absence', 'with_pay'].includes(token);
}

// NUEVO: detecta cuando el API marca expl\u00edcitamente la ausencia como NO retribuida.
// Cuando esto es true, NO hay que aplicar ninguna heur\u00edstica por nombre \u2014 la
// decisi\u00f3n del API es definitiva. Esto evita compensar tipos como "Gesti\u00f3n Privada"
// que en cada empresa pueden estar configurados como retribuidos o no.
function isExplicitlyNotRemuneratedType(value) {
  const token = normalizeRemuneratedType(value);
  return ['not_remunerated', 'unpaid', 'unpaid_leave', 'not_paid', 'without_pay', 'no_pay'].includes(token);
}

function isKnownCompensatedAbsenceLabel(value) {
  // FALLBACK conservador: solo cuando el API no devuelve `remuneratedType`.
  // \u00danicos nombres seguros entre empresas:
  //   - "Permiso retribuido" \u2192 el nombre incluye literalmente "retribuido"
  //   - "Vacaciones" \u2192 siempre retribuidas en Espa\u00f1a
  // NO incluir:
  //   - "Gesti\u00f3n Privada", "Asuntos Propios": cada empresa lo configura distinto
  //   - "M\u00e9dico": puede ser retribuido o no seg\u00fan la empresa
  const text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\b(permiso\s+retribuido|paid\s+leave|vacaciones?|vacation|paid_vacation)\b/.test(text);
}

function getAbsenceRemuneratedType(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const value = source.remuneratedType ?? source.remunerated_type ?? source.isRemunerated ?? source.paid;
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

// NUEVO: resuelve el horario te\u00f3rico de un empleado para una fecha concreta,
// teniendo en cuenta que un empleado puede tener varias plantillas en su
// hist\u00f3rico (paternidad, lactancia, jornada reducida, etc.).
// Devuelve { secondsForDay, templateName } o null si no hay datos.
function resolveEmployeeScheduleForDate(employee, dateKey) {
  if (!employee || !dateKey) return null;
  const dayOfWeek = new Date(String(dateKey) + 'T00:00:00').getDay();
  if (Number.isNaN(dayOfWeek)) return null;

  // ── PRIORIDAD MÁXIMA: override local (configurado desde el modal del empleado) ──
  // Si el usuario sobreescribió la plantilla para ese día, se respeta sin importar
  // lo que diga Sesame. Solo aplica si tenemos los minutos de la plantilla en caché.
  const overrideTemplateId = (typeof getScheduleOverrideForDate === 'function')
    ? getScheduleOverrideForDate(employee.id, dateKey)
    : null;
  if (overrideTemplateId && STATE.scheduleTemplateMinutes?.has(String(overrideTemplateId))) {
    const tmpl = STATE.scheduleTemplateMinutes.get(String(overrideTemplateId));
    const keys = ['sundayMinutes','mondayMinutes','tuesdayMinutes','wednesdayMinutes',
                  'thursdayMinutes','fridayMinutes','saturdayMinutes'];
    const mins = Number(tmpl?.[keys[dayOfWeek]] || 0);
    return {
      secondsForDay: mins * 60,
      templateName: tmpl?.name || 'Override local',
      isLocalOverride: true
    };
  }

  const views = Array.isArray(employee.scheduleTemplateAllViews)
    ? employee.scheduleTemplateAllViews
    : null;

  if (views && views.length > 0) {
    // Buscar la plantilla vigente: dateFrom <= dateKey <= dateTo (o sin dateTo)
    // Orden de b\u00fasqueda: vistas con dateFrom <= dateKey, eligiendo la m\u00e1s
    // reciente que cubra la fecha.
    const candidates = views.filter(v => {
      const fromOk = !v.dateFrom || v.dateFrom <= dateKey;
      const toOk   = !v.dateTo   || v.dateTo   >= dateKey;
      return fromOk && toOk;
    });
    if (candidates.length > 0) {
      // Coger la de dateFrom m\u00e1s reciente (la vigente)
      const winner = candidates.sort((a, b) => {
        const af = a.dateFrom || '0000-00-00';
        const bf = b.dateFrom || '0000-00-00';
        return bf.localeCompare(af);
      })[0];
      const secs = winner.workdays?.[dayOfWeek];
      if (typeof secs === 'number') {
        return { secondsForDay: secs, templateName: winner.name || '' };
      }
    }
  }

  // Fallback: plantilla por defecto (la primera o \u00fanica vista)
  if (employee.workdays && typeof employee.workdays[dayOfWeek] === 'number') {
    return {
      secondsForDay: employee.workdays[dayOfWeek],
      templateName: employee.scheduleTemplateName || ''
    };
  }
  return null;
}

// NUEVO: decisi\u00f3n jer\u00e1rquica del estatus de retribuci\u00f3n.
// Devuelve true (retribuido), false (no retribuido) o null (desconocido).
// Prioridad:
//   1. API marca "not_remunerated" \u2192 false definitivo
//   2. API marca "remunerated" \u2192 true definitivo
//   3. Sin info del API \u2192 heur\u00edstica por nombre conservadora
function resolveIsRemunerated(remuneratedType, typeName) {
  if (isExplicitlyNotRemuneratedType(remuneratedType)) return false;
  if (isRemuneratedAbsenceType(remuneratedType)) return true;
  return isKnownCompensatedAbsenceLabel(typeName);
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
  // Búsqueda exhaustiva: Sesame puede anidar los tiempos en partialDay o details
  const startRaw = dayOff?.startTime || dayOff?.start_time ||
    dayOff?.partialDay?.startTime || dayOff?.partialDay?.start_time ||
    dayOff?.details?.startTime   || dayOff?.details?.start_time;
  const endRaw   = dayOff?.endTime   || dayOff?.end_time   ||
    dayOff?.partialDay?.endTime   || dayOff?.partialDay?.end_time   ||
    dayOff?.details?.endTime     || dayOff?.details?.end_time;
  const start = parseTimeToSeconds(startRaw);
  const end   = parseTimeToSeconds(endRaw);
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

// ── Banner de token caducado (detección en vivo por 401) ───────────────────
// A diferencia de renderTokenStatus (edad del token), esto reacciona a
// rechazos reales de Sesame: aparece en cuanto una petición devuelve 401.
function markTokenExpired() {
  const cid = STATE.companyId;
  if (!cid) return;
  if (!STATE.expiredTokenCompanies) STATE.expiredTokenCompanies = new Set();
  STATE.expiredTokenCompanies.add(cid);
  renderTokenExpiredBanner();
}

function clearTokenExpired() {
  const cid = STATE.companyId;
  if (!cid || !STATE.expiredTokenCompanies) return;
  if (STATE.expiredTokenCompanies.delete(cid)) renderTokenExpiredBanner();
}

function renderTokenExpiredBanner() {
  const cid = STATE.companyId;
  const isExpired = !!(cid && STATE.expiredTokenCompanies?.has(cid));
  const isDismissed = !!(cid && STATE.expiredTokenBannerDismissed?.has(cid));
  let banner = document.getElementById('token-expired-banner');

  if (!isExpired || isDismissed) {
    banner?.remove();
    return;
  }

  const company = STATE.companies.find(c => c.companyId === cid);
  const safeName = escapeHTML(company?.name || 'la empresa activa');

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'token-expired-banner';
    banner.className = 'token-expired-banner';
    document.body.appendChild(banner);
  }

  banner.innerHTML = `
    <span class="token-expired-icon" aria-hidden="true">🔑</span>
    <div class="token-expired-text">
      <strong>Token de ${safeName} caducado</strong>
      <span>Sesame está rechazando las peticiones (401). Renueva el token para volver a ver datos reales.</span>
    </div>
    <div class="token-expired-actions">
      <button type="button" class="token-expired-btn primary" data-action="renew">✏️ Renovar credenciales</button>
      <button type="button" class="token-expired-btn" data-action="sesame">🌐 Abrir Sesame</button>
      <button type="button" class="token-expired-close" data-action="dismiss" aria-label="Ocultar aviso">✕</button>
    </div>
  `;

  banner.querySelector('[data-action="renew"]')?.addEventListener('click', () => {
    const target = STATE.companies.find(c => c.companyId === STATE.companyId);
    if (typeof showSetup === 'function') showSetup(target);
  });
  banner.querySelector('[data-action="sesame"]')?.addEventListener('click', () => {
    window.open('https://app.sesametime.com', '_blank', 'noopener');
  });
  banner.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
    if (!STATE.expiredTokenBannerDismissed) STATE.expiredTokenBannerDismissed = new Set();
    STATE.expiredTokenBannerDismissed.add(STATE.companyId);
    renderTokenExpiredBanner();
  });
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
    if (k === 'method' || k === 'body' || k === 'overrideBackend' || k === 'headers' || k === 'noStore') return;
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
  // Caché selectiva (clave para no romper nada):
  // - Si la empresa va en la URL (/companies/{id}/...), la caché GET del navegador
  //   está correctamente indexada por empresa → la DEJAMOS. Esto es vital para que
  //   el endpoint por-empresa de empleados sea fiable en la ráfaga de carga inicial
  //   y no falle cayendo al directorio global (que mezcla plantillas de varias
  //   empresas del token → empleados cruzados en fichajes/balances).
  // - Si la empresa NO va en la URL (solo en cabeceras), la misma URL se reutiliza
  //   para todas las empresas y la caché serviría datos de OTRA empresa al cambiar
  //   (bug del calendario con datos viejos) → forzamos no-store.
  // Datos en tiempo real (presencia) piden noStore explícito: aunque la empresa
  // vaya en la URL, NO deben cachearse o al volver a una empresa veríamos la
  // presencia vieja de cuando estuvimos en ella (estado obsoleto hasta un F5 duro).
  const companyInUrl = !!STATE.companyId && path.includes(STATE.companyId);
  if (params.noStore || !companyInUrl) fetchOptions.cache = 'no-store';
  if (params.body) fetchOptions.body = params.body;

  try {
    const res = await fetch(finalUrl.toString(), fetchOptions);

    // Detección de token caducado en vivo: un 401 marca la empresa activa
    // como caducada (banner visible); cualquier respuesta correcta la
    // desmarca automáticamente (token renovado o válido de nuevo).
    if (res.status === 401) markTokenExpired();
    else if (res.ok) clearTokenExpired();

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
 * Lazy load: asegura que los empleados indicados tienen cargado su horario completo (workdays) y detalles.
 */
async function ensureProfilesLoaded(employeeIds) {
  if (!employeeIds || employeeIds.length === 0) return;
  const missing = [];
  for (const id of employeeIds) {
    const emp = STATE.allEmployees.get(String(id));
    // Se considera faltante si no tiene perfil o no tiene horario teórico extraído
    if (!emp || !emp.workdays) missing.push(id);
  }
  
  if (missing.length === 0) return;
  
  // Limitar concurrencia para evitar bloqueos temporales del WAF
  const concurrency = 5;
  for (let i = 0; i < missing.length; i += concurrency) {
    const chunk = missing.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map(async (id) => {
      try {
        const res = await apiFetch(`/api/v3/employees/${id}`);
        const full = res.data || res;
        if (full && full.id) upsertEmployee(full);
      } catch(e) {
        console.warn(`Failed to lazy load profile for ${id}`, e);
      }
    }));
  }
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

  // Extraer horario teórico desde scheduleTemplateViews si viene en el payload.
  // IMPORTANTE: Un empleado puede tener varias plantillas vigentes en periodos
  // distintos (ej. reducción por paternidad/lactancia desde una fecha, vuelta
  // al 100% al terminar). Guardamos TODAS y resolvemos por fecha en runtime.
  if (Array.isArray(emp.scheduleTemplateViews) && emp.scheduleTemplateViews.length > 0) {
    // Normalizar todas las vistas a {dateFrom, dateTo, workdays, name}
    const allViews = emp.scheduleTemplateViews.map(view => {
      const tmpl = view?.scheduleTemplate || {};
      return {
        dateFrom: view.dateFrom || view.from || null,  // 'YYYY-MM-DD' o null
        dateTo:   view.dateTo   || view.to   || null,  // null = vigente
        name: tmpl.name || '',
        workdays: {
          1: (tmpl.mondayMinutes    || 0) * 60,
          2: (tmpl.tuesdayMinutes   || 0) * 60,
          3: (tmpl.wednesdayMinutes || 0) * 60,
          4: (tmpl.thursdayMinutes  || 0) * 60,
          5: (tmpl.fridayMinutes    || 0) * 60,
          6: (tmpl.saturdayMinutes  || 0) * 60,
          0: (tmpl.sundayMinutes    || 0) * 60
        }
      };
    });
    updated.scheduleTemplateAllViews = allViews;
    // Compatibilidad: dejar el primer workdays como "por defecto"
    updated.workdays = allViews[0].workdays;
    if (allViews[0].name) updated.scheduleTemplateName = allViews[0].name;
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

// ─── Schedule Templates (Fase 2 — gestor de calendario por empleado) ──────
// IMPORTANTE: estos endpoints viven en api-eu1.sesametime.com (no en back-eu1).
// Por eso pasamos overrideBackend explícitamente a apiFetch.
const SCHEDULE_API_BACKEND = 'https://api-eu1.sesametime.com';

// Endpoint oficial Sesame: GET /schedule/v1/schedule-templates devuelve solo id+name.
// Cacheado en STATE.scheduleTemplates para alimentar dropdowns del modal.
async function fetchScheduleTemplates() {
  try {
    const data = await apiFetch('/schedule/v1/schedule-templates?limit=200', {
      method: 'GET',
      overrideBackend: SCHEDULE_API_BACKEND
    });
    const list = data?.data || data || [];
    const normalized = (Array.isArray(list) ? list : []).map(t => ({
      id: String(t.id || ''),
      name: String(t.name || 'Sin nombre'),
      type: String(t.type || ''),
      createdAt: t.createdAt || null,
      updatedAt: t.updatedAt || null
    })).filter(t => t.id);
    normalized.sort((a, b) => a.name.localeCompare(b.name));
    STATE.scheduleTemplates = normalized;
    console.info(`[schedule] Plantillas cargadas: ${normalized.length}`);
    return normalized;
  } catch (e) {
    console.warn('fetchScheduleTemplates falló:', e?.message || e);
    STATE.scheduleTemplates = [];
    return [];
  }
}

// Endpoint resuelto por día con minutos exactos. La fuente de verdad de Sesame.
// Devuelve un Map: 'YYYY-MM-DD' -> { templateId, templateName, mondayMinutes,... currentDayMinutes }
async function fetchEmployeeScheduleByDay(employeeId, from, to) {
  if (!employeeId || !from || !to) return new Map();
  const path = `/schedule/v1/employees/${employeeId}/schedule-templates?from=${from}&to=${to}&limit=400`;
  try {
    const data = await apiFetch(path, {
      method: 'GET',
      overrideBackend: SCHEDULE_API_BACKEND
    });
    const arr = data?.data || [];
    const out = new Map();
    (Array.isArray(arr) ? arr : []).forEach(item => {
      // item es { 'YYYY-MM-DD': [ { ...plantilla... } ] }
      Object.entries(item).forEach(([dateKey, templates]) => {
        const tmpl = Array.isArray(templates) ? templates[0] : templates;
        if (!tmpl) return;
        const id = String(tmpl.id || '');
        out.set(dateKey, {
          templateId: id,
          templateName: tmpl.name || '',
          mondayMinutes:    Number(tmpl.mondayMinutes    || 0),
          tuesdayMinutes:   Number(tmpl.tuesdayMinutes   || 0),
          wednesdayMinutes: Number(tmpl.wednesdayMinutes || 0),
          thursdayMinutes:  Number(tmpl.thursdayMinutes  || 0),
          fridayMinutes:    Number(tmpl.fridayMinutes    || 0),
          saturdayMinutes:  Number(tmpl.saturdayMinutes  || 0),
          sundayMinutes:    Number(tmpl.sundayMinutes    || 0),
          currentDayMinutes: tmpl.currentDayMinutes != null ? Number(tmpl.currentDayMinutes) : null
        });
        // Cachear minutos por templateId para reusar en otros días
        if (id) {
          STATE.scheduleTemplateMinutes.set(id, {
            id,
            name: tmpl.name || '',
            mondayMinutes:    Number(tmpl.mondayMinutes    || 0),
            tuesdayMinutes:   Number(tmpl.tuesdayMinutes   || 0),
            wednesdayMinutes: Number(tmpl.wednesdayMinutes || 0),
            thursdayMinutes:  Number(tmpl.thursdayMinutes  || 0),
            fridayMinutes:    Number(tmpl.fridayMinutes    || 0),
            saturdayMinutes:  Number(tmpl.saturdayMinutes  || 0),
            sundayMinutes:    Number(tmpl.sundayMinutes    || 0)
          });
        }
      });
    });
    return out;
  } catch (e) {
    console.warn(`fetchEmployeeScheduleByDay(${employeeId}) falló:`, e?.message || e);
    return new Map();
  }
}

// Carga overrides locales + plantillas custom desde server.py — /schedules.
// Estructura del fichero (formato nuevo):
//   { "<companyId>": { customTemplates: [{ id, name, ...minutes }], overrides: { ... } } }
async function loadScheduleOverrides() {
  if (!isLocalProxy()) {
    STATE.scheduleOverrides = {};
    STATE.customScheduleTemplates = [];
    return {};
  }
  try {
    const res = await fetch(`${window.location.origin}/schedules`, {
      credentials: 'include'
    });
    if (!res.ok) {
      STATE.scheduleOverrides = {};
      STATE.customScheduleTemplates = [];
      return {};
    }
    const all = await res.json();
    // Adaptamos a la estructura interna que usa el resto del código:
    // STATE.scheduleOverrides[companyId][empId][date] = templateId
    const overridesFlat = {};
    Object.entries(all || {}).forEach(([cid, block]) => {
      overridesFlat[cid] = block?.overrides || {};
    });
    STATE.scheduleOverrides = overridesFlat;
    STATE.customScheduleTemplates = (all?.[STATE.companyId]?.customTemplates) || [];
    // Inyectar plantillas custom en el cache de minutos para que el cálculo
    // del teórico pueda resolverlas (igual que las de Sesame).
    STATE.customScheduleTemplates.forEach(t => {
      STATE.scheduleTemplateMinutes.set(String(t.id), {
        id: String(t.id),
        name: t.name,
        mondayMinutes:    Number(t.mondayMinutes    || 0),
        tuesdayMinutes:   Number(t.tuesdayMinutes   || 0),
        wednesdayMinutes: Number(t.wednesdayMinutes || 0),
        thursdayMinutes:  Number(t.thursdayMinutes  || 0),
        fridayMinutes:    Number(t.fridayMinutes    || 0),
        saturdayMinutes:  Number(t.saturdayMinutes  || 0),
        sundayMinutes:    Number(t.sundayMinutes    || 0)
      });
    });
    return all;
  } catch (e) {
    console.warn('loadScheduleOverrides falló:', e?.message || e);
    STATE.scheduleOverrides = {};
    STATE.customScheduleTemplates = [];
    return {};
  }
}

// Descubre las plantillas que YA tienen asignadas los empleados cargados.
// Lee `scheduleTemplateAllViews` de cada empleado (que viene del API de Sesame
// en /api/v3/employees/{id}) y agrupa por (nombre + minutos por día), sin duplicar.
// Para cada plantilla detectada cachea sus minutos en STATE.scheduleTemplateMinutes
// para que el cálculo del teórico pueda resolverla cuando se use como override.
function discoverCompanyTemplates() {
  const groups = new Map(); // key estable -> { id, name, minutes, employees:[name] }
  // 0=domingo, 1=lunes... 6=sábado (formato Date.getDay())
  const dayKeys = ['sundayMinutes','mondayMinutes','tuesdayMinutes','wednesdayMinutes',
                   'thursdayMinutes','fridayMinutes','saturdayMinutes'];
  STATE.allEmployees.forEach((emp) => {
    const views = Array.isArray(emp?.scheduleTemplateAllViews)
      ? emp.scheduleTemplateAllViews
      : [];
    views.forEach(view => {
      const name = (view.name || emp.scheduleTemplateName || '').trim();
      const wd = view.workdays || null; // segundos por día de semana (0..6)
      if (!name || !wd) return;
      // workdays viene en SEGUNDOS por día → convertir a minutos
      const mins = {};
      let validAny = false;
      for (let i = 0; i < 7; i++) {
        const m = Math.round(Number(wd[i] || 0) / 60);
        mins[dayKeys[i]] = m;
        if (m > 0) validAny = true;
      }
      if (!validAny) return; // plantilla vacía → descartar
      const key = `det_${name}|${dayKeys.map(k => mins[k]).join('|')}`;
      const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `ID ${emp.id}`;
      const existing = groups.get(key);
      if (existing) {
        if (!existing.employees.includes(empName)) existing.employees.push(empName);
      } else {
        groups.set(key, {
          id: key,                  // id estable para reutilizar en overrides
          name,
          isDetected: true,
          minutes: mins,
          employees: [empName]
        });
      }
    });
  });
  const result = Array.from(groups.values())
    .sort((a, b) => b.employees.length - a.employees.length);
  // Cachear minutos para que resolveEmployeeScheduleForDate pueda resolver el override
  result.forEach(t => {
    STATE.scheduleTemplateMinutes.set(String(t.id), { id: t.id, name: t.name, ...t.minutes });
  });
  return result;
}

// Devuelve la lista combinada de plantillas locales + detectadas + de Sesame
// (sin duplicar; locales y Sesame mantienen su id original).
function getAllAvailableTemplates() {
  const local = (STATE.customScheduleTemplates || []).map(t => ({
    id: String(t.id),
    name: t.name,
    isLocal: true,
    minutes: {
      mondayMinutes:    Number(t.mondayMinutes    || 0),
      tuesdayMinutes:   Number(t.tuesdayMinutes   || 0),
      wednesdayMinutes: Number(t.wednesdayMinutes || 0),
      thursdayMinutes:  Number(t.thursdayMinutes  || 0),
      fridayMinutes:    Number(t.fridayMinutes    || 0),
      saturdayMinutes:  Number(t.saturdayMinutes  || 0),
      sundayMinutes:    Number(t.sundayMinutes    || 0)
    }
  }));
  const detected = discoverCompanyTemplates().map(t => ({
    id: String(t.id),
    name: t.name,
    isDetected: true,
    minutes: t.minutes,
    employees: t.employees
  }));
  // Evitar que una "detectada" aparezca duplicada si el usuario ya la importó como local
  // (comparamos por nombre normalizado).
  const localNames = new Set(local.map(t => t.name.toLowerCase()));
  const detectedClean = detected.filter(t => !localNames.has(t.name.toLowerCase()));

  const sesame = (STATE.scheduleTemplates || []).map(t => ({
    id: String(t.id),
    name: t.name,
    isLocal: false
  }));
  return { local, detected: detectedClean, sesame };
}

// Persistir una plantilla local (crear o actualizar)
async function saveCustomTemplate(template) {
  if (!isLocalProxy()) throw new Error('Solo disponible con proxy local');
  const res = await fetch(`${window.location.origin}/save-custom-template`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: STATE.companyId, template })
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error || msg; } catch {}
    throw new Error(msg);
  }
  const saved = (await res.json())?.template;
  if (saved?.id) {
    // Refrescar caché
    const idx = (STATE.customScheduleTemplates || []).findIndex(t => String(t.id) === String(saved.id));
    if (idx >= 0) STATE.customScheduleTemplates[idx] = saved;
    else (STATE.customScheduleTemplates ||= []).push(saved);
    STATE.scheduleTemplateMinutes.set(String(saved.id), {
      id: String(saved.id),
      name: saved.name,
      mondayMinutes:    Number(saved.mondayMinutes    || 0),
      tuesdayMinutes:   Number(saved.tuesdayMinutes   || 0),
      wednesdayMinutes: Number(saved.wednesdayMinutes || 0),
      thursdayMinutes:  Number(saved.thursdayMinutes  || 0),
      fridayMinutes:    Number(saved.fridayMinutes    || 0),
      saturdayMinutes:  Number(saved.saturdayMinutes  || 0),
      sundayMinutes:    Number(saved.sundayMinutes    || 0)
    });
  }
  return saved;
}

// Borrar una plantilla local
async function deleteCustomTemplate(templateId) {
  if (!isLocalProxy()) throw new Error('Solo disponible con proxy local');
  const res = await fetch(`${window.location.origin}/delete-custom-template`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: STATE.companyId, templateId: String(templateId) })
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error || msg; } catch {}
    throw new Error(msg);
  }
  // Actualizar caché local
  STATE.customScheduleTemplates = (STATE.customScheduleTemplates || [])
    .filter(t => String(t.id) !== String(templateId));
  STATE.scheduleTemplateMinutes.delete(String(templateId));
  // Quitar también referencias en STATE.scheduleOverrides del cliente
  const cidBlock = STATE.scheduleOverrides?.[STATE.companyId] || {};
  Object.keys(cidBlock).forEach(empId => {
    const empBlock = cidBlock[empId] || {};
    Object.keys(empBlock).forEach(date => {
      if (String(empBlock[date]) === String(templateId)) delete empBlock[date];
    });
    if (Object.keys(empBlock).length === 0) delete cidBlock[empId];
  });
  return res.json();
}

// Devuelve el override local para un empleado-fecha o null si no hay.
function getScheduleOverrideForDate(employeeId, dateKey) {
  if (!employeeId || !dateKey) return null;
  const empBlock = STATE.scheduleOverrides?.[STATE.companyId]?.[String(employeeId)];
  if (!empBlock) return null;
  return empBlock[String(dateKey)] || null;
}

// Persiste overrides para un empleado en el servidor local.
// `overridesMap` = { 'YYYY-MM-DD': templateId | null }, null = borrar override
async function saveScheduleOverrides(employeeId, overridesMap, replaceAll = false) {
  if (!isLocalProxy()) {
    throw new Error('Solo disponible con el proxy local (server.py)');
  }
  const body = {
    companyId: STATE.companyId,
    employeeId: String(employeeId),
    overrides: overridesMap || {},
    replaceAll: !!replaceAll
  };
  const res = await fetch(`${window.location.origin}/save-schedules`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error || msg; } catch {}
    throw new Error(msg);
  }
  // Actualizar caché local en STATE
  const cidBlock = STATE.scheduleOverrides[STATE.companyId] || {};
  const empBlock = replaceAll ? {} : (cidBlock[String(employeeId)] || {});
  Object.entries(overridesMap || {}).forEach(([d, tid]) => {
    if (tid === null || tid === '' || tid === undefined) {
      delete empBlock[d];
    } else {
      empBlock[d] = String(tid);
    }
  });
  if (Object.keys(empBlock).length > 0) {
    cidBlock[String(employeeId)] = empBlock;
  } else {
    delete cidBlock[String(employeeId)];
  }
  STATE.scheduleOverrides[STATE.companyId] = cidBlock;
  return res.json();
}

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
      const data = await apiFetch(DISCOVERY.workingPresence, { noStore: true });
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

// Lee el id de empresa de un objeto empleado crudo de la API, probando las
// distintas claves que Sesame ha usado según versión/endpoint.
function getEmployeeCompanyId(e) {
  if (!e || typeof e !== 'object') return null;
  return e.companyId ?? e.company_id ?? e.companyID ?? e.company?.id ?? null;
}

async function fetchEmployees() {
  try {
    // 1. Fuente PRINCIPAL: endpoint POR EMPRESA. El companyId va en la URL, así
    //    que Sesame devuelve SOLO la plantilla de la empresa activa. El directorio
    //    global /api/v3/employees puede ignorar la cabecera x-company-id cuando el
    //    token tiene acceso multi-empresa y devolver las plantillas de varias
    //    empresas mezcladas (bug de empleados cruzados en fichajes y balances).
    let results = [];
    if (STATE.companyId) {
      const companyData = await apiFetch(
        `/api/v3/companies/${STATE.companyId}/employees?limit=500&include=personalData,details`
      ).catch(() => null);
      results = companyData?.data || (Array.isArray(companyData) ? companyData : []) || [];
    }

    // 2. Fallback: directorio global (cuentas sin permiso sobre el endpoint por
    //    empresa). Filtramos por companyId cuando el objeto lo expone, para no
    //    arrastrar empleados de otra empresa del token.
    if (results.length <= 1) {
      const data = await apiFetch(`/api/v3/employees?limit=500&include=personalData,details`).catch(() => null);
      let globalResults = data?.data || (Array.isArray(data) ? data : []) || [];
      const cid = STATE.companyId ? String(STATE.companyId) : null;
      const exposesCompany = globalResults.some(e => getEmployeeCompanyId(e));
      if (cid && exposesCompany) {
        globalResults = globalResults.filter(e => String(getEmployeeCompanyId(e)) === cid);
      }
      if (globalResults.length > results.length) results = globalResults;
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
      let scheduleTemplateAllViews = null;
      // Extraer desde scheduleTemplateViews (la fuente de verdad de Sesame en 2026).
      // Guardamos TODAS las vistas para resolver por fecha el horario real
      // (reducciones de jornada, paternidad, lactancia tienen su propia vista).
      if (Array.isArray(detail.scheduleTemplateViews) && detail.scheduleTemplateViews.length > 0) {
        scheduleTemplateAllViews = detail.scheduleTemplateViews.map(view => {
          const tmpl = view?.scheduleTemplate || {};
          return {
            dateFrom: view.dateFrom || view.from || null,
            dateTo:   view.dateTo   || view.to   || null,
            name: tmpl.name || '',
            workdays: {
              1: (tmpl.mondayMinutes    || 0) * 60,
              2: (tmpl.tuesdayMinutes   || 0) * 60,
              3: (tmpl.wednesdayMinutes || 0) * 60,
              4: (tmpl.thursdayMinutes  || 0) * 60,
              5: (tmpl.fridayMinutes    || 0) * 60,
              6: (tmpl.saturdayMinutes  || 0) * 60,
              0: (tmpl.sundayMinutes    || 0) * 60
            }
          };
        });
        // Compatibilidad: workdays "por defecto" = primera vista
        workdays = scheduleTemplateAllViews[0].workdays;
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
        companyId: getEmployeeCompanyId(e) || getEmployeeCompanyId(detail) || STATE.companyId || null,
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
        scheduleTemplateAllViews: scheduleTemplateAllViews,
        scheduleTemplateName: (scheduleTemplateAllViews && scheduleTemplateAllViews[0]?.name) || '',
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
  return getOriginMeta(origin).icon;
}

// Mapea el origen del fichaje (web/app/tablet/...) a icono + etiqueta legible.
// Misma correspondencia que la columna "Origen" del detalle de fichajes.
function getOriginMeta(origin) {
  const o = (origin || '').toLowerCase();
  if (o.includes('request')) return { icon: '📝', label: 'Solicitud' };
  if (o.includes('automatic_pause')) return { icon: '🤖', label: 'Auto Pausa' };
  if (o.includes('web')) return { icon: '🌐', label: 'Web' };
  if (o.includes('app') || o.includes('mobile')) return { icon: '📱', label: 'App' };
  if (o.includes('wall') || o.includes('tablet') || o.includes('kiosk') || o.includes('kiosko')) return { icon: '📟', label: 'Tablet' };
  return { icon: '📍', label: origin || 'Oficina' };
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


