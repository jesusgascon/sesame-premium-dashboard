'use strict';
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

