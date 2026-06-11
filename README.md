# <img src="favicon.png" width="40" height="40" align="center" style="border-radius: 8px;"> Sesame Premium Dashboard

**Sesame Premium Dashboard** es una plataforma de análisis y monitorización operativa de alta fidelidad, construida como una capa superior sobre el ecosistema de **Sesame HR**. Diseñado para directores de recursos humanos, managers operativos y administradores de sistemas, este dashboard extrae, cruza y visualiza datos que normalmente están fragmentados o son inaccesibles en la interfaz estándar.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-Vanilla%20JS%20(ES6+)-yellow.svg)
![Backend](https://img.shields.io/badge/backend-Python%20Proxy-green.svg)
![Version](https://img.shields.io/badge/version-1.7.7-success.svg)
![Status](https://img.shields.io/badge/status-Production%20Ready-success.svg)

---

## 📋 Índice

- [Visión del Proyecto](#-visión-del-proyecto)
- [Módulos Principales](#-módulos-principales)
  - [1. Fichajes Avanzados e Insights](#1-fichajes-avanzados-e-insights)
  - [2. Radar de Presencia en Vivo](#2-radar-de-presencia-en-vivo)
  - [3. Deep Birthday Harvest](#3-deep-birthday-harvest)
  - [4. Calendario Híbrido](#4-calendario-híbrido)
- [Inteligencia Analítica y Auditoría](#-inteligencia-analítica-y-auditoría)
- [Stack Tecnológico](#-stack-tecnológico)
- [Origen de Credenciales y APIs Usadas](#-origen-de-credenciales-y-apis-usadas)
- [Cumplimiento y Uso Autorizado](#-cumplimiento-y-uso-autorizado)
- [Guía de Instalación Rápida](#-guía-de-instalación-rápida)
- [Arquitectura Técnica](#️-arquitectura-técnica)
- [Changelog Detallado](#-changelog-detallado)
- [Licencia](#-licencia)

---

## 🎯 Visión del Proyecto

El objetivo de este proyecto es transformar los datos crudos de recursos humanos en **inteligencia operativa accionable**. Mientras que Sesame HR proporciona una excelente base de datos de control horario, este dashboard cruza esas bases de datos en tiempo real (REST API vs BI Analytics Engine) para revelar patrones ocultos, detectar anomalías automáticamente y ofrecer una experiencia de usuario (UX) inmersiva y ultrarrápida.

---

## 🧩 Módulos Principales

### 1. Fichajes Avanzados e Insights
Un panel forense para auditar el control horario de toda la plantilla.
- **Smart Match Geométrico**: Superpone los fichajes reales sobre las ausencias programadas. Si un empleado ficha en un día festivo o de vacaciones, el sistema lo resalta gráficamente.
- **Auditoría de Dispositivos**: Muestra desde qué dispositivo se realizó el fichaje (Web, App iOS/Android, Tablet Kiosko), la dirección IP y el nombre de la red u oficina.
- **Geolocalización Inyectada**: Convierte las coordenadas crudas en enlaces interactivos a Google Maps para verificar fichajes remotos.
- **Patrones de Productividad**: Calcula automáticamente la media semanal de la hora de entrada y salida, e identifica el "Día más productivo" del equipo.
- **Balance del ejercicio**: Resume por empleado el saldo horario del periodo, separando fuente de datos (`Sesame Statistics` o `Calculado local`), horas trabajadas, horas teóricas, ajustes de jornada, pausas, ausencias, vacaciones, días trabajados y métricas equivalentes al portal de Sesame.

### 2. Radar de Presencia en Vivo
- **Sincronización Total**: Un semáforo de estado (Trabajando, En Pausa, Ausente) que se propaga por toda la interfaz (Barra lateral, cabecera, tabla de empleados).
- **Filtros Smart**: Permite filtrar la tabla de fichajes instantáneamente para ver "Sólo quién está trabajando ahora".
- **Kiosko Mode**: Un modo de pantalla completa a prueba de distracciones, ideal para proyectar en pantallas de oficinas, que oculta menús y maximiza los datos en tiempo real.

### 3. Deep Birthday Harvest
- **Motor de Extracción Dual**: Dado que los listados estándar de empleados de Sesame no siempre incluyen las fechas de nacimiento, el dashboard consulta el motor de Business Intelligence (BI). Si falla, ejecuta un escáner secundario perfil a perfil.
- **Timeline Anual**: Agrupa los cumpleaños por mes, destacando con insignias pulsantes a los cumpleañeros del día y generando un calendario visual hermoso.

### 4. Calendario Híbrido
- **Visión Panorámica**: Muestra meses completos o semanas, permitiendo cruzar de un vistazo qué equipos están mermados por vacaciones o bajas médicas.
- **Soporte Multi-Festivos**: Soporte para inyección de calendarios laborales locales (ej. festivos de Zaragoza, Madrid, etc.) para cálculo preciso de jornadas teóricas.

---

## 🧠 Inteligencia Analítica y Auditoría

La verdadera magia ocurre en segundo plano (Backend/JS Engine):

- **Incidence Detection Engine (NUEVO)**: Monitoriza las colas de peticiones de RRHH. Si un empleado solicita borrar un fichaje erróneo, pero RRHH aún no lo ha aprobado, el dashboard lo detecta y lo marca como `⏳ PENDIENTE`, excluyéndolo del cómputo total de horas para evitar desviaciones.
- **BI Schema Discovery**: Un algoritmo que escanea la licencia de la empresa en Sesame y autoconfigura el esquema de datos, activando o desactivando llamadas a campos GPS/IP para evitar bloqueos del WAF corporativo.
- **Domain Flipping**: Si la API principal de Sesame cae, el sistema conmuta instantáneamente entre los subdominios `api-` y `back-` para asegurar el 100% de *Uptime*.

---

## 🛠️ Stack Tecnológico

- **Frontend**: `HTML5` semántico, `CSS3` (Vanilla con diseño basado en Glassmorphism, CSS Variables para theming dinámico) y `Javascript ES6+` puro. 0 KB de librerías externas (sin React ni Vue) para máximo rendimiento.
- **Backend / Proxy**: Servidor local escrito en `Python 3` (módulos `http.server`, `urllib`). Maneja la superación de bloqueos CORS, inyección de certificados SSL locales (HTTPS) y cifrado AES de credenciales.
- **Seguridad**: Los tokens de sesión web/USID se guardan cifrados (`Fernet/AES-128-CBC`) en el disco duro cuando `cryptography` está disponible.

---

## 🔎 Origen de Credenciales y APIs Usadas

Este proyecto no usa un API token público generado desde un panel administrativo de Sesame. La integración funciona sobre la sesión web autenticada del usuario: se captura localmente el token `Authorization: Bearer ...` y el `csid` de empresa que la propia aplicación web de Sesame envía en sus peticiones.

El flujo previsto es local:

1. El usuario inicia sesión en `app.sesametime.com` con permisos legítimos.
2. `bash start.sh token` ejecuta `get-token.py`.
3. El extractor local observa llamadas `fetch`/`XMLHttpRequest` del navegador y captura `Authorization` y `csid`.
4. El token se recibe en `http://localhost:8766/receive` y se guarda en `config.secrets.json`.
5. El dashboard llama a Sesame mediante el proxy local `/sesame-api/*`; el frontend no necesita exponer el token guardado.

Por tanto, técnicamente la aplicación consume endpoints web/internos de Sesame protegidos por sesión, no una API pública documentada con token administrativo.

### Dominios remotos permitidos

- `https://back-eu1.sesametime.com`
- `https://api-eu1.sesametime.com`
- `https://bi-engine.sesametime.com`

### Endpoints principales detectados

| Área | Endpoints |
|------|-----------|
| Sesión | `/api/v3/security/me` |
| Empleados | `/api/v3/employees`, `/api/v3/companies/{companyId}/employees`, `/api/v3/employees/{employeeId}` |
| Tipos de ausencia | `/api/v3/companies/{companyId}/absence-types` |
| Calendario | `/api/v3/companies/{companyId}/calendars-grouped`, `/api/v3/companies/{companyId}/calendars`, `/api/v3/employees/{employeeId}/calendars` |
| Saldos de vacaciones | `/api/v3/vacation-configuration/employee/{id}`, `/api/v3/statistics/employee/{id}/vacations` |
| Presencia | `/api/v3/statistics/presence`, `/api/v3/presence-status`, `/api/v3/employees/presence`, `/api/v3/presence`, `/api/v3/attendance/presence`, `/api/v3/work-entries/presence`, `/api/v3/companies/{companyId}/employees/presence` |
| Fichajes | `/api/v3/employees/{employeeId}/checks`, `/api/v3/work-entries/search`, `/api/v3/checks/search`, `/api/v3/work-entries`, `/api/v3/checks`, `/api/v3/attendance`, `/api/v3/timesheets`, `/api/v3/statistics/daily-computed-hour-stats` |
| Balances horarios | `/schedule/v1/reports/worked-hours` como fuente oficial preferente cuando Sesame lo autoriza; `/schedule/v1/reports/worked-hours-by-week-day`, `/schedule/v1/reports/worked-night-hours`, `/schedule/v1/reports/worked-absence-days`, `/schedule/v1/hours-bag-rule-history`, `/schedule/v1/hours-bag-rules` para diagnóstico/contraste si están disponibles |
| Incidencias | `/api/v3/check-incidences` |
| BI Analytics | `/api/v3/analytics/report-query` en `https://bi-engine.sesametime.com` |

### Balance horario y fuente de datos

La vista **Fichajes > Balances** intenta priorizar el dato oficial de Sesame cuando está disponible:

1. **Sesame Statistics oficial**: `GET /schedule/v1/reports/worked-hours`, con parámetros de periodo (`from`, `to`), empleados (`employeeIds[in]`) y paginación (`limit`, `page`). Si devuelve `secondsWorked`, `secondsToWork` y `secondsBalance`, el dashboard usa esos valores y marca la fila como `Sesame Statistics`.
2. **Cálculo local**: si Sesame Statistics no devuelve datos, devuelve 403/404 o no está habilitado para la sesión, el dashboard calcula el balance localmente y marca la fila como `Calculado local`.
3. **Diagnóstico**: endpoints privados o no disponibles como `hours-bag-overtime` se consideran solo diagnóstico. No son fuente principal de producción si devuelven `403 Forbidden` o `404/no route`.

El cálculo local está diseñado para cuadrar con el portal de Sesame en los casos conocidos:

- Usa fichajes reales y pausas para obtener tiempo trabajado.
- Usa la jornada teórica calculada por BI cuando Sesame la devuelve.
- Aplica calendario y plantilla semanal como fallback.
- Trata permisos retribuidos por horas como **ajuste de jornada**, no como horas extra trabajadas.
- Gestiona vísperas de festivo/día no laborable: si la empresa aplica jornada reducida, la jornada teórica puede bajar a 7h.
- Separa vacaciones de ausencias y excluye calendarios de empresa/festivos del contador de ausencias personales.
- En Balance anual, aunque la carga pueda mirar el ejercicio completo, los indicadores equivalentes a Sesame se acotan hasta la fecha efectiva mostrada, por ejemplo `2026-01-01 - 2026-06-06`.

En el modal de empleado se muestran métricas equivalentes al portal oficial: trabajado, teórico, saldo, entrada media, salida media, jornada media, días trabajados/teóricos, descansos, promedio de descanso, ausencias y vacaciones. También se conserva una comparativa diagnóstica entre balance local y Sesame Statistics si alguna vez Sesame devuelve esos datos.

### Nota para soporte de Sesame

Si se investiga desde Sesame, puede no aparecer ningún token de API pública activo en la cuenta porque el dashboard no depende de ese mecanismo. Lo que se reutiliza es la autorización de sesión web del usuario autenticado. Si Sesame lo clasifica internamente como API privada/no documentada, esa clasificación corresponde a Sesame; desde el código del proyecto se observa que son endpoints `/api/v3` llamados con `Bearer` de sesión y `csid`.

## ⚖️ Cumplimiento y Uso Autorizado

Este repositorio incluye una nota específica de cumplimiento en [COMPLIANCE.md](./COMPLIANCE.md). El proyecto debe usarse solo con autorización expresa de la empresa titular de la cuenta, permisos legítimos dentro de Sesame y una finalidad empresarial documentada.

Puntos clave:

- No es asesoramiento legal ni garantiza conformidad contractual con Sesame.
- Si Sesame no autoriza el uso de endpoints web/internos, debe detenerse este método y migrar a la API oficial.
- Los datos de empleados, geolocalización, IP, dispositivos, cumpleaños y ausencias deben tratarse bajo base jurídica válida, minimización y control de accesos.
- La API oficial de Sesame, cuando esté activada para el cliente, debe ser la vía preferente para integraciones estables y auditables.

---

## 🚀 Guía de Instalación Rápida

### Requisitos
- **Python 3.8+** (Para ejecutar el proxy local).
- **Dependencias Python**: `pip install -r requirements.txt` para habilitar cifrado local de secretos.
- **Credenciales**: Usuario y contraseña de Sesame HR con permisos de Administrador/Manager.

### Pasos
### 1. Clonar el repositorio
```bash
git clone https://github.com/jesusgascon/sesame-premium-dashboard.git
cd sesame-premium-dashboard
```
2. **Instalar dependencias locales**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   ```
2. **Preparar Configuración**:
   Copia las plantillas y rellena `config.secrets.json` con tus tokens de sesión web/USID de Sesame y una contraseña maestra local por empresa. Si introduces valores en claro, `server.py` los migra a cifrado local en el siguiente arranque cuando `cryptography` está disponible.
   ```bash
   cp config.example.json config.json
   cp config.secrets.example.json config.secrets.json
   ```
   También puedes usar el asistente local:
   ```bash
   bash start.sh token
   ```
3. **Lanzar el Servidor**:
   El script generará certificados locales y lanzará el dashboard en modo red local por defecto.
   ```bash
   bash start.sh
   ```
4. **Disfrutar**: El navegador se abrirá automáticamente y la terminal mostrará también la URL LAN.

### Acceso desde la red local

El acceso desde otros equipos de la misma red es el modo por defecto:

```bash
bash start.sh
```

También puedes hacerlo explícito con `bash start.sh lan`. El servidor mostrará una URL tipo `https://192.168.x.x:8765`; abre esa URL desde otro dispositivo conectado a la misma red. Si el navegador avisa por certificado autofirmado, acepta la excepción solo si estás en tu red de confianza.

Opciones de arranque disponibles:

```bash
bash start.sh        # Red local, por defecto
bash start.sh lan    # Red local, explícito
bash start.sh local  # Solo este equipo
bash start.sh token  # Extraer credenciales
```

## 🔐 Seguridad Local

- `bash start.sh` expone el panel en la red local por defecto (`0.0.0.0`). Úsalo solo en redes de confianza, con firewall local y contraseña maestra configurada. Para limitarlo al equipo actual usa `bash start.sh local`.
- `config.json` contiene solo metadatos. Los tokens de sesión web/USID y contraseñas maestras viven en `config.secrets.json`, que no debe subirse a Git.
- `/config` no devuelve tokens ni contraseñas al navegador. El proxy local inyecta la autorización desde el almacén local de secretos.
- Al desbloquear con la contraseña maestra, el servidor crea una sesión local `HttpOnly` de corta duración. En modo LAN, las llamadas al proxy que usan tokens guardados y las mutaciones de configuración exigen esa sesión.
- El cierre de sesión bloquea la UI local, pero no borra la configuración. Para eliminar una empresa usa el botón de borrado de empresa.
- No envíes datos reales de empleados a servicios externos ni compartas capturas con IPs, coordenadas, teléfonos o cumpleaños.

## 🧯 Troubleshooting

- **Certificado local**: acepta el certificado autofirmado de `localhost` si el navegador avisa la primera vez.
- **Puerto ocupado**: detén otros procesos en `8765` antes de ejecutar `bash start.sh`.
- **Falta `cryptography`**: ejecuta `python -m pip install -r requirements.txt`. Sin esa dependencia el servidor avisa y no puede cifrar nuevos secretos.
- **No abre desde otro dispositivo**: revisa que ambos equipos estén en la misma red y permite el puerto `8765` en el firewall local.
- **Sesión local bloqueada**: desbloquea primero el panel con la contraseña maestra desde el navegador que hará las consultas.
- **Token caducado o 401/403**: renueva credenciales con `bash start.sh token` o desde la pantalla de configuración.
- **No desbloquea**: revisa que `config.secrets.json` incluya `passwords` para la empresa activa.
- **UI inconsistente tras muchos cambios**: cierra sesión y recarga; si persiste, limpia `localStorage/sessionStorage` del origen local.

---

## 🏗️ Arquitectura Técnica

Para una inmersión profunda en los algoritmos de cruce de datos, heurísticas de red y topología del estado local, dirígete a nuestro documento técnico detallado:
👉 **[Leer ARCHITECTURE.md](./ARCHITECTURE.md)**

---

## 📜 Changelog Detallado

### [v1.7.19] — 2026-06-11 | *Pulido del panel de detalle de fichaje*
- **Corregido**: Errata en el título de la columna 3 del detalle: "AUTORÍA Y CONTROL" → "AUDITORÍA Y CONTROL".
- **Corregido**: Badge de jornada en curso con clase propia `.detail-audit-live` y punto pulsante (antes reutilizaba la clase verde de "registro original" con fondo rojo inline).
- **Mejorado**: Eventos de auditoría unificados en `.audit-event-row` (6 copias de estilos inline eliminadas), con soporte de tema claro.
- **Mejorado**: Título de sección "DETALLE DE FICHAJES · N tramos" y zebra sutil en la tabla inferior de fichajes.
- **Mejorado**: Chips "Sin datos" en Canales utilizados / Detalles técnicos cuando no hay información; placeholder "⏳ Cargando auditoría…".

### [v1.7.18] — 2026-06-11 | *Estadísticas de vacaciones renovadas (incluye v1.7.17)*
- **Añadido**: 5 KPIs con subtítulos: Total Ausencias (con ▲/▼ vs mes anterior), Personas (% de plantilla), Promedio/Emp, **Día pico** y **Días afectados**.
- **Añadido**: Gráfico **Ausencias por Día de la Semana** (Lun–Dom, findes en rosa) para detectar patrones de lunes/viernes.
- **Corregido**: La Carga Diaria solo pintaba los días con ausencias, uniendo días no consecutivos y deformando la curva del mes. Ahora se pinta el mes completo con ceros.
- **Mejorado**: Carga Diaria con leyenda explicativa, línea de media diaria discontinua, día pico resaltado con anillo ámbar, títulos de eje, tooltip con fecha completa y hover por eje X. Pasa a ocupar todo el ancho.
- **Mejorado**: Donut por tipo con total en el centro y porcentajes en tooltip; ranking Top 10 con título de eje y unidad en tooltip.

### [v1.7.16] — 2026-06-11 | *Vistas semana/día del calendario a escala + modal del día*
- **Mejorado**: Vista **Semana** con celdas de 220px, pills y tipografía mayores, avatares de 24px y hasta 12 visibles.
- **Mejorado**: Vista **Día** como tarjeta centrada (máx. 760px), número de día grande, pills tipo botón, avatares de 28px y hasta 40 visibles.
- **Corregido**: La cabecera Lun..Dom aparecía en 7 columnas sobre la única celda de la vista Día; ahora se oculta en esa vista.
- **Mejorado**: Celdas sin ausencias en semana/día muestran "Sin ausencias" sutil; fin de semana con fondo diferenciado.
- **Mejorado**: Modal del día con subtítulo resumen ("4 personas · 2 tipos de ausencia"), cierre con Escape y hover en filas de empleados.

### [v1.7.15] — 2026-06-11 | *Mejoras visuales en balance + barra de fuente compacta*
- **Mejorado**: Toggle "Con hoy / Sin hoy" con clases CSS propias (hover, transición, `aria-pressed`).
- **Añadido**: Chip de modo **CON HOY / SIN HOY** en la cabecera del modal de detalle de balance.
- **Añadido**: Badge "En curso" con punto pulsante en la jornada live del modal; en modo Sin hoy indica "· fuera del balance".
- **Mejorado**: Barra "Fuente del balance" compacta: mitad de altura, leyenda con textos cortos (detalle en tooltip) y botones abreviados.
- **Corregido**: El contador "En vivo" del modal mostraba 0 en modo Sin hoy; el chip de modo se estiraba a todo el ancho del modal.

### [v1.7.13] — 2026-06-11 | *El modo "Sin hoy" aplica a datos oficiales y al teórico de hoy*
- **Corregido**: El toggle "Sin hoy" no afectaba a empleados con balance oficial de Sesame Statistics (el dato oficial incluye el día en curso). Ahora en ese modo se usa el cálculo local de días cerrados en tabla, modal y export CSV.
- **Corregido**: En vista mensual el teórico de hoy desaparecía al excluir la jornada en curso (168h en vez de 176h).
- **Corregido**: Bug pre-existente: empleados sin fichaje hoy perdían el teórico del día en la proyección mensual.
- **Añadido**: El export JSON incluye `balanceLiveMode` para dejar constancia del criterio usado.

### [v1.7.12] — 2026-06-11 | *Toggle Con hoy / Sin hoy en vista balance*
- **Añadido**: Selector de dos botones en la barra de balance para incluir o excluir el día actual (sesión abierta) del cálculo. "Con hoy" = saldo en tiempo real estilo Sesame Estadísticas; "Sin hoy" = solo días cerrados. Preferencia persistida en `sessionStorage`.

### [v1.7.11] — 2026-06-11 | *Balance en tiempo real igual que Sesame*
- **Cambiado**: El balance incluye el día vivo (sesión abierta) en todos los cálculos, igualando la página de Estadísticas de Sesame.

### [v1.7.9 / v1.7.10] — 2026-06-11 | *Cálculo del día vivo y teórico mensual completo*
- **Corregido**: Teórico mensual = mes completo (176h en junio) proyectando los días laborables futuros; trabajado = días cerrados.
- **Corregido**: La proyección teórica solo aplica en vista mensual; la anual usa días reales para no inflar el total (+112h).
- **Corregido**: La víspera solo aplica a festivos impuestos por la empresa (Fibercom), no a vacaciones pedidas por el empleado.

### [v1.7.7] — 2026-06-11 | *Pulido visual: insights colapsables, selector año/mes y tooltips contextuales*
- **Añadido**: **Insights de Fichajes colapsables**. Las 4 tarjetas (Incidencias, Validaciones, Radar de anomalías, Solicitudes y ausencias) ahora vienen **colapsadas por defecto** con un toggle único que las expande/colapsa todas a la vez. El estado se persiste en `localStorage`. Cuando están cerradas, el toggle muestra un resumen en una línea con los contadores.
- **Añadido**: **Selector año/mes** en el gestor de calendario. Modal centrado con navegación `‹ 2026 ›` y grid 3×4 de meses. Mes actual en violeta gradient, mes de HOY con borde azul, botones "Hoy" y "Cancelar". Acceso desde click en el título "Junio de 2026".
- **Añadido**: **Tooltips contextuales** en la tabla de Balance del ejercicio. Pasando el ratón sobre el balance del periodo se ve `Trabajado / Teórico / Diferencia / Fuente` en multilínea; sobre la barra de visualización `Cumplimiento % + Trabajado + Teórico`; sobre el badge de estado una explicación clara ("El empleado debe horas para este ejercicio"). Sistema `[data-tip]` con soporte multilínea (white-space:pre-line) y posiciones top/bottom/left/right.
- **Mejorado**: **Pill de días** en la tabla de Balances ahora vive en la misma fila del nombre del empleado, no en el centro vertical de la celda. Alineación horizontal limpia.
- **Mejorado**: Modal Balance del ejercicio: secciones colapsables "Ajustes de jornada retribuidos" y "Jornadas y fichajes" tienen ahora **header como pill independiente** (sin caja envolvente que metiera el primer card "dentro" del header).
- **Mejorado**: **Colores de fondo unificados** en las jornadas del balance. Los días con ausencia se marcan con un **borde lateral verde** de 3px en lugar de inundar la celda de color, evitando el choque cromático cuando se abren varias jornadas seguidas con y sin ausencia.
- **Mejorado**: Layout del valor del balance diario migrado de flex a **grid de 3 columnas estables** `[Fecha (1fr)] 32px [Balance (min 90px)] 32px [Detalles]`. El balance ya no se desplaza al lado del botón "Detalles" cuando la fecha es corta, sino que mantiene una posición estable y respiración a ambos lados.
- **Corregido**: El selector año/mes anterior basado en popover no recibía clicks por interferencias con el modal del gestor. Rediseñado como modal centrado robusto que siempre funciona.
- **Corregido**: Solapamiento visual del primer card "Miércoles, 10 de junio" con el header "Jornadas y fichajes" en el modal Balance.

### [v1.7.6] — 2026-06-11 | *UX premium: toasts, confirmaciones, breadcrumbs & cache instantánea*
- **Añadido**: Sistema de **toasts** no bloqueantes con cuatro variantes (success/error/warn/info), pause-on-hover, botón de cierre manual y auto-cierre adaptativo.
- **Añadido**: **Diálogo de confirmación propio** (`ssmConfirm`) con la estética de la app, teclas Enter/Escape, botón rojo gradient para acciones destructivas y focus automático.
- **Añadido**: **Cache local de empleados** (TTL 1h por empresa). Arranque percibido como instantáneo en sesiones consecutivas: hidrata `STATE.allEmployees` antes del fetch real.
- **Añadido**: **Breadcrumbs entre modales encadenados** (Balance › Gestionar calendario › Ficha) con navegación a pasos anteriores con un click.
- **Añadido**: Sistema de **tooltips contextuales** CSS-only con atributo `data-tip` y posición arriba/abajo.
- **Añadido**: **Estados vacíos rediseñados** con tarjeta gradient, icono circular y mensaje, en Vacaciones › Empleados, Fichajes sin datos y Balances vacíos.
- **Mejorado**: Cierre unificado de modales: `ESC` cierra siempre el modal más reciente; click fuera funciona en todos.
- **Mejorado**: Secciones "Ajustes de jornada retribuidos" y "Jornadas y fichajes" del modal de balance ahora son **colapsables** con toggle rotativo y borde divisorio limpio.
- **Mejorado**: Animaciones de carga unificadas (barra superior + warmup del balance) con gradiente teal→azul→violeta y efecto cometa.
- **Mejorado**: El botón "📊 Ver balance" del gestor de calendario carga los datos en background si no estaban, con toast de progreso.
- **Corregido**: 50+ `alert()` y `confirm()` nativos sustituidos por toasts y `ssmConfirm`.
- **Corregido**: El primer card de "Jornadas y fichajes" ya no se solapa visualmente con el header de la sección.
- **Corregido**: Tipografía del badge informativo de los headers nivelada con el título principal.

### [v1.7.5] — 2026-06-11 | *Toasts, confirmaciones propias y mejoras de UX*
- (Consolidada dentro de v1.7.6.)

### [v1.7.4] — 2026-06-10 | *Gestor de calendario por empleado*
- **Añadido**: **Gestor de calendario** por empleado accesible desde la ficha y desde el modal de balance. Calendario mensual editable con asignación de plantilla por día.
- **Añadido**: **Gestor de plantillas locales** (`config.schedules.json`) con CRUD, auto-detección de plantillas reales de los empleados, importación masiva, limpieza de duplicados y reset completo.
- **Añadido**: **Asignación por rango** con multi-select de empleados (búsqueda por nombre/cargo + chips Todos/Ninguno). Modo "Solo días laborables" y paralelización en chunks.
- **Añadido**: **Exports contextuales**: CSV/JSON en Vacaciones (calendario filtrado), Fichajes (fichajes filtrados con metadata) y Balances (tabla por empleado, no fichajes raw).
- **Añadido**: Endpoints en `server.py`: `GET /schedules`, `POST /save-schedules`, `POST /save-custom-template`, `POST /delete-custom-template`. Persistencia local sin tocar Sesame.
- **Añadido**: Botones "📅 Gestionar calendario" en ficha y balance; "📊 Ver balance" desde el gestor; avatares clickables en Vacaciones › Empleados con foco a la ficha.
- **Mejorado**: Detección automática de empresa zaragozana solo por nombre (Fibercom) para `HOLIDAYS_ZGZ`; el resto depende del calendario API.
- **Mejorado**: Modo empleado detecta festivos de empresa en `/employees/{id}/calendars` y marca víspera reducida.
- **Mejorado**: Plantilla vigente del empleado se resuelve **por fecha** (`scheduleTemplateAllViews` con `dateFrom`/`dateTo`), capturando reducciones individuales por paternidad, lactancia o jornada parcial.
- **Corregido**: Cálculo de teórico cuadrado con Sesame en empleados con permisos retribuidos y vísperas.
- **Corregido**: Diferencias sistemáticas de 1 minuto entre el cálculo local y Sesame (uso de `Math.floor` con signo, como hace Sesame).

### [v1.7.3] — 2026-06-10 | *Balance fix: teórico correcto en permisos, plantillas y vísperas*
- **Corregido**: Bug crítico de cálculo del balance horario documentado en `BUG_BALANCE_SESAME.md`. Días con Permiso Retribuido parcial ya no muestran `Teórico: 0h 0m`; Gestión Privada deja de inflar la compensación.
- **Mejorado**: Resolución jerárquica de retribución basada en el API oficial (`remuneratedType: "remunerated" | "not_remunerated"`).

### [v1.7.0] — 2026-06-09 | *Carga Híbrida de Horarios & Plantillas Pactadas*
- **Añadido**: Integración de la jornada pactada de contrato de cada empleado (`scheduleTemplateName` de Sesame) en fichajes y balances.
- **Añadido**: Lazy loading concurrente optimizado (`ensureProfilesLoaded`) en lotes de 5 peticiones concurrentes para evitar bloqueos del WAF al descargar perfiles y calendarios de turnos semanales (`workdays`).
- **Añadido**: Escáner serial de background (`startSerialProfileScan`) ampliado para descargar perfiles completos (workdays y cumpleaños) si hay ausencias de datos locales.
- **Añadido**: Badge dinámico `⏱ JORNADA PACTADA` en el desplegable de fichajes con la duración contratada por día y el nombre descriptivo de la plantilla activa.
- **Añadido**: Badge de jornada pactada diario y nombre del calendario inyectado en cada línea de jornada en el modal de balance por empleado.
- **Mejorado**: El indicador de jornada pactada en el modal se mueve a su propio bloque flex para evitar solapamientos con las métricas tradicionales de Trabajo, Teórico y Pausas.
- **Limpieza**: Eliminación de todos los archivos y scripts de desarrollo temporal del repositorio local para dejar limpio el proyecto.

### [v1.6.3] — 2026-06-07 | *Balance Load & Employee Absence Clarity*
- **Añadido**: Modal ampliado de Balance por empleado con resumen equivalente al portal de Sesame: entrada media, salida media, jornada media, días trabajados/teóricos, descansos, promedio de descanso, ausencias y vacaciones.
- **Añadido**: Etiquetado visible de fuente de balance: `Sesame Statistics`, `Calculado local`, ajuste de bolsa o error/sin datos.
- **Añadido**: Navegación lateral directa a **Balances** junto a Vacaciones y Fichajes, conservando también el botón superior de Balance.
- **Mejorado**: Balance diferencia claramente entre vista de ejercicio completo y vista mensual; `Ejercicio actual` vuelve siempre al rango anual del año en curso.
- **Mejorado**: La carga de Balance incorpora warmup visual, progreso local animado, lista de empleados en curso y reseteo estricto de la barra superior al terminar para evitar estados residuales al 100%.
- **Mejorado**: La vista **Vacaciones > Empleados** muestra ausencias parciales con horas acumuladas, franjas exactas y fecha compacta legible por chip (`Vie 05 Jun`) con detalle completo en tooltip (`05 de Junio - Viernes`).
- **Mejorado**: El cálculo local de Balance usa permisos retribuidos como ajuste de jornada, no como horas trabajadas adicionales.
- **Mejorado**: Las vísperas de festivo o día no laborable pueden ajustar la jornada teórica a 7h cuando aplica la regla de empresa.
- **Corregido**: Los calendarios de empresa/festivos ya no inflan el contador de ausencias personales.
- **Corregido**: Las vacaciones asignadas al empleado, incluidos puentes registrados como vacaciones, se muestran separadas de ausencias.
- **Corregido**: El resumen anual de Balance se acota hasta la fecha efectiva mostrada para cuadrar con Sesame Statistics.
- **Corregido**: La barra de progreso superior de Fichajes se oculta siempre al finalizar cargas de Balance y no conserva valores antiguos entre entradas.

### [v1.6.1] — 2026-06-04 | *Corrección de Ausencias Parciales*
- **Añadido**: Las ausencias de jornada parcial (visitas médicas, permisos por horas, etc.) ahora se visualizan en **dos niveles**:
  - **Calendario de Vacaciones — Modal de día**: aparece un badge `🕐 HH:MM – HH:MM (Xh)` bajo el nombre de cada empleado cuando la API `/calendars` confirma un horario parcial de ausencia.
  - **Fichajes — Línea de actividad**: la franja horaria de ausencia se renderiza como una **barra violeta semitransparente** en la mini-línea de actividad del panel de detalle.
  - **Fichajes — Tabla de detalles**: aparece una fila `📌 <Tipo de Ausencia>` con horario exacto y duración calculada, **solo** cuando el tramo de ausencia no está ya cubierto por un fichaje físico (no hay duplicados).
- **Añadido**: `fetchAbsenceTimesIndex()` — nueva función que consulta de forma no bloqueante `/api/v3/companies/.../calendars` para poblar `STATE.absenceTimesIndex`, un mapa `{empId_date → {startTime, endTime}}` reutilizable en todo el frontend.
- **Añadido**: `FichajesModule.absenceTimesMap` — mapa análogo para el módulo de fichajes, que cruza los horarios exactos de ausencia con los registros de presencia en `parseRealSignings`.
- **Corregido**: Las ausencias de día completo no generan fila en la tabla de detalles (no tienen franja horaria concreta).
- **Corregido**: La barra de ausencia en la mini-línea de actividad ahora ocupa el alto completo del contenedor (24 px) al eliminar el `height:8px` inline que sobreescribía el CSS.
- **Corregido**: Lógica de "cruce inteligente" actualizada para evitar que fichajes físicos reales (trabajo o pausa) sean reemplazados visualmente por el nombre de una ausencia parcial con la que solapan. Esto soluciona la desaparición de las franjas trabajadas y la visibilidad de la ausencia en la tabla de detalles.
- **Corregido**: El módulo Calendario ahora obtiene todas las ausencias sin limitarse a los tipos pre-cacheados (`fetchCalendarGrouped` con parámetros vacíos). Además, registra dinámicamente cualquier tipo de ausencia faltante o histórico devuelto por la API, solucionando el problema de ausencias invisibles en el calendario que sí aparecían en fichajes.
- **CSS**: Añadida regla `.mini-timeline-bar.absence` con color violeta `rgba(139,92,246,0.35)` y bordes laterales `#a78bfa` para distinguir visualmente las ausencias de los tramos de trabajo y pausa.

### [v1.5.2] — 2026-06-01 | *Visual Polish*
- **Añadido**: `bash start.sh` arranca en modo red local por defecto y muestra las opciones disponibles (`lan`, `local`, `token`, `help`) antes de iniciar.
- **Seguridad local**: El proxy ya no expone tokens al navegador en `/config`; usa metadatos públicos y una sesión local `HttpOnly` tras desbloquear con la contraseña maestra.
- **Mejorado**: Pulido visual premium de login, setup, sidebar, cabeceras, calendario, tablas, modales, estados vacíos, cumpleaños y responsive móvil/tablet.
- **Corregido**: El selector de **Empresa Activa** mantiene contraste y render estable en reposo, hover y focus, evitando caracteres visualmente corruptos antes de interactuar.
- **Corregido**: La línea de tiempo de fichajes conserva segmentos rectos para trabajo, pausa y ausencias; no usa esquinas redondeadas porque representa una escala temporal.
- **Mejorado**: Al editar una empresa, token y contraseña guardados se conservan sin mostrarse y se comunica con una ayuda persistente, no solo con placeholder.
- **Privacidad**: Eliminados fallbacks externos de avatar con nombres de empleados; las iniciales se generan localmente.
- **Documentación**: README y ARCHITECTURE actualizados con instalación, LAN, sesión local, cifrado de secretos y operación multiempresa.

### [v1.4.0] — 2026-05-07 | *The Persistence & Audit Update*
- **Añadido**: Nuevo motor `Incidence Detection Engine`. Detecta en tiempo real solicitudes de borrado o edición pendientes cruzando la REST API con el BI Engine.
- **Añadido**: UX Memory. El sistema guarda en `localStorage` si estabas en Fichajes o Vacaciones; un `F5` ya no interrumpe el flujo.
- **Mejorado**: El espaciado de la barra lateral (Sidebar) se ha recalibrado para mayor respiro visual bajo el logo de la empresa.
- **Corregido**: En el Modo Oscuro, el selector de empleados (`<select>`) presentaba problemas de contraste (texto blanco sobre fondo blanco nativo); arreglado con estilos dedicados.
- **Corregido**: Bug crítico al guardar ediciones en el panel de configuración de empresas (`loadSavedConfig` vs `loadConfig`).
- **Seguridad**: Limpieza profunda del repositorio. Eliminadas todas las carpetas `_scratch` y `scratch` del índice de Git para proteger datos de prueba y privacidad de empleados.

### [v1.3.0] — 2026-05-06 | *The Intelligence Update*
- **Añadido**: **BI Schema Discovery**. Detección automática y *auto-tuning* de campos GPS e IPs disponibles por licencia de empresa.
- **Añadido**: Edición completa de metadatos de empresa (Nombre, Logo, Color corporativo) directamente desde el Dashboard.
- **Mejorado**: Cálculo de horas teóricas cruzando calendarios locales e integrando el *Smart Match* de ausencias.

### [v1.2.0] — 2026-04-20 | *The Forensics & Glass Update*
- **Añadido**: Seguimiento forense del origen de los fichajes (Web/App/Tablet) y Device Tracking.
- **Añadido**: Integración dinámica con **Google Maps** en las coordenadas de check-in/out.
- **Diseño**: Refactorización del panel de detalles hacia una arquitectura "Bento-Box" usando Glassmorphism (efectos translúcidos y blur).

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **MIT**. Eres libre de usarlo, modificarlo y distribuirlo comercialmente.

---
*Diseñado y desarrollado por Jesús Gascón para optimizar la toma de decisiones en entornos operativos de Sesame HR.*
