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
};

let REFRESH_TIMER = null;

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
function clearCredentials() {
  localStorage.removeItem('ssm_token');
  localStorage.removeItem('ssm_companyId');
  localStorage.removeItem('ssm_backendUrl');
}

// ── API layer ──────────────────────────────────────────────────────────────
async function apiFetch(path, params = {}) {
  const url = new URL(`${apiBase()}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(i => url.searchParams.append(k, i));
    else url.searchParams.set(k, v);
  });

  const headers = {
    'Authorization': `Bearer ${STATE.token}`,
    'Content-Type':  'application/json',
    'csid':          STATE.companyId,
  };

  // Tell the local proxy which backend to forward to
  if (isLocalProxy()) {
    headers['X-Backend-Url'] = STATE.backendUrl || 'https://back-eu1.sesametime.com';
  }

  const res = await fetch(url.toString(), { headers });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Sesión caducada (401). Por favor vuelve a conectar.");
    }
    throw new Error(`Error de API ${res.status}: ${res.statusText}`);
  }
  return res.json();
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

async function fetchEmployees() {
  try {
    const data = await apiFetch(`/api/v3/companies/${STATE.companyId}/employees`);
    return (data.data || data || []).map(e => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      imageProfileURL: e.imageProfileURL
    }));
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
 * Lógica de inicio real una vez desbloqueado el panel.
 */
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
  });
  
  const empSelNone = $('emp-sel-none');
  if(empSelNone) empSelNone.addEventListener('click', (e) => {
    e.preventDefault();
    STATE.allEmployees.forEach((emp, id) => STATE.hiddenEmployeeIds.add(id));
    renderEmployeeFilterList();
    renderFilters(); renderCalendar(); renderEmployeeList(); renderStats();
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

  // Apply initial theme
  document.documentElement.setAttribute('data-theme', STATE.theme);
  const themeBtn = $('theme-btn');
  if (themeBtn) {
    themeBtn.textContent = STATE.theme === 'light' ? '🌙' : '☀️';
    themeBtn.addEventListener('click', () => {
      STATE.theme = STATE.theme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', STATE.theme);
      localStorage.setItem('theme', STATE.theme);
      themeBtn.textContent = STATE.theme === 'light' ? '🌙' : '☀️';
      
      // Update UI components that depend on theme-aware colors
      const active = STATE.companies.find(c => c.companyId === STATE.companyId);
      if (active) applyCompanyBranding(active);
      
      renderCalendar();
      renderFilters();
      renderStats();
    });
  }

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
    
    const companyName = manualName || companyData.name || 'Mi Empresa';
    const brandColor = manualColor || companyData.brandColor || null;
    const logoUrl = manualLogo || companyData.logo || null;
    
    saveCredentials();
    await persistConfigToServer(companyName, brandColor, logoUrl);
    showApp();
    await loadInitialData();
    await loadSavedConfig();
    startAutoRefresh();
  } catch (e) {

    showSetupError(`No se pudo conectar: ${e.message}. Verifica el token y el Company ID.`);
    STATE.token = STATE.companyId = null;
  } finally {
    showLoading(false);
  }
}

function showSetupError(msg) {
  const err = $('setup-error');
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
    // 1. Parallel fetch of core metadata
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
    if (me && me.id) {
      STATE.allEmployees.set(me.id, {
        id: me.id,
        firstName: me.firstName,
        lastName: me.lastName,
        imageProfileURL: me.imageProfileURL
      });
    }

    teamEmps.forEach(emp => {
      if (!STATE.allEmployees.has(emp.id)) {
        STATE.allEmployees.set(emp.id, emp);
      }
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
          if (!STATE.allEmployees.has(emp.id)) {
            STATE.allEmployees.set(emp.id, emp);
          }
        });

        const rawType = ct.calendar_type || {};
        const masterType = STATE.absenceTypes.find(t => t.id === rawType.id) || {};
        
        return {
          type: {
            ...rawType,
            name: masterType.name || rawType.name || 'Ausencia',
            color: masterType.color || rawType.color || 'ssmv2-purple'
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
    // Show all types, even if count is 0, to maintain visibility

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
    
    const isHidden = STATE.hiddenEmployeeIds.has(emp.id);
    
    const label = document.createElement('label');
    label.className = 'emp-filter-item';
    label.innerHTML = `
      <input type="checkbox" value="${emp.id}" ${isHidden ? '' : 'checked'}>
      <span class="emp-filter-name" title="${name}">${name}</span>
    `;
    
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) STATE.hiddenEmployeeIds.delete(emp.id);
      else STATE.hiddenEmployeeIds.add(emp.id);
      
      renderFilters();
      renderCalendar();
      renderEmployeeList();
      renderStats();
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
  const initials = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);

  $('user-info').innerHTML = `
    <div class="user-avatar">
      ${user.imageProfileURL
        ? `<img src="${user.imageProfileURL}" alt="${name}" onerror="this.style.display='none'" />`
        : initials}
    </div>
    <div class="user-details">
      <div class="user-name">${name}</div>
      <div class="user-role">${user.email || 'Sesame HR'}</div>
    </div>
  `;
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

function logout() {
  stopAutoRefresh();
  clearCredentials();

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
