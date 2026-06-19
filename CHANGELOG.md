# Changelog

Todos los cambios relevantes de **Sesame Premium Dashboard** se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/) y el proyecto se adhiere a
[Versionado Semántico](https://semver.org/lang/es/). El detalle ampliado de cada versión vive en el
[README](./README.md#-changelog-detallado).

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
