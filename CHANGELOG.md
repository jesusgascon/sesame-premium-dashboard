# Changelog

Todos los cambios relevantes de **Sesame Premium Dashboard** se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/) y el proyecto se adhiere a
[Versionado Semántico](https://semver.org/lang/es/). El detalle ampliado de cada versión vive en el
[README](./README.md#-changelog-detallado).

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
