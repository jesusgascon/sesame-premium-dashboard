/* ============================================================
   SESAME VACATION CALENDAR - app.js
   Lógica de frontend, gestión de estado y filtrado.
   ============================================================ */

'use strict';

const APP_VERSION = '1.9.12';

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
  // Cross-fade suave de colores solo al conmutar (no en la carga inicial).
  document.body.classList.add('theme-transitioning');
  window.clearTimeout(toggleTheme._t);
  toggleTheme._t = window.setTimeout(() => {
    document.body.classList.remove('theme-transitioning');
  }, 420);
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

  const confirmed = await ssmConfirm({
    title: `\u00BFEliminar empresa "${name}"?`,
    body: 'Esta acci\u00F3n no se puede deshacer. Se borrar\u00E1n las credenciales guardadas para esta empresa.',
    okLabel: 'Eliminar empresa',
    cancelLabel: 'Cancelar',
    danger: true
  });
  if (!confirmed) return;

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
      toastErr("Error: " + (err.error || "No se pudo eliminar la empresa."));
      showLoading(false);
    }
  } catch (e) {
    console.error("Error deleting company:", e);
    toastErr("Error de conexi\u00F3n con el servidor.");
    showLoading(false);
  }
}

/**
 * Animación "Brand Sweep" del cambio de empresa.
 *
 * Implementada con la Web Animations API (element.animate) — NO con animaciones
 * CSS — a propósito: por escritorio remoto (RDP) y cuando el SO desactiva
 * animaciones, el navegador reporta `prefers-reduced-motion: reduce`, y la regla
 * global wildcard de styles.css aplastaría cualquier animación CSS a 0.01ms
 * (efecto invisible). WAAPI no se ve afectada por esa regla, así que el efecto
 * se ejecuta SIEMPRE. Además usa solo transform/opacity y colores sólidos (sin
 * blur ni mix-blend-mode, que RDP descarta), para que se vea de verdad.
 *
 * El color del barrido sale de --accent, que applyCompanyBranding ya repintó con
 * el de la NUEVA empresa justo antes de llamar aquí.
 */
function playCompanySwitchAnimation() {
  // Reentrante: limpia un overlay previo si se cambia muy rápido de empresa.
  const prev = document.getElementById('company-switch-overlay');
  if (prev) prev.remove();

  const host = document.querySelector('.main-content') || document.body;

  // 1) Overlay real (no pseudo-elemento) con barrido diagonal del acento nuevo.
  const ov = document.createElement('div');
  ov.id = 'company-switch-overlay';
  ov.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:60', 'pointer-events:none',
    'overflow:hidden', 'border-radius:inherit'
  ].join(';');
  const band = document.createElement('div');
  band.style.cssText = [
    'position:absolute', 'top:-20%', 'bottom:-20%', 'left:-60%', 'width:85%',
    'transform:translateX(-60%) skewX(-12deg)',
    // Gradiente sólido del acento: bien visible, sin blend ni blur.
    'background:linear-gradient(90deg,' +
      'transparent 0%,' +
      'color-mix(in srgb, var(--accent) 30%, transparent) 30%,' +
      'color-mix(in srgb, var(--accent) 85%, transparent) 48%,' +
      'var(--accent) 50%,' +
      'color-mix(in srgb, var(--accent) 85%, transparent) 52%,' +
      'color-mix(in srgb, var(--accent) 30%, transparent) 70%,' +
      'transparent 100%)',
    'box-shadow:0 0 90px 22px color-mix(in srgb, var(--accent) 55%, transparent)'
  ].join(';');
  ov.appendChild(band);

  // El host necesita ser contenedor de posicionamiento para el overlay absoluto.
  const hostPosWasStatic = getComputedStyle(host).position === 'static';
  if (hostPosWasStatic) host.style.position = 'relative';
  host.appendChild(ov);

  const PREMIUM = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const DUR = 1150;

  // 2) Barrido cruzando toda la pantalla (más lento y marcado).
  band.animate([
    { transform: 'translateX(-90%) skewX(-12deg)', opacity: 0 },
    { opacity: 1, offset: 0.18 },
    { opacity: 1, offset: 0.78 },
    { transform: 'translateX(240%) skewX(-12deg)', opacity: 0 }
  ], { duration: DUR, easing: PREMIUM, fill: 'forwards' });

  // 3) Swap del contenido: se aparta y vuelve (solo opacity+scale, sin blur).
  const active = host.querySelector(':scope > .module-wrapper.active') ||
                 document.querySelector('.module-wrapper.active');
  if (active) {
    active.animate([
      { opacity: 1, transform: 'scale(1) translateY(0)' },
      { opacity: 0.08, transform: 'scale(0.955) translateY(16px)', offset: 0.34 },
      { opacity: 1, transform: 'scale(1) translateY(0)' }
    ], { duration: DUR, easing: PREMIUM });
  }

  // 4) Micro-stagger de la nueva identidad (logo + nombre, en la sidebar),
  //    sincronizado para entrar tras el paso del barrido.
  const logo = document.getElementById('company-logo-container');
  const name = document.getElementById('company-name-display');
  [[logo, 360], [name, 470]].forEach(([el, delay]) => {
    if (!el) return;
    el.animate([
      { opacity: 0, transform: 'translateY(10px) scale(0.92)' },
      { opacity: 1, transform: 'none' }
    ], { duration: 560, delay, easing: PREMIUM, fill: 'backwards' });
  });

  // Limpieza al terminar el barrido.
  window.clearTimeout(playCompanySwitchAnimation._t);
  playCompanySwitchAnimation._t = window.setTimeout(() => {
    ov.remove();
    if (hostPosWasStatic) host.style.position = '';
  }, DUR + 80);
}

/**
 * Animación de cierre de sesión: un "telón" que se cierra sobre toda la app
 * (paneles superior e inferior que se juntan en el centro) con un candado y el
 * mensaje "Sesión cerrada", y que luego se abre revelando la pantalla de
 * contraseña. Más larga y marcada que la de cambio de empresa.
 *
 * `onCovered` se invoca cuando la pantalla está totalmente cubierta: ese es el
 * momento de hacer el "relock" real (limpiar credenciales y mostrar el
 * lock-screen) por debajo del telón, antes de abrirlo.
 *
 * Usa la Web Animations API (no la afecta el wildcard de prefers-reduced-motion)
 * y colores sólidos, para que se vea bien también por escritorio remoto.
 */
function playLogoutAnimation(onCovered, message) {
  if (document.getElementById('logout-overlay')) return; // anti-reentrada
  const PREMIUM = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const CLOSE = 720, HOLD = 620;
  const msgMain = (message && message.main) || 'Sesión cerrada';
  const msgSub = (message && message.sub) || 'Hasta pronto 👋';
  const appScreen = document.getElementById('app-screen');

  // Paleta del telón según el tema activo: en claro usamos una superficie clara con
  // texto oscuro; en oscuro, el telón profundo con texto blanco. El acento (marca)
  // se mezcla en ambos casos para mantener identidad.
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const panelFill = isLight ? '#eef1f8' : '#0a0b13';
  const iconBg    = isLight ? '#ffffff' : '#11131f';
  const textMain  = isLight ? '#1b1e2b' : '#ffffff';
  const textSub   = isLight ? 'rgba(27,30,43,.58)' : 'rgba(255,255,255,.62)';

  const ov = document.createElement('div');
  ov.id = 'logout-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:all;overflow:hidden;';

  const panelBase =
    'position:absolute;left:0;right:0;height:51%;' +
    'background:linear-gradient(180deg, color-mix(in srgb, var(--accent) 22%, ' + panelFill + '), ' + panelFill + ');';
  const top = document.createElement('div');
  top.style.cssText = panelBase + 'top:0;transform:translateY(-100%);' +
    'box-shadow:0 16px 60px color-mix(in srgb, var(--accent) 45%, transparent);';
  const bot = document.createElement('div');
  bot.style.cssText = panelBase + 'bottom:0;transform:translateY(100%);' +
    'box-shadow:0 -16px 60px color-mix(in srgb, var(--accent) 45%, transparent);';

  const center = document.createElement('div');
  center.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:14px;opacity:0;';
  center.innerHTML =
    '<div style="width:76px;height:76px;border-radius:21px;display:flex;align-items:center;' +
      'justify-content:center;font-size:35px;background:color-mix(in srgb, var(--accent) 22%, ' + iconBg + ');' +
      'border:1px solid color-mix(in srgb, var(--accent) 55%, transparent);' +
      'box-shadow:0 0 44px color-mix(in srgb, var(--accent) 50%, transparent);">🔒</div>' +
    '<div style="font-size:1.08rem;font-weight:700;letter-spacing:.02em;color:' + textMain + ';">' + msgMain + '</div>' +
    '<div style="font-size:.82rem;color:' + textSub + ';">' + msgSub + '</div>';

  ov.appendChild(top);
  ov.appendChild(bot);
  ov.appendChild(center);
  document.body.appendChild(ov);

  // La app se encoge y se atenúa mientras se cierra el telón.
  if (appScreen) appScreen.animate([
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(0.94)', opacity: 0.22 }
  ], { duration: CLOSE, easing: PREMIUM, fill: 'forwards' });

  // Telón: cierra.
  top.animate(
    [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }],
    { duration: CLOSE, easing: PREMIUM, fill: 'forwards' });
  bot.animate(
    [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
    { duration: CLOSE, easing: PREMIUM, fill: 'forwards' });

  // Candado + texto: aparecen justo al juntarse los paneles.
  center.animate([
    { opacity: 0, transform: 'scale(0.82) translateY(10px)' },
    { opacity: 0, transform: 'scale(0.82) translateY(10px)', offset: 0.4 },
    { opacity: 1, transform: 'scale(1) translateY(0)' }
  ], { duration: CLOSE + HOLD, easing: PREMIUM, fill: 'forwards' });

  // Tras cerrarse el telón + la pausa, ejecutamos el cierre real. `onCovered`
  // recarga la página para re-inicializar limpio (el desbloqueo en caliente tras
  // logout dejaba estado a medias y requería un Ctrl+Shift+R); la recarga sucede
  // oculta tras el telón, así que la transición a la pantalla de contraseña es
  // limpia. Usamos setTimeout (no animation.finished) para que también dispare con
  // la pestaña en segundo plano, importante para el cierre por inactividad.
  window.setTimeout(() => {
    try { if (typeof onCovered === 'function') onCovered(); } catch (_) {}
  }, CLOSE + HOLD);
}

function switchCompany(cid) {
  const next = STATE.companies.find(c => c.companyId === cid);
  if (!next) return;

  STATE.token = next.token || null;
  STATE.companyId = next.companyId;
  STATE.backendUrl = next.backendUrl;
  saveCredentials();

  // Apply branding immediately for better UX. Esto actualiza --accent/logo/nombre
  // ANTES de disparar la animación, para que el "Brand Sweep" use ya el color nuevo.
  applyCompanyBranding(next);
  playCompanySwitchAnimation();

  // El banner de token caducado es por empresa: al cambiar, mostrar/ocultar
  // según el estado de la nueva. Editar credenciales también lo re-evalúa
  // (el primer 200 de la nueva sesión lo limpia automáticamente).
  if (STATE.expiredTokenBannerDismissed) STATE.expiredTokenBannerDismissed.delete(next.companyId);
  renderTokenExpiredBanner();

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
  // La presencia en tiempo real es por empresa: hay que vaciar también la lista
  // (no solo el mapa) o el resumen "Trab./Pausa/Fuera" seguiría mostrando la
  // gente de la empresa anterior hasta que llegue el nuevo fetchPresence.
  STATE.presenceList = [];
  STATE.calendarData = {};
  STATE.hiddenEmployeeIds.clear();

  // Limpiamos datos del módulo de fichajes si existe
  if (typeof FichajesModule !== 'undefined') {
    FichajesModule.data = [];
    FichajesModule.realSignings = [];
    // Presencia en tiempo real de la empresa anterior: vaciar para no contar a su
    // gente como "trabajando ahora" en la nueva empresa hasta el nuevo fetch.
    FichajesModule.realtimePresence = [];
    // Resetear el filtro de empleado: el empleado seleccionado puede no existir
    // en la nueva empresa. Sin esto seguiría filtrando por su ID (y mostrando su
    // nombre arriba) con datos cruzados. Volvemos a "Todo el equipo".
    FichajesModule.selectedEmployee = 'all';
    const empSelect = document.getElementById('signings-employee-select');
    if (empSelect) empSelect.value = 'all';
    if (FichajesModule.failedIds) FichajesModule.failedIds.clear();
    FichajesModule.biSchemaFields = null;
    FichajesModule.biTheoreticMap = new Map();
    FichajesModule.dayOverrides = new Map();
    FichajesModule.balanceCalendarSummaryMap = new Map();
    FichajesModule.absenceTimesMap = new Map();
    // Cancelar cargas de balance en vuelo y vaciar los mapas oficiales de la
    // empresa anterior (officialHoursBagMap, hoursBagRuleHistoryMap, etc.)
    if (typeof FichajesModule.resetOfficialWorkedHoursState === 'function') {
      FichajesModule.resetOfficialWorkedHoursState({ cancel: true });
    }
    if (typeof FichajesModule.cancelBalanceWarmup === 'function') {
      FichajesModule.cancelBalanceWarmup();
    }
  }

  // Limpiar caché de rutas y modo de empresa (cada empresa puede tener permisos distintos)
  DISCOVERY.workingPresence = null;
  DISCOVERY.workingChecks   = null;
  localStorage.removeItem('ssm_path_presence');
  localStorage.removeItem('ssm_path_checks');
  // Nota: NO borramos ssm_company_mode ni ssm_bi_waf porque son correctos por empresa
  // Solo los borramos si el admin cambió el rol del usuario en Sesame.

  // Vaciar la sección principal (calendario + tabla de fichajes/balances) y
  // mostrar un placeholder de carga, para NO seguir enseñando datos de la
  // empresa anterior durante los segundos que tarda en llegar la nueva.
  // El render de la nueva empresa (refreshAllViews / renderTable) lo reemplaza.
  showCompanySwitchLoading(next.name);

  // Vaciar de inmediato el resumen de presencia del top-bar (Trab./Pausa/Fuera):
  // sin esto seguiría enseñando los contadores de la empresa anterior hasta que
  // el nuevo fetchPresence (asíncrono) termine.
  renderTeamPresenceSummary([]);

  // Cargamos TODO de la nueva empresa (Metadatos + Calendario)
  loadInitialData();
  startAutoRefresh();
}

/**
 * Sustituye al instante el contenido de la sección principal por un placeholder
 * de carga al cambiar de empresa, para que no se vean datos de la empresa
 * anterior mientras llegan los nuevos. Cubre Fichajes/Balances (#signings-tbody)
 * y las tres vistas de Vacaciones: calendario (#calendar-grid), Empleados
 * (#employee-list-container) y Stats (#stats-container). Todas se re-renderizan
 * en refreshAllViews, que reemplaza estos placeholders con los datos nuevos.
 */
function showCompanySwitchLoading(companyName) {
  const safe = escapeHTML(companyName || 'la nueva empresa');
  const loader = `
    <div class="company-switch-loader">
      <div class="csl-ring"></div>
      <div class="csl-text">Cargando datos de ${safe}…</div>
      <div class="csl-sub">Un momento, recuperando información de Sesame</div>
    </div>`;
  const fullWidth = `<div style="grid-column:1/-1">${loader}</div>`;
  const grid = document.getElementById('calendar-grid');
  if (grid) grid.innerHTML = fullWidth;
  const empList = document.getElementById('employee-list-container');
  if (empList) empList.innerHTML = fullWidth;
  const stats = document.getElementById('stats-container');
  if (stats) stats.innerHTML = fullWidth;
  const tbody = document.getElementById('signings-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="border:none;background:none;padding:0;">${loader}</td></tr>`;
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

    await loadData(true);
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


// ── Botón flotante "subir arriba" ───────────────────────────────────────────
// Aparece al bajar mucho en las zonas con scroll (Fichajes/Balances y las vistas
// de Vacaciones) y devuelve el contenedor activo al inicio. Usa un listener en
// fase de captura sobre #app-screen para cubrir cualquier contenedor scrollable
// sin tener que re-enganchar cuando se recrea el contenido interno.
function initScrollTopButton() {
  const btn = document.getElementById('scroll-top-btn');
  const root = document.getElementById('app-screen');
  if (!btn || !root) return;
  const SCROLLER_SELECTOR = '.signings-table-container, .view';
  const THRESHOLD = 400;
  let activeScroller = null;

  // scroll no burbujea: lo capturamos en fase de captura desde el ancestro.
  root.addEventListener('scroll', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.matches(SCROLLER_SELECTOR)) return;
    activeScroller = el;
    btn.classList.toggle('visible', el.scrollTop > THRESHOLD);
  }, true);

  btn.addEventListener('click', () => {
    let target = activeScroller;
    if (!target || target.offsetParent === null || target.scrollTop === 0) {
      target = Array.from(root.querySelectorAll(SCROLLER_SELECTOR))
        .find(el => el.offsetParent !== null && el.scrollTop > 0) || target;
    }
    if (!target) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    btn.classList.remove('visible');
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  if (APP_BOOTSTRAPPED) return;
  APP_BOOTSTRAPPED = true;
  initScrollTopButton();

  const versionEl = document.getElementById('app-version-display');
  if (versionEl) versionEl.textContent = 'Sesame HR Premium Dashboard v' + APP_VERSION;

  const loadingVersionEl = document.getElementById('loading-version-badge');
  if (loadingVersionEl) loadingVersionEl.textContent = 'v' + APP_VERSION;

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
    // Carga silenciosa (sin overlay "Conectando a Sesame"): al cambiar a
    // Vacaciones la sección se actualiza en sitio con el icono 🔄 girando,
    // igual que Fichajes/Balances. El overlay solo se usa en el arranque inicial.
    if (!options.skipLoad) loadData(true);
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

  // Lista de IDs que este handler global puede manejar. Otros pickers
  // (ej. el del gestor de calendario) tienen su propio sistema de listeners.
  const KNOWN_GLOBAL_PICKER_IDS = ['vacaciones-month-picker', 'fichajes-month-picker'];

  // ── Un único listener por delegación en document ─────────────────────────
  document.addEventListener('click', (e) => {
    // Navegación de año (‹ ›)
    const yearBtn = e.target.closest('.mp-year-btn');
    if (yearBtn) {
      const picker = yearBtn.closest('.month-picker-popover');
      if (!picker || !KNOWN_GLOBAL_PICKER_IDS.includes(picker.id)) return; // picker ajeno
      e.stopPropagation();
      const cur = parseInt(picker.querySelector('.mp-year-display').textContent, 10);
      const newY = yearBtn.classList.contains('prev-year') ? cur - 1 : cur + 1;
      _renderPicker(picker, newY, picker.id === 'fichajes-month-picker');
      return;
    }

    // Selección de mes
    const monthBtn = e.target.closest('.mp-month-btn');
    if (monthBtn) {
      const picker = monthBtn.closest('.month-picker-popover');
      if (!picker || !KNOWN_GLOBAL_PICKER_IDS.includes(picker.id)) return; // picker ajeno
      e.stopPropagation();
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
        reloadCalendarSilent();
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
    reloadCalendarSilent();
  });
  // El giro del icono lo gestiona el ciclo de vida de loadData (ver
  // setRefreshSpinning), así también gira en el auto-refresco silencioso.
  $('refresh-btn').addEventListener('click', () => loadData(true));
  $('logout-btn').addEventListener('click', () => logout());
  initMonthPickers();

  // Privacidad: auto-cierre de sesión tras 10 min de inactividad del usuario.
  startIdleWatch();

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

  const absSelAll = $('abs-sel-all');
  if (absSelAll) absSelAll.addEventListener('click', (e) => {
    e.preventDefault();
    STATE.absenceTypes.forEach(type => STATE.activeFilters.add(type.id));
    refreshAllViews();
  });

  const absSelNone = $('abs-sel-none');
  if (absSelNone) absSelNone.addEventListener('click', (e) => {
    e.preventDefault();
    STATE.activeFilters.clear();
    refreshAllViews();
  });

  // Cabeceras de sección plegables accesibles por teclado (Enter/Espacio)
  document.querySelectorAll('.sidebar-section .section-header').forEach(header => {
    header.setAttribute('tabindex', '0');
    header.setAttribute('role', 'button');
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });
  });

  const exportBtn = $('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportToIcal);

  const exportVacCsvBtn = $('export-vacaciones-csv');
  if (exportVacCsvBtn) exportVacCsvBtn.addEventListener('click', () => exportVacationsCSV());

  const exportVacJsonBtn = $('export-vacaciones-json');
  if (exportVacJsonBtn) exportVacJsonBtn.addEventListener('click', () => exportVacationsJSON());

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
    // Mostrar el módulo guardado ANTES de revelar la app, para no enseñar el
    // calendario (activo por defecto en el HTML) y saltar de sección después.
    switchModule(STATE.currentModule, { skipLoad: true });
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

  // Mostrar el módulo guardado ANTES de revelar la app, para no enseñar el
  // calendario (activo por defecto en el HTML) y saltar de sección después.
  switchModule(STATE.currentModule, { skipLoad: true });
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

  // Hidratar empleados desde cache local (TTL 1h) para mostrar la app de
  // inmediato. El fetch real refresca después en background.
  const cacheHit = loadEmployeesCache();
  if (cacheHit) {
    // Cache cogido: el overlay de loading se puede ocultar antes — la app
    // ya tiene datos para renderizar.
    showLoading(false);
  } else {
    showLoading(true);
    STATE.allEmployees.clear();
  }
  STATE.presenceMap.clear();

  try {
    // Carga en paralelo de plantillas disponibles y overrides locales (no críticos).
    // No bloquean si fallan: el resto de la app sigue funcionando.
    fetchScheduleTemplates().catch(() => {});
    loadScheduleOverrides().catch(() => {});

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

    // Persistir cache de empleados para acelerar el próximo arranque
    saveEmployeesCache();
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

// Hace girar (o detiene) un botón redondo de "actualizar" de la barra superior.
// Se invoca desde el ciclo de vida de las cargas, de modo que el icono gira en
// CUALQUIER refresco: manual, auto-refresco silencioso o warmup de balance.
// Mantiene el giro un mínimo de tiempo para que sea perceptible aunque la carga
// termine al instante (datos en caché) o el repintado vaya lento por escritorio
// remoto. La parada se difiere; si llega otra carga, se cancela y sigue girando.
const REFRESH_SPIN_MIN_MS = 800;
function setRefreshSpinning(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (on) {
    if (btn._spinOffTimer) { clearTimeout(btn._spinOffTimer); btn._spinOffTimer = null; }
    if (!btn.classList.contains('refreshing')) {
      btn._spinStart = Date.now();
      btn.classList.add('refreshing');
    }
  } else {
    const elapsed = Date.now() - (btn._spinStart || 0);
    const remaining = Math.max(0, REFRESH_SPIN_MIN_MS - elapsed);
    if (btn._spinOffTimer) clearTimeout(btn._spinOffTimer);
    btn._spinOffTimer = setTimeout(() => {
      btn.classList.remove('refreshing');
      btn._spinOffTimer = null;
    }, remaining);
  }
}

async function loadData(isSilent = false) {
  if (STATE.isLoading) return;
  STATE.isLoading = true;
  if (!isSilent) showLoading(true);
  setRefreshSpinning('refresh-btn', true);
  try {
    await loadDataInternal();
  } finally {
    STATE.isLoading = false;
    if (!isSilent) showLoading(false);
    setRefreshSpinning('refresh-btn', false);
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
      refreshAllViews();
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

  let visibleTypes = 0;
  let activeTypes = 0;
  STATE.absenceTypes.forEach(type => {
    const count = counts[type.id] || 0;
    if (count === 0) return; // Ocultar si el conteo es 0
    visibleTypes += 1;
    if (STATE.activeFilters.has(type.id)) activeTypes += 1;

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

  if (visibleTypes === 0) {
    container.innerHTML = '<div class="filter-empty-hint">Sin ausencias en este periodo</div>';
  }

  const absTitle = $('absence-filter-title');
  if (absTitle) {
    absTitle.innerHTML = visibleTypes > 0
      ? `Tipos de Ausencia <span class="emp-filter-count">(${activeTypes}/${visibleTypes})</span>`
      : 'Tipos de Ausencia';
  }
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

  if (!container.children.length) {
    container.innerHTML = search
      ? `<div class="filter-empty-hint">Sin resultados para «${escapeHTML(search)}»</div>`
      : '<div class="filter-empty-hint">Sin empleados cargados</div>';
  }

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

  // Clase de vista para escalar celdas/contenido por CSS y cabecera coherente
  grid.classList.remove('cal-view-month', 'cal-view-week', 'cal-view-day');
  grid.classList.add(`cal-view-${STATE.calView}`);
  const headerDays = document.querySelector('.calendar-header-days');
  if (headerDays) headerDays.style.display = STATE.calView === 'day' ? 'none' : 'grid';

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

  // Avatars: en semana/día hay más espacio, así que se muestran más y más grandes
  const _maxAvatars = STATE.calView === 'day' ? 40 : STATE.calView === 'week' ? 12 : 6;
  const _avatarSize = STATE.calView === 'day' ? 28 : STATE.calView === 'week' ? 24 : 18;
  if (filteredEvents.length > 0) {
    const avatarRow = document.createElement('div');
    avatarRow.className = 'day-avatars';
    const allEmployees = filteredEvents.flatMap(e => e.employees);
    const shown = allEmployees.slice(0, _maxAvatars);
    shown.forEach(emp => {
      avatarRow.appendChild(buildAvatar(emp, _avatarSize));
    });
    if (allEmployees.length > _maxAvatars) {
      const more = document.createElement('div');
      more.className = 'day-more-badge';
      more.textContent = `+${allEmployees.length - _maxAvatars}`;
      avatarRow.appendChild(more);
    }
    cell.appendChild(avatarRow);
  } else if (!otherMonth && STATE.calView !== 'month') {
    // En semana/día una celda vacía sin nada parece rota: indicarlo con sutileza
    eventsContainer.innerHTML = '<div class="day-empty-hint">Sin ausencias</div>';
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
  STATE.lastUpdateVacaciones = Date.now();
  refreshLastUpdateLabels();

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
  const formatPartialHours = seconds => {
    const totalMinutes = Math.round(Number(seconds || 0) / 60);
    if (!totalMinutes) return '';
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  };
  const formatAbsenceDateMeta = dateKey => {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) {
      const fallbackDay = String(dateKey || '').slice(-2) || '';
      return {
        day: fallbackDay,
        compact: fallbackDay,
        full: fallbackDay ? `Día ${fallbackDay}` : 'Día sin fecha'
      };
    }
    const dateObj = new Date(year, month - 1, day);
    const weekdaysShort = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const weekdaysLong = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const safeDay = String(day).padStart(2, '0');
    const monthName = MONTHS_ES[month - 1] || '';
    const monthShort = monthName.slice(0, 3);
    return {
      day: safeDay,
      compact: `${weekdaysShort[dateObj.getDay()]} ${safeDay} ${monthShort}`,
      full: `${safeDay} de ${monthName} - ${weekdaysLong[dateObj.getDay()]}`
    };
  };

  Object.entries(STATE.calendarData).forEach(([date, entries]) => {
    if (date < range.from || date > range.to) return;
    entries.forEach(evt => {
      if (!STATE.activeFilters.has(evt.type.id)) return;
      evt.employees.forEach(emp => {
        if (STATE.hiddenEmployeeIds.has(String(emp.id))) return;
        if (!empMap[emp.id]) empMap[emp.id] = { emp, absences: new Map() };

        const typeId = evt.type.id;
        const entry = empMap[emp.id].absences.get(typeId) || {
          type: evt.type,
          dates: [],
          dateKeys: [],
          fullDates: [],
          partialDates: [],
          partialSeconds: 0,
          partialSlots: []
        };
        const day = date.split('-')[2];
        if (!entry.dates.includes(day)) {
          entry.dates.push(day);
          entry.dateKeys.push(date);
          const timeInfo = STATE.absenceTimesIndex?.get(String(emp.id) + '_' + date);
          const startTime = timeInfo?.startTime || '';
          const endTime = timeInfo?.endTime || '';
          const seconds = Number(timeInfo?.seconds || 0) || (
            startTime && endTime ? getDayOffSeconds({ startTime, endTime }) : 0
          );
          if (seconds > 0 || startTime || endTime) {
            entry.partialDates.push(day);
            entry.partialSeconds += seconds;
            entry.partialSlots.push({
              date,
              day,
              startTime,
              endTime,
              seconds
            });
          } else {
            entry.fullDates.push(day);
          }
        }
        empMap[emp.id].absences.set(typeId, entry);
      });
    });
  });

  const empList = Object.values(empMap).sort((a,b) => {
    const ta = [...a.absences.values()].reduce((s,v)=>s+v.fullDates.length + v.partialDates.length, 0);
    const tb = [...b.absences.values()].reduce((s,v)=>s+v.fullDates.length + v.partialDates.length, 0);
    return tb - ta;
  });

  if (empList.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon" aria-hidden="true">📅</div>
        <h3 class="empty-state-title">Sin ausencias en este periodo</h3>
        <p class="empty-state-msg">No se han registrado vacaciones ni permisos en el periodo y filtros activos.</p>
      </div>`;
    return;
  }

  empList.forEach(({ emp, absences }) => {
    const name = `${emp.firstName||''} ${emp.lastName||''}`.trim();
    const safeName = escapeHTML(name || 'Empleado');
    const safePhoto = safeHttpUrlAttr(emp.imageProfileURL);
    const initials = escapeHTML(getInitials(name));
    const totalFullDays = [...absences.values()].reduce((s,v)=>s+v.fullDates.length, 0);
    const totalPartialEvents = [...absences.values()].reduce((s,v)=>s+v.partialDates.length, 0);
    const totalPartialSeconds = [...absences.values()].reduce((s,v)=>s+v.partialSeconds, 0);
    const totalUnits = totalFullDays + totalPartialEvents;
    const totalPartialLabel = formatPartialHours(totalPartialSeconds);
    const totalUnitLabel = totalPartialEvents > 0
      ? (totalUnits === 1 ? 'ausencia' : 'ausencias')
      : (totalUnits === 1 ? 'día' : 'días');

    const tags = [...absences.entries()].map(([,v]) => {
      const color = resolveColor(v.type.color);
      const bg = hexToRgba(color, 0.25);
      const sortedDateKeys = [...(v.dateKeys || [])].sort();
      const sortedDays = sortedDateKeys.length
        ? sortedDateKeys.map(dateKey => formatAbsenceDateMeta(dateKey).day)
        : [...v.dates].sort();
      const daysStr = sortedDays.join(', ');
      const safeTypeName = escapeHTML(v.type.name || 'Ausencia');
      const fullDateText = sortedDateKeys.length
        ? sortedDateKeys.map(dateKey => formatAbsenceDateMeta(dateKey).full).join(', ')
        : daysStr;
      const safeDaysStr = escapeHTML(fullDateText);
      const fullCount = v.fullDates.length;
      const partialCount = v.partialDates.length;
      const partialHours = formatPartialHours(v.partialSeconds);
      const partialSlotItems = v.partialSlots
        .sort((a, b) => String(a.date || a.day).localeCompare(String(b.date || b.day)))
        .map(slot => {
          const time = slot.startTime && slot.endTime
            ? `${String(slot.startTime).slice(0,5)}-${String(slot.endTime).slice(0,5)}`
            : formatPartialHours(slot.seconds);
          const dateMeta = formatAbsenceDateMeta(slot.date || slot.day);
          return {
            day: dateMeta.day,
            compactDate: dateMeta.compact,
            fullDate: dateMeta.full,
            time,
            label: `${dateMeta.full}${time ? ` · ${time}` : ''}`
          };
        })
        .filter(item => item.day);
      const partialSlotText = partialSlotItems.map(item => item.label).join(', ');
      const unitParts = [
        fullCount ? `${fullCount}d` : '',
        partialCount ? `${partialCount} parcial${partialCount === 1 ? '' : 'es'}` : ''
      ].filter(Boolean).join(' · ') || `${v.dates.length}d`;
      const partialChip = partialHours
        ? `<span class="emp-tag-time" title="${escapeHTML(partialSlotText || 'Horas parciales solicitadas')}">${escapeHTML(partialHours)}</span>`
        : '';
      const dayChips = sortedDays
        .map((day, index) => {
          const dateMeta = sortedDateKeys[index]
            ? formatAbsenceDateMeta(sortedDateKeys[index])
            : { compact: day, full: `Día ${day}` };
          return `<span class="emp-day-pill" title="${escapeHTML(dateMeta.full)}">${escapeHTML(dateMeta.compact)}</span>`;
        })
        .join('');
      const slotChips = partialSlotItems
        .map(item => `<span class="emp-tag-slot" title="${escapeHTML(item.label)}"><strong>${escapeHTML(item.compactDate)}</strong>${item.time ? `<span>${escapeHTML(item.time)}</span>` : ''}</span>`)
        .join('');
      const detailLine = slotChips
        ? `<span class="emp-absence-detail emp-absence-detail-slots" title="${escapeHTML(partialSlotText)}">${slotChips}</span>`
        : `<span class="emp-absence-detail" title="${safeDaysStr}"><span class="emp-days-caption">Días</span>${dayChips}</span>`;
      return `<span class="emp-absence-tag" style="background:${bg};border-color:${color}40">
        <span class="emp-absence-head">
          <span class="emp-absence-dot" style="background:${color}"></span>
          <span class="emp-absence-type">${safeTypeName}</span>
          <span class="emp-absence-units">${escapeHTML(unitParts)}</span>
          ${partialChip}
        </span>
        ${detailLine}
      </span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'emp-card';
    const safeEmpId = escapeHTML(String(emp.id));
    card.innerHTML = `
      <div class="emp-avatar emp-avatar-clickable" data-employee-id="${safeEmpId}" role="button" tabindex="0" title="Ver ficha de ${safeName}">
        ${safePhoto
          ? `<img src="${safePhoto}" alt="${safeName}" referrerpolicy="no-referrer" />${initials}`
          : initials}
      </div>
      <div class="emp-info">
        <div class="emp-name emp-name-clickable" data-employee-id="${safeEmpId}" role="button" tabindex="0" title="Ver ficha de ${safeName}">${safeName}</div>
        <div class="emp-absences">${tags}</div>
      </div>
      <div class="emp-days">
        <div class="emp-days-count">${totalUnits}</div>
        <div class="emp-days-label">${totalUnitLabel}</div>
        ${totalPartialLabel ? `<div class="emp-hours-count" title="Horas parciales solicitadas">${escapeHTML(totalPartialLabel)}</div>` : ''}
      </div>
    `;
    card.querySelector('.emp-avatar img')?.addEventListener('error', event => {
      event.currentTarget.remove();
    });
    const openProfile = () => showContactCard(String(emp.id));
    card.querySelector('.emp-avatar-clickable')?.addEventListener('click', openProfile);
    card.querySelector('.emp-name-clickable')?.addEventListener('click', openProfile);
    card.querySelector('.emp-avatar-clickable')?.addEventListener('keypress', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(); }
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

  // Comparativa con el mes anterior (solo si hay datos cargados de ese rango)
  const _prevRange = getMonthRange(new Date(STATE.currentDate.getFullYear(), STATE.currentDate.getMonth() - 1, 1));
  let prevTotalAbsences = 0;
  Object.entries(STATE.calendarData).forEach(([date, entries]) => {
    if (date < _prevRange.from || date > _prevRange.to) return;
    entries.forEach(evt => {
      if (!STATE.activeFilters.has(evt.type.id)) return;
      prevTotalAbsences += evt.employees.filter(e => !STATE.hiddenEmployeeIds.has(String(e.id))).length;
    });
  });
  const deltaPct = prevTotalAbsences > 0
    ? Math.round(((totalAbsences - prevTotalAbsences) / prevTotalAbsences) * 100)
    : null;

  // Día pico del periodo
  let peakDate = null, peakCount = 0;
  Object.entries(dailyData).forEach(([date, count]) => {
    if (count > peakCount) { peakCount = count; peakDate = date; }
  });
  const peakLabel = peakDate
    ? new Date(peakDate + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    : '--';

  // Reparto por día de la semana (Lun..Dom)
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0]; // indice 0 = lunes
  Object.entries(dailyData).forEach(([date, count]) => {
    const dow = new Date(date + 'T00:00:00').getDay(); // 0=domingo
    weekdayTotals[(dow + 6) % 7] += count;
  });

  // % de plantilla visible afectada
  const visibleWorkforce = Array.from(STATE.allEmployees.keys())
    .filter(id => !STATE.hiddenEmployeeIds.has(String(id))).length;
  const workforcePct = visibleWorkforce > 0
    ? Math.round((totalEmployees / visibleWorkforce) * 100)
    : null;

  if (totalAbsences === 0) {
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon" aria-hidden="true">📊</div>
        <h3 class="empty-state-title">Sin datos para este periodo</h3>
        <p class="empty-state-msg">No hay registros para los criterios actuales. Prueba a cambiar el rango o quitar filtros.</p>
      </div>`;
    return;
  }

  const sortedDates = Object.keys(dailyData).sort();
  const topEmps = Object.entries(employeeTotals).sort((a,b) => b[1] - a[1]).slice(0, 10);
  const chartColors = ['#6C63FF', '#00D4AA', '#FF6B8A', '#FFB547', '#4ADE80', '#60A5FA', '#A78BFA', '#FB923C', '#2DD4BF', '#F87171'];

  const deltaBadge = deltaPct === null
    ? ''
    : deltaPct === 0
      ? '<span class="stats-delta neutral" title="Sin cambio respecto al mes anterior">=</span>'
      : deltaPct > 0
        ? `<span class="stats-delta up" title="${prevTotalAbsences} ausencias el mes anterior">▲ ${deltaPct}%</span>`
        : `<span class="stats-delta down" title="${prevTotalAbsences} ausencias el mes anterior">▼ ${Math.abs(deltaPct)}%</span>`;
  const summaryHtml = `
    <div class="stats-summary-row">
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Total Ausencias</div>
        <div class="stat-value stats-summary-value">${totalAbsences} ${deltaBadge}</div>
        <div class="stats-summary-sub">${deltaPct === null ? 'sin datos del mes anterior' : 'vs mes anterior'}</div>
      </div>
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Personas</div>
        <div class="stat-value stats-summary-value">${totalEmployees}</div>
        <div class="stats-summary-sub">${workforcePct !== null ? `${workforcePct}% de la plantilla (${visibleWorkforce})` : '&nbsp;'}</div>
      </div>
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Promedio/Emp</div>
        <div class="stat-value stats-summary-value">${avgDays} d</div>
        <div class="stats-summary-sub">días por persona afectada</div>
      </div>
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Día pico</div>
        <div class="stat-value stats-summary-value">${escapeHTML(peakLabel)}</div>
        <div class="stats-summary-sub">${peakCount ? `${peakCount} persona${peakCount === 1 ? '' : 's'} ausente${peakCount === 1 ? '' : 's'}` : '&nbsp;'}</div>
      </div>
      <div class="stat-card stats-summary-card">
        <div class="stat-label">Días afectados</div>
        <div class="stat-value stats-summary-value">${Object.keys(dailyData).length}</div>
        <div class="stats-summary-sub">días con alguna ausencia</div>
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
      <h3>Ausencias por Día de la Semana</h3>
      <canvas id="weekdayChart"></canvas>
    </div>
    <div class="stats-chart-container stats-chart-container-wide glass">
      <h3>Carga Diaria (Ausencias/Día)</h3>
      <div class="stats-chart-legend">
        <span><i style="background:#6C63FF"></i> Día laborable</span>
        <span><i style="background:#FF6B8A"></i> Fin de semana</span>
        <span><i style="background:#6C63FF; box-shadow:0 0 0 2.5px #FFB547"></i> Día pico</span>
        <span><i class="stats-legend-dash"></i> Media diaria</span>
      </div>
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

  // Chart 1: Types (Donut) con total en el centro y % en tooltip
  const centerTextPlugin = {
    id: 'centerText',
    afterDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta?.data?.length) return;
      const { x, y } = meta.data[0];
      const { ctx } = chart;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 28px Inter, system-ui, sans-serif';
      ctx.fillStyle = theme.text;
      ctx.fillText(String(totalAbsences), x, y - 10);
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = theme.secondary;
      ctx.fillText('ausencias', x, y + 12);
      ctx.restore();
    }
  };
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
    plugins: [centerTextPlugin],
    options: {
      plugins: {
        legend: {
          position: 'right',
          labels: { color: theme.text, font: { size: 12, weight: '800' }, padding: 15, usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = totalAbsences > 0 ? Math.round((ctx.parsed / totalAbsences) * 100) : 0;
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            }
          }
        }
      },
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      spacing: 5
    }
  });

  // Chart 1b: Reparto por día de la semana (los findes en rosa)
  new Chart($('weekdayChart'), {
    type: 'bar',
    data: {
      labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
      datasets: [{
        label: 'Ausencias',
        data: weekdayTotals,
        backgroundColor: weekdayTotals.map((_, i) => i >= 5
          ? (isDark ? 'rgba(255, 107, 138, 0.45)' : 'rgba(255, 107, 138, 0.6)')
          : (isDark ? 'rgba(108, 99, 255, 0.5)' : 'rgba(108, 99, 255, 0.65)')),
        borderColor: weekdayTotals.map((_, i) => i >= 5 ? '#FF6B8A' : '#6C63FF'),
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true, grid: { color: theme.grid },
          ticks: { color: theme.secondary, precision: 0, font: { weight: '800' } }
        },
        x: { grid: { display: false }, ticks: { color: theme.text, font: { weight: '800' } } }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = totalAbsences > 0 ? Math.round((ctx.parsed.y / totalAbsences) * 100) : 0;
              return ` ${ctx.parsed.y} ausencia${ctx.parsed.y === 1 ? '' : 's'} (${pct}% del mes)`;
            }
          }
        }
      },
      responsive: true, maintainAspectRatio: false
    }
  });

  // Chart 2: Daily Load (Line/Area) — mes completo con ceros para no deformar
  // la curva, finde en rosa, día pico resaltado y línea de media diaria.
  const _isWeekendDate = d => {
    const dow = new Date(d + 'T00:00:00').getDay();
    return dow === 0 || dow === 6;
  };
  const allMonthDates = [];
  {
    let _c = range.from;
    while (_c <= range.to) {
      allMonthDates.push(_c);
      const _n = new Date(_c + 'T00:00:00');
      _n.setDate(_n.getDate() + 1);
      _c = fmtDate(_n);
    }
  }
  const dailySeries = allMonthDates.map(d => dailyData[d] || 0);
  const dailyAvg = allMonthDates.length
    ? Math.round((dailySeries.reduce((a, b) => a + b, 0) / allMonthDates.length) * 10) / 10
    : 0;
  new Chart($('dailyChart'), {
    type: 'line',
    data: {
      labels: allMonthDates.map(d => d.split('-')[2]),
      datasets: [{
        label: 'Ausencias',
        data: dailySeries,
        borderColor: '#6C63FF',
        backgroundColor: isDark ? 'rgba(108, 99, 255, 0.25)' : 'rgba(108, 99, 255, 0.15)',
        fill: true, tension: 0.35,
        pointRadius: allMonthDates.map(d => d === peakDate ? 7 : (dailyData[d] ? 4 : 2)),
        pointBackgroundColor: allMonthDates.map(d => _isWeekendDate(d) ? '#FF6B8A' : '#6C63FF'),
        pointBorderColor: allMonthDates.map(d => d === peakDate ? '#FFB547' : 'transparent'),
        pointBorderWidth: allMonthDates.map(d => d === peakDate ? 3 : 0),
        order: 1
      }, {
        label: `Media diaria (${dailyAvg})`,
        data: allMonthDates.map(() => dailyAvg),
        borderColor: isDark ? 'rgba(255, 181, 71, 0.8)' : 'rgba(217, 119, 6, 0.8)',
        borderWidth: 2,
        borderDash: [6, 5],
        pointRadius: 0,
        pointHitRadius: 0,
        fill: false,
        order: 0
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true, grid: { color: theme.grid },
          ticks: { color: theme.secondary, precision: 0, font: { weight: '800' } },
          title: { display: true, text: 'Personas ausentes', color: theme.secondary, font: { size: 11, weight: '700' } }
        },
        x: {
          grid: { display: false },
          ticks: { color: theme.secondary, font: { weight: '800' }, autoSkip: true, maxTicksLimit: 31 },
          title: { display: true, text: 'Día del mes', color: theme.secondary, font: { size: 11, weight: '700' } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: item => item.datasetIndex === 0,
          callbacks: {
            title: items => {
              if (!items.length) return '';
              const d = allMonthDates[items[0].dataIndex];
              return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
            },
            label: ctx => {
              const d = allMonthDates[ctx.dataIndex];
              const extras = [];
              if (d === peakDate) extras.push('día pico');
              if (_isWeekendDate(d)) extras.push('fin de semana');
              const suffix = extras.length ? ` · ${extras.join(' · ')}` : '';
              return ` ${ctx.parsed.y} ausencia${ctx.parsed.y === 1 ? '' : 's'}${suffix}`;
            },
            afterLabel: ctx => `Media del mes: ${dailyAvg}`
          }
        }
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
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
          ticks: { color: theme.secondary, stepSize: 1, font: { weight: '800' } },
          title: { display: true, text: 'Días de ausencia en el mes', color: theme.secondary, font: { size: 11, weight: '700' } }
        },
        y: {
          grid: { display: false },
          ticks: { color: theme.text, font: { size: 12, weight: '800' } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} día${ctx.parsed.x === 1 ? '' : 's'} de ausencia`
          }
        }
      },
      responsive: true, maintainAspectRatio: false
    }
  });
}
// ── Modal ──────────────────────────────────────────────────────────────────
const _dayModalEscHandler = e => { if (e.key === 'Escape') closeModal(); };

function openModal(dateStr, events) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m-1, d);
  const opts    = { weekday:'long', day:'numeric', month:'long', year:'numeric' };
  const totalPeople = events.reduce((sum, evt) => sum + evt.employees.length, 0);
  const subParts = [
    `${totalPeople} persona${totalPeople === 1 ? '' : 's'}`,
    `${events.length} tipo${events.length === 1 ? '' : 's'} de ausencia`
  ];
  $('modal-date-title').innerHTML = `${escapeHTML(dateObj.toLocaleDateString('es-ES', opts))}<small class="modal-date-sub">${subParts.join(' · ')}</small>`;
  document.addEventListener('keydown', _dayModalEscHandler);

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
  document.removeEventListener('keydown', _dayModalEscHandler);
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
    toastWarn('No hay eventos visibles para exportar con los filtros actuales.');
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

// ─── Export CSV/JSON de Vacaciones (respeta filtros activos) ──────────────
function _getVacationsExportRange() {
  // Mismo rango que la vista actual (mes/semana/día)
  if (STATE.calView === 'day') return getDayRange(STATE.currentDate);
  if (STATE.calView === 'week') return getWeekRange(STATE.currentDate);
  return getMonthRange(STATE.currentDate);
}

function _collectVacationsRows() {
  const { from, to } = _getVacationsExportRange();
  const rows = [];
  Object.entries(STATE.calendarData || {}).forEach(([dateStr, dayEntries]) => {
    if (dateStr < from || dateStr > to) return;
    (dayEntries || []).forEach(evt => {
      if (!evt?.type?.id || !STATE.activeFilters.has(evt.type.id)) return;
      const typeName = evt.type.name || 'Ausencia';
      (evt.employees || []).forEach(emp => {
        const empIdStr = String(emp.id || '');
        if (STATE.hiddenEmployeeIds.has(empIdStr)) return;
        // Cruzar con absenceTimesIndex para horario exacto si lo hay
        const timesKey = `${empIdStr}_${dateStr}`;
        const times = STATE.absenceTimesIndex?.get(timesKey) || null;
        const startTime = times?.startTime || emp.start_time || emp.startTime || '';
        const endTime   = times?.endTime   || emp.end_time   || emp.endTime   || '';
        const seconds   = times?.seconds   || (startTime && endTime
          ? getDayOffSeconds({ startTime, endTime })
          : 0);
        const dObj = new Date(dateStr + 'T00:00:00');
        const dayName = dObj.toLocaleDateString('es-ES', { weekday: 'long' });
        const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `ID ${empIdStr}`;
        rows.push({
          employeeId: empIdStr,
          employeeName: empName,
          date: dateStr,
          dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1),
          absenceType: typeName,
          absenceTypeId: String(evt.type.id),
          isFullDay: !startTime,
          startTime: startTime || '',
          endTime: endTime || '',
          durationSeconds: seconds,
          durationFormatted: seconds
            ? `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`
            : 'Día completo'
        });
      });
    });
  });
  // Orden estable: por fecha, después por empleado
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.employeeName.localeCompare(b.employeeName);
  });
  return { rows, from, to };
}

function _csvEscapeValue(value) {
  const s = String(value ?? '');
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function _downloadExportFile(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function _buildVacationsExportFilename(ext, ctx) {
  const company = (STATE.companies.find(c => c.companyId === STATE.companyId) || {}).name || 'sesame';
  const safeCompany = String(company).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `vacaciones_${safeCompany}_${ctx.from}_a_${ctx.to}.${ext}`;
}

function exportVacationsCSV() {
  const { rows, from, to } = _collectVacationsRows();
  if (!rows.length) return toastWarn('No hay ausencias visibles para exportar en este rango.');

  const esc = _csvEscapeValue;
  let csv = 'Empleado;Fecha;DiaSemana;TipoAusencia;DiaCompleto;HoraInicio;HoraFin;Duracion\n';
  rows.forEach(r => {
    csv += [
      esc(r.employeeName), esc(r.date), esc(r.dayName), esc(r.absenceType),
      r.isFullDay ? 'Si' : 'No',
      esc(r.startTime), esc(r.endTime),
      esc(r.durationFormatted)
    ].join(';') + '\n';
  });
  _downloadExportFile(csv, 'text/csv;charset=utf-8;',
    _buildVacationsExportFilename('csv', { from, to }));
}

function exportVacationsJSON() {
  const { rows, from, to } = _collectVacationsRows();
  if (!rows.length) return toastWarn('No hay ausencias visibles para exportar en este rango.');

  const company = (STATE.companies.find(c => c.companyId === STATE.companyId) || {}).name || '';
  const payload = {
    meta: {
      exportedAt: new Date().toISOString(),
      appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown',
      company,
      companyId: STATE.companyId,
      range: { from, to },
      view: STATE.calView,
      activeAbsenceTypeIds: Array.from(STATE.activeFilters || []),
      hiddenEmployeeCount: STATE.hiddenEmployeeIds?.size || 0,
      rowCount: rows.length
    },
    rows
  };
  _downloadExportFile(JSON.stringify(payload, null, 2), 'application/json',
    _buildVacationsExportFilename('json', { from, to }));
}

/**
 * Muestra el modal/confirm con el enlace de suscripción iCal.
 */
async function showSubscriptionModal() {
  if (!isLocalProxy()) {
    toastWarn("Esta función requiere que la app corra a través de server.py");
    return;
  }

  try {
    const secret = "sesame-vacation-secret-9182";
    const msgBuffer = new TextEncoder().encode(`${STATE.companyId}${secret}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const token = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);

    const url = `${window.location.origin}/feed.ics?token=${token}`;

    const choice = await ssmConfirm({
      title: '🔗 Suscripción para Google Calendar',
      body: `Enlace: ${url}\n\n¿Copiarlo al portapapeles? Después en Google Calendar: Añadir → "Desde URL".`,
      okLabel: 'Copiar enlace',
      cancelLabel: 'Cerrar'
    });

    if (choice) {
      navigator.clipboard.writeText(url).then(() => {
        toastOk("Enlace copiado. Pégalo en Google Calendar → Añadir desde URL.");
      });
    }
  } catch (e) {
    console.error(e);
    toastErr("No se pudo generar el enlace.");
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

  reloadCalendarSilent();
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
  reloadCalendarSilent();
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

// ── Loader LOCAL del calendario (Vacaciones) ───────────────────────────────
// Para la navegación de calendario (cambio de mes/vista/hoy/picker) NO usamos
// el overlay global "Conectando a Sesame": atenuamos in-situ el grid y mostramos
// la misma píldora de progreso indeterminada de Fichajes/Balances, contenida en
// la tarjeta del calendario. La carga INICIAL sigue usando el overlay grande.
function setCalendarLoading(show) {
  const wrapper = document.querySelector('.calendar-wrapper');
  if (!wrapper) return;
  let bar = document.getElementById('calendar-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'calendar-progress';
    bar.className = 'signings-progress-container is-indeterminate calendar-progress hidden';
    bar.innerHTML = '<div class="signings-progress-bar"></div>';
    wrapper.prepend(bar);
  }
  wrapper.classList.toggle('is-month-loading', show);
  bar.classList.toggle('hidden', !show);
  ['prev-month', 'next-month'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = show;
  });
}

// Recarga silenciosa del calendario con loader local (sin overlay global).
function reloadCalendarSilent() {
  setCalendarLoading(true);
  loadData(true).finally(() => setCalendarLoading(false));
}

async function logout(opts = {}) {
  // `opts` puede ser un MouseEvent (viene del click del botón): tratamos como
  // logout normal salvo que se pase explícitamente { idle: true }.
  const isIdle = opts && opts.idle === true;

  // Paramos el vigilante de inactividad y el auto-refresco (no pintar bajo el telón).
  stopIdleWatch();
  stopAutoRefresh();

  // Relock real: limpia credenciales/estado y RECARGA para re-inicializar limpio.
  // La app cablea sus listeners y el flujo de desbloqueo una sola vez por carga de
  // página (en init()/startApp(), que no son idempotentes), por lo que desbloquear
  // en caliente tras un logout dejaba la sesión a medias (sin "Verificando…" y con
  // datos viejos) hasta un Ctrl+Shift+R. Recargar replica ese refresco manual y
  // garantiza una pantalla de contraseña y un arranque correctos.
  const doRelock = () => {
    clearCredentials();
    sessionStorage.removeItem('ssm_unlocked');
    sessionStorage.removeItem('ssm_current_date');
    sessionStorage.removeItem('ssm_signings_date');
    sessionStorage.removeItem('ssm_signings_view');
    sessionStorage.removeItem('ssm_fichajes_cache');
    location.reload();
  };

  const message = isIdle
    ? { main: 'Sesión cerrada por inactividad', sub: 'Vuelve a introducir la contraseña para entrar' }
    : { main: 'Sesión cerrada', sub: 'Hasta pronto 👋' };

  // Con reduce-motion (o sin soporte de WAAPI) cerramos sin animación.
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    doRelock();
    return;
  }
  playLogoutAnimation(doRelock, message);
}

// ── Auto-cierre por inactividad (privacidad) ─────────────────────────────────
// Si no hay interacción del usuario durante IDLE_LOGOUT_MS, cerramos la sesión
// con la animación y se exige volver a introducir la contraseña. Solo cuenta la
// actividad real del usuario (ratón, teclado, scroll, táctil); los refrescos de
// red en segundo plano NO la reinician.
const IDLE_LOGOUT_MS = 10 * 60 * 1000; // 10 minutos
let _idleTimer = null;
let _idleLastReset = 0;
let _idleWatching = false;

function resetIdleTimer() {
  if (!_idleWatching) return;
  const now = Date.now();
  // Throttle: no re-armar más de una vez por segundo (mousemove dispara mucho).
  if (_idleTimer && now - _idleLastReset < 1000) return;
  _idleLastReset = now;
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    // Modo Kiosko: pantalla de oficina pensada para estar siempre visible; nunca la
    // cerramos por inactividad, solo reprogramamos el temporizador.
    if (document.body.classList.contains('kiosko-mode-active')) {
      _idleLastReset = 0;
      resetIdleTimer();
      return;
    }
    // Solo si seguimos dentro de la app desbloqueada y no hay ya un cierre en curso.
    if (sessionStorage.getItem('ssm_unlocked') === 'true' &&
        !document.getElementById('logout-overlay')) {
      logout({ idle: true });
    }
  }, IDLE_LOGOUT_MS);
}

function startIdleWatch() {
  if (_idleWatching) return;
  _idleWatching = true;
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel']
    .forEach(ev => document.addEventListener(ev, resetIdleTimer, { passive: true, capture: true }));
  resetIdleTimer();
}

function stopIdleWatch() {
  _idleWatching = false;
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
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
