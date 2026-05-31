# AGENTS.md — Sesame Premium Dashboard

## Identidad del proyecto

Este repositorio es `sesame-premium-dashboard`, un dashboard avanzado para Sesame HR.

El proyecto debe tratarse como una aplicación local y ligera:
- Frontend principal: HTML5, CSS3 y JavaScript ES6+ vanilla.
- Backend/proxy local: Python 3.
- Scripts auxiliares: Bash y Python.
- Documentación: README.md, ARCHITECTURE.md y ficheros de configuración de ejemplo.
- No convertir el proyecto a React, Vue, Angular, Vite, Next.js ni frameworks similares salvo que el usuario lo pida de forma explícita.

El objetivo de este agente es evolucionar el proyecto hacia una versión visual y funcionalmente más premium, moderna, consistente y profesional, manteniendo la arquitectura simple y sin romper compatibilidad.

## Reglas críticas de seguridad

Está prohibido:
- Subir cambios a GitHub.
- Ejecutar `git push`.
- Crear pull requests.
- Publicar releases.
- Leer, copiar, imprimir o resumir secretos reales.
- Modificar `config.secrets.json` si existe.
- Mostrar tokens, credenciales, cookies, CIF, contraseñas o datos personales reales.
- Enviar datos reales de empleados a servicios externos.
- Añadir telemetría o tracking.
- Romper compatibilidad con ejecución local mediante `bash start.sh`.
- Reescribir todo el proyecto desde cero.
- Introducir dependencias pesadas sin justificarlo en un informe.

Si necesitas datos de prueba, crea fixtures anónimos y sintéticos dentro de una carpeta local de pruebas.

## Archivos sensibles

No leer ni modificar:
- `config.secrets.json`
- `.env`
- `.env.*`
- cualquier fichero con tokens, claves o credenciales reales
- carpetas `scratch/` o `_scratch/` si aparecen

Sí se pueden leer y mejorar:
- `README.md`
- `ARCHITECTURE.md`
- `config.example.json`
- `config.secrets.example.json`
- `index.html`
- `styles.css`
- `app.js`
- `server.py`
- `get-token.py`
- `start.sh`
- `.gitignore`
- documentación y ejemplos sin secretos reales

## Forma de trabajo obligatoria

Trabaja por fases, pero con la mínima intervención del usuario:

### Fase 1 — Comprensión total
Analiza todo el proyecto:
- código
- documentación
- estructura de carpetas
- configuración
- scripts
- ejemplos
- dependencias
- README
- arquitectura
- estilo visual
- flujo de usuario
- módulos y pantallas
- riesgos técnicos
- deuda técnica
- posibles inconsistencias

Genera internamente un mapa del sistema antes de editar.

### Fase 2 — Investigación técnica actual
Busca documentación actual y buenas prácticas modernas sobre:
- Codex / AGENTS.md / skills / subagents
- buenas prácticas para agentes de programación
- diseño de dashboards SaaS premium
- glassmorphism moderno sin perder legibilidad
- accesibilidad WCAG
- responsive design
- CSS variables y design tokens
- vanilla JavaScript mantenible
- seguridad en frontends con tokens
- proxies Python locales
- hardening de manejo de configuración
- pruebas visuales o snapshots si hay tooling disponible

No copies código de terceros. Usa la investigación solo para criterios de diseño y buenas prácticas.

### Fase 3 — Auditoría premium
Audita todas las pantallas, menús, módulos, estados, temas, formularios, tablas, tarjetas, calendario, sidebar, cabecera, diálogos, badges, estados vacíos, errores, loaders, responsive y modo oscuro/claro.

Busca:
- incoherencias visuales
- estilos duplicados
- colores poco profesionales
- baja legibilidad
- problemas responsive
- exceso de ruido visual
- falta de jerarquía
- textos poco claros
- errores de contraste
- estados de carga pobres
- inconsistencias entre módulos
- menús o botones básicos
- pantallas que parezcan prototipo en vez de producto premium

### Fase 4 — Implementación local
Aplica mejoras directamente en local, sin preguntar en cada cambio, siempre que:
- no se rompa la arquitectura existente
- no se añadan secretos
- no se suba nada a GitHub
- no se cambie la finalidad del proyecto
- no se introduzcan frameworks pesados
- no se eliminen funciones existentes

Prioriza:
1. sistema visual premium consistente
2. design tokens CSS
3. mejores estados visuales
4. navegación más clara
5. responsive real
6. accesibilidad
7. microinteracciones suaves
8. refactor mínimo de JS si ayuda a mantenimiento
9. documentación actualizada
10. validación final

## Criterios visuales

El resultado debe sentirse como una herramienta SaaS premium:
- limpia
- moderna
- elegante
- profesional
- rápida
- legible
- con buen contraste
- con jerarquía clara
- con estética premium, no “demo básica”
- sin recargar la interfaz
- sin romper el carácter actual glassmorphism/bento si ya existe

Evita:
- colores chillones sin sistema
- sombras excesivas
- animaciones invasivas
- iconos decorativos sin función
- efectos que empeoren legibilidad
- cambios visuales que parezcan plantilla genérica

## Validación obligatoria

Antes de terminar:
- Ejecuta `python3 -m py_compile server.py get-token.py` si existen.
- Ejecuta `bash -n start.sh` si existe.
- Revisa que HTML/CSS/JS sigan siendo coherentes.
- Si hay herramientas disponibles, ejecuta lint/formato sin introducir dependencias productivas innecesarias.
- Comprueba `git diff`.
- Resume todos los archivos tocados.
- Explica riesgos, pruebas realizadas y siguientes mejoras recomendadas.

## Git

Puedes crear commits locales si ayuda, pero no hagas push.

Antes de cualquier commit:
- muestra resumen del diff
- evita incluir secretos
- evita incluir datos reales
- comprueba `git status`

Nunca ejecutes:
- `git push`
- `gh pr create`
- `gh release create`
- `npm publish`
- comandos destructivos fuera del repo

## Comunicación

Responde en español.
Sé técnico, claro y directo.
No ocultes dudas.
No vendas humo: si algo no se puede validar automáticamente, dilo.
