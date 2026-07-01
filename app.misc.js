'use strict';
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

function showLoading(show, instant = false) {
  const el = $('loading-overlay');
  if (!el) return;
  // Ocultado instantáneo (sin fundido) para el arranque con caché: evita que el
  // overlay se disuelva durante 0.4s por encima de las barras de progreso que ya
  // están corriendo debajo (era lo que hacía ver "logo + 2 barras" a la vez).
  el.classList.toggle('loading-overlay--instant', instant && !show);
  el.classList.toggle('hidden', !show);
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
