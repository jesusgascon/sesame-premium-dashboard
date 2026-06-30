# Changelog

Todos los cambios relevantes de **Sesame Premium Dashboard** se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/) y el proyecto se adhiere a
[Versionado Semántico](https://semver.org/lang/es/). El detalle ampliado de cada versión vive en el
[README](./README.md#-changelog-detallado).

## [1.9.21] — 2026-06-30

### Corregido
- **Menú «⋯ Más herramientas» detrás de la tabla en Balances**: el panel quedaba oculto tras la cabecera *sticky* de la tabla de balance (en Fichajes se veía bien, en Balances no). Causa: el panel era `position:absolute` y quedaba atrapado en el contexto de apilamiento que crea el `backdrop-filter` de la barra superior. Ahora usa `position:fixed` con coordenadas calculadas en JS (`positionFixedPopover`) y z-index alto, igual que los popovers de presencia, así que aparece siempre por encima del contenido.

### Mejorado
- **Menos ruido en el log del servidor**: los errores *esperados* del descubrimiento de endpoints y de la falta de licencia BI (`403`/`404`/`422`) ya no se imprimen en el arranque normal. Se siguen logueando todos con `SESAME_DEBUG=1`, y los errores inesperados (5xx, etc.) se muestran siempre.
- **Carga de horario por empleado**: la petición a `/schedule/v1/employees/{id}/schedule-templates` usaba `limit=400` y Sesame la rechazaba con `422 invalid_items_per_page_limit_exceeded`; se baja a `limit=100` (de sobra para el rango mensual), evitando el error.

## [1.9.20] — 2026-06-30

### Corregido
- **(Crítico) Horario teórico real por día desde Sesame**: el horario reducido de verano (y cualquier cambio de plantilla con fecha) ya no «tapa» el resto del año. Causa de fondo: con la licencia actual Sesame **no** expone el histórico de jornada por las vías que usábamos (`/employees/{id}` solo devolvía la asignación de verano; `schedule/v1/*` y el BI dan 403). Se ha localizado el endpoint **interno** que sí lo da sin licencia de pago — `/api/v3/employees/{id}/schedule-templates-v2?from&to` —, que devuelve la jornada teórica que **Sesame calcula para cada persona y día** (p. ej. enero → «Jornada 40h/semana» 8h15 L-J / 7h V; 29-jun→31-ago → «Jornada 35h/semana» 7h). El dashboard lo carga para el rango visible y lo usa como **fuente autoritativa** en `resolveEmployeeScheduleForDate`, de modo que el cálculo del balance y todos los displays muestran **el horario real de cada usuario en cada día**. Tolerante a fallos: si el endpoint no responde, se cae a las vistas/fallback locales.

## [1.9.19] — 2026-06-30

### Corregido
- **(Crítico) Horario de verano aplicado a todos los días**: al activarse por primera vez un horario reducido con fecha de inicio y fin (jornada de verano, por empleado y por sede/colectivo, con distintas fechas de inicio según oficina), el horario reducido se mostraba en **todos** los días pasados y futuros en la «JORNADA PACTADA» del detalle de Fichajes, en el horario por día del modal de Balance y en el export JSON. Causa: esos tres puntos leían el horario **por defecto** del empleado (`workdays`, fijado a la primera vista que devuelve Sesame) sin resolver por fecha. Ahora los tres pasan por `resolveEmployeeScheduleForDate(empleado, fecha)`, que respeta el override de verano por fecha exacta y las vistas de Sesame por su rango de vigencia, de modo que cada usuario ve **su** horario en **ese** día.
- **Robustez del resolutor de horarios**: (1) la detección del rango de vigencia (`dateFrom`/`dateTo`) admite ahora más variantes de nombre de campo de la API de Sesame; y (2) cuando ninguna vista cubre una fecha, el *fallback* ya **no** aplica una plantilla acotada (p. ej. la de verano) fuera de su rango, sino la jornada base permanente (vista sin fecha de fin).

## [1.9.18] — 2026-06-24

### Corregido
- El menú «⋯ Más herramientas» de la cabecera de Fichajes/Balances se veía translúcido y con los iconos casi invisibles sobre la tabla. Ahora tiene fondo sólido (tema claro/oscuro), borde, sombra, mayor z-index y mejor contraste.

## [1.9.17] — 2026-06-24

### Añadido
- **Selector de empleado en Balances**: vuelve a mostrarse para filtrar por una persona o ver todo el equipo (el filtrado ya se aplicaba; solo se había ocultado al compactar la cabecera). El buscador y «Varios…» siguen ocultos en Balances.

## [1.9.16] — 2026-06-24

### Cambiado
- **Cabecera de Fichajes/Balances**: deja de partirse en 2 filas con el panel lateral abierto. Los iconos secundarios (Sesame, Kiosko, export CSV/JSON, tema, cumpleaños) se agrupan en un menú «⋯ Más herramientas»; la barra se compacta cuando el sidebar resta ancho (se ocultan etiquetas de presencia y «Actualizado hace…»); y en modo Balances se ocultan los filtros de tabla que no aplican.
- **Vista Balance compactada**: se ocultan los indicadores de fuente de datos (badges «Sesame Statistics / Calculado local / Fallback local» por empleado, fila de desglose de fuente y la sección «Comparativa de balance» del detalle). El cálculo no cambia; la fuente se conserva en el export.

## [1.9.15] — 2026-06-24

### Cambiado
- El indicador de fichaje **fuera del recinto de la oficina** se muestra ahora sobre los **pines** 📍 In / 📍 Out del detalle del día (pasan a **🚩 rojo** cuando la geolocalización cae fuera), en vez de un badge aparte en la columna Origen.

### Añadido
- Se solicita también `check_out_inside_office` a Sesame para marcar **entrada y salida** de forma independiente (antes solo se disponía del dato de entrada). El esquema BI se re-descubre automáticamente; el campo se ignora sin romper nada si la empresa no lo expone.

## [1.9.14] — 2026-06-24

### Añadido
- **Panel «Dispositivos y origen»** en los resúmenes de Fichajes: reparto por canal (Web/App/Tablet), % de fichajes dentro/fuera de la oficina y ranking de terminales más usados (qué tablet se usa más). Se calcula sobre los fichajes visibles en una sola pasada y se presenta como banner a todo el ancho de la rejilla.
- **Resalte de fichaje fuera de oficina**: en el detalle del día, los tramos cuya geolocalización cae fuera del recinto (`insideOffice`) muestran un distintivo 🚩 «Fuera».

### Cambiado
- **Barra superior de Vacaciones unificada** con Fichajes y Balances: el contador de ausencias va al lado del mes (no debajo), reutilizando el contenedor `.fichajes-period-main`. Rejilla de resúmenes reorganizada (banner a todo el ancho), con `max-height` y responsividad de columnas corregidas.

### Corregido
- **Export CSV de Fichajes**: la columna «Localización» salía siempre vacía; ahora se rellena con la dirección o las coordenadas del fichaje.

## [1.9.13] — 2026-06-24

### Añadido
- **Dispositivo de fichaje visible**: el detalle de Fichajes muestra, en pequeño bajo la columna «Origen» y en el modal «Mapa de fichaje», el origen del fichaje (🌐 Web / 📱 App / 📟 Tablet) y el **nombre del terminal** cuando Sesame lo proporciona (p. ej. la tablet concreta). Si entrada y salida usan dispositivos distintos, se muestran ambos. El dato proviene de `check_in/out_device_name`.

## [1.9.12] — 2026-06-24

### Cambiado
- **Frontend modular**: el monolito `app.js` (~13.200 líneas) se divide en **cinco módulos clásicos** cargados en orden — `app.core.js` (estado, helpers, capa API, fechas, ausencias), `app.boot.js` (multi-empresa, temas, animaciones, arranque), `app.vacaciones.js` (calendario, filtros, estadísticas, modales), `app.misc.js` (export, navegación, idle/logout) y `app.fichajes.js` (FichajesModule, gestores y arranque `DOMContentLoaded`). **Sin cambios funcionales**: la app se comporta de forma idéntica. Mejora la navegación, el mantenimiento y el aislamiento entre áreas. Garantizado por **reconstrucción byte-a-byte** del `app.js` original y auditoría del grafo de dependencias por módulo. Detalle en [ARCHITECTURE.md §13](./ARCHITECTURE.md).
- **Mantenimiento**: `server.py` (`PUBLIC_FILES`) e `index.html` sirven y cargan los cinco módulos en el orden obligatorio; `.github/workflows/ci.yml` valida la sintaxis de los cinco. `actions/checkout` del CI actualizado a v7.

## [1.9.11] — 2026-06-19

### Añadido
- **Animación de cierre de sesión**: un "telón" (paneles superior e inferior con tinte de marca)
  se cierra sobre la app con un candado y el mensaje "Sesión cerrada", y luego se revela la pantalla
  de contraseña. Implementada con la Web Animations API (visible también por escritorio remoto) y
  adaptada al **tema claro/oscuro** activo. Respeta `prefers-reduced-motion`.
- **Auto-cierre de sesión por inactividad** (privacidad): tras 10 minutos sin interacción real del
  usuario (ratón, teclado, scroll, táctil) se cierra la sesión con la animación y se exige volver a
  introducir la contraseña. Solo cuenta la actividad del usuario —los refrescos de red en segundo
  plano no reinician el contador— y funciona con la pestaña en segundo plano. El **modo Kiosko** queda
  excluido (la pantalla de oficina nunca se cierra por inactividad).

### Corregido
- **Re-login en caliente tras cerrar sesión**: el desbloqueo posterior a un logout quedaba a medias
  (sin "Verificando…" y con datos viejos) porque la inicialización y el cableado de eventos solo se
  ejecutan una vez por carga de página y no son idempotentes. Ahora el cierre de sesión recarga la
  página (oculto tras el telón) para re-inicializar limpio, equivalente al `Ctrl+Shift+R` manual.

## [1.9.7] — 2026-06-19

### Añadido
- **Cumplimiento de jornada >6h**: los tramos de trabajo continuo que superan el máximo legal sin pausa
  (Estatuto de los Trabajadores art. 34.4 y Convenio del Metal de Zaragoza) se señalan de forma discreta
  pero visible en la línea de tiempo (anillo ámbar), en la tabla (icono ⚠) y en el resumen del fichaje.
- **Continuación de fichajes que cruzan medianoche**: los tramos nocturnos se muestran también en el día
  en el que terminan, como hace Sesame, mediante segmentos de continuación que **no** contaminan las
  métricas del día (primera entrada, número de tramos, totales).
- **Animación de cambio de empresa**: barrido diagonal de marca con transición de contenido y logo,
  implementada con la Web Animations API para que se vea también por escritorio remoto.
- **Carga in-place de Vacaciones**: al cambiar de mes se usa un indicador ligero en lugar del overlay
  "Conectando a Sesame", que resultaba intrusivo para una operación tan frecuente.

### Corregido
- **(Crítico) Datos cruzados al cambiar de empresa**: el calendario, los empleados, los fichajes y los
  balances podían seguir mostrando datos de la empresa anterior hasta un refresco completo. Se limpia
  todo el estado por empresa (plantilla, presencia, calendario, fichajes, balances, mapas oficiales) y
  se aplica **caché selectiva**: se conserva la caché por-empresa cuando la empresa va en la URL y se
  fuerza `no-store` cuando solo viaja en cabeceras (evita servir datos de otra empresa).
- **Presencia obsoleta al cambiar de empresa** (Trab./Pausa/Tele./Fuera): se vacían `presenceList` y
  `realtimePresence` y se refresca el resumen al instante; además la presencia (dato en tiempo real)
  nunca se cachea, así al volver a una empresa no se ve su presencia antigua.
- **Filtro de presencia en Balance**: «Trab.»/«Pausa» ahora filtran **todas** las fuentes del balance
  (filas locales, directorio, bolsa oficial de Sesame e histórico de reglas); antes las fuentes oficiales
  reinyectaban a toda la plantilla y el filtro no surtía efecto. Estado vacío explícito cuando no hay
  nadie en ese estado, con botón para quitar el filtro.
- **Popover "Fuera ahora"**: el `backdrop-filter` del `.top-bar` lo atrapaba en su contexto de
  apilamiento (salía desplazado y por detrás de los resúmenes y de la cabecera de la tabla). Ahora se
  ancla al `<body>` con `position:fixed`, con coordenadas correctas y por encima de todo.
- **Filtro de empleado** al cambiar de empresa: se resetea a «Todo el equipo» (el empleado seleccionado
  podía no existir en la nueva empresa y arrastraba datos cruzados).
- **Arranque** directo en el último módulo usado, sin pasar por el calendario de Vacaciones.
- **Tema claro**: legibilidad de la marca >6h y de la continuación nocturna, y estado deshabilitado de
  los botones de navegación.

### Mejorado
- **Pulido visual**: barra de progreso de fichajes como píldora, loader de cambio de mes en Vacaciones y
  refinamiento general de la capa premium.
- **Mantenimiento del repositorio**: perfil profesional (Código de Conducta, CI), `dependabot` y
  actualización de `actions/checkout`, `setup-node`, `setup-python` y del requisito de `cryptography`.

## [1.8.0] — 2026-06-16

### Corregido
- **(Crítico) Mezcla de plantillas multi-empresa**: con una cuenta de administrador con acceso a varias
  empresas, Fichajes y Balances mostraban empleados de ambas empresas a la vez. `fetchEmployees()` usa
  ahora el endpoint por empresa `/api/v3/companies/{companyId}/employees` como fuente principal y el
  directorio global solo como fallback filtrado por `companyId`.

### Añadido
- **Botón flotante "subir arriba"** que aparece al bajar más de 400 px en Fichajes/Balances y en las
  vistas de Vacaciones, con scroll suave y respeto de `prefers-reduced-motion`.
- **Giro del icono 🔄 de actualizar** en cualquier refresco (manual, auto-refresco silencioso y warmup
  de balance), con sincronización absoluta y duración mínima visible.

### Mejorado
- **Animaciones premium** en login, "Editar empresa" y el overlay "Conectando a Sesame".
- **Documentación y andamiaje profesional**: `.github/` (plantillas de issues/PR, `SECURITY.md`,
  `CODEOWNERS`), `CONTRIBUTING.md`, este `CHANGELOG.md` y alineación de README, ARCHITECTURE, COMPLIANCE,
  `.gitignore` y `config.example.json` con el estado real del proyecto.

## [1.7.23] — 2026-06-11
Panel lateral mejorado, protección multi-empresa (guarda anti-carrera, caché sellada por empresa,
validación de plantilla) y banner de token caducado con detección en vivo.

## [1.7.0] – [1.7.19] — 2026-06-09 … 2026-06-11
Carga híbrida de horarios y plantillas pactadas (v1.7.0), fichajes en vivo y balance horario
(v1.7.2–v1.7.3), gestor de calendario por empleado (v1.7.4), capa de UX premium —toasts,
confirmaciones, breadcrumbs, caché instantánea— (v1.7.5–v1.7.6), insights colapsables y selector
año/mes (v1.7.7), toggle Con hoy / Sin hoy en balance (v1.7.12), vistas semana/día a escala (v1.7.16)
y estadísticas de vacaciones renovadas (v1.7.18–v1.7.19).

Consulta el [changelog detallado del README](./README.md#-changelog-detallado) para el desglose
completo de cada versión.
