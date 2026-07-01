'use strict';
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
      if (barEl) {
        // Rellenar sin barrido de 0→valor: es un medidor de días consumidos, no
        // una barra de progreso de carga. Así no parece un segundo loader
        // corriendo a la vez durante el arranque.
        barEl.style.transition = 'none';
        barEl.style.width = `${percent}%`;
        // Restaurar la transición para futuros cambios reales del saldo.
        requestAnimationFrame(() => { barEl.style.transition = ''; });
      }

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

  // Cascada diagonal de entrada: solo al terminar una carga real de mes/vista
  // (reloadCalendarSilent deja la clase is-month-loading puesta hasta que este
  // render corre dentro de loadData().finally), nunca al re-renderizar por un
  // toggle de filtro o de empleado visible, para no repetir la animación cada
  // vez que se pulsa un checkbox.
  const wrapper = document.querySelector('.calendar-wrapper');
  const animateEntrance = !!wrapper && wrapper.classList.contains('is-month-loading');
  if (animateEntrance) {
    // reloadCalendarSilent() solo quita is-month-loading en el .finally(), unos
    // milisegundos después de este render: si lo dejamos así, el grid entero
    // pasa de opacity 0.45 a 1 (transición propia de 0.25s) casi a la vez que
    // cada celda hace su propio fundido — como la opacidad de una celda se
    // multiplica por la del contenedor, la ola diagonal quedaba disuelta
    // dentro de ese brillo general y apenas se notaba. Se quita aquí, ya,
    // para que el grid ya esté a opacidad plena cuando entran las celdas:
    // la única animación visible pasa a ser la ola celda a celda.
    wrapper.classList.remove('is-month-loading');
  }
  let cellIndex = 0;
  const nextDiagIndex = () => {
    if (!animateEntrance) return -1;
    const col = cellIndex % 7;
    const row = Math.floor(cellIndex / 7);
    cellIndex += 1;
    return row + col;
  };

  // Clase de vista para escalar celdas/contenido por CSS y cabecera coherente
  grid.classList.remove('cal-view-month', 'cal-view-week', 'cal-view-day');
  grid.classList.add(`cal-view-${STATE.calView}`);
  const headerDays = document.querySelector('.calendar-header-days');
  if (headerDays) headerDays.style.display = STATE.calView === 'day' ? 'none' : 'grid';

  const y = STATE.currentDate.getFullYear();
  const m = STATE.currentDate.getMonth();

  if (STATE.calView === 'day') {
    grid.style.gridTemplateColumns = '1fr';
    grid.appendChild(buildDayCell(new Date(STATE.currentDate), false, nextDiagIndex()));
    return;
  }

  if (STATE.calView === 'week') {
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    const range = getWeekRange(STATE.currentDate);
    let curr = new Date(range.from);
    for (let i = 0; i < 7; i++) {
      grid.appendChild(buildDayCell(new Date(curr), false, nextDiagIndex()));
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
    grid.appendChild(buildDayCell(d, true, nextDiagIndex()));
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    grid.appendChild(buildDayCell(date, false, nextDiagIndex()));
  }

  // Next month fill to complete rows
  const totalCells = grid.children.length;
  const remaining  = Math.ceil(totalCells / 7) * 7 - totalCells;
  for (let d = 1; d <= remaining; d++) {
    const date = new Date(y, m+1, d);
    grid.appendChild(buildDayCell(date, true, nextDiagIndex()));
  }
}

function buildDayCell(date, otherMonth, diagIndex = -1) {
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
    + (isToday(dateStr) ? ' today' : '')
    + (diagIndex >= 0 ? ' row-entering' : '');
  // Onda diagonal: retardo proporcional a fila+columna (tope 380ms) para que
  // el mes se "revele" celda a celda en vez de aparecer todo de golpe.
  if (diagIndex >= 0) {
    cell.style.animationDelay = `${Math.min(diagIndex * 38, 380)}ms`;
  }

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

function openLocationModal({ lat, lon, kind = 'Ubicación', time = '', employee = '', origin = '', device = '' }) {
  const safeLat = Number(lat);
  const safeLon = Number(lon);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return;

  LOCATION_MODAL_STATE.lat = safeLat;
  LOCATION_MODAL_STATE.lon = safeLon;
  LOCATION_MODAL_STATE.zoom = 15;

  const title = $('location-modal-title');
  if (title) title.textContent = `${kind} del fichaje`;

  // Origen del fichaje (web/app/tablet) y, si existe, nombre del dispositivo
  // (p. ej. desde qué tablet se fichó). El dato viene de check_in/out_device_name.
  let deviceLabel = '';
  if (origin) {
    const meta = getOriginMeta(origin);
    deviceLabel = device ? `${meta.icon} ${meta.label} · ${device}` : `${meta.icon} ${meta.label}`;
  } else if (device) {
    deviceLabel = `📟 ${device}`;
  }
  const subtitleParts = [employee, time, deviceLabel].filter(Boolean);
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

