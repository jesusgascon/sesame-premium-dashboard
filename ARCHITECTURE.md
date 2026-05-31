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

### 1.2. Resiliencia y Domain Flipping (Failover)
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
- **Bento-Grid Details**: El panel de detalles expandible de un fichaje usa un layout tipo "Bento Box" (cajas asimétricas organizadas en un grid perfecto) para mostrar métricas heterogéneas (Mapa GPS, Tiempos, Dispositivos) de forma digerible.
- **Kiosko Mode**: Un flag en el estado que aplica clases CSS a nivel del `<body>` para ocultar la barra lateral y controles, maximizando el área gráfica para pantallas de televisión en salas de reuniones.

---
*Fin del Documento de Arquitectura.*
