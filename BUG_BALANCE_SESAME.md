# Análisis del Bug de Balance (Ausencias y Teórico) - v1.7.8+

**Fecha**: Junio 2026
**Estado**: ✅ CORREGIDO en v1.7.2 (parche aplicado 2026-06-10). Ver sección "Correcciones aplicadas" al final.

## El Problema Central
El cálculo local de balance (horas trabajadas vs horas teóricas) daba fallos masivos en las ausencias (ej. -265h en Fibercom, o 8h15m fijas en APL) cuando el motor de BI de Sesame no devolvía el cálculo procesado.

### Los Síntomas
1. **Administradores (APL - Andrea)**: Los días con "Permiso Retribuido" o "Médico" mostraban el Teórico intacto a 8h15m, sin descontar las horas del médico.
2. **Empleados sin acceso BI (Fibercom - Jesús)**: Todas las ausencias (Gestión Privada, Vacaciones, Permisos) mostraban el Teórico a 8h15m, provocando una deuda brutal en el balance (ej. -21h).

## Causa Raíz
Sesame tiene dos formas de obtener la jornada teórica y las ausencias:
1. **API BI Engine (`schedule_context_daily_computed`) / Metadata de Fichajes**: Contrario a lo que la app asumía inicialmente, estos endpoints devuelven la jornada **BASE** (ej. 8h15m) y **NO descuentan nativamente las ausencias**.
2. Por lo tanto, la app **debe** aplicar matemáticamente la reducción de jornada de forma local.

Sin embargo, el motor de reducción local (`dayOverrides`) tenía varios fallos críticos estructurales:

### Fallo 1: El Modo Administrador ignoraba las ausencias personales
En Modo Administrador (`_employeeMode = false`), la app usaba `fetchCalendarsRaw` llamando a `/api/v3/companies/.../calendars`. 
**El problema:** Ese endpoint solo devuelve festivos de empresa. Las ausencias personales (Médico, Vacaciones) se obtenían en otro lado (`fetchCalendarGrouped`) para pintar los iconos 📌, pero **nunca** se pasaban al motor matemático `dayOverrides`. Resultado: El teórico en APL siempre era 8h15m, aunque hubiera permisos.

### Fallo 2: El Modo Empleado no tenía fallback matemático
En Modo Empleado (error 403 por falta de permisos en Fibercom), la app leía el calendario personal para los iconos 📌, pero al igual que el administrador, nunca lo inyectaba en `dayOverrides` para restar horas.

### Fallo 3: Extracción de tiempos parciales invisible
La función que calculaba cuánto debía restar una ausencia parcial (`getDayOffSeconds`) solo buscaba en `dayOff.startTime`. La API de Sesame esconde los tiempos dentro de `dayOff.partialDay.startTime` o `dayOff.details.startTime`. Al no encontrar la hora, la función devolvía `0` y se anulaba el descuento en todos los casos.

## Intentos de Solución (v1.7.9a - v1.7.9g)
- Se intentó llamar a `/api/v3/employees/.../absence-notices` (provocó el bug de las -265h por formato incompatible).
- Se reparó la lectura de tiempos ocultos en `getDayOffSeconds`.
- Se parcheó el loop de `localAbsences` para inyectar todas las ausencias en `dayOverrides`.
- Se liberó el bloqueo de `!isSesameComputedTheoretic` para forzar el descuento local siempre.

## Conclusión y Próximos Pasos (cuando se retome desde v1.7.2)
Para arreglar esto limpiamente desde v1.7.2 sin romper la arquitectura:
1. **Unificar `dayOverrides`**: Hay que asegurar que las ausencias personales obtenidas en `fetchCalendarGrouped` (que acaban en `localAbsences`) se conviertan siempre en `dayOverrides` con sus respectivos `compensatedSeconds`.
2. **Actualizar `getDayOffSeconds`**: Debe ser tan exhaustivo buscando `startTime` como lo es la función visual del timeline (`partialDay`, `details`, `start_time`, etc.).
3. **No confiar en el BI**: Eliminar la asunción de que Sesame nos da el Teórico ya descontado. Si hay una ausencia compensable local, **siempre** hay que restarla del teórico devuelto por el BI o la plantilla.
4. **Catálogo de Ausencias**: Asegurar que "Gestión Privada", "Asuntos propios", "Vacaciones" devuelvan `true` al comprobar si son jornadas compensables.

---

## Correcciones aplicadas (2026-06-10)

Los 4 puntos anteriores han sido implementados en `app.js`:

### 1. ✅ `getDayOffSeconds` — búsqueda exhaustiva de tiempos (línea ~244)
Añadida lectura desde `partialDay.startTime`, `partialDay.start_time`, `details.startTime`, `details.start_time`. Antes solo leía el primer nivel del objeto.

### 2. ✅ `isKnownCompensatedAbsenceLabel` — catálogo ampliado (línea ~217)
Añadidos al regex de nombres conocidos: `vacaciones?`, `vacation`, `paid_vacation`, `gestion\s+privada`, `asuntos?\s+propios?`. Antes faltaban los tipos más habituales en España.

### 3. ✅ Nuevo bloque post-`localAbsences` → `dayOverrides` (línea ~5264)
Bloque que itera `localAbsences` (ya poblado tanto en modo admin como en modo empleado) e inyecta en `dayOverrides` los `compensatedSeconds` y `fullDayRemunerated` para cada ausencia retribuida personal. Maneja dos formatos de datos:
- **Formato A (admin)**: `{ calendar_type, employees: [{id, startTime, ...}] }` de `calendars-grouped`
- **Formato B (empleado)**: `{ calendarType, startTime, daysOff, ... }` de `/employees/{id}/calendars`

Este es el fix principal. Sin él, Médico, Vacaciones y Gestión Privada eran invisibles para el motor de teórico.

### 4. ✅ Eliminado guard `!isSesameComputedTheoretic` en `parseRealSignings` (línea ~7068)
El BI devuelve la jornada BASE (ej. 8h15m) sin descontar ausencias. El parche aplica siempre la compensación local independientemente de si el BI proporcionó el teórico. El guard anterior impedía el descuento cuando existía dato BI, que es precisamente la situación más común (APL, cuentas con acceso BI).
