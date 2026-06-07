# 🏗️ Arquitectura Técnica Exhaustiva - Sesame Premium Dashboard

Este documento sirve como el manual de ingeniería definitivo para el **Sesame Premium Dashboard**. Detalla los patrones de diseño, las decisiones arquitectónicas, los algoritmos de procesamiento de datos y las estrategias de resiliencia implementadas para construir una capa analítica avanzada sobre la infraestructura de Sesame HR.

---

## 1. Topología del Sistema y Estrategia de Red

El sistema opera en una arquitectura híbrida cliente-servidor local diseñada para compatibilizar la ejecución en navegador con las APIs de Sesame HR, evitando exponer credenciales en el código cliente.

### 1.1. El Proxy Híbrido (`server.py`)
Dado que las APIs de Sesame imponen políticas estrictas de CORS (Cross-Origin Resource Sharing) que impiden a un navegador hacer peticiones directas desde `localhost` o dominios no autorizados, el proyecto incluye un micro-servidor proxy escrito en Python puro (sin dependencias externas pesadas).
- **Inyección controlada de cabeceras**: Intercepta las peticiones del frontend y añade únicamente las cabeceras necesarias para compatibilidad con la API de Sesame.
- **Enrutamiento Dinámico**: Utiliza la cabecera personalizada `X-Backend-Url` enviada por el frontend para saber si debe enrutar la petición hacia `api-eu1`, `back-eu1` o `bi-engine`.
- **Gestión de secretos**: Lee `config.json` (público) y `config.secrets.json` (privado), fusionándolos en memoria solo en el servidor. El endpoint `/config` entrega metadatos sin tokens ni contraseñas; el proxy inyecta `Authorization` desde el almacén local de secretos.
- **Límite de exposición**: `server.py` puede escuchar en `127.0.0.1` o en `0.0.0.0`. El lanzador `start.sh` arranca en modo LAN por defecto para facilitar uso interno, mientras `bash start.sh local` limita el acceso al equipo actual. En ambos casos se bloquean rutas sensibles como `config.secrets.json`, claves TLS, claves de cifrado y carpetas internas.
- **Sesión local de desbloqueo**: La pantalla de contraseña ya no es solo una barrera visual. Cuando `/validate-password` valida la clave maestra, el servidor emite una cookie `HttpOnly` y de corta duración; el proxy exige esa sesión antes de inyectar tokens guardados o aceptar mutaciones de configuración. La conexión inicial con un token recién pegado puede seguir validando `/me` sin sesión porque todavía no usa secretos guardados.

### 1.2. Origen del Token y Naturaleza de la Integración

La integración no se basa en un API token público generado desde un panel administrativo de Sesame. El proyecto reutiliza la sesión web autenticada del usuario, concretamente:

- `Authorization: Bearer ...`
- `csid` de empresa

El asistente `get-token.py` levanta un receptor local en `http://localhost:8766/receive` y facilita una captura controlada de las cabeceras que la propia aplicación web de Sesame envía al interactuar con `app.sesametime.com`. Una vez capturadas, las credenciales se guardan en `config.secrets.json`; si `cryptography` está disponible, `server.py` las cifra en reposo mediante Fernet.

Implicación técnica: desde el punto de vista del código, el dashboard consume endpoints web/internos `/api/v3` protegidos por la sesión del usuario. No hay llamadas a un endpoint de creación de tokens, OAuth client credentials, API keys públicas ni panel de generación de API tokens. Si Sesame clasifica estos endpoints como API privada/no documentada, esa clasificación pertenece a Sesame; el comportamiento observable es el de una sesión web con `Bearer` y `csid`.

Los límites de uso autorizado, privacidad y cumplimiento están documentados en `COMPLIANCE.md`. Si Sesame no autoriza este mecanismo o exige API oficial, la integración debe migrarse antes de usar datos reales en producción.

### 1.3. Dominios y Superficie de APIs

El proxy limita los destinos remotos permitidos a tres orígenes:

| Dominio | Uso |
|---------|-----|
| `https://back-eu1.sesametime.com` | Backend principal para endpoints REST `/api/v3` |
| `https://api-eu1.sesametime.com` | Backend alternativo para failover/domain flipping |
| `https://bi-engine.sesametime.com` | Motor BI para `/api/v3/analytics/report-query` |

Inventario funcional de endpoints usados por la aplicación:

| Área | Endpoints |
|------|-----------|
| Sesión | `/api/v3/security/me` |
| Empleados | `/api/v3/employees`, `/api/v3/companies/{companyId}/employees`, `/api/v3/employees/{employeeId}` |
| Tipos de ausencia | `/api/v3/companies/{companyId}/absence-types` |
| Calendario | `/api/v3/companies/{companyId}/calendars-grouped`, `/api/v3/companies/{companyId}/calendars`, `/api/v3/employees/{employeeId}/calendars` |
| Saldos de vacaciones | `/api/v3/vacation-configuration/employee/{id}`, `/api/v3/statistics/employee/{id}/vacations` |
| Presencia | `/api/v3/statistics/presence`, `/api/v3/presence-status`, `/api/v3/employees/presence`, `/api/v3/presence`, `/api/v3/attendance/presence`, `/api/v3/work-entries/presence`, `/api/v3/companies/{companyId}/employees/presence` |
| Fichajes | `/api/v3/employees/{employeeId}/checks`, `/api/v3/work-entries/search`, `/api/v3/checks/search`, `/api/v3/work-entries`, `/api/v3/checks`, `/api/v3/attendance`, `/api/v3/timesheets`, `/api/v3/statistics/daily-computed-hour-stats` |
| Incidencias | `/api/v3/check-incidences` |
| BI Analytics | `/api/v3/analytics/report-query` |

### 1.4. Resiliencia y Domain Flipping (Failover)
La función `apiFetch` en `app.js` es el núcleo de la comunicación. Implementa una heurística de recuperación de errores:
1. **Intento Primario**: Lanza la petición al subdominio configurado (ej. `back-eu1.sesametime.com`).
2. **Detección de Caídas**: Si recibe un error `502`, `503`, o un fallo de red (`TypeError: Failed to fetch`), activa el modo de reintento.
3. **Domain Flipping**: Cambia dinámicamente el objetivo de `back-eu1` a `api-eu1` (o viceversa) e inyecta la nueva ruta en `X-Backend-Url`. Esto ha demostrado saltar mantenimientos puntuales o bloqueos zonales en la infraestructura de Sesame.

---

## 2. Motor de Procesamiento y Normalización de Datos

El mayor desafío técnico del proyecto es la inconsistencia estructural de las distintas APIs de Sesame. El pipeline de datos está diseñado para ingerir, limpiar y unificar esta información.

### 2.1. Ingesta Multi-Fuente Concurrente
Para construir el panel de Fichajes, no basta con un solo endpoint. El método `loadData()` orquesta un `Promise.allSettled` que dispara peticiones simultáneas a:
- **BI Analytics Engine** (`/api/v3/analytics/report-query`): Extrae la "verdad histórica", incluyendo coordenadas GPS, IPs y nombres de dispositivos.
- **Incidencias REST** (`/api/v3/check-incidences`): Extrae modificaciones de jornada realizadas a posteriori por los empleados.
- **Solicitudes REST** (`/api/v3/work-entry-requests` & `/api/v3/requests`): Extrae peticiones genéricas o borrados pendientes de aprobación.

### 2.2. Incidence Detection Engine (v1.4.0)
El BI Engine de Sesame tiene un desfase (eventual consistency) y no refleja inmediatamente las solicitudes de borrado o edición pendientes de aprobación por RRHH.
- **El Algoritmo**: El dashboard descarga las tablas de solicitudes crudas y realiza un *Fuzzy Match* (búsqueda aproximada) contra los registros del BI, comparando IDs de empleado, fechas y fragmentos de hora (`HH:MM`).
- **Resolución**: Si un registro de BI coincide con una solicitud de borrado/edición pendiente en la REST API, el motor muta el registro, le inyecta un flag de `pendingDeletion` o `pendingEdit`, lo renderiza con opacidad reducida (`⏳ PENDIENTE`) y, críticamente, **lo excluye del cálculo total de horas trabajadas en el día**.

### 2.3. Smart Match (Cruce Ausencias vs Fichajes)
La función `parseRealSignings` es el corazón analítico.
- Recibe la amalgama de datos de BI y las ausencias (Vacaciones, Bajas) del módulo de calendario.
- Agrupa los registros por la clave compuesta `EmpleadoID_Fecha`.
- **Cruce Geométrico Temporal**: Detecta si en un día marcado como "Vacaciones", el empleado tiene registros de tipo "Trabajo". En lugar de ocultar la anomalía, la UI grafica la barra de vacaciones de fondo y superpone el fichaje real, evidenciando un posible error administrativo o trabajo en festivo.

### 2.4. Normalización Universal (`upsertEmployee`)
El objeto "Empleado" difiere drásticamente si viene del endpoint `/me`, de `/employees`, o del `BI Engine`.
- `upsertEmployee` actúa como un *Reducer* global. Acepta cualquier fragmento JSON que represente a un empleado y hace un *merge* (fusión) con los datos existentes en memoria (`STATE.allEmployees`).
- **Extracción Recursiva**: Busca la fecha de nacimiento en `emp.birthDate`, `emp.birthday`, `emp.personalData.birthDate`, etc. Salva fotos de perfil perdidas conservando la URL original si la nueva petición la omite.

---

## 3. Deep Birthday Harvest (Descubrimiento en Profundidad)

Dado que la lista general de empleados de Sesame censura las fechas de nacimiento por privacidad por defecto, el sistema implementa una táctica de extracción en dos fases para popular el panel de cumpleaños:

1. **Nivel 1 (BI Query)**: Intenta inyectar una consulta al motor de Analytics solicitando el campo `core_context_employee.birthDate`. Si el WAF (Web Application Firewall) lo permite, extrae el 100% de las fechas en una sola llamada de 200ms.
2. **Nivel 2 (Serial Profiling Fallback)**: Si el BI no devuelve datos, el dashboard puede iniciar una rutina en background (`startSerialBirthdayScan`) sobre perfiles accesibles por la cuenta autenticada. Esta capacidad debe usarse solo cuando exista permiso y finalidad legítima para tratar cumpleaños; la interfaz se actualiza progresivamente con una barra de progreso sutil.

---

## 4. BI Schema Discovery & Auto-Tuning

Diferentes cuentas de empresa en Sesame tienen diferentes niveles de licenciamiento (Premium vs Basic), lo que activa o desactiva campos en el BI Engine (ej. Geolocation).
- **Probing Inicial**: Al conectar una empresa, el dashboard lanza una *query sonda* pidiendo todos los campos de auditoría posibles (Latitud, Longitud, IP, Device Name).
- **Filtro Adaptativo**: Si la API devuelve un error `400 Bad Request` indicando que un campo (ej. `check_in_latitude`) "no existe", el algoritmo captura la excepción, purga ese campo de su esquema interno y reintenta.
- **Caché de Esquema**: El esquema final "válido" se guarda en `localStorage` bajo `ssm_bi_schema_{companyId}`, garantizando que las consultas futuras sean ultrarrápidas y 100% exitosas.

---

## 5. Gestión de Estado y Persistencia (UX Memory)

La aplicación implementa un patrón similar a Redux pero en Vanilla JS puro, gestionando todo en un único objeto `STATE`. Para ofrecer una experiencia de usuario fluida sin fricciones, implementa memoria a largo y corto plazo:

- **Local Storage (Memoria Larga)**:
  - `theme`: Modo Claro u Oscuro.
  - `ssm_current_module`: El último módulo abierto (Fichajes o Vacaciones), asegurando que un F5 no te expulse de tu flujo de trabajo.
  - `ssm_sidebar_collapsed`: Estado de contracción del menú lateral.
  - Estados de colapso individuales de sub-secciones del menú.
  - Identificador de empresa activa y endpoint backend. Los tokens no se persisten en `localStorage` cuando se usa el proxy local.
- **Session Storage (Memoria Corta)**:
  - `ssm_current_date`: La fecha o periodo temporal que el usuario estaba analizando.
  - `ssm_unlocked`: Estado visual de desbloqueo para la sesión actual del navegador. La autorización real de proxy se valida en servidor mediante cookie `HttpOnly`.
  - `ssm_fichajes_cache`: Caché efímera de grandes bloques de datos JSON para que navegar atrás/adelante sea instantáneo.

---

## 6. Arquitectura Visual y Diseño (CSS Stack)

El frontend no utiliza librerías (Cero React, Vue o Tailwind) para garantizar un tamaño de *bundle* de 0 KB y tiempos de ejecución sub-milisegundo.

- **Variables CSS Dinámicas**: Todo el esquema de color está tokenizado en la raíz (`:root`). El cambio de tema invierte las variables fundamentales (`--bg-base`, `--text-primary`), haciendo que la transición sea manejada íntegramente por el motor de renderizado de la GPU del navegador.
- **Glassmorphism & Jerarquía**: Uso intensivo de `backdrop-filter: blur()`, fondos translúcidos (`rgba(255,255,255,0.03)`) y bordes de contraste (`1px solid var(--border)`) para crear profundidad.
- **Capa Visual Premium (v1.5.0)**: `styles.css` añade una capa final de superficies elevadas, bordes fuertes, sombras suaves, estados hover/focus consistentes, selector de empresa activo estable y responsive reforzado sin cambiar la estructura HTML/JS.
- **Bento-Grid Details**: El panel de detalles expandible de un fichaje usa un layout tipo "Bento Box" (cajas asimétricas organizadas en un grid perfecto) para mostrar métricas heterogéneas (Mapa GPS, Tiempos, Dispositivos) de forma digerible.
- **Timeline de Fichajes**: Las barras de trabajo, pausa y ausencias se renderizan como segmentos rectos sobre una línea temporal. No se redondean para preservar la lectura de escala y evitar un aspecto de píldoras independientes.
- **Kiosko Mode**: Un flag en el estado que aplica clases CSS a nivel del `<body>` para ocultar la barra lateral y controles, maximizando el área gráfica para pantallas de televisión en salas de reuniones.

---
*Fin del Documento de Arquitectura.*

---

## 7. Motor de Ausencias Parciales (v1.6.0)

### Problema resuelto
El API de calendarios de Sesame tiene dos endpoints con diferente granularidad:
- `/calendars-grouped` — devuelve ausencias agrupadas por tipo/día, sin horario exacto.
- `/calendars` — devuelve ausencias individuales por empleado con `startTime`/`endTime` cuando son de jornada parcial.

El módulo de Fichajes usaba únicamente los datos de presencia (`/workEntries`) para renderizar la línea de tiempo, por lo que los tramos de ausencia parcial (p. ej., visita médica de 10:16 a 12:02) eran invisibles en el detalle de ese día.

### Solución implementada

#### `fetchAbsenceTimesIndex(from, to)`
Función global no bloqueante que consulta `/calendars` y construye `STATE.absenceTimesIndex`, un `Map` con clave `"empId_date"` y valor `{startTime, endTime, seconds}`. Se llama tras cargar el calendario y el resultado queda disponible para toda la interfaz.

#### `FichajesModule.absenceTimesMap`
Mapa análogo construido dentro de `FichajesModule.loadData` usando `fetchCalendarsRaw()`. Se almacena en la instancia del módulo y se cruza en `parseRealSignings` para inyectar los horarios exactos en los `absenceSegments` de cada fila.

#### Renderizado en la UI
Las ausencias parciales se visualizan en tres capas:

| Capa | Elemento | Descripción |
|------|----------|-------------|
| **Modal calendario** | Badge `🕐 HH:MM – HH:MM` | Se muestra bajo el nombre del empleado en el modal de día del calendario de vacaciones. |
| **Mini-línea de actividad** | Barra violeta `rgba(139,92,246,0.35)` | Renderizada por `_absTimelineHtml()` sobre el contenedor `detail-activity-timeline` (24 px). |
| **Tabla de detalles** | Fila `📌 <Tipo>` con horario y duración | Generada por `_absTableRowsHtml()`. Se omite si un fichaje físico ya cubre ese tramo horario exacto (lógica de solapamiento por minuto). |

#### Lógica de deduplicación
Para evitar duplicados entre el registro del calendario y los fichajes físicos (que a veces también se etiquetan con el tipo de ausencia), `_absTableRowsHtml` aplica una comprobación de solapamiento temporal:
```
ausencia visible ⟺ no existe ninguna entrada (type ≠ 'work'/'pause')
                    cuyo tramo [eIn, eOut] solape con [absStart, absEnd]
```
Esto garantiza que el tramo 10:16-12:02 aparezca como fila `📌` si no hay ningún fichaje que lo cubra, pero se suprima si ya hay un `🚪` registrado para ese periodo exacto.

---

## 8. Motor de Balance Horario

La vista **Fichajes > Balances** combina fuentes oficiales, datos históricos de fichajes y calendario para calcular el saldo horario por empleado con trazabilidad visible.

### 8.1. Orden de prioridad de datos

El diseño evita depender de una única API no garantizada:

1. **Sesame Statistics oficial**: `GET /schedule/v1/reports/worked-hours`.
   - Parámetros esperados: `from`, `to`, `employeeIds[in]`, `limit`, `page` y, si Sesame lo admite, `withChecks`.
   - Campos esperados: `employeeId`, `secondsWorked`, `secondsToWork`, `secondsBalance`.
   - Si hay fila oficial para el empleado/periodo, se usa `secondsBalance` como fuente principal y se marca como `Sesame Statistics`.
2. **Cálculo local**: fallback cuando el endpoint oficial no devuelve datos, devuelve 403/404, no está habilitado para la sesión o no incluye `secondsBalance`.
3. **Diagnóstico**: rutas como `hours-bag-overtime` o variantes privadas quedan solo para auditoría técnica. Si Sesame responde `403 Forbidden Access Permission`, no se usan como fuente productiva.

El modal de Balance muestra siempre la fuente usada para evitar ambigüedad entre dato oficial y dato calculado.

### 8.2. Cálculo local

El cálculo local parte de las filas normalizadas por `parseRealSignings`:

- `workedSeconds`: segundos reales de trabajo, excluyendo pausas.
- `totalPauseSec`: suma de pausas.
- `theoreticSeconds`: jornada teórica final del día.
- `balanceSec`: `workedSeconds - theoreticSeconds`.
- `compensatedSeconds`: permisos retribuidos detectados en calendario.
- `compensatedAppliedToTheoretic`: parte del permiso retribuido que reduce la jornada a cubrir.

La regla importante es que las ausencias retribuidas por horas **no se suman como trabajo real**. Se muestran como **ajuste de jornada**: reducen la jornada teórica pendiente cuando Sesame no proporciona ya una jornada calculada por BI. Esto evita inflar el tiempo trabajado y permite cuadrar con el portal de Sesame.

### 8.3. Jornada teórica

La jornada teórica diaria se resuelve por prioridad:

1. `biTheoreticMap`: dato calculado por Sesame BI cuando existe.
2. `dayOverrides`: calendario individual, ausencias de día completo o excepciones.
3. Plantilla semanal del empleado.
4. Fallback conservador de 8h.

Después se aplican reglas de empresa:

- **Víspera de festivo/día no laborable**: si el día siguiente laborable está marcado como festivo, no laborable o ausencia de día completo aplicable, la jornada puede limitarse a 7h.
- **Permiso retribuido parcial**: si Sesame BI no dio ya una jornada final, la duración retribuida reduce la jornada teórica a cubrir.
- **Gestión Privada**: se muestra como ausencia/nota visual, pero no se trata automáticamente como permiso retribuido salvo que Sesame lo marque así en los datos de calendario.

### 8.4. Ausencias, vacaciones y puentes

Los contadores del modal separan conceptos:

- **Ausencias**: permisos, gestión privada, médico, bajas u otros tipos personales.
- **Vacaciones**: tipos de calendario asignados al empleado como vacaciones, incluyendo puentes si la empresa los registra así en Sesame.
- **Calendario de empresa/festivos**: no cuentan como ausencia personal ni como vacaciones del empleado.

Para esto se cruzan dos fuentes:

- `/calendars-grouped`: útil para saber qué empleados tienen eventos en cada día.
- `/calendars`: más preciso para tipo real, días `daysOff`, horarios parciales y metadatos de ausencia.

El motor deduplica por empleado, fecha y tipo para no contar dos veces el mismo evento si aparece en ambas fuentes.

### 8.5. Rango efectivo del balance anual

En el botón **Balance**, la carga puede consultar el ejercicio completo para preparar el contexto anual. Sin embargo, las métricas equivalentes al portal de Sesame se acotan al rango efectivo mostrado.

Ejemplo: si el ejercicio consultado es `2026-01-01 - 2026-12-31`, pero hoy es `2026-06-06`, el modal muestra y calcula los indicadores de resumen contra `2026-01-01 - 2026-06-06`. Esto evita contar vacaciones futuras o ausencias posteriores a la fecha de comparación.

### 8.6. Métricas del modal de empleado

El modal de Balance muestra:

- Balance usado.
- Trabajado.
- Teórico.
- Ajuste jornada.
- Pausas.
- Entrada media.
- Salida media.
- Jornada media.
- Días trabajados / días teóricos.
- Descansos y promedio de descanso.
- Ausencias y vacaciones.
- Comparativa entre local, bolsa y Sesame Statistics.
- Detalle de ajustes retribuidos.
- Jornadas desplegables con fichajes diarios.

Las medias de entrada/salida se calculan desde timestamps originales cuando existen; si no, se usa la hora normalizada visible.

### 8.7. Carga visual y limpieza de progreso

La vista **Balances** tiene identidad de carga propia y no depende de la barra superior genérica de Fichajes:

- `renderBalanceWarmup()` muestra un estado inicial inmediato con rango, empleados candidatos y skeletons.
- `prepareOfficialWorkedHoursLoad()` inicializa el progreso local con fase `local` antes de consultar Sesame Statistics.
- `startBalanceLocalPulse()` anima el avance local mientras se prepara la base de datos calculada, incluso si todavía no hay progreso real del endpoint remoto.
- `startOfficialWorkedHoursLoad()` cambia de fase a `statistics` y después a `history` para separar la consulta oficial de Sesame y la aplicación de bolsa de horas.
- `resetSigningsTopProgress()` fuerza la barra superior genérica a `hidden` y `0%` al entrar o terminar Balance, evitando que quede visible al 100% por estados heredados de cargas anteriores.

Este diseño evita dos problemas de UX: sensación de bloqueo al entrar en Balance y barras de progreso residuales cuando el cálculo ya terminó.

---

## 9. Vista Empleados de Vacaciones

La subvista **Vacaciones > Empleados** resume las ausencias agrupadas por empleado y tipo, pero conserva la granularidad diaria necesaria para auditar permisos parciales.

### 9.1. Modelo de datos agregado

`renderEmployeeList()` construye un mapa por empleado y tipo de ausencia con:

- `dates`: días visibles del mes.
- `dateKeys`: fechas completas `YYYY-MM-DD`, usadas para calcular día de semana y mes.
- `fullDates`: ausencias de día completo.
- `partialDates`: ausencias parciales.
- `partialSeconds`: duración acumulada de permisos parciales.
- `partialSlots`: lista de tramos `{date, day, startTime, endTime, seconds}`.

El índice `STATE.absenceTimesIndex` se consulta por clave `empId_date` para asociar cada ausencia parcial con su horario real. Cuando ese índice termina de cargar en segundo plano, se llama a `refreshAllViews()` para repintar la vista con los horarios exactos sin bloquear la primera carga.

### 9.2. Lectura visual de fechas

Para reducir ambigüedad, cada chip de día se formatea con `formatAbsenceDateMeta()`:

- Formato compacto visible: `Vie 05 Jun`.
- Detalle completo en tooltip: `05 de Junio - Viernes`.

En ausencias parciales, la fecha compacta se muestra junto a la franja horaria (`Vie 05 Jun · 12:00-14:00`). En ausencias completas, los días aparecen como chips separados debajo del tipo. Esto evita cadenas largas como `01 08:00-16:00, 02 08:00-16:00` donde era fácil perder qué horario pertenecía a cada día.
