'use strict';
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
  balanceLiveMode: (() => {
    const saved = sessionStorage.getItem('ssm_balance_live_mode');
    return ['live', 'closed'].includes(saved) ? saved : 'live';
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
  signingsTopProgressHideTimer: null,
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

  /**
   * Detecta si un conjunto de filas pertenece a OTRA empresa: con tokens
   * multi-empresa, el BI Engine puede ignorar la cabecera x-company-id y
   * devolver los fichajes de la empresa del token. Si menos del 20% de los
   * empleados de las filas están en la plantilla activa, es de otra empresa.
   */
  rowsBelongToAnotherCompany(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    if (!STATE.allEmployees || STATE.allEmployees.size === 0) return false;
    const ids = new Set();
    for (const row of rows) {
      const id = row.employeeId ?? row.employee_id ?? row.employee?.id;
      if (id !== null && id !== undefined && id !== '') ids.add(String(id));
      if (ids.size >= 60) break;
    }
    if (ids.size === 0) return false;
    let known = 0;
    ids.forEach(id => { if (STATE.allEmployees.has(id)) known += 1; });
    return (known / ids.size) < 0.2;
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
      button.textContent = 'Año actual';
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

    this.resetSigningsTopProgress();
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
    if (this.signingsTopProgressHideTimer) {
      clearTimeout(this.signingsTopProgressHideTimer);
      this.signingsTopProgressHideTimer = null;
    }
    progressContainer.classList.remove('hidden');
    progressContainer.classList.add('is-indeterminate');
    progressBar.style.width = '38%';
  },

  updateSigningsTopProgress(percent) {
    const progressBar = $('signings-progress-bar');
    const progressContainer = $('signings-progress-container');
    if (!progressContainer || !progressBar) return;
    if (this.signingsTopProgressHideTimer) {
      clearTimeout(this.signingsTopProgressHideTimer);
      this.signingsTopProgressHideTimer = null;
    }
    progressContainer.classList.remove('hidden', 'is-indeterminate');
    progressBar.style.width = `${Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))}%`;
  },

  finishSigningsTopProgress() {
    const progressBar = $('signings-progress-bar');
    const progressContainer = $('signings-progress-container');
    if (!progressContainer || !progressBar) return;
    if (this.signingsTopProgressHideTimer) {
      clearTimeout(this.signingsTopProgressHideTimer);
      this.signingsTopProgressHideTimer = null;
    }
    progressContainer.classList.remove('is-indeterminate');
    progressBar.style.width = '100%';
    this.signingsTopProgressHideTimer = window.setTimeout(() => {
      progressContainer.classList.add('hidden');
      progressBar.style.width = '0%';
      this.signingsTopProgressHideTimer = null;
    }, 450);
  },

  resetSigningsTopProgress() {
    const progressBar = $('signings-progress-bar');
    const progressContainer = $('signings-progress-container');
    if (!progressContainer || !progressBar) return;
    if (this.signingsTopProgressHideTimer) {
      clearTimeout(this.signingsTopProgressHideTimer);
      this.signingsTopProgressHideTimer = null;
    }
    progressContainer.classList.add('hidden');
    progressContainer.classList.remove('is-indeterminate');
    progressBar.style.width = '0%';
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

  setBalanceLiveMode(mode) {
    if (!['live', 'closed'].includes(mode)) return;
    this.balanceLiveMode = mode;
    sessionStorage.setItem('ssm_balance_live_mode', mode);
    this.renderBalanceTable();
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
    // Toggle global de las 4 tarjetas de insights (colapsado por defecto).
    // El estado se guarda en localStorage para recordarlo entre sesiones.
    const insightsBtn = document.getElementById('insights-toggle-btn');
    const insightsSection = document.getElementById('fichajes-insights');
    if (insightsBtn && insightsSection) {
      const persisted = localStorage.getItem('ssm_insights_open');
      if (persisted === '1') insightsSection.classList.remove('is-collapsed');
      const updateLabel = () => {
        const open = !insightsSection.classList.contains('is-collapsed');
        insightsBtn.querySelector('.insights-toggle-label').textContent =
          open ? 'Ocultar resúmenes' : 'Mostrar resúmenes';
      };
      updateLabel();
      insightsBtn.addEventListener('click', () => {
        insightsSection.classList.toggle('is-collapsed');
        const open = !insightsSection.classList.contains('is-collapsed');
        localStorage.setItem('ssm_insights_open', open ? '1' : '0');
        updateLabel();
      });
    }

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

    // Menú overflow "⋯" de la cabecera (agrupa Sesame/Kiosko/export/tema/cumpleaños)
    const overflowBtn = document.getElementById('fichajes-overflow-btn');
    const overflowPanel = document.getElementById('fichajes-overflow-panel');
    if (overflowBtn && overflowPanel) {
      // El .top-bar usa backdrop-filter, que convierte a sus descendientes
      // position:fixed en relativos al top-bar (no al viewport), por lo que las
      // coordenadas de positionFixedPopover caían mal (el panel salía cortado en una
      // esquina). Lo movemos al <body> —sin ancestro con filter/transform— para que
      // el posicionamiento fixed sea relativo al viewport, como los popovers de presencia.
      if (overflowPanel.parentElement !== document.body) {
        document.body.appendChild(overflowPanel);
      }
      overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = overflowPanel.classList.toggle('hidden') === false;
        overflowBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        // El panel es position:fixed (escapa del contexto del top-bar): hay que
        // colocarlo bajo el botón con coordenadas de viewport al abrir.
        if (isOpen && typeof positionFixedPopover === 'function') {
          positionFixedPopover(overflowPanel, overflowBtn, 280);
        }
      });
      // Recolocar si cambia el tamaño de ventana con el menú abierto.
      window.addEventListener('resize', () => {
        if (!overflowPanel.classList.contains('hidden') && typeof positionFixedPopover === 'function') {
          positionFixedPopover(overflowPanel, overflowBtn, 280);
        }
      });
      document.addEventListener('click', (e) => {
        if (!overflowPanel.classList.contains('hidden') &&
            !overflowPanel.contains(e.target) && e.target !== overflowBtn) {
          overflowPanel.classList.add('hidden');
          overflowBtn.setAttribute('aria-expanded', 'false');
        }
      });
      overflowPanel.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) {
          overflowPanel.classList.add('hidden');
          overflowBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

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
    // El giro lo gestiona syncRefreshSpinner() según el estado de carga, así
    // gira también en el auto-refresco silencioso y durante el warmup de balance.
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
    // Limpiamos las coordenadas inline calculadas por positionFixedPopover.
    popover.style.top = '';
    popover.style.left = '';
    popover.style.right = '';
    popover.style.width = '';
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
    // CLAVE: el .top-bar tiene backdrop-filter, que convierte a ese contenedor en
    // el bloque contenedor de los hijos position:fixed (y crea su propio contexto
    // de apilamiento). Eso atrapaba el popover dentro del header: salía desplazado
    // y por detrás del thead sticky de la tabla. Lo movemos a <body> para que su
    // position:fixed sea relativo al viewport de verdad y su z-index domine.
    if (popover.parentElement !== document.body) {
      document.body.appendChild(popover);
    }
    popover.classList.remove('hidden');
    // Coordenadas ancladas al botón "Fuera" (rect en coordenadas de viewport).
    positionFixedPopover(popover, document.getElementById('filter-live-out'));
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
    // En modo Balances los filtros de tabla no aplican: se ocultan vía CSS con esta clase.
    document.getElementById('module-fichajes-wrapper')?.classList.toggle('view-is-balance', this.currentView === 'balance');
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
      this.startSerialProfileScan();

    } catch (e) {
      console.warn("Deep Birthday Harvest failed:", e);
      this.startSerialProfileScan();
    }
  },

  async startSerialProfileScan() {
    if (this.isScanning) return;
    this.isScanning = true;

    const employees = Array.from(STATE.allEmployees.values())
      .filter(e => !e.birthDate || !e.workdays)
      .slice(0, 50); // Limitamos a 50 para evitar baneo del WAF

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

  // Sincroniza el giro del icono "actualizar" de fichajes con el estado real de
  // carga (carga principal + warmup de balance en segundo plano). Idempotente:
  // refleja siempre la verdad, así el icono nunca se queda girando pegado.
  syncRefreshSpinner() {
    setRefreshSpinning('refresh-signings-btn', !!(this.isLoading || this.officialHoursBagLoading));
  },

  async loadData(ignoreCache = false, options = {}) {
    if (typeof ignoreCache === 'object' && ignoreCache !== null) {
      options = ignoreCache;
      ignoreCache = !!options.ignoreCache;
    }

    if (this.isLoading) return;
    this.isLoading = true;
    this.syncRefreshSpinner();

    // Empresa para la que se lanza esta carga. Si el usuario cambia de empresa
    // mientras la petición está en vuelo, los resultados se descartan al final
    // (guarda anti-carrera: evita pintar/cachear datos de la empresa anterior).
    const loadCompanyId = STATE.companyId;

    const isSilent = !!options.silent;
    const isBalanceLoad = this.currentView === 'balance';
    if (!isSilent && isBalanceLoad) {
      this.resetSigningsTopProgress();
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
          // Validar el sello de empresa: entradas sin sello (formato antiguo) o
          // de otra empresa se descartan para evitar mostrar datos cruzados.
          if (parsed.companyId !== STATE.companyId) {
            sessionStorage.removeItem(cacheKey);
          } else {
            this.data = parsed.data || [];
            this.realSignings = parsed.realSignings || [];
            // Map no se serializa a JSON: hay que reconstruirlo
            if (parsed.biTheoreticMap) {
              this.biTheoreticMap = new Map(Object.entries(parsed.biTheoreticMap));
            }
            this.populateEmployeeSelect();
            this.renderTable();
            console.info(`Fichajes: Cache hits for ${start}/${end} (${this.data.length} registros).`);
          }
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
      const BI_SCHEMA_CACHE_KEY = `ssm_bi_schema_v2_${STATE.companyId}`;
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
          {"field": "schedule_context_check.check_out_inside_office", "alias": "insideOfficeOut"},
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

      // 2.4 Horario REAL por día desde Sesame (schedule-templates-v2). Fuente
      // autoritativa de la jornada teórica por empleado y fecha (respeta verano y
      // demás cambios de plantilla con su rango). No crítico: si falla, el resolver
      // cae a las vistas/fallback locales.
      try {
        const _schedEmpIds = _employeeMode
          ? [getCurrentEmployeeId()].filter(Boolean)
          : Array.from(STATE.allEmployees.keys());
        await this.loadScheduleV2(_schedEmpIds, start, end);
      } catch (e) {
        console.warn('loadScheduleV2 falló (no crítico):', e?.message || e);
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
        // Nombre corto de la empresa activa (primer token), para detectar
        // calendarios de festivos rotulados como "<Empresa> 20XX" sin hardcodear
        // ningún nombre concreto: vale para cualquier organización.
        const _coShort = String((STATE.companies?.find(c => c.companyId === STATE.companyId) || {}).name || '')
          .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[\s,.]+/)[0];
        const looksLikeCompanyCalendar = (
          /\b(festivo|holiday|company_holiday|bank_holiday|calendario)\b/.test(normalizedRaw) ||
          (_coShort.length >= 3 && normalizedLabel.includes(_coShort) && /\b20\d{2}\b/.test(normalizedLabel)) ||
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

      // ── FIX BUG_BALANCE_SESAME: Inyectar ausencias personales en dayOverrides ──
      // fetchCalendarGrouped poblaba localAbsences (visible como iconos 📌) pero
      // ese dato NUNCA llegaba al motor matemático de dayOverrides.
      // En modo empleado, fetchCalendarsRaw se saltaba completamente.
      {
        const _myEmpId = _employeeMode ? getCurrentEmployeeId() : null;
        // Dedup: clave (empId, fecha, duración, tipo) para evitar doble conteo
        // cuando el API devuelve el mismo evento en múltiples entries o formatos.
        const _empDayDedup = new Set();

        Object.entries(localAbsences).forEach(([date, dayEntries]) => {
          (dayEntries || []).forEach(entry => {
            const rawType = entry.calendar_type || entry.calendarType ||
              entry.absenceCalendar?.absenceType || entry.absenceType || {};
            const masterType = STATE.absenceTypes.find(
              t => String(t.id) === String(rawType.id || '')
            ) || {};
            const mergedType = rawType.id ? rawType : masterType;
            const typeInfoForCal = getBalanceCalendarTypeInfo(mergedType);

            const typeName = typeInfoForCal.label || displayAbsenceTypeName(mergedType) || 'Ausencia';

            // ── FESTIVOS DE EMPRESA: workdayOverride=0 + víspera ────────────────
            // Si es un festivo de empresa (no una ausencia personal), reducir el
            // teórico a 0 ese día y aplicar regla de víspera al día anterior.
            // En modo empleado venimos aquí porque fetchCalendarsRaw está bloqueado.
            if (typeInfoForCal.isCompanyCalendar) {
              if (_myEmpId) {
                const _myEmpStr = String(_myEmpId);
                const applyHolidayDate = (holDate) => {
                  if (!holDate) return;
                  const k = `${_myEmpStr}_${holDate}`;
                  const ex = dayOverrides.get(k) || {
                    workdayOverride: null, compensatedSeconds: 0,
                    compensatedItems: [], fullDayRemunerated: false
                  };
                  ex.workdayOverride = 0; // No se trabaja ese día
                  dayOverrides.set(k, ex);
                  markEveOfNonWorkingDay(_myEmpStr, holDate, typeName || 'Festivo');
                };
                // Festivo puede venir como entry.date o expandido en daysOff
                if (Array.isArray(entry.daysOff) && entry.daysOff.length > 0) {
                  entry.daysOff.forEach(doff => applyHolidayDate(doff.date || date));
                } else {
                  applyHolidayDate(date);
                }
              }
              return;
            }

            const remuneratedType = getAbsenceRemuneratedType(rawType, masterType);
            // resolveIsRemunerated: API > nombre. Si Sesame marca "not_remunerated"
            // explícitamente, se respeta sin importar el nombre.
            const isRemunerated = resolveIsRemunerated(remuneratedType, typeName);
            if (!isRemunerated) return;

            // Helper: escribe o fusiona la compensación en dayOverrides
            // fallbackSec: segundos explícitos cuando no hay start/end como string
            const upsertCompensation = (empId, date2, sRaw, eRaw, fallbackSec = 0) => {
              if (!empId) return;
              // Calcular duración: usar getDayOffSeconds si hay tiempos, si no el fallback
              const dur = sRaw ? getDayOffSeconds({ startTime: sRaw, endTime: eRaw }) : fallbackSec;
              // Es jornada completa solo si NO hay tiempo y NO hay segundos conocidos
              const isFullDay = !sRaw && dur === 0;

              // Dedup por (empId, fecha, duración, tipo): evita contar el mismo evento dos veces
              // aunque llegue con formato diferente (doff.seconds vs startTime/endTime)
              const dedupKey = isFullDay
                ? `${empId}_${date2}_fullday_${typeName}`
                : `${empId}_${date2}_${dur}_${typeName}`;
              if (_empDayDedup.has(dedupKey)) return;
              _empDayDedup.add(dedupKey);

              const key = `${empId}_${date2}`;
              const ex = dayOverrides.get(key) || {
                workdayOverride: null, compensatedSeconds: 0,
                compensatedItems: [], fullDayRemunerated: false
              };
              if (isFullDay) {
                ex.fullDayRemunerated = true;
              } else if (dur > 0) {
                ex.compensatedSeconds += dur;
                ex.compensatedItems.push({
                  label: typeName, seconds: dur, isFullDay: false,
                  startTime: sRaw || null, endTime: eRaw || null,
                  date: date2, remuneratedType: remuneratedType || 'remunerated'
                });
              }
              dayOverrides.set(key, ex);
            };

            // ── Formato A: Modo Administrador (entries de calendars-grouped) ──
            const empsList = entry.employees || (entry.employee ? [entry.employee] : []);
            if (empsList.length > 0) {
              empsList.forEach(empObj => {
                const sRaw = empObj.start_time || empObj.startTime ||
                  empObj.partialDay?.start_time || empObj.partialDay?.startTime ||
                  empObj.details?.start_time   || empObj.details?.startTime;
                const eRaw = empObj.end_time || empObj.endTime ||
                  empObj.partialDay?.end_time || empObj.partialDay?.endTime ||
                  empObj.details?.end_time   || empObj.details?.endTime;
                upsertCompensation(String(empObj.id || ''), date, sRaw, eRaw, 0);
              });
              return;
            }

            // ── Formato B: Modo Empleado (/employees/{id}/calendars) ──────────
            if (!_myEmpId) return;
            const empId = String(_myEmpId);
            addBalanceCalendarSummaryItem(empId, date, typeName, typeInfoForCal);

            // Tiempos en el campo externo del entry (fallback para doffs sin tiempo)
            const outerSRaw = entry.startTime || entry.start_time ||
              entry.partialDay?.startTime || entry.partialDay?.start_time ||
              entry.details?.startTime   || entry.details?.start_time;
            const outerERaw = entry.endTime || entry.end_time ||
              entry.partialDay?.endTime || entry.partialDay?.end_time ||
              entry.details?.endTime   || entry.details?.end_time;

            if (Array.isArray(entry.daysOff) && entry.daysOff.length > 0) {
              entry.daysOff.forEach(doff => {
                const doffDate = doff.date || date;
                if (!doffDate) return;

                const doffSRaw = doff.startTime || doff.start_time ||
                  doff.partialDay?.startTime || doff.partialDay?.start_time ||
                  doff.details?.startTime;
                const doffERaw = doff.endTime || doff.end_time ||
                  doff.partialDay?.endTime || doff.partialDay?.end_time ||
                  doff.details?.endTime;

                // getDayOffSeconds incluye: doff.seconds explícito + partialDay + tiempos directos
                const doffDur = getDayOffSeconds(doff);
                // Tiempos resueltos: doff primero, luego campo externo del entry como fallback
                const resolvedSRaw = doffSRaw || outerSRaw;
                const resolvedERaw = doffERaw || outerERaw;

                if (!resolvedSRaw && doffDur > 0) {
                  // Duración explícita (doff.seconds) pero sin tiempos string → parcial conocido
                  upsertCompensation(empId, doffDate, null, null, doffDur);
                } else {
                  // Jornada completa SOLO si no hay ningún tiempo ni segundos disponibles
                  const isFullDayDoff = !resolvedSRaw && doffDur === 0;
                  upsertCompensation(empId, doffDate,
                    isFullDayDoff ? null : resolvedSRaw,
                    isFullDayDoff ? null : resolvedERaw,
                    0);
                }
              });
            } else {
              upsertCompensation(empId, date, outerSRaw, outerERaw, 0);
            }
          });
        });

        // Post-procesado: si un override tiene fullDayRemunerated + compensatedSeconds > 0
        // coexistiendo, el fullDayRemunerated es un artefacto del API (devuelve doff:full_day
        // para ausencias parciales junto a una entrada separada con los tiempos exactos).
        // Desactivarlo para que solo actúe la compensación parcial concreta.
        dayOverrides.forEach(override => {
          if (override.fullDayRemunerated && override.compensatedSeconds > 0) {
            override.fullDayRemunerated = false;
          }
        });
      }

      const markEveOfNonWorkingDay = (employeeId, nonWorkingDate, label) => {
        const dateKey = normalizeDateKey(nonWorkingDate);
        const prevDate = addLocalDays(dateKey, -1);
        if (!employeeId || !dateKey || !prevDate || !isWeekdayDateKey(dateKey) || !isWeekdayDateKey(prevDate)) return;
        const key = `${employeeId}_${prevDate}`;
        const existing = dayOverrides.get(key) || { workdayOverride: null, compensatedSeconds: 0, compensatedItems: [], fullDayRemunerated: false };
        existing.eveOfNonWorkingDaySeconds = 25200; // 7h
        existing.eveOfNonWorkingDayLabel = label || 'Víspera de festivo';
        dayOverrides.set(key, existing);
	      };
	      this.absenceTimesMap = new Map();
	      const eveScanEnd = addLocalDays(end, 1) || end;

	      // ── Festivos locales de Zaragoza (HOLIDAYS_ZGZ) ─────────────────────
	      // Lista de festivos LOCALES de Zaragoza. Solo se aplica a las empresas que
	      // lo tengan habilitado en su configuración (`applyZgzHolidays: true` en
	      // config.json). Para el resto confiamos en el calendario API de la empresa,
	      // que ya marca sus festivos específicos. Estar en Zaragoza NO implica
	      // reducción automática de jornada en víspera: es decisión de cada empresa/convenio.
	      const _activeCompany = STATE.companies.find(c => c.companyId === STATE.companyId) || {};
	      const _appliesZgzHolidays = _activeCompany.applyZgzHolidays === true;

	      if (_appliesZgzHolidays) {
	        Object.entries(HOLIDAYS_ZGZ).forEach(([holidayDate, holidayName]) => {
	          if (holidayDate < start || holidayDate > eveScanEnd) return;
	          if (!isWeekdayDateKey(holidayDate)) return;
	          const myId = _employeeMode ? getCurrentEmployeeId() : null;
	          if (myId) {
	            // Modo empleado: solo marcamos al usuario actual
	            markEveOfNonWorkingDay(String(myId), holidayDate, holidayName);
	          } else {
	            // Modo admin: marcar a todos los empleados de la empresa aragonesa
	            STATE.allEmployees.forEach((_, employeeId) => {
	              markEveOfNonWorkingDay(employeeId, holidayDate, holidayName);
	            });
	          }
	        });
	      }

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
            // resolveIsRemunerated: confía en `remuneratedType` del API.
            // Si Sesame marca "not_remunerated" explícitamente, NO se compensa
            // aunque el nombre suene a retribuido.
            const isRemunerated = resolveIsRemunerated(remuneratedType, typeName);
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
                const existing = dayOverrides.get(key) || { workdayOverride: null, compensatedSeconds: 0, compensatedItems: [], fullDayRemunerated: false };
                const isFullDayImplicit = doff.dayOffTimeType === 'full_day' && dayOffSeconds === 0;

                if (doff.dayOffTimeType === 'full_day' && dayOffSeconds > 0) {
                  existing.workdayOverride = dayOffSeconds;
                  // Solo marcar víspera si la empresa aplica reducción (festivos
                  // locales habilitados) y el día libre es festivo de empresa, no
                  // vacaciones personales.
                  if (_appliesZgzHolidays && calendarTypeInfo.isCompanyCalendar) {
                    markEveOfNonWorkingDay(empId, doff.date, typeName || 'Día no laborable');
                  }
                }
                if (isRemunerated && (dayOffSeconds > 0 || isFullDayImplicit)) {
                  if (isFullDayImplicit) {
                    existing.fullDayRemunerated = true;
                  } else {
                    existing.compensatedSeconds += dayOffSeconds;
                  }
                  existing.compensatedItems.push({
                    label: typeName || 'Ausencia retribuida',
                    seconds: isFullDayImplicit ? 0 : dayOffSeconds,
                    isFullDay: isFullDayImplicit,
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

      // VALIDACIÓN DE PLANTILLA: si el BI ha devuelto empleados de otra empresa
      // (token multi-empresa: bi-engine escopa por token, no por cabecera),
      // se descartan esos datos para que el fallback REST cargue los correctos.
      if (this.rowsBelongToAnotherCompany(biData)) {
        console.warn(`BI Engine [${String(STATE.companyId || '').substring(0, 8)}]: las filas devueltas pertenecen a otra empresa (${biData.length}). Descartando BI y usando fallback REST.`);
        biData = [];
        biTheoreticMap = new Map();
        this.biTheoreticMap = new Map();
      }

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
               // Asegurar horario real (schedule-templates-v2) para los empleados
               // con fichajes en esta rama de fallback (pueden ser nuevos respecto
               // a la carga inicial de V2). Cacheado: no re-pide los ya cargados.
               try {
                 const _v2Ids = [...new Set(rawData.map(h => h.employeeId).filter(Boolean))];
                 await this.loadScheduleV2(_v2Ids, start, end);
               } catch (e) {
                 console.warn('loadScheduleV2 (fallback) falló (no crítico):', e?.message || e);
               }
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

      // RED DE SEGURIDAD: si tras todos los fallbacks los datos siguen siendo
      // de otra empresa, no se pintan (mejor sin datos que datos cruzados).
      if (this.rowsBelongToAnotherCompany(this.data)) {
        console.warn('Fichajes: los datos recibidos no pertenecen a la plantilla de la empresa activa. Se descartan. Revisa que el token configurado sea de esta empresa.');
        this.data = [];
        this.realSignings = [];
        this.biTheoreticMap = new Map();
      }

      // GUARDA ANTI-CARRERA: si la empresa activa cambió mientras esta carga
      // estaba en vuelo, los datos pertenecen a la empresa anterior. Se
      // descartan sin pintar ni cachear, y se relanza la carga correcta.
      if (STATE.companyId !== loadCompanyId) {
        console.warn('Fichajes: resultados descartados, la empresa cambió durante la carga.');
        this.data = [];
        this.realSignings = [];
        if (isSilent) { restoreSilentState(); return; }
        if (STATE.currentModule === 'fichajes' || STATE.currentModule === 'balances') {
          window.setTimeout(() => this.loadData(true), 60);
        }
        return;
      }

      if (this.currentView === 'balance' && !isSilent) {
        // En refresh automático no relanzamos warmup ni pulses (anima sin pedirlo)
        this.prepareOfficialWorkedHoursLoad(start, end);
      } else if (this.currentView !== 'balance') {
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
            companyId: loadCompanyId,
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
      if (!isSilent && (isBalanceLoad || this.currentView === 'balance')) {
        this.resetSigningsTopProgress();
      } else if (!isSilent) {
        this.finishSigningsTopProgress();
      }
      this.isLoading = false;
      this.syncRefreshSpinner();
      STATE.lastUpdateFichajes = Date.now();
      refreshLastUpdateLabels();
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
          this.loadData(true, { silent: true });
        }
      }, 120000); // 2 minutos
    }
  },

  populateEmployeeSelect() {
    const select = document.getElementById('signings-employee-select');
    if (!select) return;

    // Guardar selección actual
    const current = select.value;
    select.innerHTML = '<option value="all">👥 Todo el equipo</option>';

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
    this.resetSigningsTopProgress();
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

    // Asegurarnos de que tenemos los perfiles (horarios y birthDate) antes de procesar saldos locales
    await ensureProfilesLoaded(employeeIds);

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
   * Carga el horario REAL por día desde Sesame mediante el endpoint interno
   * `/api/v3/employees/{id}/schedule-templates-v2?from&to` (api/v3, accesible sin
   * licencia de API de pago). Es la jornada teórica que Sesame calcula para cada
   * persona y fecha, respetando los cambios de plantilla con su rango (jornada de
   * verano, reducciones, etc.). Se vuelca en `STATE.scheduleV2ByEmpDate` para que
   * `resolveEmployeeScheduleForDate` la use como fuente autoritativa (cálculo y
   * displays). Tolerante a fallos: si un empleado da error, se cae a las vistas/
   * fallback locales sin romper la carga.
   */
  async loadScheduleV2(employeeIds, start, end) {
    if (!Array.isArray(employeeIds) || employeeIds.length === 0 || !start || !end) return;
    if (!(STATE.scheduleV2ByEmpDate instanceof Map)) STATE.scheduleV2ByEmpDate = new Map();
    // Aislar por empresa: al cambiar de empresa, vaciar para no mezclar horarios.
    if (STATE.scheduleV2Company !== STATE.companyId) {
      STATE.scheduleV2ByEmpDate.clear();
      STATE.scheduleV2Loaded = new Set();
      STATE.scheduleV2Company = STATE.companyId;
    }
    if (!(STATE.scheduleV2Loaded instanceof Set)) STATE.scheduleV2Loaded = new Set();

    const wkKeys = ['sundayMinutes','mondayMinutes','tuesdayMinutes','wednesdayMinutes',
                    'thursdayMinutes','fridayMinutes','saturdayMinutes'];
    const ids = [...new Set(employeeIds.filter(Boolean).map(String))]
      .filter(id => !STATE.scheduleV2Loaded.has(`${id}|${start}|${end}`));
    if (ids.length === 0) return;

    const fetchOne = async (id) => {
      try {
        const res = await apiFetch(`/api/v3/employees/${id}/schedule-templates-v2?from=${start}&to=${end}`);
        const data = (res && res.data) || {};
        Object.entries(data).forEach(([date, arr]) => {
          if (!Array.isArray(arr) || arr.length === 0) return;
          const dow = new Date(date + 'T12:00:00').getDay();
          let mins = 0;
          let name = '';
          arr.forEach(t => {
            const m = (typeof t.currentDayMinutes === 'number')
              ? t.currentDayMinutes
              : Number(t[wkKeys[dow]] || 0);
            mins += Number(m || 0);
            if (!name) name = t.name || '';
          });
          STATE.scheduleV2ByEmpDate.set(`${id}_${date}`, { seconds: mins * 60, name });
        });
        STATE.scheduleV2Loaded.add(`${id}|${start}|${end}`);
      } catch (e) {
        console.warn(`schedule-templates-v2 falló para ${String(id).substring(0,8)}:`, e?.message || e);
      }
    };

    // Concurrencia limitada para no saturar el proxy con muchas peticiones.
    const CONCURRENCY = 6;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      await Promise.all(ids.slice(i, i + CONCURRENCY).map(fetchOne));
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
      const inObj = c.checkIn || c.workEntryIn;
      const outObj = c.checkOut || c.workEntryOut;
      const inStr = (inObj && typeof inObj === 'object') ? inObj.date : inObj;
      const outStr = (outObj && typeof outObj === 'object') ? outObj.date : outObj;

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
        insideOfficeOut: c.insideOfficeOut ?? (c.checkOut ? c.checkOut.insideOffice : null) ?? null,
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
        if (!isNaN(inD.getTime())) {
          inTime = `${String(inD.getHours()).padStart(2,'0')}:${String(inD.getMinutes()).padStart(2,'0')}`;
        }
      }
      let outTime = "--:--";
      if (record.checkOut) {
        const outD = new Date(record.checkOut);
        if (!isNaN(outD.getTime()) && outD.getFullYear() > 2000) {
          outTime = `${String(outD.getHours()).padStart(2,'0')}:${String(outD.getMinutes()).padStart(2,'0')}`;
        }
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
       let isLiveOngoing = false;
       let validOutDate = null;
       if (record.checkOut) {
         const d = new Date(record.checkOut);
         if (!isNaN(d.getTime()) && d.getFullYear() > 2000) validOutDate = d;
       }
       if (record.checkIn && validOutDate) {
         durationSeconds = (validOutDate - new Date(record.checkIn)) / 1000;
       } else if (record.checkIn) {
         durationSeconds = (new Date() - new Date(record.checkIn)) / 1000;
         if (durationSeconds < 0) durationSeconds = 0;
         isLiveOngoing = true;
       }
       const durH = Math.floor(durationSeconds / 3600);
       const durM = Math.round((durationSeconds % 3600) / 60);
       const durationLabel = durationSeconds > 0 ? `${durH}h ${durM}m${isLiveOngoing ? ' (en curso)' : ''}` : '--';

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
         insideOfficeOut: record.insideOfficeOut,
         performedByNameIn: record.performedByNameIn || '',
         performedByNameOut: record.performedByNameOut || '',
         performedByIdIn: record.performedByIdIn || '',
         performedByIdOut: record.performedByIdOut || '',
         recordCreatedAt: record.recordCreatedAt || '',
         recordUpdatedAt: record.recordUpdatedAt || ''
       });

       if (record.type === 'work') {
         let actualWorked = record.secondsWorked || 0;
         if (isLiveOngoing && durationSeconds > actualWorked) {
           actualWorked = durationSeconds;
         }
         grouped[key].totalWorkedSeconds += actualWorked;
       }
    }

    // POST-PASE: Continuación visual de fichajes que cruzan medianoche.
    // Cuando un fichaje entra un día y sale al día siguiente, Sesame muestra
    // un tramo "fantasma" (00:00 → hora de salida) en el día donde TERMINA.
    // Replicamos solo la parte segura: el tramo se guarda en un array APARTE
    // (continuationSegments) que SOLO lee el render del timeline. Así no toca
    // ninguna métrica (Primera Entrada, nº de tramos, balances, totales) ni la
    // tabla de detalle: el fichaje sigue contando íntegro en su día de inicio.
    for (const key in grouped) {
      const g = grouped[key];
      for (const e of g.entries) {
        if (!e.inOriginal || !e.outOriginal) continue;
        const inD = new Date(e.inOriginal);
        const outD = new Date(e.outOriginal);
        if (isNaN(inD.getTime()) || isNaN(outD.getTime()) || outD.getFullYear() <= 2000) continue;
        // ¿La salida cae en un día local distinto (posterior) al de la entrada?
        const inDayKey = `${inD.getFullYear()}-${String(inD.getMonth()+1).padStart(2,'0')}-${String(inD.getDate()).padStart(2,'0')}`;
        const outDayKey = `${outD.getFullYear()}-${String(outD.getMonth()+1).padStart(2,'0')}-${String(outD.getDate()).padStart(2,'0')}`;
        if (outDayKey <= inDayKey) continue;
        const nextKey = `${g.employeeId}_${outDayKey}`;
        const nextGroup = grouped[nextKey];
        if (!nextGroup) continue; // solo si la fila del día siguiente ya existe
        if (!nextGroup.continuationSegments) nextGroup.continuationSegments = [];
        // Evitar duplicar si ya añadimos esta continuación
        if (nextGroup.continuationSegments.some(x => x.outOriginal === e.outOriginal)) continue;
        nextGroup.continuationSegments.push({
          outOriginal: e.outOriginal,
          in: "00:00",
          out: e.out,
          type: e.type,
          typeLabel: (e.typeLabel || 'Trabajo') + ' (viene del día anterior)',
          isContinuation: true
        });
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
	        compensatedItems = Array.isArray(dayOverride.compensatedItems) ? dayOverride.compensatedItems.map(i => ({...i})) : [];
	      }

	      const isSesameComputedTheoretic = this.biTheoreticMap && this.biTheoreticMap.has(overrideKey);
	      if (isSesameComputedTheoretic) {
	        // El BI Engine ya nos da la jornada teórica final calculada por Sesame
	        // (incluye reducciones de jornada individuales, paternidad, etc.)
	        theoreticSeconds = this.biTheoreticMap.get(overrideKey);
	        theoreticSource = compensatedSeconds > 0 ? 'Sesame BI + Calendario' : 'Sesame BI';
	      } else if (dayOverride && dayOverride.workdayOverride !== null) {
	        theoreticSeconds = dayOverride.workdayOverride;
	        theoreticSource = 'Calendario';
	      } else {
	        // Resolver plantilla vigente en la fecha (no la primera del array).
	        // Esto captura reducciones de jornada activas en periodos específicos.
	        const _resolved = resolveEmployeeScheduleForDate(emp, g.date);
	        if (_resolved && typeof _resolved.secondsForDay === 'number') {
	          theoreticSeconds = _resolved.secondsForDay;
	          const _tmplLabel = _resolved.templateName ? `Plantilla (${_resolved.templateName})` : 'Plantilla';
	          theoreticSource = compensatedSeconds > 0 ? `${_tmplLabel} + Calendario` : _tmplLabel;
	        }
	      }
	      // Si Sesame BI ya nos dio la jornada teórica final, no aplicar la
	      // reducción víspera local: el BI ya refleja lo que Sesame calcula para
	      // ese día (si para Sesame no es víspera, el BI devuelve 8h y es correcto).
	      if (!isSesameComputedTheoretic && dayOverride?.eveOfNonWorkingDaySeconds && theoreticSeconds > dayOverride.eveOfNonWorkingDaySeconds) {
	        theoreticSeconds = dayOverride.eveOfNonWorkingDaySeconds;
	        theoreticSource = `${theoreticSource} + Víspera`;
	      }

	      // IMPORTANTE: Ya no ponemos la jornada teórica a 0 si hay ausencia.
	      // Sesame sigue mostrando la jornada teórica (ej: 7h o 8h) aunque sea festivo/ausencia.
	      // En permisos retribuidos por horas, Sesame descuenta ese tiempo de la jornada a cubrir.
	      theoreticBeforeCompensation = theoreticSeconds;

	      // ── GUARD anti-fullDayRemunerated cuando hay jornada normal ────────────
	      // El API de Sesame en modo empleado a veces devuelve doffs con
	      // dayOffTimeType:'full_day' sin tiempos aunque la ausencia sea parcial.
	      // Regla robusta: si el empleado fichó más de 30 min de trabajo ese día,
	      // NO es un día de jornada completa de permiso. Ignoramos el flag y dejamos
	      // que actúe solo la compensación parcial (compensatedSeconds) si la hay.
	      const _workedForGuard = g.totalWorkedSeconds || 0;
	      const _hasRealWorkDay = _workedForGuard > 30 * 60;

	      if (dayOverride && dayOverride.fullDayRemunerated && !_hasRealWorkDay) {
	        const neededCompensation = Math.max(0, theoreticSeconds - compensatedSeconds);
	        if (neededCompensation > 0) {
	          compensatedSeconds += neededCompensation;
	          const fullDayItem = compensatedItems.find(i => i.isFullDay);
	          if (fullDayItem) {
	            fullDayItem.seconds = neededCompensation;
	          }
	        }
	      }

	      // El BI devuelve la jornada BASE (p.ej. 8h15m), NO descuenta ausencias.
	      // Siempre aplicar compensación local aunque el BI haya dado el teórico.
	      if (compensatedSeconds > 0) {
	        compensatedAppliedToTheoretic = Math.min(theoreticSeconds, compensatedSeconds);
	        theoreticSeconds = Math.max(0, theoreticSeconds - compensatedAppliedToTheoretic);
	        if (!theoreticSource.includes('Permiso retribuido')) {
	          theoreticSource = `${theoreticSource} + Permiso retribuido`;
	        }
	      }

      // --- Computed enriched metrics for the detail panel ---
      const workEntries = g.entries.filter(e => e.type === 'work' || e.type === 'special' || e.type === 'private');
      const pauseEntries = g.entries.filter(e => e.type === 'pause');
      // Aviso de cumplimiento: tramo de trabajo continuo > 6h. El art. 34.4 ET
      // y el art. 28 del Convenio del Metal de Zaragoza obligan a un descanso
      // (15 min ET / 20 min convenio) cuando la jornada continuada excede de 6h;
      // un tramo único > 6h indica que esa pausa pudo no respetarse. Flag SOLO
      // de visualización: no altera duraciones, totales ni balances.
      // 6h + 1 min de gracia: la duración se muestra a resolución de minuto, así
      // que un tramo de 6h00m02s (legalmente >6h pero visualmente "6h00m") no se
      // marca para no parecer un falso positivo; se marca desde 6h01m en adelante.
      const LONG_WORK_SEC = 21600 + 60;
      let longWorkCount = 0;
      for (const e of g.entries) {
        e.isLongWork = e.type === 'work' && (e.durationSec || 0) > LONG_WORK_SEC;
        if (e.isLongWork) longWorkCount++;
      }
      const hasLongWorkSegment = longWorkCount > 0;
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
      // Sesame usa Math.floor del balance EN SEGUNDOS CON SIGNO (truncar hacia
      // el lado pesimista): -201s → -4m (no -3m), +173s → +2m (no +3m).
      // Aplicar esta misma fórmula elimina las diferencias sistemáticas de 1m.
      const balanceMinSigned = Math.floor(balanceSec / 60); // puede ser negativo
      const _balanceAbsMin = Math.abs(balanceMinSigned);
      const balanceH = Math.floor(_balanceAbsMin / 60);
      const balanceM = _balanceAbsMin % 60;
      const balanceLabel = (balanceMinSigned < 0 ? '-' : '+') + `${balanceH}h ${balanceM}m`;

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
        continuationSegments: g.continuationSegments || [],
        hasLongWorkSegment: hasLongWorkSegment,
        longWorkCount: longWorkCount,
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
    this.renderDeviceStats();

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

    // Calcula posición/ancho (%) de un tramo en el eje 0-24h del día. Si el tramo
    // cruza medianoche (salida < entrada, p.ej. un fichaje sin cerrar 16:40→08:04),
    // la barra se dibuja hasta el final del día en lugar de salir con ancho negativo
    // (que la hacía desaparecer). Devuelve null si las horas no son válidas.
    const _timelineBar = (inStr, outStr) => {
      if (!inStr || !outStr) return null;
      const [hIn, mIn] = String(inStr).split(':').map(Number);
      const [hOut, mOut] = String(outStr).split(':').map(Number);
      if (isNaN(hIn) || isNaN(hOut)) return null;
      const inDec = hIn + (mIn || 0) / 60;
      let outDec = hOut + (mOut || 0) / 60;
      const crossesMidnight = outDec < inDec; // fichaje sin cerrar: cruza medianoche
      if (crossesMidnight) outDec = 24; // dibujar hasta fin de día
      return {
        left: (inDec / 24) * 100,
        width: Math.max(0, ((outDec - inDec) / 24) * 100),
        crossesMidnight,
      };
    };

    // ── Helpers: HTML de ausencias (sin backticks anizados) ──────────────
    const _absTimelineHtml = (segs) => {
      if (!segs || !segs.length) return '';
      return segs.filter(a => !a.isFullDay).map(abs => {
        const bar = _timelineBar(abs.start, abs.end);
        if (!bar) return '';
        const cls = 'mini-timeline-bar absence' + (bar.crossesMidnight ? ' crosses-midnight' : '');
        const lbl = (abs.label || 'Ausencia') + ': ' + abs.start.substring(0,5) + '-' + abs.end.substring(0,5)
                  + (bar.crossesMidnight ? ' (cruza medianoche)' : '');
        return '<div class="' + cls + '" style="left:' + bar.left.toFixed(2) + '%;width:' + bar.width.toFixed(2) + '%;" title="' + escapeHTML(lbl) + '"></div>';
      }).join('');
    };
    const _getAbsenceTableItems = (segs, entries) => {
      if (!segs || !segs.length) return [];
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
          return iMin < bMin && oMin > aMin;
        });
      };
      return segs.filter(abs => {
        if (abs.isFullDay) return false;
        return !isCoveredByEntry(abs.start, abs.end);
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
        const html = '<tr class="row-is-absence" style="background:rgba(139,92,246,0.06);">'
          + '<td><strong>' + st + ' \u2013 ' + et + '</strong></td>'
          + '<td><span class="td-duration">' + durStr + '</span></td>'
          + '<td><span style="background:rgba(139,92,246,0.15);border:1px dashed #a78bfa;padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;color:#a78bfa;">'
          + '\uD83D\uDCCC ' + lbl + '</span></td>'
          + '<td><span class="td-loc">\uD83D\uDCC5 Sesame (Ausencia)</span></td>'
          + '<td><span style="opacity:0.3">--</span></td>'
          + '</tr>';
        return { start: st, html };
      });
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

        // --- Datos del horario del empleado para ese día concreto ---
        const empProfile = STATE.allEmployees.get(String(row.employeeId || ''));
        // Resolver el horario vigente de ESE empleado en ESA fecha (respeta
        // override de verano por fecha exacta y vistas de Sesame por rango).
        const _schedResolved = (empProfile && row.date)
          ? resolveEmployeeScheduleForDate(empProfile, row.date)
          : null;
        const scheduleTemplateName = _schedResolved?.templateName || empProfile?.scheduleTemplateName || '';
        const scheduleSecondsForDay = (typeof _schedResolved?.secondsForDay === 'number')
          ? _schedResolved.secondsForDay
          : null;
        const scheduleHtmlForDay = (() => {
          if (scheduleSecondsForDay === null) return '';
          const sh = Math.floor(scheduleSecondsForDay / 3600);
          const sm = Math.floor((scheduleSecondsForDay % 3600) / 60);
          const isRest = scheduleSecondsForDay === 0;
          const dayLabel = isRest ? 'No laborable' : `${sh}h${sm > 0 ? ' ' + sm + 'm' : ''}`;
          const accentColor = isRest ? 'var(--text-muted)' : 'var(--accent2)';
          const nameHtml = scheduleTemplateName
            ? `<span style="opacity:0.6; font-size:0.68rem; display:block; margin-top:2px; font-weight:500;">${escapeHTML(scheduleTemplateName)}</span>`
            : '';
          return `
            <div class="detail-meta-item" style="grid-column: 1 / -1; margin-top: 4px; padding: 7px 10px; border-radius: 8px; background: rgba(99,202,183,0.08); border: 1px solid rgba(99,202,183,0.2);">
              <span class="detail-meta-label" style="color: var(--accent2); font-weight: 700; font-size: 0.65rem; letter-spacing: 0.5px;">⏱ JORNADA PACTADA</span>
              <span class="detail-meta-val" style="color: ${accentColor}; font-weight: 800; font-size: 1rem;">${escapeHTML(dayLabel)}${nameHtml}</span>
            </div>`;
        })();
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
            const bar = _timelineBar(e.in, e.out);
            if (!bar) return "";
            const typeClass = safeClassToken(e.type || 'work', 'work');
            const cls = 'timeline-bar ' + typeClass + (bar.crossesMidnight ? ' crosses-midnight' : '') + (e.isLongWork ? ' over-max-segment' : '');
            const title = `${e.typeLabel || 'Trabajo'}: ${e.in} - ${e.out}`
                        + (bar.crossesMidnight ? ' (sin cerrar · cruza medianoche)' : '')
                        + (e.isLongWork ? ' ⚠ Tramo > 6h sin pausa (descanso obligatorio art. 34.4 ET)' : '');
            return '<div class="' + cls + '" style="left:' + bar.left + '%;width:' + bar.width + '%" title="' + escapeHTML(title) + '"></div>';
          }),
          ...(row.absenceSegments || []).filter(a => !a.isFullDay).map(abs => {
            const bar = _timelineBar(abs.start, abs.end);
            if (!bar) return "";
            const cls = 'timeline-bar absence' + (bar.crossesMidnight ? ' crosses-midnight' : '');
            const title = `${abs.label || 'Ausencia'}: ${abs.start.substring(0,5)} - ${abs.end.substring(0,5)}`
                        + (bar.crossesMidnight ? ' (cruza medianoche)' : '');
            return '<div class="' + cls + '" style="left:' + bar.left + '%;width:' + bar.width + '%" title="' + escapeHTML(title) + '"></div>';
          }),
          ...(row.continuationSegments || []).map(e => {
            const bar = _timelineBar(e.in, e.out);
            if (!bar) return "";
            const typeClass = safeClassToken(e.type || 'work', 'work');
            const cls = 'timeline-bar ' + typeClass + ' continues-from-prev';
            const title = `${e.typeLabel || 'Trabajo'}: ${e.in} - ${e.out}`;
            return '<div class="' + cls + '" style="left:' + bar.left + '%;width:' + bar.width + '%" title="' + escapeHTML(title) + '"></div>';
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
                        ${scheduleHtmlForDay}
                     </div>
                     ${row.hasLongWorkSegment ? `<div class="over-max-note" title="El art. 34.4 ET y el art. 28 del Convenio del Metal de Zaragoza obligan a un descanso (20 min) cuando la jornada continuada supera las 6h.">⚠ ${row.longWorkCount > 1 ? row.longWorkCount + ' tramos' : 'Tramo'} de trabajo &gt; 6h sin pausa</div>` : ''}

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
                         const bar = _timelineBar(e.in, e.out);
                         if (!bar) return "";
                         const typeClass = safeClassToken(e.type || 'work', 'work');
                         const cls = `mini-timeline-bar ${typeClass}${bar.crossesMidnight ? ' crosses-midnight' : ''}${e.isLongWork ? ' over-max-segment' : ''}`;
                         const title = `${e.typeLabel || 'Trabajo'}: ${e.in}-${e.out}${bar.crossesMidnight ? ' (sin cerrar · cruza medianoche)' : ''}${e.isLongWork ? ' ⚠ Tramo > 6h sin pausa' : ''}`;
                         return `<div class="${cls}" style="left: ${bar.left}%; width: ${bar.width}%;" title="${escapeHTML(title)}"></div>`;
                       }).join('')}
                       ${(row.continuationSegments || []).map(e => {
                         const bar = _timelineBar(e.in, e.out);
                         if (!bar) return "";
                         const typeClass = safeClassToken(e.type || 'work', 'work');
                         const cls = `mini-timeline-bar ${typeClass} continues-from-prev`;
                         const title = `${e.typeLabel || 'Trabajo'}: ${e.in}-${e.out}`;
                         return `<div class="${cls}" style="left: ${bar.left}%; width: ${bar.width}%;" title="${escapeHTML(title)}"></div>`;
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
                     <div class="info-title">🔍 AUDITORÍA Y CONTROL</div>
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
                       ${row.originsUsed.length ? row.originsUsed.map(o => {
                         const ol = o.toLowerCase();
                         const icon = ol.includes('web') ? '🌐' : (ol.includes('app') ? '📱' : (ol.includes('tablet') ? '📟' : '📍'));
                         return '<span class="detail-chip">' + icon + ' ' + escapeHTML(ol.includes('web')?'Web':ol.includes('app')?'App':ol.includes('tablet')?'Tablet':o) + '</span>';
                       }).join('') : '<span class="detail-chip detail-chip-empty">Sin datos</span>'}
                     </div>

                     <div class="detail-divider"></div>
                     <div class="info-title" style="font-size:0.6rem; opacity:0.6">DETALLES TÉCNICOS</div>
                     <div class="detail-chips">
                       ${(row.devicesUsed.length || row.officesUsed.length)
                         ? row.devicesUsed.map(d => '<span class="detail-chip">💻 ' + escapeHTML(d) + '</span>').join('')
                           + row.officesUsed.map(o => '<span class="detail-chip">🏢 ' + escapeHTML(o) + '</span>').join('')
                         : '<span class="detail-chip detail-chip-empty">Sin datos</span>'}
                     </div>
                   </div>
                   <!-- COL 4: SEGURIDAD E HISTORIAL -->
                   <div class="stats-bento-section">
                     <div class="info-title">🛡️ SEGURIDAD E HISTORIAL</div>
                     <div class="detail-meta-grid" style="grid-template-columns: 1fr; gap: 4px;" id="audit-level-3-${safeClassToken(empId, 'emp')}-${safeClassToken(row.date, 'date')}">
                        ${(() => {
                           let preAuditHTML = '';
                           const seenEditors = new Set();

                           row.entries.forEach(e => {
                             const isEditedIn = e.performedByNameIn && String(e.performedByIdIn) !== String(row.employeeId);
                             const isEditedOut = e.performedByNameOut && String(e.performedByIdOut) !== String(row.employeeId);

                             if (isEditedIn && !seenEditors.has('in_'+e.performedByNameIn)) {
                                 preAuditHTML += `<div class="detail-meta-item audit-event-row warn">
                                    <span class="detail-meta-label">✏️ Edición In</span>
                                    <span class="detail-meta-val">${escapeHTML(e.performedByNameIn)}</span>
                                 </div>`;
                                 seenEditors.add('in_'+e.performedByNameIn);
                              }
                              if (isEditedOut && !seenEditors.has('out_'+e.performedByNameOut)) {
                                 preAuditHTML += `<div class="detail-meta-item audit-event-row warn">
                                    <span class="detail-meta-label">✏️ Edición Out</span>
                                    <span class="detail-meta-val">${escapeHTML(e.performedByNameOut)}</span>
                                 </div>`;
                                 seenEditors.add('out_'+e.performedByNameOut);
                              }

                              if (e.originIn === 'request' && !seenEditors.has('req_in')) {
                                 preAuditHTML += `<div class="detail-meta-item audit-event-row warn">
                                    <span class="detail-meta-label">📝 Origen Entrada</span>
                                    <span class="detail-meta-val">Por Solicitud (Aprobada)</span>
                                 </div>`;
                                 seenEditors.add('req_in');
                              }
                              if (e.originOut === 'request' && !seenEditors.has('req_out')) {
                                 preAuditHTML += `<div class="detail-meta-item audit-event-row warn">
                                    <span class="detail-meta-label">📝 Origen Salida</span>
                                    <span class="detail-meta-val">Por Solicitud (Aprobada)</span>
                                 </div>`;
                                 seenEditors.add('req_out');
                              }
                           });

                           return preAuditHTML || '<div class="stat-subtext audit-loading-hint">⏳ Cargando auditoría…</div>';
                        })()}
                     </div>

                     ${row.absenceLabel ? `
                     <div class="detail-divider"></div>
                     <div class="info-title">📌 NOTA AUSENCIA</div>
                     <div class="stat-subtext" style="color:var(--accent2); font-weight:600">${safeAbsenceLabel}</div>
                     ` : ''}

                     ${row.isLive ? `
                     <div class="detail-divider"></div>
                     <div class="detail-audit-live"><span class="pulse-dot green" style="margin-left:0;"></span> <span>Jornada en curso</span></div>
                     ` : ''}
                   </div>
                </div>

                <!-- 2. Detailed Table (Bottom) -->
                <div class="signings-table-wrapper">
                  <div class="details-table-title">🧾 DETALLE DE FICHAJES <span class="detail-stat-badge">${(row.entries || []).length} tramo${(row.entries || []).length === 1 ? '' : 's'}</span></div>
                  <table class="details-tech-table">
                    <thead><tr><th>HORARIO</th><th>DURACIÓN</th><th>TIPO</th><th>ORIGEN</th><th>UBICACIÓN</th></tr></thead>
                    <tbody>
	                      ${(() => {
                          const absItems = _getAbsenceTableItems(row.absenceSegments, row.entries);
                          const entryItems = (row.entries || []).map(e => {
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
                        const outIn = e.insideOfficeIn === false;
                        const outOut = e.insideOfficeOut === false;
                        const inIcon = outIn ? '🚩' : '📍';
                        const outIcon = outOut ? '🚩' : '📍';
                        const inFlagCls = outIn ? ' loc-link-out' : '';
                        const outFlagCls = outOut ? ' loc-link-out' : '';
                        const inFlagTitle = outIn ? ' — 🚩 FUERA de la oficina' : '';
                        const outFlagTitle = outOut ? ' — 🚩 FUERA de la oficina' : '';
		                        const safeLocInTime = escapeHTML(e.in || '--:--');
		                        const safeLocOutTime = escapeHTML(e.out || '--:--');
		                        const locIn = hasCoordIn ? `<button type="button" title="Ver entrada en mapa: ${latIn}, ${lonIn}${inFlagTitle}" class="loc-link${inFlagCls}" data-lat="${latIn}" data-lon="${lonIn}" data-kind="Entrada" data-time="${safeLocInTime}" data-employee="${safeEmpName}" data-origin="${escapeHTML(e.originIn || '')}" data-device="${escapeHTML(e.deviceNameIn || '')}">${inIcon} In</button>` : (safeAddrIn ? `<span class="loc-addr" title="Dirección entrada: ${safeAddrIn}">📍 ${safeAddrIn}</span>` : '');
		                        const locOut = hasCoordOut ? `<button type="button" title="Ver salida en mapa: ${latOut}, ${lonOut}${outFlagTitle}" class="loc-link${outFlagCls}" data-lat="${latOut}" data-lon="${lonOut}" data-kind="Salida" data-time="${safeLocOutTime}" data-employee="${safeEmpName}" data-origin="${escapeHTML(e.originOut || '')}" data-device="${escapeHTML(e.deviceNameOut || '')}">${outIcon} Out</button>` : (safeAddrOut ? `<span class="loc-addr" title="Dirección salida: ${safeAddrOut}">📍 ${safeAddrOut}</span>` : '');
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
                        // Dispositivo de fichaje (p. ej. la tablet concreta). Si entrada y
                        // salida usaron dispositivos distintos, se muestran ambos.
                        const devIn = (e.deviceNameIn || '').trim();
                        const devOut = (e.deviceNameOut || '').trim();
                        const deviceText = (devIn && devOut && devIn !== devOut) ? `${devIn} → ${devOut}` : (devIn || devOut);
                        const deviceHtml = deviceText ? `<span class="td-device" title="Dispositivo de fichaje: ${escapeHTML(deviceText)}" style="display:block;font-size:0.66rem;opacity:0.6;margin-top:2px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📟 ${escapeHTML(deviceText)}</span>` : '';
	                        const longWorkBadge = e.isLongWork ? ' <span class="over-max-flag" title="Tramo de trabajo continuo de más de 6h. El art. 34.4 ET y el art. 28 del Convenio del Metal de Zaragoza exigen un descanso cuando la jornada continuada supera las 6h.">⚠</span>' : '';

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

	                        const html = `
	                        <tr class="${highlightClass}">
	                          <td><strong title="${safeAuditTooltip}">${safeIn} - ${safeOut}</strong></td>
	                          <td><span class="td-duration${e.isLongWork ? ' td-duration-over' : ''}">${safeDuration}</span>${longWorkBadge}</td>
	                          <td><span class="signing-type-badge ${typeCls}">${icon} ${safeTypeLabel}</span></td>
	                          <td>${originContent}${deviceHtml}</td>
	                          <td>${locContent}</td>
                        </tr>`;
                            return { start: safeIn, html };
                          });
                          return [...absItems, ...entryItems].sort((a, b) => {
                            const parseT = (t) => {
                              if (!t || t === '--:--') return 0;
                              const [h, m] = t.split(':').map(Number);
                              return (isNaN(h) ? 0 : h * 60) + (isNaN(m) ? 0 : m);
                            };
                            return parseT(a.start) - parseT(b.start);
                          }).map(x => x.html).join('');
                        })()}
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
	              employee: button.dataset.employee,
              origin: button.dataset.origin,
              device: button.dataset.device
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

      // Quitar el placeholder de carga si sigue presente
      if (container.innerHTML.includes('Cargando auditoría')) {
         container.innerHTML = '';
      }

      if (unique.length > 0) {
        let html = '';
        unique.forEach(a => {
          html += `<div class="detail-meta-item audit-event-row">
            <span class="detail-meta-label">${a.icon} ${escapeHTML(a.label)}</span>
            <span class="detail-meta-val">${escapeHTML(a.value)}</span>
          </div>`;
        });
        container.insertAdjacentHTML('beforeend', html);
      } else if (container.innerHTML.trim() === '') {
        container.innerHTML = '<div class="stat-subtext">Sin incidencias técnicas extra.</div>';
      }
    } catch (err) {
      console.error("Error Level 3:", err);
      if (container.innerHTML.includes('Cargando auditoría')) {
         container.innerHTML = '<div class="stat-subtext" style="color:var(--danger)">Error al cargar metadatos.</div>';
      }
    }
  },

  // ─── Helpers genéricos de descarga ──────────────────────────────────────
  _downloadBlob(content, mime, filename) {
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
  },

  _csvEscape(value) {
    const s = String(value ?? '');
    if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  },

  _buildFilenameContext() {
    const { start, end } = this.getCurrentRangeKeys();
    const company = (STATE.companies.find(c => c.companyId === STATE.companyId) || {}).name || 'sesame';
    const safeCompany = String(company).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
    const empPart = this.selectedEmployee && this.selectedEmployee !== 'all'
      ? `_emp_${String(this.selectedEmployee).slice(0, 8)}`
      : '_todos';
    return { start, end, safeCompany, empPart };
  },

  exportToCSV() {
    // Contextual: en vista balance exporta balances por empleado, en mes/sem/día fichajes
    if (this.currentView === 'balance') return this._exportBalanceCSV();
    return this._exportSigningsCSV();
  },

  exportToJSON() {
    if (this.currentView === 'balance') return this._exportBalanceJSON();
    return this._exportSigningsJSON();
  },

  // ─── Export FICHAJES (mes/semana/día) ───────────────────────────────────
  _exportSigningsCSV() {
    const visibleRows = this.getFilteredRows();
    if (!visibleRows || visibleRows.length === 0) return toastWarn("No hay datos visibles para exportar");

    const ctx = this._buildFilenameContext();
    const esc = v => this._csvEscape(v);

    let csv = 'Empleado;Fecha;DiaSemana;Entrada;Salida;Duracion;Tipo;Localizacion\n';
    visibleRows.forEach(row => {
      (row.entries || []).forEach(e => {
        csv += [
          esc(row.employeeName),
          esc(row.date),
          esc(row.dayName || ''),
          esc(e.in),
          esc(e.out),
          esc(e.duration),
          esc(e.typeLabel),
          esc(e.addrIn || e.addrOut || (Number.isFinite(Number(e.latIn)) && Number.isFinite(Number(e.lonIn)) ? `${e.latIn}, ${e.lonIn}` : ''))
        ].join(';') + '\n';
      });
    });

    this._downloadBlob(
      csv, 'text/csv;charset=utf-8;',
      `fichajes_${ctx.safeCompany}${ctx.empPart}_${ctx.start}_a_${ctx.end}.csv`
    );
  },

  _exportSigningsJSON() {
    const visibleRows = this.getFilteredRows();
    if (!visibleRows || visibleRows.length === 0) return toastWarn("No hay datos visibles para exportar");

    const ctx = this._buildFilenameContext();
    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown',
        company: ctx.safeCompany,
        range: { from: ctx.start, to: ctx.end },
        selectedEmployee: this.selectedEmployee || 'all',
        searchQuery: this.searchQuery || '',
        view: this.currentView,
        rowCount: visibleRows.length
      },
      rows: visibleRows
    };
    this._downloadBlob(
      JSON.stringify(payload, null, 2), 'application/json',
      `fichajes_${ctx.safeCompany}${ctx.empPart}_${ctx.start}_a_${ctx.end}.json`
    );
  },

  // ─── Export BALANCES (vista balance) ────────────────────────────────────
  _getVisibleBalanceEmployeeIds() {
    const ids = this.getBalanceEmployeeIds({ applySearch: true });
    if (this.selectedEmployee && this.selectedEmployee !== 'all') {
      return ids.filter(id => String(id) === String(this.selectedEmployee));
    }
    return ids;
  },

  _exportBalanceCSV() {
    const empIds = this._getVisibleBalanceEmployeeIds();
    if (!empIds.length) return toastWarn('No hay empleados visibles para exportar balances');

    const ctx = this._buildFilenameContext();
    const fmtSecHM = s => {
      const v = Number(s || 0);
      const sign = v < 0 ? '-' : '';
      const abs = Math.abs(v);
      return `${sign}${Math.floor(abs/3600)}h ${Math.floor((abs%3600)/60)}m`;
    };
    const esc = v => this._csvEscape(v);

    let csv = [
      'Empleado','Trabajado','Teorico','Balance','Fuente','Jornadas',
      'Dias_trabajados','Dias_teoricos','Ajuste_jornada','Pausas',
      'Entrada_media','Salida_media','Ausencias','Vacaciones',
      'Balance_local','Balance_oficial_Sesame'
    ].join(';') + '\n';

    empIds.forEach(empId => {
      try {
        const s = this.buildBalanceEmployeeSummary(empId);
        const _csvUseOfficial = this.balanceLiveMode !== 'closed';
        const usedBalance = (_csvUseOfficial && s.officialBalance != null) ? s.officialBalance : s.localAdjustedBalance;
        const usedWorked  = (_csvUseOfficial && s.officialWorked != null) ? s.officialWorked : s.worked;
        const usedTheo    = (_csvUseOfficial && s.officialTheoretic != null) ? s.officialTheoretic : s.theoretic;
        const fmtClock = m => {
          if (m === null || m === undefined) return '';
          const n = Math.max(0, Math.floor(Number(m) || 0));
          return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
        };
        csv += [
          esc(s.name),
          esc(fmtSecHM(usedWorked)),
          esc(fmtSecHM(usedTheo)),
          esc((usedBalance >= 0 ? '+' : '') + fmtSecHM(usedBalance)),
          esc(s.source),
          (s.rows || []).length,
          s.workedDays,
          s.theoreticDays,
          esc(fmtSecHM(s.compensated)),
          esc(fmtSecHM(s.pause)),
          esc(fmtClock(s.averageEntryMinutes)),
          esc(fmtClock(s.averageExitMinutes)),
          s.absenceEvents,
          s.vacationEvents,
          esc((s.localAdjustedBalance >= 0 ? '+' : '') + fmtSecHM(s.localAdjustedBalance)),
          esc(s.officialBalance !== null ? ((s.officialBalance >= 0 ? '+' : '') + fmtSecHM(s.officialBalance)) : '')
        ].join(';') + '\n';
      } catch (err) {
        console.warn(`Balance export failed for ${empId}:`, err);
      }
    });

    this._downloadBlob(
      csv, 'text/csv;charset=utf-8;',
      `balances_${ctx.safeCompany}${ctx.empPart}_${ctx.start}_a_${ctx.end}.csv`
    );
  },

  _exportBalanceJSON() {
    const empIds = this._getVisibleBalanceEmployeeIds();
    if (!empIds.length) return toastWarn('No hay empleados visibles para exportar balances');

    const ctx = this._buildFilenameContext();
    const employees = empIds.map(empId => {
      try {
        const s = this.buildBalanceEmployeeSummary(empId);
        return {
          id: String(empId),
          name: s.name,
          source: s.source,
          worked: s.worked,
          theoretic: s.theoretic,
          compensated: s.compensated,
          compensatedApplied: s.compensatedApplied,
          pause: s.pause,
          localBaseBalance: s.localBaseBalance,
          bagAdjustment: s.bagAdjustment,
          localAdjustedBalance: s.localAdjustedBalance,
          officialBalance: s.officialBalance,
          officialWorked: s.officialWorked,
          officialTheoretic: s.officialTheoretic,
          workedDays: s.workedDays,
          theoreticDays: s.theoreticDays,
          workSegments: s.workSegments,
          pauseSegments: s.pauseSegments,
          averageEntryMinutes: s.averageEntryMinutes,
          averageExitMinutes: s.averageExitMinutes,
          averageWorkdaySeconds: s.averageWorkdaySeconds,
          averagePauseSeconds: s.averagePauseSeconds,
          absenceEvents: s.absenceEvents,
          vacationEvents: s.vacationEvents,
          liveDays: s.liveDays,
          jornadasCount: (s.rows || []).length
        };
      } catch (err) {
        return { id: String(empId), error: String(err?.message || err) };
      }
    });

    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown',
        company: ctx.safeCompany,
        range: { from: ctx.start, to: ctx.end },
        scope: this.isBalanceMonthScope() ? 'month' : 'year',
        selectedEmployee: this.selectedEmployee || 'all',
        employeeCount: employees.length
      },
      employees
    };
    this._downloadBlob(
      JSON.stringify(payload, null, 2), 'application/json',
      `balances_${ctx.safeCompany}${ctx.empPart}_${ctx.start}_a_${ctx.end}.json`
    );
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

  // Estadísticas de dispositivos/origen sobre los fichajes visibles (Tier 1).
  // Agrega por evento de check (entrada y salida): canal (Web/App/Tablet),
  // terminal concreto (deviceName) y dentro/fuera de oficina (insideOffice).
  renderDeviceStats() {
    const body = document.getElementById('insight-devices-body');
    if (!body) return;
    const countEl = document.getElementById('insight-devices-count');
    const rows = this.getFilteredRows();

    const channel = {};
    const channelIcon = {};
    const device = {};
    const office = { inside: 0, outside: 0, unknown: 0 };
    let events = 0;

    const tally = (origin, dev) => {
      const meta = getOriginMeta(origin || '');
      channel[meta.label] = (channel[meta.label] || 0) + 1;
      channelIcon[meta.label] = meta.icon;
      const d = (dev || '').trim();
      if (d) device[d] = (device[d] || 0) + 1;
      events++;
    };

    rows.forEach(row => (row.entries || []).forEach(e => {
      tally(e.originIn, e.deviceNameIn);
      if (e.out && e.out !== '--:--') tally(e.originOut, e.deviceNameOut);
      if (e.insideOfficeIn === true) office.inside++;
      else if (e.insideOfficeIn === false) office.outside++;
      else office.unknown++;
    }));

    if (countEl) countEl.textContent = String(Object.keys(device).length);

    if (events === 0) {
      body.innerHTML = '<div class="dev-stats-empty">Sin fichajes en el rango seleccionado.</div>';
      return;
    }

    const pct = n => Math.round((n / events) * 100);

    const channelRows = Object.entries(channel).sort((a, b) => b[1] - a[1]).map(([label, n]) => `
      <div class="dev-bar-row">
        <span class="dev-bar-label">${channelIcon[label] || '📍'} ${escapeHTML(label)}</span>
        <span class="dev-bar-track"><span class="dev-bar-fill" style="width:${pct(n)}%"></span></span>
        <span class="dev-bar-val">${n} · ${pct(n)}%</span>
      </div>`).join('');

    const officeTotal = office.inside + office.outside + office.unknown;
    const officeLine = (office.inside + office.outside) > 0
      ? `<div class="dev-office-line">🏢 En oficina <strong>${Math.round((office.inside / officeTotal) * 100)}%</strong> · 📍 Fuera <strong>${Math.round((office.outside / officeTotal) * 100)}%</strong>${office.unknown ? ` · ❓ s/dato <strong>${Math.round((office.unknown / officeTotal) * 100)}%</strong>` : ''}</div>`
      : '';

    const devEntries = Object.entries(device).sort((a, b) => b[1] - a[1]);
    const maxDev = devEntries.length ? devEntries[0][1] : 1;
    const deviceRows = devEntries.length
      ? devEntries.slice(0, 6).map(([name, n]) => `
        <div class="dev-bar-row">
          <span class="dev-bar-label" title="${escapeHTML(name)}">📟 ${escapeHTML(name)}</span>
          <span class="dev-bar-track"><span class="dev-bar-fill" style="width:${Math.round((n / maxDev) * 100)}%"></span></span>
          <span class="dev-bar-val">${n}</span>
        </div>`).join('')
      : '<div class="dev-stats-empty">Sin nombre de terminal (la app móvil y la web no siempre lo reportan).</div>';

    body.innerHTML = `
      <div class="dev-stats-block">
        <div class="dev-stats-title">Canal de fichaje</div>
        ${channelRows}
        ${officeLine ? `<div style="margin-top:10px;">${officeLine}</div>` : ''}
      </div>
      <div class="dev-stats-block">
        <div class="dev-stats-title">Terminales más usados</div>
        ${deviceRows}
      </div>`;
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

    // Resumen del toggle (visible cuando las secciones están colapsadas)
    const sumEl = document.getElementById('insights-toggle-sum');
    if (sumEl) {
      sumEl.textContent = `${incidents.length} incidencias · ${validations.length} validaciones · ${anomalies.length} anomalías · ${upcoming.length} solicitudes`;
    }

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
      if (row.isLive) acc.liveDays += 1;
      if (this.balanceLiveMode === 'closed' && row.isLive) return acc;
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

    // Proyectar teórico del día vivo y días futuros solo en vista mensual.
    // En vista anual se usan solo días cerrados para no inflar el teórico anual.
    if (this.currentView === 'month' || this.isBalanceMonthScope()) {
      const _todayKey = getLocalDateKey();
      const _todayDate = new Date(_todayKey + 'T00:00:00');
      const _monthLastDay = new Date(_todayDate.getFullYear(), _todayDate.getMonth() + 1, 0);
      const _monthEndKey = getLocalDateKey(_monthLastDay);
      const { end: _rangeEnd } = this.getCurrentRangeKeys();
      const _projEnd = _monthEndKey < _rangeEnd ? _monthEndKey : _rangeEnd;
      if (_projEnd >= _todayKey) {
        const _coveredDates = new Set(rows.map(r => r.date));
        const _empObj = STATE.allEmployees.get(id);
        const _todayRow = rows.find(r => r.date === _todayKey);
        // En modo "Sin hoy" la fila live queda fuera del reduce, pero su teórico
        // sí cuenta para el teórico del mes completo (criterio Sesame).
        const _todayExcludedLive = this.balanceLiveMode === 'closed' && !!(_todayRow && _todayRow.isLive);
        // Día de hoy (si no tiene fila o su fila live quedó excluida) + futuros laborables
        let _cursor = _todayKey;
        while (_cursor <= _projEnd) {
          const _isToday = _cursor === _todayKey;
          const _needsTheoretic = _isToday
            ? (!_coveredDates.has(_cursor) || _todayExcludedLive)
            : !_coveredDates.has(_cursor);
          if (isWeekdayDateKey(_cursor) && _needsTheoretic) {
            let _dayTh;
            if (_isToday && _todayExcludedLive && Number(_todayRow.theoreticSeconds || 0) > 0) {
              _dayTh = Number(_todayRow.theoreticSeconds || 0);
            } else {
              const _ovKey = `${id}_${_cursor}`;
              const _ov = this.dayOverrides?.get(_ovKey);
              if (_ov && _ov.workdayOverride !== null) {
                _dayTh = Number(_ov.workdayOverride || 0);
              } else {
                const _res = _empObj ? resolveEmployeeScheduleForDate(_empObj, _cursor) : null;
                _dayTh = _res?.secondsForDay ?? 28800;
              }
            }
            if (_dayTh > 0) {
              totals.theoretic += _dayTh;
              totals.theoreticDays += 1;
            }
          }
          _cursor = addLocalDays(_cursor, 1);
        }
      }
    }

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
      source: (officialBalance !== null && this.balanceLiveMode !== 'closed') ? 'Sesame Statistics' : (bagAdjustment ? 'Local + bolsa' : 'Calculado local'),
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

  exportEmployeeBalanceJSON(employeeId, summary, startKey, endKey) {
    const empProfile = STATE.allEmployees.get(String(employeeId)) || {};
    const fmt = s => this.formatDurationCompact(Number(s || 0));
    const fmtSigned = s => {
      const v = Number(s || 0);
      const sign = v >= 0 ? '+' : '-';
      const h = Math.floor(Math.abs(v) / 3600);
      const m = Math.floor((Math.abs(v) % 3600) / 60);
      return `${sign}${h}h ${m}m`;
    };

    // Serializar cada jornada con todos sus campos relevantes
    const jornadas = (summary.rows || []).map(row => ({
      date: row.date,
      dayName: row.dayName,
      inTime: row.inTime,
      outTime: row.outTime,
      workedSeconds: row.workedSeconds,
      workedFormatted: fmt(row.workedSeconds),
      theoreticSeconds: row.theoreticSeconds,
      theoreticFormatted: fmt(row.theoreticSeconds),
      theoreticBeforeCompensation: row.theoreticBeforeCompensation,
      theoreticSource: row.theoreticSource,
      pactedSeconds: (() => {
        const _r = (empProfile && row.date) ? resolveEmployeeScheduleForDate(empProfile, row.date) : null;
        return (typeof _r?.secondsForDay === 'number') ? _r.secondsForDay : null;
      })(),
      compensatedSeconds: row.compensatedSeconds,
      compensatedFormatted: fmt(row.compensatedSeconds),
      compensatedAppliedToTheoretic: row.compensatedAppliedToTheoretic,
      compensatedItems: row.compensatedItems || [],
      totalPauseSec: row.totalPauseSec,
      pauseFormatted: fmt(row.totalPauseSec),
      balanceSec: row.balanceSec,
      balanceLabel: row.balanceLabel,
      absenceLabel: row.absenceLabel,
      absenceSegments: row.absenceSegments || [],
      workSegments: row.workSegments,
      pauseSegments: row.pauseSegments,
      isLive: row.isLive,
      eveOfNonWorkingDayLabel: row.eveOfNonWorkingDayLabel || null,
      entries: (row.entries || []).map(e => ({
        type: e.type,
        in: e.in,
        out: e.out,
        inOriginal: e.inOriginal || e.in,
        outOriginal: e.outOriginal || e.out,
        durationSec: e.durationSec,
        durationFormatted: fmt(e.durationSec),
        originIn: e.originIn || null,
        originOut: e.originOut || null,
        deviceNameIn: e.deviceNameIn || null,
        deviceNameOut: e.deviceNameOut || null,
        ipIn: e.ipIn || null,
        ipOut: e.ipOut || null,
        officeNameIn: e.officeNameIn || null,
        officeNameOut: e.officeNameOut || null,
        insideOfficeIn: e.insideOfficeIn ?? null,
        insideOfficeOut: e.insideOfficeOut ?? null,
        latIn: e.checkInLat || null,
        lonIn: e.checkInLon || null,
        latOut: e.checkOutLat || null,
        lonOut: e.checkOutLon || null,
        performedByNameIn: e.performedByNameIn || null,
        performedByIdIn: e.performedByIdIn || null,
        performedByNameOut: e.performedByNameOut || null,
        performedByIdOut: e.performedByIdOut || null,
        pendingDeletion: e.pendingDeletion || false,
        pendingEdit: e.pendingEdit || false
      }))
    }));

    // Añadir filas de días futuros laborables del mes en curso (como Sesame: 0h / 8h)
    {
      const _expToday = getLocalDateKey();
      const _expTodayDate = new Date(_expToday + 'T00:00:00');
      const _expMonthEnd = getLocalDateKey(new Date(_expTodayDate.getFullYear(), _expTodayDate.getMonth() + 1, 0));
      const _expRangeEnd = endKey < _expMonthEnd ? endKey : _expMonthEnd;
      const _expCoveredDates = new Set(jornadas.map(j => j.date));
      const _expEmp = STATE.allEmployees.get(String(employeeId));
      const _weekdayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      let _expCursor = addLocalDays(_expToday, 1);
      while (_expCursor <= _expRangeEnd) {
        if (isWeekdayDateKey(_expCursor) && !_expCoveredDates.has(_expCursor)) {
          const _expOv = this.dayOverrides?.get(`${employeeId}_${_expCursor}`);
          let _expTh;
          if (_expOv && _expOv.workdayOverride !== null) {
            _expTh = Number(_expOv.workdayOverride || 0);
          } else {
            const _expRes = _expEmp ? resolveEmployeeScheduleForDate(_expEmp, _expCursor) : null;
            _expTh = _expRes?.secondsForDay ?? 28800;
          }
          if (_expTh > 0) {
            const _expDow = new Date(_expCursor + 'T00:00:00').getDay();
            jornadas.push({
              date: _expCursor,
              dayName: _weekdayNames[_expDow] || '',
              inTime: '--:--',
              outTime: '--:--',
              workedSeconds: 0,
              workedFormatted: '0h 0m',
              theoreticSeconds: _expTh,
              theoreticFormatted: fmt(_expTh),
              theoreticBeforeCompensation: _expTh,
              theoreticSource: 'Proyectado',
              pactedSeconds: _expTh,
              compensatedSeconds: 0,
              compensatedFormatted: '0h 0m',
              compensatedAppliedToTheoretic: 0,
              compensatedItems: [],
              totalPauseSec: 0,
              pauseFormatted: '0h 0m',
              balanceSec: -_expTh,
              balanceLabel: fmt(-_expTh),
              absenceLabel: null,
              absenceSegments: [],
              workSegments: 0,
              pauseSegments: 0,
              isLive: false,
              isFutureProjected: true,
              eveOfNonWorkingDayLabel: null,
              entries: []
            });
          }
        }
        _expCursor = addLocalDays(_expCursor, 1);
      }
    }

    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown',
        company: {
          companyId: STATE.companyId,
          name: (STATE.companies.find(c => c.companyId === STATE.companyId) || {}).name || null
        },
        range: { from: startKey, to: endKey },
        scope: this.currentView === 'balance' ? (this.isBalanceMonthScope() ? 'month' : 'year') : 'period'
      },
      employee: {
        id: String(employeeId),
        name: summary.name,
        photoUrl: empProfile.imageProfileURL || null,
        jobTitle: empProfile.jobTitle || empProfile.jobChargeName || null,
        scheduleTemplateName: empProfile.scheduleTemplateName || null,
        workdaysSecondsByDayOfWeek: empProfile.workdays || null,
        birthDate: empProfile.birthDate || null
      },
      summary: {
        source: summary.source,
        worked: summary.worked,
        workedFormatted: fmt(summary.worked),
        theoretic: summary.theoretic,
        theoreticFormatted: fmt(summary.theoretic),
        compensated: summary.compensated,
        compensatedFormatted: fmt(summary.compensated),
        compensatedApplied: summary.compensatedApplied,
        pause: summary.pause,
        pauseFormatted: fmt(summary.pause),
        equivalent: summary.equivalent,
        localBaseBalance: summary.localBaseBalance,
        localBaseBalanceFormatted: fmtSigned(summary.localBaseBalance),
        bagAdjustment: summary.bagAdjustment,
        balanceLiveMode: this.balanceLiveMode,
        balanceLiveModeLabel: this.balanceLiveMode === 'closed' ? 'Solo días cerrados (sin hoy)' : 'Incluye día actual (live)',
        localAdjustedBalance: summary.localAdjustedBalance,
        localAdjustedBalanceFormatted: fmtSigned(summary.localAdjustedBalance),
        officialBalance: summary.officialBalance,
        officialBalanceFormatted: summary.officialBalance !== null ? fmtSigned(summary.officialBalance) : null,
        officialWorked: summary.officialWorked,
        officialWorkedFormatted: summary.officialWorked !== null ? fmt(summary.officialWorked) : null,
        officialTheoretic: summary.officialTheoretic,
        officialTheoreticFormatted: summary.officialTheoretic !== null ? fmt(summary.officialTheoretic) : null,
        workedDays: summary.workedDays,
        theoreticDays: summary.theoreticDays,
        workSegments: summary.workSegments,
        pauseSegments: summary.pauseSegments,
        entries: summary.entries,
        absenceEvents: summary.absenceEvents,
        vacationEvents: summary.vacationEvents,
        averageEntryMinutes: summary.averageEntryMinutes,
        averageExitMinutes: summary.averageExitMinutes,
        averageWorkdaySeconds: summary.averageWorkdaySeconds,
        averagePauseSeconds: summary.averagePauseSeconds,
        liveDays: summary.liveDays
      },
      compensatedItems: summary.compensatedItems || [],
      jornadas
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = String(summary.name || `empleado-${employeeId}`)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
    a.href = url;
    a.download = `balance_${safeName}_${startKey}_a_${endKey}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
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
    const _useOfficial = this.balanceLiveMode !== 'closed';
    const balanceUsed = (_useOfficial && summary.officialBalance != null) ? summary.officialBalance : summary.localAdjustedBalance;
    const workedUsed = (_useOfficial && summary.officialWorked != null) ? summary.officialWorked : summary.worked;
    const theoreticUsed = (_useOfficial && summary.officialTheoretic != null) ? summary.officialTheoretic : summary.theoretic;
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
    // Perfil del empleado para mostrar el horario pactado por día en el modal
    const _balEmpProfile = STATE.allEmployees.get(String(employeeId));
    const _balScheduleName = _balEmpProfile?.scheduleTemplateName || '';
    // Resuelve el horario vigente de ESE empleado en ESA fecha (override de
    // verano por fecha exacta + vistas de Sesame por rango). Devuelve segundos
    // y el nombre de la plantilla aplicada ese día (puede cambiar día a día).
    const _getScheduleForDate = (dateKey) => {
      if (!_balEmpProfile || !dateKey) return null;
      const r = resolveEmployeeScheduleForDate(_balEmpProfile, dateKey);
      if (!r || typeof r.secondsForDay !== 'number') return null;
      return { secs: r.secondsForDay, name: r.templateName || _balScheduleName };
    };
    const dayRowsHtml = summary.rows.length ? summary.rows.map((row, index) => {
      const entriesHtml = (row.entries || []).map(entry => {
        const isPause = entry.type === 'pause';
        const typeClass = isPause ? 'type-pause' : 'type-work';
        const type = isPause ? 'Pausa' : (entry.typeLabel || 'Trabajo');
        return `
          <div class="balance-day-entry ${typeClass}">
            <span>${escapeHTML(entry.in || '--:--')} - ${escapeHTML(entry.out || '--:--')}</span>
            <strong>${escapeHTML(entry.duration || '--')}</strong>
            <em>${escapeHTML(type)}</em>
          </div>
        `;
      }).join('');
      const openAttr = index === 0 ? ' open' : '';
      return `
        <details class="balance-day-card${row.absenceLabel ? ' has-absence' : ''}${row.isLive ? ' is-live' : ''}"${openAttr}>
          <summary class="balance-day-head">
            <div style="display:flex;align-items:center;gap:8px;">
              <strong>${escapeHTML(formatDayTitle(row))}</strong>
              ${row.absenceLabel ? `<span class="badge-absence">📌 ${escapeHTML(row.absenceLabel)}</span>` : ''}
              ${row.isLive ? `<span class="badge-live" title="${this.balanceLiveMode === 'closed' ? 'Jornada en curso. En modo Sin hoy queda fuera de los totales del balance.' : 'Jornada en curso, incluida en el balance.'}"><span class="pulse-dot green"></span>En curso${this.balanceLiveMode === 'closed' ? ' · fuera del balance' : ''}</span>` : ''}
            </div>
            <b class="${Number(row.balanceSec || 0) >= 0 ? 'positive' : 'negative'}">${formatSigned(row.balanceSec)}</b>
            <span class="balance-day-toggle">Detalles</span>
          </summary>
          <div class="balance-day-metrics">
            <span><strong>Trabajado</strong> ${formatDuration(row.workedSeconds)}</span>
            <span>Teórico ${formatDuration(row.theoreticSeconds)}</span>
            <span>Pausas ${formatDuration(row.totalPauseSec)}</span>
          </div>
          ${(() => {
            const sched = _getScheduleForDate(row.date);
            if (sched === null) return '';
            const secs = sched.secs;
            const sh = Math.floor(secs / 3600);
            const sm = Math.floor((secs % 3600) / 60);
            const label = secs === 0 ? 'Descanso' : sh + 'h' + (sm > 0 ? ' ' + sm + 'm' : '');
            const nameHtml = sched.name ? ' <span style="opacity:0.55;font-size:0.68rem;font-weight:500;">' + escapeHTML(sched.name) + '</span>' : '';
            return '<div style="display:flex;align-items:center;gap:6px;padding:5px 16px 10px;"><span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;background:rgba(45,212,191,0.12);border:1px solid rgba(45,212,191,0.22);color:#2dd4bf;font-size:0.68rem;font-weight:800;letter-spacing:0.3px;">⏱ Pactado ' + escapeHTML(label) + '</span>' + nameHtml + '</div>';
          })()}
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
            <p>${safeRange} · ${summary.rows.length} jornadas · <span class="balance-mode-chip ${this.balanceLiveMode === 'closed' ? 'closed' : 'live'}">${this.balanceLiveMode === 'closed' ? 'Sin hoy' : 'Con hoy'}</span></p>
            <div class="balance-title-actions">
              <button class="balance-export-json-btn" type="button" data-employee-id="${escapeHTML(String(employeeId))}" title="Descargar JSON con todos los fichajes y métricas del periodo" aria-label="Descargar JSON de fichajes">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Descargar JSON
              </button>
              <button class="balance-manage-schedule-btn" type="button" data-employee-id="${escapeHTML(String(employeeId))}" title="Editar plantilla de jornada del empleado por día (local)" aria-label="Gestionar calendario del empleado">
                <span class="balance-action-emoji" aria-hidden="true">📅</span>
                Gestionar calendario
              </button>
            </div>
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

          <div class="balance-modal-section balance-source-section">
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

          <details class="balance-modal-section balance-modal-section-collapsible" open>
            <summary class="balance-modal-section-head">
              <strong>Ajustes de jornada retribuidos</strong>
              <span>${formatDuration(summary.compensated)} detectado · ${formatDuration(summary.compensatedApplied)} aplicado</span>
              <span class="balance-modal-section-toggle" aria-hidden="true">▾</span>
            </summary>
            <div class="balance-compensated-list">${compensatedRowsHtml}</div>
          </details>

          <details class="balance-modal-section balance-modal-section-collapsible" open>
            <summary class="balance-modal-section-head">
              <strong>Jornadas y fichajes</strong>
              <span>${summary.rows.length} dias · abre cada jornada</span>
              <span class="balance-modal-section-toggle" aria-hidden="true">▾</span>
            </summary>
            <div class="balance-days-list">${dayRowsHtml}</div>
          </details>
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
    overlay.querySelector('.balance-export-json-btn')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      try {
        this.exportEmployeeBalanceJSON(employeeId, summary, start, effectiveEnd);
      } catch (err) {
        console.error('Export JSON falló:', err);
        toastErr('No se pudo exportar el JSON: ' + (err?.message || err));
      }
    });
    overlay.querySelector('.balance-manage-schedule-btn')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Ocultar (no cerrar) el balance, abrir el gestor y al cerrar volver a mostrar el balance
      overlay.style.visibility = 'hidden';
      // Registrar en el stack para que el gestor muestre breadcrumb "‹ Balance"
      pushModalToStack({
        id: `balance_${employeeId}`,
        title: `Balance · ${summary.name || 'Empleado'}`,
        openFn: () => {
          overlay.style.visibility = 'visible';
        }
      });
      try {
        openEmployeeScheduleManager(employeeId, {
          onClose: () => {
            popModalFromStack();
            overlay.style.visibility = 'visible';
          }
        });
      } catch (err) {
        popModalFromStack();
        overlay.style.visibility = 'visible';
        console.error('No se pudo abrir el gestor de calendario:', err);
        toastErr('No se pudo abrir el gestor: ' + (err?.message || err));
      }
    });
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    let isInitializing = true;
    overlay.querySelectorAll('.balance-day-card').forEach(card => {
      card.addEventListener('toggle', () => {
        if (isInitializing || !card.open) return;
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
    window.setTimeout(() => {
      pinModalTop();
      isInitializing = false;
    }, 120);
    overlay.querySelector('.balance-employee-close')?.focus({ preventScroll: true });
    pinModalTop();
  },

  /**
   * Renderiza una vista resumen de balances acumulados por empleado.
   */
  renderBalanceTable() {
    const tbody = document.getElementById('signings-tbody');
    if (!tbody) return;
    // El balance se repinta durante todo el warmup en segundo plano: aprovechamos
    // para mantener el icono "actualizar" girando hasta que termine la carga.
    this.syncRefreshSpinner();

    // Agregamos por empleado usando las mismas filas visibles del periodo activo.
    const stats = new Map();
    let balanceRows = this.getFilteredRows({ includePresenceFilter: false });

    // En vista Balance el filtro de presencia (Trabajando/Pausa/Fuera) debe
    // filtrar EL CONJUNTO DE EMPLEADOS VISIBLES según su estado actual, no
    // filtrar filas concretas por fecha. El balance se nutre de varias fuentes
    // (filas locales, directorio, bolsa de horas oficial e histórico de reglas),
    // así que calculamos el conjunto de empleados que cumplen el estado UNA vez
    // y lo aplicamos a TODAS las fuentes; de lo contrario las fuentes oficiales
    // reinyectarían a todos los empleados y el filtro no surtiría efecto.
    let presenceMatchIds = null;
    if (this.presenceFilter && this.presenceFilter !== 'all') {
      presenceMatchIds = new Set();
      STATE.allEmployees.forEach((_, id) => {
        const status = this.getCurrentActivityKind(id);
        if (this.presenceFilter === 'working' && (status === 'working' || status === 'remote')) {
          presenceMatchIds.add(String(id));
        } else if (this.presenceFilter === 'paused' && status === 'paused') {
          presenceMatchIds.add(String(id));
        } else if (this.presenceFilter === 'out' && (status === 'out' || !status)) {
          presenceMatchIds.add(String(id));
        }
      });
      balanceRows = balanceRows.filter(r => presenceMatchIds.has(String(r.employeeId)));
    }

    balanceRows.forEach(row => {
      if (this.balanceLiveMode === 'closed' && row.isLive) return;
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

    // Teórico proyectado solo en vista mensual (no en anual: evita inflar el total).
    if (this.currentView === 'month' || this.isBalanceMonthScope()) {
      const _btToday = getLocalDateKey();
      const _btTodayDate = new Date(_btToday + 'T00:00:00');
      const _btMonthLastDay = new Date(_btTodayDate.getFullYear(), _btTodayDate.getMonth() + 1, 0);
      const _btMonthEndKey = getLocalDateKey(_btMonthLastDay);
      const { end: _btRangeEnd } = this.getCurrentRangeKeys();
      const _btEnd = _btMonthEndKey < _btRangeEnd ? _btMonthEndKey : _btRangeEnd;
      if (_btEnd >= _btToday) {
        stats.forEach((stat, empId) => {
          if (stat.hasOfficialBalance) return;
          const _btEmp = STATE.allEmployees.get(empId);
          const _btEmpRows = balanceRows.filter(r => String(r.employeeId) === empId);
          const _btCovered = new Set(_btEmpRows.map(r => r.date));
          const _btTodayRow = _btEmpRows.find(r => r.date === _btToday);
          const _btTodayExcluded = this.balanceLiveMode === 'closed' && !!(_btTodayRow && _btTodayRow.isLive);
          // Día de hoy (sin fila o con fila live excluida) + futuros laborables
          let _btCursor = _btToday;
          while (_btCursor <= _btEnd) {
            const _btIsToday = _btCursor === _btToday;
            const _btNeeds = _btIsToday
              ? (!_btCovered.has(_btCursor) || _btTodayExcluded)
              : !_btCovered.has(_btCursor);
            if (isWeekdayDateKey(_btCursor) && _btNeeds) {
              let _btTh;
              if (_btIsToday && _btTodayExcluded && Number(_btTodayRow.theoreticSeconds || 0) > 0) {
                _btTh = Number(_btTodayRow.theoreticSeconds || 0);
              } else {
                const _btOv = this.dayOverrides?.get(`${empId}_${_btCursor}`);
                if (_btOv && _btOv.workdayOverride !== null) {
                  _btTh = Number(_btOv.workdayOverride || 0);
                } else {
                  const _btRes = _btEmp ? resolveEmployeeScheduleForDate(_btEmp, _btCursor) : null;
                  _btTh = _btRes?.secondsForDay ?? 28800;
                }
              }
              if (_btTh > 0) stat.localTheoreticSeconds += _btTh;
            }
            _btCursor = addLocalDays(_btCursor, 1);
          }
        });
      }
    }

    this.getBalanceEmployeeIds({ applySearch: true }).forEach(id => {
      const rowId = String(id);
      if (presenceMatchIds && !presenceMatchIds.has(rowId)) return;
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
        if (presenceMatchIds && !presenceMatchIds.has(rowId)) return;

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
        if (presenceMatchIds && !presenceMatchIds.has(String(id))) return;

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
        // En modo "Sin hoy" el dato oficial de Sesame no sirve: incluye el dia en curso.
        if (typeof officialBalance === 'number' && this.balanceLiveMode !== 'closed') {
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
      // Si el vacío se debe al filtro de presencia (Trabajando/Pausa), lo decimos
      // explícitamente para que quede claro que NO es falta de datos, sino que
      // ahora mismo no hay nadie en ese estado.
      const presenceEmpty = {
        working: { icon: '🟢', title: 'Nadie está trabajando ahora', msg: 'No hay ningún compañero fichado y activo en este momento. Quita el filtro «Trab.» para ver el balance de todo el equipo.' },
        paused: { icon: '🟡', title: 'Nadie está en pausa ahora', msg: 'Ningún compañero está en pausa en este momento. Quita el filtro «Pausa» para ver el balance de todo el equipo.' }
      };
      const presenceCard = (this.presenceFilter && this.presenceFilter !== 'all') ? presenceEmpty[this.presenceFilter] : null;
      const card = presenceCard || {
        icon: '⚖️',
        title: 'Sin datos de balance',
        msg: 'No hay fichajes suficientes en este rango para calcular el balance.'
      };
      tbody.innerHTML = `
        <tr><td colspan="5" style="padding: 0;">
          <div class="empty-state-card">
            <div class="empty-state-icon" aria-hidden="true">${card.icon}</div>
            <h3 class="empty-state-title">${escapeHTML(card.title)}</h3>
            <p class="empty-state-msg">${escapeHTML(card.msg)}</p>
            ${presenceCard ? `<button type="button" class="btn-secondary btn-compact" onclick="FichajesModule.togglePresenceFilter('${this.presenceFilter}')" style="margin-top:12px;">Quitar filtro</button>` : ''}
          </div>
        </td></tr>`;
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
      ? 'Recargar ejercicio'
      : `Ejercicio ${currentExerciseYear}`;
    const _isLiveMode = this.balanceLiveMode !== 'closed';
    const balanceScopeActionHtml = `
      <button
        type="button"
        class="btn-secondary balance-scope-btn"
        onclick="FichajesModule.goToCurrentExerciseBalance(true)"
        title="Ver el balance del ejercicio actual completo"
      >
        ${exerciseButtonLabel}
      </button>
      <span class="balance-live-toggle" role="group" aria-label="Modo de cálculo del día actual">
        <button type="button" class="${_isLiveMode ? 'active' : ''}" aria-pressed="${_isLiveMode}" onclick="FichajesModule.setBalanceLiveMode('live')" title="Incluir día actual (sesión abierta)">Con hoy</button>
        <button type="button" class="${!_isLiveMode ? 'active' : ''}" aria-pressed="${!_isLiveMode}" onclick="FichajesModule.setBalanceLiveMode('closed')" title="Solo días cerrados (sin sesión de hoy)">Sin hoy</button>
      </span>
    `;
    const sourceActionsHtml = officialSkipped
      ? '<button type="button" class="btn-secondary" onclick="FichajesModule.retryOfficialWorkedHours()" style="font-size:0.62rem; padding:3px 7px;" title="Reintentar el balance oficial de Sesame Statistics">Probar Sesame</button>'
      : '<button type="button" class="btn-secondary" onclick="FichajesModule.useLocalBalanceOnly()" style="font-size:0.62rem; padding:3px 7px;" title="Usar solo el cálculo local, sin consultar Sesame Statistics">Solo local</button>';
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
        <td colspan="5" style="padding: 5px 12px; background: rgba(45, 212, 191, 0.07); border-bottom: 1px solid rgba(45, 212, 191, 0.16);">
          ${loadingPanelHtml}
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; font-size:0.66rem; color:var(--text-muted); ${loadingPanelHtml ? 'margin-top:8px;' : ''}">
            <span class="balance-source-breakdown">
            <strong style="color:var(--text-primary); font-size:0.68rem;" title="Origen de los datos de balance de cada empleado">Fuente</strong>
            <span style="display:inline-flex; align-items:center; gap:5px;" title="Balances confirmados por Sesame Statistics">
              <span style="width:6px; height:6px; border-radius:50%; background:#2dd4bf;"></span>
              ${officialCount} Sesame
            </span>
            <span style="display:inline-flex; align-items:center; gap:5px;" title="Balances calculados localmente">
              <span style="width:6px; height:6px; border-radius:50%; background:#f59e0b;"></span>
              ${localCount} local
            </span>
            <span style="display:inline-flex; align-items:center; gap:5px;" title="Pendientes de respuesta de Sesame">
              <span style="width:6px; height:6px; border-radius:50%; background:#94a3b8;"></span>
              ${pendingCount} pend.
            </span>
            <span style="display:inline-flex; align-items:center; gap:5px;" title="Cálculo local ajustado con la bolsa de horas de Sesame">
              <span style="width:6px; height:6px; border-radius:50%; background:#60a5fa;"></span>
              ${adjustedLocalCount} bolsa
            </span>
            <span style="display:inline-flex; align-items:center; gap:5px;" title="Empleados con error o sin datos">
              <span style="width:6px; height:6px; border-radius:50%; background:#f87171;"></span>
              ${errorCount} error
            </span>
            ${officialSkipped ? '<span style="color:#f59e0b;" title="Sesame Statistics desactivado manualmente">Local manual</span>' : ''}
            ${this.balanceLiveMode === 'closed' ? '<span style="color:#2dd4bf;" title="El balance oficial de Sesame incluye el día en curso, por eso en este modo se usa el cálculo local de días cerrados.">Sin hoy: local</span>' : ''}
            ${lastError && !officialSkipped ? `<span title="${escapeHTML(lastError)}" style="color:#f59e0b;">Último error</span>` : ''}
            </span>
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

      // Tooltips contextuales (multilínea con \n + white-space:pre-line en CSS)
      const fmtH = s => {
        const v = Number(s || 0);
        const sign = v < 0 ? '-' : '';
        const abs = Math.abs(v);
        return `${sign}${Math.floor(abs / 3600)}h ${Math.floor((abs % 3600) / 60)}m`;
      };
      const periodTooltip = [
        `Trabajado: ${fmtH(stat.localEquivalentSeconds)}`,
        `Teórico: ${fmtH(stat.localTheoreticSeconds)}`,
        `Diferencia: ${fmtH(stat.periodBalance)}`,
        ``,
        `Fuente: ${sourceLabel}`
      ].join('\n');
      const stateTooltip = balanceTone.label === 'Superávit'
        ? `${balanceTone.label}\nEl empleado tiene horas a favor para este ${scopeLabel}.`
        : balanceTone.label === 'Déficit'
          ? `${balanceTone.label}\nEl empleado debe horas para este ${scopeLabel}.`
          : `Cuadrado\nTrabajado y teórico empatan.`;
      const cumplimientoPct = stat.localTheoreticSeconds > 0
        ? Math.round((stat.localEquivalentSeconds / stat.localTheoreticSeconds) * 100)
        : 0;
      const progressTooltip = [
        `Cumplimiento: ${cumplimientoPct}%`,
        `Trabajado: ${fmtH(stat.localEquivalentSeconds)}`,
        `Teórico: ${fmtH(stat.localTheoreticSeconds)}`
      ].join('\n');

      return `
        <tr class="${rowClass}">
          <td>
            <div class="balance-employee-cell">
              <button type="button" class="balance-avatar-trigger" data-employee-id="${escapeHTML(rowId)}" data-tip="Ver balance ampliado de ${escapeHTML(stat.name)}" data-tip-pos="bottom">
                ${renderLocalAvatar(stat.name, stat.photo, 'balance-avatar', 'width:32px; height:32px; border-radius:50%; object-fit:cover; border: 1px solid var(--border);')}
              </button>
              <div class="balance-employee-main">
                <div class="balance-employee-name-row">
                  <span class="balance-employee-name-line" title="${escapeHTML(stat.name)}">${escapeHTML(stat.name)}</span>
                  <span class="balance-days-pill" data-tip="${escapeHTML(daysTitle)}" data-tip-pos="bottom">${escapeHTML(String(daysLabel))}</span>
                </div>
                <span class="balance-row-processing">${escapeHTML(rowPhaseLabel)}</span>
              </div>
            </div>
          </td>
          <td class="text-center">
            <div style="display:inline-flex; flex-direction:column; align-items:center; gap:4px; position:relative;" data-tip="${escapeHTML(periodTooltip)}" data-tip-pos="bottom">
              <span style="font-size: 1.1rem; font-weight: 800; color: ${mColor}">${format(stat.periodBalance)}</span>
              <span class="balance-source-badge" style="display:inline-flex; align-items:center; gap:5px; padding:2px 7px; border-radius:999px; border:1px solid ${sourceBadgeColor}40; background:${sourceBadgeColor}17; color:${sourceBadgeColor}; font-size:0.58rem; font-weight:900; text-transform:uppercase; letter-spacing:0.4px;">
                <span style="width:5px; height:5px; border-radius:50%; background:${sourceBadgeColor};"></span>
                ${sourceBadgeLabel}
              </span>
            </div>
          </td>
          <td class="text-center">
            <span data-tip="${escapeHTML(annualTitle)}" data-tip-pos="bottom" style="font-size: 0.95rem; font-weight: 500; color: ${aColor}; opacity: 0.8; display:inline-block;">${hasAnnualBalance ? format(stat.annualBalance) : '--'}</span>
          </td>
          <td class="text-center">
             <div data-tip="${escapeHTML(stateTooltip)}" data-tip-pos="bottom" style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:20px; background:${mColor}15; border: 1px solid ${mColor}30; color:${mColor}; font-size:0.65rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
               <span style="width:6px; height:6px; border-radius:50%; background:${mColor}"></span>
               ${balanceTone.label}
             </div>
          </td>
          <td style="vertical-align: middle;">
            <div data-tip="${escapeHTML(progressTooltip)}" data-tip-pos="bottom" style="height:6px; width:100%; background:rgba(255,255,255,0.05); border-radius:3px; position:relative; overflow:hidden; cursor:help;">
              <div style="position:absolute; left:0; top:0; height:100%; width:${progress}%; background:${mColor}; opacity:0.5; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
              <div style="position:absolute; left:50%; top:0; height:100%; width:1px; background:rgba(255,255,255,0.2);"></div>
            </div>
            <div class="balance-source-badge" data-tip="${escapeHTML(sourceTitle)}" data-tip-pos="bottom" style="margin-top:6px; display:inline-flex; align-items:center; gap:5px; color:${sourceColor}; font-size:0.62rem; font-weight:800; text-transform:uppercase; letter-spacing:0.4px; cursor:help;">
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
  if (!emp.birthDate || !emp.hiringDate || !emp.phone || !emp.workdays) {
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

        <div class="contact-card-actions">
          <button class="contact-card-action-btn" data-action="manage-schedule" type="button">
            <span class="contact-card-action-icon">📅</span>
            <span>Gestionar calendario</span>
            <span class="contact-card-action-hint">Asignar plantilla por día (local)</span>
          </button>
        </div>
      </div>
    </div>
  `;


  document.body.appendChild(overlay);
  overlay.querySelector('.contact-card-close').onclick = () => overlay.remove();
  overlay.querySelector('[data-action="manage-schedule"]')?.addEventListener('click', () => {
    overlay.remove();
    openEmployeeScheduleManager(emp.id);
  });
}

// ─── Modal: Gestor de Plantillas locales custom ───────────────────────────
// onClose: callback opcional para refrescar la vista que lo abrió.
async function openTemplatesManager(onClose) {
  if (!isLocalProxy()) {
    toastWarn('Solo disponible con el proxy local (server.py).');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'contact-card-overlay templates-manager-overlay';
  overlay.innerHTML = `
    <div class="templates-manager-modal animate-pop" role="dialog" aria-modal="true" aria-label="Mis plantillas">
      <header class="schedule-manager-header">
        <div class="schedule-manager-title">
          <div class="schedule-manager-avatar" style="background: linear-gradient(135deg,#22d3ee,#6366f1);">🗂️</div>
          <div>
            <h2>Mis plantillas</h2>
            <p>Plantillas locales de jornada para esta empresa</p>
          </div>
        </div>
        <button class="schedule-manager-close" aria-label="Cerrar">&times;</button>
      </header>

      <div class="templates-toolbar">
        <button class="btn-primary" data-action="new" type="button">➕ Nueva plantilla</button>
        <button class="btn-secondary" data-action="import-detected" type="button" title="Importa como locales todas las plantillas que ya tienen asignadas los empleados de la empresa">🔍 Importar plantillas detectadas</button>
        <button class="btn-secondary" data-action="cleanup" type="button" title="Fusiona o borra plantillas duplicadas (mismo nombre o mismos minutos)">🧹 Limpiar duplicados</button>
        <button class="btn-secondary templates-purge-btn" data-action="purge" type="button" title="Borra TODAS tus plantillas locales y los overrides que las usan">🗑️ Borrar todas</button>
      </div>

      <div class="templates-list" data-templates-list>
        <div class="templates-empty">Cargando plantillas...</div>
      </div>

      <div class="templates-detected-section" data-detected-section></div>

      <footer class="schedule-manager-footer">
        <span>Las plantillas viven en <code>config.schedules.json</code>. Sesame no se modifica.</span>
        <button class="btn-secondary schedule-toolbar-btn" data-action="done" type="button">Hecho</button>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);

  const $list = overlay.querySelector('[data-templates-list]');
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (typeof onClose === 'function') onClose();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const visible = Array.from(document.querySelectorAll('.contact-card-overlay'))
      .filter(o => o.style.visibility !== 'hidden');
    if (visible[visible.length - 1] === overlay) close();
  };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.schedule-manager-close').onclick = close;
  overlay.querySelector('[data-action="done"]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const fmtMinutes = m => {
    const n = Math.max(0, Math.floor(Number(m) || 0));
    if (n === 0) return '0h';
    return `${Math.floor(n/60)}h ${n%60}m`.replace(' 0m','');
  };

  const $detectedSection = overlay.querySelector('[data-detected-section]');

  const renderDetected = () => {
    const detected = discoverCompanyTemplates();
    const localNames = new Set((STATE.customScheduleTemplates || []).map(t => t.name.toLowerCase()));
    const fresh = detected.filter(t => !localNames.has(t.name.toLowerCase()));
    if (fresh.length === 0) {
      $detectedSection.innerHTML = '';
      return;
    }
    const fmtM = m => {
      const n = Math.max(0, Math.floor(Number(m) || 0));
      if (n === 0) return '0h';
      return `${Math.floor(n/60)}h ${n%60}m`.replace(' 0m','');
    };
    $detectedSection.innerHTML = `
      <div class="templates-detected-header">
        🔍 Plantillas detectadas en los empleados de la empresa
        <span class="templates-detected-hint">${fresh.length} sin importar</span>
      </div>
      <div class="templates-detected-list">
        ${fresh.map(t => `
          <div class="template-row detected">
            <div class="template-row-main">
              <div class="template-row-name">${escapeHTML(t.name)}</div>
              <div class="template-row-meta">
                <span>L ${fmtM(t.minutes.mondayMinutes)}</span>
                <span>M ${fmtM(t.minutes.tuesdayMinutes)}</span>
                <span>X ${fmtM(t.minutes.wednesdayMinutes)}</span>
                <span>J ${fmtM(t.minutes.thursdayMinutes)}</span>
                <span>V ${fmtM(t.minutes.fridayMinutes)}</span>
                <span class="weekend">S ${fmtM(t.minutes.saturdayMinutes)}</span>
                <span class="weekend">D ${fmtM(t.minutes.sundayMinutes)}</span>
                <span class="template-row-total">👥 ${t.employees.length} empleado${t.employees.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div class="template-row-actions">
              <button class="template-row-btn" data-action="import-one" data-detected-id="${escapeHTML(t.id)}" type="button">📥 Importar</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    $detectedSection.querySelectorAll('[data-action="import-one"]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.detectedId;
        const tmpl = fresh.find(t => t.id === id);
        if (!tmpl) return;
        try {
          await saveCustomTemplate({ name: tmpl.name, ...tmpl.minutes });
          renderList();
          renderDetected();
        } catch (e) { toastErr('No se pudo importar: ' + e.message); }
      };
    });
  };

  const renderList = () => {
    const local = STATE.customScheduleTemplates || [];
    if (local.length === 0) {
      $list.innerHTML = `
        <div class="templates-empty">
          Aún no tienes plantillas locales. Pulsa "➕ Nueva plantilla" para crear una,
          o usa "🔍 Importar plantillas detectadas" si aparecen plantillas debajo
          (extraídas de los empleados ya cargados).
        </div>
      `;
      return;
    }
    $list.innerHTML = local.map(t => {
      const totalMin = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
        .reduce((s, d) => s + Number(t[d + 'Minutes'] || 0), 0);
      return `
        <div class="template-row" data-template-id="${escapeHTML(t.id)}">
          <div class="template-row-main">
            <div class="template-row-name">${escapeHTML(t.name)}</div>
            <div class="template-row-meta">
              <span>L ${fmtMinutes(t.mondayMinutes)}</span>
              <span>M ${fmtMinutes(t.tuesdayMinutes)}</span>
              <span>X ${fmtMinutes(t.wednesdayMinutes)}</span>
              <span>J ${fmtMinutes(t.thursdayMinutes)}</span>
              <span>V ${fmtMinutes(t.fridayMinutes)}</span>
              <span class="weekend">S ${fmtMinutes(t.saturdayMinutes)}</span>
              <span class="weekend">D ${fmtMinutes(t.sundayMinutes)}</span>
              <span class="template-row-total">Σ ${fmtMinutes(totalMin)}/sem</span>
            </div>
          </div>
          <div class="template-row-actions">
            <button class="template-row-btn" data-action="edit" type="button">✏️ Editar</button>
            <button class="template-row-btn" data-action="duplicate" type="button">📋 Duplicar</button>
            <button class="template-row-btn danger" data-action="delete" type="button">🗑️ Borrar</button>
          </div>
        </div>
      `;
    }).join('');

    $list.querySelectorAll('.template-row').forEach(row => {
      const id = row.dataset.templateId;
      row.querySelector('[data-action="edit"]').onclick = () => openTemplateEditor(id);
      row.querySelector('[data-action="duplicate"]').onclick = async () => {
        const src = (STATE.customScheduleTemplates || []).find(t => String(t.id) === id);
        if (!src) return;
        const copy = { ...src };
        delete copy.id;
        copy.name = `${src.name} (copia)`;
        try {
          await saveCustomTemplate(copy);
          renderList();
        } catch (e) { toastErr('No se pudo duplicar: ' + e.message); }
      };
      row.querySelector('[data-action="delete"]').onclick = async () => {
        const src = (STATE.customScheduleTemplates || []).find(t => String(t.id) === id);
        if (!src) return;
        const ok = await ssmConfirm({
          title: `¿Borrar "${src.name}"?`,
          body: 'También se eliminarán los overrides de empleados que usen esta plantilla.',
          okLabel: 'Borrar plantilla',
          danger: true
        });
        if (!ok) return;
        try {
          await deleteCustomTemplate(id);
          renderList();
        } catch (e) { toastErr('No se pudo borrar: ' + e.message); }
      };
    });
  };

  const openTemplateEditor = (templateId = null) => {
    const existing = templateId
      ? (STATE.customScheduleTemplates || []).find(t => String(t.id) === templateId) || null
      : null;
    const popup = document.createElement('div');
    popup.className = 'schedule-cell-editor-overlay';
    const v = (k) => Number(existing?.[k] || 0);
    popup.innerHTML = `
      <div class="schedule-cell-editor template-editor animate-pop" role="dialog">
        <header class="schedule-editor-header">
          <h3>${existing ? '✏️ Editar plantilla' : '➕ Nueva plantilla'}</h3>
          <button class="schedule-cell-editor-close" aria-label="Cerrar">&times;</button>
        </header>
        <div class="schedule-editor-body">
          <label class="schedule-editor-label">Nombre</label>
          <input type="text" data-name class="template-input-text" placeholder="Ej: Jornada 40h Turno 13:30h - ZGZ" value="${escapeHTML(existing?.name || '')}">

          <label class="schedule-editor-label" style="margin-top:16px;">Minutos por día (24h máximo = 1440 min)</label>
          <div class="template-minutes-grid">
            ${['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d, i) => {
              const labels = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
              return `
                <label class="template-minutes-cell ${i >= 5 ? 'weekend' : ''}">
                  <span>${labels[i]}</span>
                  <input type="number" min="0" max="1440" step="1" data-day="${d}" value="${v(d + 'Minutes')}">
                </label>
              `;
            }).join('')}
          </div>
          <p class="schedule-editor-hint">
            Ejemplo: Jornada 40h L-J: 8h 15min = <strong>495 min</strong>.
            Viernes: 7h = <strong>420 min</strong>.
          </p>
          <div class="schedule-editor-actions">
            <button class="btn-secondary" data-cancel type="button">Cancelar</button>
            <button class="btn-primary" data-save type="button">${existing ? 'Guardar' : 'Crear'}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
    const closePopup = () => popup.remove();
    popup.querySelector('.schedule-cell-editor-close').onclick = closePopup;
    popup.querySelector('[data-cancel]').onclick = closePopup;
    popup.addEventListener('click', (e) => { if (e.target === popup) closePopup(); });
    popup.querySelector('[data-save]').onclick = async () => {
      const name = popup.querySelector('[data-name]').value.trim();
      if (!name) { toastWarn('El nombre es obligatorio.'); return; }
      const out = { name };
      if (existing) out.id = existing.id;
      ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach(d => {
        out[d + 'Minutes'] = Number(popup.querySelector(`[data-day="${d}"]`).value || 0);
      });
      try {
        await saveCustomTemplate(out);
        closePopup();
        renderList();
      } catch (e) {
        toastErr('No se pudo guardar: ' + e.message);
      }
    };
  };

  overlay.querySelector('[data-action="new"]').onclick = () => openTemplateEditor();

  // Detectar duplicados: agrupa por nombre normalizado y también por minutos idénticos.
  // El primero del grupo se conserva, el resto se eliminan (y con ellos sus overrides).
  const findDuplicateGroups = () => {
    const local = STATE.customScheduleTemplates || [];
    const dayKeys = ['mondayMinutes','tuesdayMinutes','wednesdayMinutes',
                     'thursdayMinutes','fridayMinutes','saturdayMinutes','sundayMinutes'];
    const byName = new Map();
    const byMinutes = new Map();
    local.forEach(t => {
      const nameKey = String(t.name).trim().toLowerCase();
      if (!byName.has(nameKey)) byName.set(nameKey, []);
      byName.get(nameKey).push(t);
      const minKey = dayKeys.map(k => Number(t[k] || 0)).join('|');
      if (!byMinutes.has(minKey)) byMinutes.set(minKey, []);
      byMinutes.get(minKey).push(t);
    });
    const dupByName = Array.from(byName.values()).filter(g => g.length > 1);
    const dupByMinutes = Array.from(byMinutes.values()).filter(g => g.length > 1);
    return { dupByName, dupByMinutes };
  };

  // Limpiar duplicados: prioriza nombre. Para grupos con mismo nombre, conserva la
  // primera entrada y borra el resto. Para grupos con mismos minutos pero distinto
  // nombre, lo deja porque puede ser intencional.
  overlay.querySelector('[data-action="cleanup"]').onclick = async () => {
    const { dupByName, dupByMinutes } = findDuplicateGroups();
    if (dupByName.length === 0 && dupByMinutes.length === 0) {
      toastOk('No hay duplicados que limpiar.');
      return;
    }
    const toDelete = [];
    dupByName.forEach(group => {
      const sorted = [...group].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      toDelete.push(...sorted.slice(1).map(t => t.id));
    });
    const minutesOnlyDupNames = dupByMinutes
      .filter(g => new Set(g.map(t => t.name.toLowerCase())).size > 1)
      .map(g => g.map(t => t.name).join(' = '))
      .join('\n• ');
    let body = '';
    if (toDelete.length > 0) {
      body += `Se borrarán ${toDelete.length} duplicados por nombre.\n`;
    }
    if (minutesOnlyDupNames) {
      body += `\nℹ️ También detecté plantillas con los mismos minutos pero distinto nombre (NO se borrarán):\n• ${minutesOnlyDupNames}`;
    }
    if (toDelete.length === 0) {
      toastInfo(body || 'Nada que borrar.');
      return;
    }
    const ok = await ssmConfirm({
      title: '¿Limpiar duplicados?',
      body,
      okLabel: 'Limpiar',
      danger: true
    });
    if (!ok) return;
    let fails = 0;
    for (const id of toDelete) {
      try { await deleteCustomTemplate(id); }
      catch (e) { fails++; console.warn('No se pudo borrar', id, e); }
    }
    renderList();
    renderDetected();
    toastOk(`Limpieza completa. Borradas: ${toDelete.length - fails}${fails ? `, errores: ${fails}` : ''}.`);
  };

  // Purgar TODAS las plantillas locales
  overlay.querySelector('[data-action="purge"]').onclick = async () => {
    const local = STATE.customScheduleTemplates || [];
    if (local.length === 0) {
      toastInfo('No hay plantillas que borrar.');
      return;
    }
    const ok1 = await ssmConfirm({
      title: '¿Borrar TODAS tus plantillas locales?',
      body: `Esto eliminará ${local.length} plantillas y todos los overrides de empleado que las usan.`,
      okLabel: 'Continuar',
      danger: true
    });
    if (!ok1) return;
    const ok2 = await ssmConfirm({
      title: 'Última confirmación',
      body: 'Esta acción NO se puede deshacer. ¿Estás completamente seguro?',
      okLabel: 'Sí, borrar todo',
      danger: true
    });
    if (!ok2) return;
    let fails = 0;
    const ids = local.map(t => t.id);
    for (const id of ids) {
      try { await deleteCustomTemplate(id); }
      catch (e) { fails++; console.warn('No se pudo borrar', id, e); }
    }
    renderList();
    renderDetected();
    if (fails === 0) toastOk('Todas las plantillas locales han sido eliminadas.');
    else toastWarn(`Borradas ${ids.length - fails} de ${ids.length}. ${fails} fallaron.`);
  };

  // Importar todas las plantillas detectadas (saltar las que ya tengamos como locales)
  overlay.querySelector('[data-action="import-detected"]').onclick = async () => {
    const detected = discoverCompanyTemplates();
    if (detected.length === 0) {
      toastWarn('No se han detectado plantillas en los empleados cargados. Asegúrate de tener los empleados cargados (módulo Fichajes) antes de abrir este gestor.');
      return;
    }
    const localNames = new Set((STATE.customScheduleTemplates || []).map(t => t.name.toLowerCase()));
    const fresh = detected.filter(t => !localNames.has(t.name.toLowerCase()));
    if (fresh.length === 0) {
      toastInfo('Todas las plantillas detectadas ya están importadas como locales.');
      return;
    }
    const summary = fresh.map(t =>
      `• ${t.name} (L-V: ${Math.floor((t.minutes.mondayMinutes||0)/60)}h, asignada a ${t.employees.length} empleado${t.employees.length === 1 ? '' : 's'})`
    ).join('\n');
    const ok = await ssmConfirm({
      title: `¿Importar ${fresh.length} plantilla${fresh.length === 1 ? '' : 's'}?`,
      body: summary,
      okLabel: 'Importar'
    });
    if (!ok) return;
    try {
      for (const t of fresh) {
        await saveCustomTemplate({ name: t.name, ...t.minutes });
      }
      renderList();
      renderDetected();
      toastOk(`${fresh.length} plantilla${fresh.length === 1 ? '' : 's'} importada${fresh.length === 1 ? '' : 's'} correctamente.`);
    } catch (e) { toastErr('Error al importar: ' + e.message); }
  };

  // Cargar / refrescar overrides para asegurar customScheduleTemplates al día
  try { await loadScheduleOverrides(); } catch {}
  renderList();
  renderDetected();
}

// ─── Modal: Gestor de calendario por empleado (Fase 3) ────────────────────
// options: { onClose: fn() } — callback ejecutado al cerrar este modal, útil
// para reabrir/restaurar la ventana desde la que se invocó.
async function openEmployeeScheduleManager(employeeId, options = {}) {
  const empIdStr = String(employeeId);
  const emp = STATE.allEmployees.get(empIdStr);
  if (!emp) {
    toastErr('No se ha podido cargar la información del empleado.');
    return;
  }
  if (!isLocalProxy()) {
    toastWarn('La gestión de calendario solo está disponible cuando la app corre con el proxy local (server.py).');
    return;
  }

  // Estado del modal: fecha base (mes/año actual) y pending changes sin guardar
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-11
  const pending = new Map(); // 'YYYY-MM-DD' -> templateId | null (null = restaurar default)

  const overlay = document.createElement('div');
  overlay.className = 'contact-card-overlay schedule-manager-overlay';
  const breadcrumbHTML = renderBreadcrumbHTML(`Gestionar calendario · ${`${emp.firstName || ''} ${emp.lastName || ''}`.trim()}`);
  overlay.innerHTML = `
    <div class="schedule-manager-modal animate-pop" role="dialog" aria-modal="true" aria-label="Gestor de calendario de ${escapeHTML(emp.firstName + ' ' + emp.lastName)}">
      <header class="schedule-manager-header">
        <div class="schedule-manager-title">
          <div class="schedule-manager-avatar schedule-manager-avatar-clickable" data-action="view-profile" role="button" tabindex="0" title="Ver ficha del empleado">
            ${safeHttpUrlAttr(emp.imageProfileURL)
              ? `<img src="${safeHttpUrlAttr(emp.imageProfileURL)}" alt="" referrerpolicy="no-referrer">`
              : escapeHTML(getInitials(`${emp.firstName} ${emp.lastName}`))}
          </div>
          <div>
            ${breadcrumbHTML}
            <h2>${escapeHTML(`${emp.firstName || ''} ${emp.lastName || ''}`.trim())}</h2>
            <p>Calendario de jornada · cambios guardados solo en local</p>
          </div>
        </div>
        <div class="schedule-manager-header-actions">
          <button class="schedule-toolbar-btn schedule-view-balance-btn" data-action="view-balance" type="button" title="Ver balance del ejercicio de este empleado">📊 Ver balance</button>
          <button class="schedule-manager-close" aria-label="Cerrar">&times;</button>
        </div>
      </header>

      <div class="schedule-manager-toolbar">
        <button class="schedule-nav-btn" data-nav="prev" aria-label="Mes anterior">‹</button>
        <button class="schedule-current-month" data-month-label data-action="open-month-picker" type="button" title="Saltar a otro mes/año"></button>
        <button class="schedule-nav-btn" data-nav="next" aria-label="Mes siguiente">›</button>
        <div class="schedule-toolbar-spacer"></div>
        <span class="schedule-pending-badge hidden" data-pending-badge>0 cambios sin guardar</span>
        <button class="btn-secondary schedule-toolbar-btn" data-action="manage-templates" type="button" title="Crear y gestionar tus plantillas de jornada">🗂️ Mis plantillas</button>
        <button class="btn-secondary schedule-toolbar-btn" data-action="assign-range" type="button" title="Asignar una plantilla a un rango de fechas">📆 Por rango</button>
        <button class="btn-secondary schedule-reset-month-btn" data-action="reset-month" type="button">Restaurar mes</button>
        <button class="btn-primary schedule-save-btn" data-action="save" type="button" disabled>💾 Guardar cambios</button>
      </div>

      <div class="schedule-legend">
        <span class="legend-item"><span class="legend-dot is-sesame"></span> Plantilla de Sesame</span>
        <span class="legend-item"><span class="legend-dot is-override"></span> Override local (pendiente o guardado)</span>
        <span class="legend-item"><span class="legend-dot is-pending"></span> Cambio sin guardar</span>
      </div>

      <div class="schedule-grid-head">
        <div>Lun</div><div>Mar</div><div>Mié</div><div>Jue</div><div>Vie</div>
        <div class="weekend">Sáb</div><div class="weekend">Dom</div>
      </div>
      <div class="schedule-grid" data-schedule-grid>
        <div class="schedule-grid-loading">Cargando plantilla actual...</div>
      </div>

      <footer class="schedule-manager-footer">
        <span class="schedule-footer-template">Plantilla por defecto: <strong>${escapeHTML(emp.scheduleTemplateName || '—')}</strong></span>
        <span class="schedule-footer-hint">Click en un día para asignar otra plantilla. Sesame no se modifica.</span>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);

  const $grid = overlay.querySelector('[data-schedule-grid]');
  const $monthLabel = overlay.querySelector('[data-month-label]');
  const $pendingBadge = overlay.querySelector('[data-pending-badge]');
  const $saveBtn = overlay.querySelector('[data-action="save"]');
  const $resetBtn = overlay.querySelector('[data-action="reset-month"]');

  // Conectar breadcrumb si existe (navegación a modales anteriores)
  wireBreadcrumb(overlay);

  const close = () => {
    overlay.remove();
    // Limpiar el popover del selector mes/año que vive fuera del modal (en body)
    // Cerrar también el chooser de mes/año si quedó abierto
    document.querySelectorAll('.schedule-mp-modal-overlay').forEach(el => el.remove());
    document.removeEventListener('keydown', onKey);
    if (typeof options.onClose === 'function') {
      try { options.onClose(); } catch {}
    }
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const visible = Array.from(document.querySelectorAll('.contact-card-overlay'))
      .filter(o => o.style.visibility !== 'hidden');
    if (visible[visible.length - 1] === overlay) close();
  };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.schedule-manager-close').onclick = close;

  // Botón "Ver balance" → cierra este modal y abre el balance del ejercicio
  overlay.querySelector('[data-action="view-balance"]')?.addEventListener('click', async () => {
    if (typeof FichajesModule === 'undefined' || !FichajesModule.openBalanceEmployeeModal) {
      toastWarn('Esta opción solo está disponible si has cargado el módulo Fichajes.');
      return;
    }
    try {
      // Si el módulo Fichajes no tiene datos del periodo (caso típico cuando
      // el usuario entró directamente al gestor sin pasar por Balance), forzar
      // una carga en vista 'balance' para tener todas las filas del ejercicio.
      const needsLoad = !FichajesModule.data || FichajesModule.data.length === 0;
      if (needsLoad) {
        // Cerrar este modal y mostrar feedback de carga
        close();
        const toastRef = toastInfo('Cargando balance del empleado…', { duration: 0 });
        // Asegurar vista 'balance' y rango 'ejercicio'
        const prevView = FichajesModule.currentView;
        const prevScope = FichajesModule.balanceScope;
        if (FichajesModule.currentView !== 'balance') FichajesModule.currentView = 'balance';
        FichajesModule.balanceScope = 'year';
        try {
          await FichajesModule.loadData(true, { silent: true });
        } catch (loadErr) {
          console.warn('Carga de balance falló:', loadErr);
        }
        toastRef.close();
        FichajesModule.openBalanceEmployeeModal(empIdStr);
        // Restaurar la vista previa solo si era distinta (no queremos forzar
        // al usuario a quedarse en Balance si no estaba ahí).
        if (prevView !== 'balance' && prevView != null) {
          FichajesModule.currentView = prevView;
        }
        if (prevScope != null) FichajesModule.balanceScope = prevScope;
        return;
      }
      // Datos ya cargados: comportamiento normal con back-stack
      close();
      FichajesModule.openBalanceEmployeeModal(empIdStr);
    } catch (e) {
      console.error('No se pudo abrir el balance:', e);
      toastErr('No se pudo abrir el balance: ' + (e?.message || e));
    }
  });

  // Avatar clickeable → abre la ficha del empleado encima del gestor (back-stack)
  const $avatar = overlay.querySelector('[data-action="view-profile"]');
  if ($avatar) {
    const openProfile = () => {
      overlay.style.visibility = 'hidden';
      // showContactCard ya crea su propio overlay; cuando se cierre, restauramos este
      const restore = () => { overlay.style.visibility = 'visible'; };
      try {
        showContactCard(empIdStr);
        // Observamos cuándo se cierra la tarjeta de contacto para restaurar
        const watcher = setInterval(() => {
          const card = document.querySelector('.contact-card-overlay:not(.schedule-manager-overlay):not(.templates-manager-overlay)');
          if (!card) {
            clearInterval(watcher);
            restore();
          }
        }, 200);
      } catch (e) {
        restore();
        console.error('No se pudo abrir la ficha:', e);
      }
    };
    $avatar.addEventListener('click', openProfile);
    $avatar.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(); }
    });
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const updatePendingBadge = () => {
    const n = pending.size;
    $pendingBadge.classList.toggle('hidden', n === 0);
    $pendingBadge.textContent = `${n} cambio${n === 1 ? '' : 's'} sin guardar`;
    $saveBtn.disabled = n === 0;
  };

  // Cargar plantillas de Sesame (no bloqueante; si falla por 403 seguimos con locales)
  if (!STATE.scheduleTemplates || STATE.scheduleTemplates.length === 0) {
    try { await fetchScheduleTemplates(); } catch {}
  }
  // Asegurar que tenemos las plantillas locales y overrides cargados
  if (!STATE.customScheduleTemplates) {
    try { await loadScheduleOverrides(); } catch {}
  }
  // Descubrir plantillas detectadas en los empleados de la empresa para que
  // estén disponibles en el dropdown (y cacheadas en scheduleTemplateMinutes
  // por si se usan como override).
  discoverCompanyTemplates();

  // Aviso suave si Sesame da 403 pero ya hay plantillas locales: solo informativo.
  const hasSesame = (STATE.scheduleTemplates || []).length > 0;
  const hasLocal = (STATE.customScheduleTemplates || []).length > 0;
  if (!hasSesame && !hasLocal) {
    const banner = document.createElement('div');
    banner.className = 'schedule-templates-warning';
    banner.innerHTML = `
      ℹ️ Aún no tienes plantillas locales y Sesame no ha devuelto la lista (probablemente 403).
      <button class="schedule-reload-templates" type="button" data-action="open-templates">🗂️ Crear plantilla</button>
    `;
    overlay.querySelector('.schedule-manager-toolbar').after(banner);
    banner.querySelector('[data-action="open-templates"]').addEventListener('click', () => {
      banner.remove();
      openTemplatesManager(() => renderMonth());
    });
  }

  // Calcula minutos del día según una plantilla concreta
  const minutesForDay = (templateMinutes, dayOfWeek) => {
    if (!templateMinutes) return null;
    const keys = ['sundayMinutes','mondayMinutes','tuesdayMinutes','wednesdayMinutes',
                  'thursdayMinutes','fridayMinutes','saturdayMinutes'];
    return Number(templateMinutes[keys[dayOfWeek]] || 0);
  };
  const fmtMinutes = m => {
    if (m === null || m === undefined) return '—';
    const n = Math.max(0, Math.floor(Number(m) || 0));
    if (n === 0) return '0h';
    return `${Math.floor(n/60)}h ${n%60}m`.replace(' 0m','');
  };

  // Render del mes activo
  const renderMonth = async () => {
    $grid.innerHTML = '<div class="schedule-grid-loading">Cargando plantilla de Sesame...</div>';
    $monthLabel.textContent = new Date(viewYear, viewMonth, 1)
      .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
      .replace(/^\w/, c => c.toUpperCase());

    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const from = fmtDate(firstDay);
    const to = fmtDate(lastDay);
    let sesameByDay = new Map();
    try {
      sesameByDay = await fetchEmployeeScheduleByDay(empIdStr, from, to);
    } catch (e) {
      console.warn('schedule fetch error:', e);
    }

    // Cargar ausencias del mes si no las tenemos ya (módulo Vacaciones puede no
    // haberse visitado o haber cargado otro periodo). No bloquea el render.
    try {
      const dayKeys = [];
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        dayKeys.push(fmtDate(d));
      }
      const hasAnyForMonth = dayKeys.some(k => Array.isArray(STATE.calendarData?.[k]) && STATE.calendarData[k].length > 0);
      if (!hasAnyForMonth) {
        const absRes = await fetchCalendarGrouped(from, to, []).catch(() => []);
        STATE.calendarData = STATE.calendarData || {};
        (absRes || []).forEach(dayObj => {
          if (!dayObj.date) return;
          // Normalizar al mismo formato que usa el módulo Vacaciones:
          // [{ type: { id, name, color }, employees: [...] }]
          STATE.calendarData[dayObj.date] = (dayObj.calendar_types || []).map(ct => {
            const rawType = ct.calendar_type || {};
            const masterType = STATE.absenceTypes.find(t => t.id === rawType.id) || {};
            return {
              type: {
                ...rawType,
                name: masterType.name || displayAbsenceTypeName(rawType),
                color: masterType.color || rawType.color || ''
              },
              employees: ct.employees || []
            };
          });
        });
      }
      // Refrescar el índice de horarios de ausencias parciales si falta
      if (typeof fetchAbsenceTimesIndex === 'function') {
        const idx = await fetchAbsenceTimesIndex(from, to).catch(() => null);
        if (idx) STATE.absenceTimesIndex = idx;
      }
    } catch (e) {
      console.warn('No se pudieron cargar ausencias para el calendario del empleado:', e?.message || e);
    }

    // Construir grid: empezar el lunes anterior si el día 1 no es lunes
    const offset = (firstDay.getDay() + 6) % 7; // 0 si es lunes
    const totalCells = Math.ceil((offset + lastDay.getDate()) / 7) * 7;
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dateObj = new Date(viewYear, viewMonth, i - offset + 1);
      const inMonth = dateObj.getMonth() === viewMonth;
      const dateKey = fmtDate(dateObj);
      const dow = dateObj.getDay();
      const isWeekend = dow === 0 || dow === 6;

      // Plantilla actual aplicada según prioridad: pending > override guardado > Sesame
      const pendingVal = pending.get(dateKey);
      const savedOverride = getScheduleOverrideForDate(empIdStr, dateKey);
      const sesameDay = sesameByDay.get(dateKey);
      let effectiveTemplateId = null;
      let effectiveMinutes = null;
      let effectiveName = '—';
      let source = 'sesame';

      // FALLBACK: si el API admin de Sesame no devolvió datos (403, etc.),
      // resolver desde `scheduleTemplateAllViews` del empleado, que ya viene
      // cargado en STATE.allEmployees vía /api/v3/employees/{id}.
      const fallbackResolved = (!sesameDay)
        ? resolveEmployeeScheduleForDate(emp, dateKey)
        : null;
      // Construir un "sesameDay" sintético si llega del fallback
      const effectiveSesame = sesameDay || (fallbackResolved ? {
        templateId: emp?.scheduleTemplateAllViews?.[0] ? `default_${empIdStr}` : null,
        templateName: fallbackResolved.templateName || emp?.scheduleTemplateName || '',
        // minutes acumulados solo para este día (no plantilla completa)
        currentDayMinutes: Math.round(Number(fallbackResolved.secondsForDay || 0) / 60)
      } : null);

      if (pendingVal !== undefined) {
        if (pendingVal === null) {
          // Reset → vuelve a la plantilla por defecto del empleado
          source = 'sesame';
          if (effectiveSesame) {
            effectiveTemplateId = effectiveSesame.templateId;
            effectiveMinutes = effectiveSesame.currentDayMinutes != null
              ? effectiveSesame.currentDayMinutes
              : minutesForDay(effectiveSesame, dow);
            effectiveName = effectiveSesame.templateName || '—';
          }
        } else {
          source = 'pending';
          const tmplCache = STATE.scheduleTemplateMinutes.get(String(pendingVal));
          effectiveTemplateId = pendingVal;
          effectiveMinutes = minutesForDay(tmplCache, dow);
          effectiveName = tmplCache?.name || STATE.scheduleTemplates.find(t => t.id === pendingVal)?.name || 'Plantilla';
        }
      } else if (savedOverride) {
        source = 'override';
        const tmplCache = STATE.scheduleTemplateMinutes.get(String(savedOverride));
        effectiveTemplateId = savedOverride;
        effectiveMinutes = minutesForDay(tmplCache, dow);
        effectiveName = tmplCache?.name || STATE.scheduleTemplates.find(t => t.id === savedOverride)?.name || 'Plantilla guardada';
      } else if (effectiveSesame) {
        effectiveTemplateId = effectiveSesame.templateId;
        effectiveMinutes = effectiveSesame.currentDayMinutes != null
          ? effectiveSesame.currentDayMinutes
          : minutesForDay(effectiveSesame, dow);
        effectiveName = effectiveSesame.templateName || '—';
      }

      // Detectar ausencias del empleado para este día desde STATE.calendarData
      // (datos cargados por el módulo Vacaciones). Cada entrada trae el tipo
      // de ausencia y el empleado dentro de su array `employees`.
      const absences = [];
      const dayEntries = (STATE.calendarData && STATE.calendarData[dateKey]) || [];
      dayEntries.forEach(entry => {
        const myAbs = (entry.employees || []).find(e => String(e.id) === empIdStr);
        if (!myAbs) return;
        const type = entry.type || {};
        const sTime = myAbs.start_time || myAbs.startTime ||
                      myAbs.partialDay?.start_time || myAbs.partialDay?.startTime ||
                      myAbs.details?.start_time || myAbs.details?.startTime;
        const eTime = myAbs.end_time || myAbs.endTime ||
                      myAbs.partialDay?.end_time || myAbs.partialDay?.endTime ||
                      myAbs.details?.end_time || myAbs.details?.endTime;
        // Cruzar con absenceTimesIndex si existe para tiempos precisos
        let timesFromIndex = null;
        if (STATE.absenceTimesIndex) {
          timesFromIndex = STATE.absenceTimesIndex.get(empIdStr + '_' + dateKey) || null;
        }
        absences.push({
          name: type.name || 'Ausencia',
          color: type.color || '',
          startTime: timesFromIndex?.startTime || sTime || '',
          endTime:   timesFromIndex?.endTime   || eTime || '',
          isFullDay: !(timesFromIndex?.startTime || sTime),
          isVacation: /vacaci/i.test(type.name || '')
        });
      });

      cells.push({
        dateKey, dateObj, inMonth, isWeekend, source,
        effectiveTemplateId, effectiveMinutes, effectiveName,
        absences
      });
    }

    const renderAbsenceChip = (a) => {
      const txt = a.isFullDay
        ? `${a.isVacation ? '🌴' : '📌'} ${a.name}`
        : `🕐 ${a.startTime?.slice(0,5) || ''}${a.endTime ? '–' + a.endTime.slice(0,5) : ''} ${a.name}`;
      const bg = a.color
        ? `style="background:${escapeHTML(a.color)};color:#fff;border-color:${escapeHTML(a.color)};"`
        : '';
      const cls = `schedule-cell-absence ${a.isVacation ? 'vac' : 'abs'} ${a.isFullDay ? 'full' : 'partial'}`;
      return `<span class="${cls}" ${bg} title="${escapeHTML(a.name)}${a.startTime ? ' · ' + escapeHTML(a.startTime) + (a.endTime ? '–' + escapeHTML(a.endTime) : '') : ''}">${escapeHTML(txt)}</span>`;
    };

    $grid.innerHTML = cells.map(c => `
      <div class="schedule-cell ${c.inMonth ? '' : 'out-month'} ${c.isWeekend ? 'weekend' : ''} source-${c.source} ${c.absences.length ? 'has-absence' : ''}"
           data-date="${c.dateKey}"
           data-template-id="${escapeHTML(c.effectiveTemplateId || '')}"
           data-template-name="${escapeHTML(c.effectiveName || '')}"
           role="button" tabindex="0">
        <div class="schedule-cell-date">${c.dateObj.getDate()}</div>
        <div class="schedule-cell-hours">${escapeHTML(fmtMinutes(c.effectiveMinutes))}</div>
        <div class="schedule-cell-name" title="${escapeHTML(c.effectiveName)}">${escapeHTML(c.effectiveName)}</div>
        ${c.absences.length ? `<div class="schedule-cell-absences">${c.absences.map(renderAbsenceChip).join('')}</div>` : ''}
        ${c.source === 'pending' ? '<span class="schedule-cell-flag pending">●</span>' : ''}
        ${c.source === 'override' ? '<span class="schedule-cell-flag override">●</span>' : ''}
      </div>
    `).join('');

    // Click handler para abrir el selector
    $grid.querySelectorAll('.schedule-cell').forEach(cell => {
      cell.addEventListener('click', () => openCellEditor(cell.dataset.date, cell.dataset.templateId, cell.dataset.templateName));
      cell.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCellEditor(cell.dataset.date, cell.dataset.templateId, cell.dataset.templateName);
        }
      });
    });
  };

  // Popup pequeño para elegir plantilla (combina locales + Sesame)
  const openCellEditor = (dateKey, currentTemplateId, currentTemplateName) => {
    const popup = document.createElement('div');
    popup.className = 'schedule-cell-editor-overlay';
    const dateLabel = new Date(dateKey + 'T00:00:00')
      .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
      .replace(/^\w/, c => c.toUpperCase());

    const { local, detected, sesame } = getAllAvailableTemplates();
    // Helper: marca selected si el id coincide, o si NO hay id válido y el nombre
    // coincide (case-insensitive). Esto preselecciona la plantilla del empleado
    // aunque solo conozcamos su nombre (caso fallback sin id de Sesame).
    const nameKey = String(currentTemplateName || '').trim().toLowerCase();
    const hasValidId = currentTemplateId && (
      local.some(t => t.id === currentTemplateId) ||
      detected.some(t => t.id === currentTemplateId) ||
      sesame.some(t => t.id === currentTemplateId)
    );
    const isSel = (t) => {
      if (hasValidId) return t.id === currentTemplateId;
      if (nameKey) return String(t.name).trim().toLowerCase() === nameKey;
      return false;
    };
    const localOpts = local.map(t => `
      <option value="${escapeHTML(t.id)}" ${isSel(t) ? 'selected' : ''}>🗂️ ${escapeHTML(t.name)}</option>
    `).join('');
    const detectedOpts = detected.map(t => `
      <option value="${escapeHTML(t.id)}" ${isSel(t) ? 'selected' : ''}>🔍 ${escapeHTML(t.name)}</option>
    `).join('');
    const sesameOpts = sesame.map(t => `
      <option value="${escapeHTML(t.id)}" ${isSel(t) ? 'selected' : ''}>☁️ ${escapeHTML(t.name)}</option>
    `).join('');

    popup.innerHTML = `
      <div class="schedule-cell-editor animate-pop" role="dialog">
        <header class="schedule-editor-header">
          <h3>${escapeHTML(dateLabel)}</h3>
          <button class="schedule-cell-editor-close" aria-label="Cerrar">&times;</button>
        </header>
        <div class="schedule-editor-body">
          <label class="schedule-editor-label">Plantilla para este día</label>
          <select class="schedule-editor-select">
            <option value="">— Restaurar plantilla por defecto —</option>
            ${local.length ? `<optgroup label="🗂️ Mis plantillas locales">${localOpts}</optgroup>` : ''}
            ${detected.length ? `<optgroup label="🔍 Detectadas en empleados de la empresa">${detectedOpts}</optgroup>` : ''}
            ${sesame.length ? `<optgroup label="☁️ Plantillas de Sesame">${sesameOpts}</optgroup>` : ''}
          </select>
          <p class="schedule-editor-hint">Los cambios se aplican localmente. Pulsa "Guardar cambios" en el modal principal para persistir.</p>
          ${(!local.length && !detected.length && !sesame.length) ? `<p class="schedule-editor-hint" style="color:#f59e0b;">No hay plantillas disponibles. Crea una desde "🗂️ Mis plantillas".</p>` : ''}
          <div class="schedule-editor-actions">
            <button class="btn-secondary" data-cancel type="button">Cancelar</button>
            <button class="btn-primary" data-apply type="button">Aplicar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
    const closePopup = () => popup.remove();
    popup.querySelector('.schedule-cell-editor-close').onclick = closePopup;
    popup.querySelector('[data-cancel]').onclick = closePopup;
    popup.addEventListener('click', e => { if (e.target === popup) closePopup(); });
    popup.querySelector('[data-apply]').onclick = () => {
      const select = popup.querySelector('.schedule-editor-select');
      const chosen = select.value;
      const savedOverride = getScheduleOverrideForDate(empIdStr, dateKey);
      if (!chosen) {
        if (savedOverride) pending.set(dateKey, null);
        else pending.delete(dateKey);
      } else if (savedOverride === chosen) {
        pending.delete(dateKey);
      } else {
        pending.set(dateKey, chosen);
      }
      updatePendingBadge();
      closePopup();
      renderMonth();
    };
  };

  // Diálogo para asignar plantilla a un rango de fechas
  const openRangeAssigner = () => {
    const popup = document.createElement('div');
    popup.className = 'schedule-cell-editor-overlay';
    const { local, detected, sesame } = getAllAvailableTemplates();
    const localOpts = local.map(t => `<option value="${escapeHTML(t.id)}">🗂️ ${escapeHTML(t.name)}</option>`).join('');
    const detectedOpts = detected.map(t => `<option value="${escapeHTML(t.id)}">🔍 ${escapeHTML(t.name)}</option>`).join('');
    const sesameOpts = sesame.map(t => `<option value="${escapeHTML(t.id)}">☁️ ${escapeHTML(t.name)}</option>`).join('');

    const today = fmtDate(new Date());
    const allEmpsCount = STATE.allEmployees.size;
    const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `ID ${empIdStr}`;

    popup.innerHTML = `
      <div class="schedule-cell-editor schedule-range-editor animate-pop" role="dialog">
        <header class="schedule-editor-header">
          <h3>📆 Asignar plantilla por rango</h3>
          <button class="schedule-cell-editor-close" aria-label="Cerrar">&times;</button>
        </header>
        <div class="schedule-editor-body">
          <div class="schedule-range-grid">
            <div>
              <label class="schedule-editor-label">Desde</label>
              <input type="date" data-from value="${today}">
            </div>
            <div>
              <label class="schedule-editor-label">Hasta</label>
              <input type="date" data-to value="${today}">
            </div>
          </div>
          <label class="schedule-editor-label" style="margin-top:14px;">Plantilla a aplicar</label>
          <select class="schedule-editor-select" data-template>
            <option value="">— Restaurar plantilla por defecto —</option>
            ${local.length ? `<optgroup label="🗂️ Mis plantillas locales">${localOpts}</optgroup>` : ''}
            ${detected.length ? `<optgroup label="🔍 Detectadas en empleados">${detectedOpts}</optgroup>` : ''}
            ${sesame.length ? `<optgroup label="☁️ Plantillas de Sesame">${sesameOpts}</optgroup>` : ''}
          </select>

          <fieldset class="schedule-range-target">
            <legend class="schedule-editor-label">Aplicar a</legend>
            <label class="schedule-range-radio">
              <input type="radio" name="range-target" value="employee" checked>
              <span>Solo a <strong>${escapeHTML(empName)}</strong></span>
            </label>
            <label class="schedule-range-radio">
              <input type="radio" name="range-target" value="selected">
              <span>A <strong>empleados seleccionados</strong> (elegir abajo)</span>
            </label>
            <label class="schedule-range-radio">
              <input type="radio" name="range-target" value="company">
              <span>A <strong>todos los empleados de la empresa</strong> (${allEmpsCount})</span>
            </label>
          </fieldset>

          <div class="schedule-range-emp-picker hidden" data-emp-picker>
            <div class="schedule-emp-picker-toolbar">
              <input type="text" class="schedule-emp-search" data-emp-search placeholder="🔍 Buscar empleado..." aria-label="Buscar empleado">
              <button class="schedule-emp-chip" data-action="select-all" type="button">Todos</button>
              <button class="schedule-emp-chip" data-action="select-none" type="button">Ninguno</button>
              <span class="schedule-emp-counter" data-emp-counter>0 de ${allEmpsCount}</span>
            </div>
            <div class="schedule-emp-list" data-emp-list></div>
          </div>

          <label class="schedule-range-check">
            <input type="checkbox" data-only-weekdays checked>
            Aplicar solo a días laborables (Lun-Vie)
          </label>
          <p class="schedule-editor-hint" data-range-hint>Los cambios para este empleado quedan como pending hasta que pulses "Guardar cambios" en el modal principal.</p>
          <div class="schedule-editor-actions">
            <button class="btn-secondary" data-cancel type="button">Cancelar</button>
            <button class="btn-primary" data-apply type="button">Aplicar al rango</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
    const closePopup = () => popup.remove();
    popup.querySelector('.schedule-cell-editor-close').onclick = closePopup;
    popup.querySelector('[data-cancel]').onclick = closePopup;
    popup.addEventListener('click', e => { if (e.target === popup) closePopup(); });

    // Picker de empleados (lazy: solo se renderiza cuando se necesita)
    const $picker = popup.querySelector('[data-emp-picker]');
    const $empList = popup.querySelector('[data-emp-list]');
    const $empCounter = popup.querySelector('[data-emp-counter]');
    const $empSearch = popup.querySelector('[data-emp-search]');
    const selectedIds = new Set();

    // Construir la lista una sola vez
    const allEmps = Array.from(STATE.allEmployees.entries()).map(([id, emp]) => ({
      id: String(id),
      name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `ID ${id}`,
      jobTitle: emp.jobTitle || emp.jobChargeName || '',
      photo: emp.imageProfileURL || ''
    })).sort((a, b) => a.name.localeCompare(b.name));

    const updateCounter = () => {
      $empCounter.textContent = `${selectedIds.size} de ${allEmps.length}`;
    };
    const renderEmps = (filter = '') => {
      const q = filter.trim().toLowerCase();
      const visible = q ? allEmps.filter(e =>
        e.name.toLowerCase().includes(q) || (e.jobTitle || '').toLowerCase().includes(q)
      ) : allEmps;
      if (visible.length === 0) {
        $empList.innerHTML = '<div class="schedule-emp-empty">Sin empleados que coincidan</div>';
        return;
      }
      $empList.innerHTML = visible.map(e => {
        const checked = selectedIds.has(e.id) ? 'checked' : '';
        const safePhoto = safeHttpUrlAttr(e.photo);
        const initials = escapeHTML(getInitials(e.name));
        return `
          <label class="schedule-emp-row">
            <input type="checkbox" data-emp-id="${escapeHTML(e.id)}" ${checked}>
            <div class="schedule-emp-avatar">
              ${safePhoto ? `<img src="${safePhoto}" alt="" referrerpolicy="no-referrer">` : initials}
            </div>
            <div class="schedule-emp-meta">
              <div class="schedule-emp-name">${escapeHTML(e.name)}</div>
              ${e.jobTitle ? `<div class="schedule-emp-job">${escapeHTML(e.jobTitle)}</div>` : ''}
            </div>
          </label>
        `;
      }).join('');
      $empList.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.onchange = () => {
          const id = chk.dataset.empId;
          if (chk.checked) selectedIds.add(id);
          else selectedIds.delete(id);
          updateCounter();
        };
      });
    };

    popup.querySelector('[data-action="select-all"]').onclick = () => {
      const q = $empSearch.value.trim().toLowerCase();
      const visible = q ? allEmps.filter(e =>
        e.name.toLowerCase().includes(q) || (e.jobTitle || '').toLowerCase().includes(q)
      ) : allEmps;
      visible.forEach(e => selectedIds.add(e.id));
      updateCounter();
      renderEmps($empSearch.value);
    };
    popup.querySelector('[data-action="select-none"]').onclick = () => {
      selectedIds.clear();
      updateCounter();
      renderEmps($empSearch.value);
    };
    $empSearch.addEventListener('input', e => renderEmps(e.target.value));

    // Mostrar / ocultar picker y ajustar hint según el target seleccionado
    const $hint = popup.querySelector('[data-range-hint]');
    popup.querySelectorAll('[name="range-target"]').forEach(r => {
      r.addEventListener('change', () => {
        const v = popup.querySelector('[name="range-target"]:checked').value;
        if (v === 'selected') {
          $picker.classList.remove('hidden');
          if ($empList.innerHTML === '') {
            // Por defecto preseleccionar al empleado actual para no perderlo
            selectedIds.add(empIdStr);
            updateCounter();
            renderEmps('');
          }
          $hint.innerHTML = `⚠️ Se aplicará y <strong>guardará inmediatamente</strong> a los empleados que selecciones.`;
        } else {
          $picker.classList.add('hidden');
          if (v === 'company') {
            $hint.innerHTML = `⚠️ Se aplicará y <strong>guardará inmediatamente</strong> en todos los empleados de la empresa.`;
          } else {
            $hint.textContent = `Los cambios para este empleado quedan como pending hasta que pulses "Guardar cambios" en el modal principal.`;
          }
        }
      });
    });

    popup.querySelector('[data-apply]').onclick = async () => {
      const from = popup.querySelector('[data-from]').value;
      const to   = popup.querySelector('[data-to]').value;
      const chosen = popup.querySelector('[data-template]').value;
      const onlyWeekdays = popup.querySelector('[data-only-weekdays]').checked;
      const target = popup.querySelector('[name="range-target"]:checked').value;
      if (!from || !to || from > to) {
        toastWarn('Rango inválido: revisa las fechas.');
        return;
      }

      // Construir el mapa de overrides para el rango
      const startD = new Date(from + 'T00:00:00');
      const endD = new Date(to + 'T00:00:00');
      const datesInRange = [];
      for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (onlyWeekdays && (dow === 0 || dow === 6)) continue;
        datesInRange.push(fmtDate(d));
      }
      if (datesInRange.length === 0) {
        toastWarn('El rango no tiene días aplicables.');
        return;
      }

      // ── Aplicar solo al empleado actual: comportamiento original ────────
      if (target === 'employee') {
        let count = 0;
        datesInRange.forEach(k => {
          const savedOverride = getScheduleOverrideForDate(empIdStr, k);
          if (!chosen) {
            if (savedOverride) { pending.set(k, null); count++; }
          } else if (savedOverride !== chosen) {
            pending.set(k, chosen);
            count++;
          }
        });
        updatePendingBadge();
        closePopup();
        renderMonth();
        if (count === 0) toastInfo('No se ha aplicado ningún cambio (puede que ya estuvieran asignados).');
        return;
      }

      // ── Aplicar a TODA la empresa o a SELECCIONADOS: guardado directo ──
      let empIds;
      if (target === 'selected') {
        empIds = Array.from(selectedIds);
        if (empIds.length === 0) {
          toastWarn('No has seleccionado ningún empleado.');
          return;
        }
      } else {
        empIds = Array.from(STATE.allEmployees.keys()).map(String);
      }
      if (empIds.length === 0) {
        toastWarn('No hay empleados cargados.');
        return;
      }
      const targetLabel = target === 'selected'
        ? `${empIds.length} empleado${empIds.length === 1 ? '' : 's'} seleccionado${empIds.length === 1 ? '' : 's'}`
        : `los ${empIds.length} empleados de la empresa`;
      const ok = await ssmConfirm({
        title: '¿Aplicar plantilla por rango?',
        body: `Se aplicará a ${targetLabel} durante ${datesInRange.length} días (${from} → ${to}).\n\nLos cambios se guardarán inmediatamente.`,
        okLabel: 'Aplicar'
      });
      if (!ok) return;

      const applyBtn = popup.querySelector('[data-apply]');
      applyBtn.disabled = true;
      applyBtn.textContent = 'Aplicando...';

      const overridesMap = {};
      datesInRange.forEach(k => { overridesMap[k] = chosen || null; });

      let okCount = 0;
      let failCount = 0;
      // Paralelización en chunks pequeños para no saturar
      const chunkSize = 5;
      for (let i = 0; i < empIds.length; i += chunkSize) {
        const chunk = empIds.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
          chunk.map(id => saveScheduleOverrides(id, overridesMap, false))
        );
        results.forEach(r => {
          if (r.status === 'fulfilled') okCount++;
          else failCount++;
        });
        applyBtn.textContent = `Aplicando... ${okCount + failCount}/${empIds.length}`;
      }

      // Refrescar la vista del empleado actual también
      // (los cambios para él ya están guardados en server, no como pending)
      pending.clear();
      updatePendingBadge();
      renderMonth();

      closePopup();
      if (failCount === 0) {
        toastOk(`Aplicado a ${okCount} empleados.`);
      } else {
        toastWarn(`Aplicado a ${okCount} empleados. ${failCount} fallaron (revisa la consola).`);
      }
    };
  };

  overlay.querySelector('[data-nav="prev"]').onclick = () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderMonth();
  };
  overlay.querySelector('[data-nav="next"]').onclick = () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderMonth();
  };

  // ── Selector rápido de año/mes (modal centrado, robusto) ────────────────
  // Antes era un popover pegado al botón que fallaba por z-index/clipping.
  // Ahora abre un modal centrado igual que ssmConfirm: garantiza visibilidad.
  const openMonthYearChooser = () => {
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const shortMonths = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    let chosenYear = viewYear;
    const overlayEl = document.createElement('div');
    overlayEl.className = 'ssm-confirm-overlay schedule-mp-modal-overlay';
    const renderInner = () => {
      const todayMonth = new Date().getMonth();
      const todayYear = new Date().getFullYear();
      overlayEl.innerHTML = `
        <div class="ssm-confirm-dialog schedule-mp-modal animate-pop" role="dialog" aria-modal="true">
          <header class="schedule-mp-modal-head">
            <button class="schedule-mp-modal-nav" data-act="year-prev" type="button" aria-label="Año anterior">‹</button>
            <h3 class="schedule-mp-modal-year">${chosenYear}</h3>
            <button class="schedule-mp-modal-nav" data-act="year-next" type="button" aria-label="Año siguiente">›</button>
          </header>
          <div class="schedule-mp-modal-grid">
            ${shortMonths.map((m, i) => {
              const isSelected = (i === viewMonth && chosenYear === viewYear);
              const isToday = (i === todayMonth && chosenYear === todayYear);
              return `<button class="schedule-mp-modal-cell ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}" data-act="pick" data-month="${i}" type="button">${m}</button>`;
            }).join('')}
          </div>
          <footer class="schedule-mp-modal-foot">
            <button class="btn-secondary" data-act="today" type="button">Hoy</button>
            <button class="btn-secondary" data-act="cancel" type="button">Cancelar</button>
          </footer>
        </div>
      `;
    };
    renderInner();
    document.body.appendChild(overlayEl);
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlayEl.remove();
    };
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) return close();
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'cancel') return close();
      if (act === 'year-prev') { chosenYear--; renderInner(); return; }
      if (act === 'year-next') { chosenYear++; renderInner(); return; }
      if (act === 'today') {
        const now = new Date();
        viewYear = now.getFullYear();
        viewMonth = now.getMonth();
        close();
        renderMonth();
        return;
      }
      if (act === 'pick') {
        viewYear = chosenYear;
        viewMonth = Number(btn.dataset.month);
        close();
        renderMonth();
        return;
      }
    });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKey);
  };

  // Event delegation desde el modal (no en el botón directamente) — garantiza
  // que el click llegue incluso si algún handler global intentara robarlo.
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="open-month-picker"]')) {
      e.preventDefault();
      e.stopPropagation();
      openMonthYearChooser();
    }
  });

  // (lógica del antiguo popover eliminada; ahora todo va por openMonthYearChooser)

  overlay.querySelector('[data-action="manage-templates"]').onclick = () => {
    openTemplatesManager(() => renderMonth());
  };
  overlay.querySelector('[data-action="assign-range"]').onclick = openRangeAssigner;

  $resetBtn.onclick = async () => {
    const ok = await ssmConfirm({
      title: '¿Restaurar el mes a Sesame?',
      body: 'Todos los overrides del mes visible volverán a la plantilla por defecto. Quedarán como pending hasta que guardes.',
      okLabel: 'Restaurar'
    });
    if (!ok) return;
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      const k = fmtDate(d);
      if (getScheduleOverrideForDate(empIdStr, k)) pending.set(k, null);
      else pending.delete(k);
    }
    updatePendingBadge();
    renderMonth();
  };

  $saveBtn.onclick = async () => {
    if (pending.size === 0) return;
    $saveBtn.disabled = true;
    $saveBtn.textContent = 'Guardando...';
    try {
      const overridesMap = {};
      pending.forEach((tid, date) => { overridesMap[date] = tid; });
      const count = Object.keys(overridesMap).length;
      await saveScheduleOverrides(empIdStr, overridesMap, false);
      pending.clear();
      updatePendingBadge();
      $saveBtn.textContent = '✅ Guardado';
      setTimeout(() => { $saveBtn.textContent = '💾 Guardar cambios'; }, 1400);
      toastOk(`${count} cambio${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'} en local.`);
      renderMonth();
    } catch (e) {
      toastErr('Error guardando: ' + (e?.message || e));
      $saveBtn.disabled = false;
      $saveBtn.textContent = '💾 Guardar cambios';
    }
  };

  await renderMonth();
}

// ── Kick off ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
