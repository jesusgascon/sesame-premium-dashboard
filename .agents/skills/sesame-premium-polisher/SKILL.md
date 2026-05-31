---
name: sesame-premium-polisher
description: Usa esta skill para analizar, modernizar y pulir el proyecto sesame-premium-dashboard sin romper su arquitectura vanilla HTML/CSS/JS/Python, aplicando mejoras premium de UI/UX, accesibilidad, documentación y calidad de código.
---

# Skill: Sesame Premium Polisher

## Objetivo

Transformar `sesame-premium-dashboard` en una versión más premium, coherente y profesional sin cambiar su filosofía:
- vanilla HTML/CSS/JS
- Python local proxy
- ejecución local
- mínimo acoplamiento
- sin framework pesado
- sin publicar nada en GitHub

## Flujo obligatorio

### 1. Reconocimiento profundo

Antes de editar:
- listar archivos relevantes
- identificar estructura real
- leer README y ARCHITECTURE
- entender flujo de autenticación/configuración
- entender módulos funcionales
- entender cómo se renderizan vistas, menús, calendario, fichajes, presencia, cumpleaños y configuración
- detectar puntos frágiles
- detectar duplicidades de CSS/JS
- detectar inconsistencias visuales

### 2. Investigación externa

Buscar fuentes actuales y buenas prácticas sobre:
- AGENTS.md, skills y subagents
- AI coding agents
- diseño dashboard SaaS premium
- WCAG y contraste
- responsive dashboard
- CSS design tokens
- vanilla JS maintainability
- Python local proxy security

No copiar código de terceros.

### 3. Diseño de mejora

Crear internamente una lista priorizada:
- quick wins visuales
- mejoras estructurales CSS
- mejoras de interacción
- mejoras de accesibilidad
- mejoras responsive
- mejoras de documentación
- mejoras de seguridad local
- mejoras de validación

### 4. Implementación

Aplicar cambios de forma incremental:
- primero CSS/design tokens
- después pequeños ajustes HTML si hacen falta
- después JS solo si mejora estados/interacciones/mantenibilidad
- Python solo si hay problemas claros de seguridad, errores o documentación
- documentación al final

No eliminar funciones existentes.
No crear una app nueva.
No introducir frameworks.

### 5. Revisión visual

Revisar todas las vistas y estados disponibles:
- dashboard principal
- sidebar
- cabecera
- login/configuración
- calendario
- fichajes
- presencia
- cumpleaños
- vacaciones
- modales
- tablas
- filtros
- tema claro/oscuro
- responsive móvil/tablet/escritorio
- errores
- estados vacíos
- loaders

Si Playwright, browser tooling o screenshots están disponibles, usarlos para detectar problemas visuales.
Si no están disponibles, realizar auditoría estática DOM/CSS/JS y explicar esa limitación.

### 6. Validación

Ejecutar:
- `python3 -m py_compile server.py get-token.py` si existen
- `bash -n start.sh` si existe
- revisión de `git diff`
- revisión de posibles secretos con `git diff --check` y búsquedas prudentes

### 7. Entrega

Al terminar, entregar:
- resumen ejecutivo
- lista de archivos modificados
- mejoras aplicadas
- pruebas ejecutadas
- riesgos pendientes
- recomendaciones futuras
- comandos para revisar localmente

## Prohibiciones

No hacer:
- git push
- pull request
- release
- publicación de paquetes
- lectura de secretos reales
- impresión de tokens
- migración a framework
- reescritura total
- borrado destructivo
