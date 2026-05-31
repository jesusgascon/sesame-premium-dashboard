Usa la skill $sesame-premium-polisher.

Quiero que trabajes sobre este repositorio local `sesame-premium-dashboard` con el objetivo de convertirlo en una versión más premium, moderna, coherente y profesional, sin romper nada y sin subir nada a GitHub.

REGLAS ABSOLUTAS:
- No ejecutes git push.
- No crees PR.
- No publiques releases.
- No leas ni muestres secretos reales.
- No modifiques config.secrets.json si existe.
- No migres el proyecto a React/Vue/Angular/Vite/Next.
- No elimines funcionalidades existentes.
- No hagas una reescritura total.
- Trabaja solo en local.
- Mantén el enfoque vanilla HTML/CSS/JS + Python.

FASE 1 — ANÁLISIS COMPLETO DEL PROYECTO
Analiza todo:
- estructura de carpetas
- documentación
- README
- ARCHITECTURE
- HTML
- CSS
- JavaScript
- Python
- Bash
- configuración de ejemplo
- módulos
- pantallas
- menús
- temas
- datos mostrados
- estados de UI
- flujo de ejecución
- seguridad
- deuda técnica

Crea internamente un mapa del proyecto antes de editar.

FASE 2 — INVESTIGACIÓN ACTUAL
Busca documentación y ejemplos actuales en fuentes fiables sobre:
- Codex AGENTS.md, skills y subagents
- buenas prácticas de agentes de programación
- buenas prácticas para dashboards SaaS premium
- diseño visual moderno para dashboards operativos
- glassmorphism legible y profesional
- bento dashboards
- accesibilidad WCAG
- responsive dashboards
- design tokens con CSS variables
- vanilla JS mantenible
- seguridad de apps locales con tokens
- proxy Python local seguro
- auditoría visual con Playwright o herramientas equivalentes

No copies código externo. Extrae criterios y buenas prácticas.

FASE 3 — SUBAGENTES
Lanza subagentes especializados en paralelo y espera a que terminen todos:

1. Agente de arquitectura:
   Revisa estructura, responsabilidades, separación de código, deuda técnica y riesgos de romper funcionalidad.

2. Agente de UI/UX premium:
   Revisa estilo visual, jerarquía, temas, responsive, menús, tablas, calendario, tarjetas, estados vacíos, modales, loaders y microinteracciones.

3. Agente de seguridad y privacidad:
   Revisa tokens, configs, secretos, localStorage/sessionStorage, proxy local, errores, logs y protección de datos personales.

4. Agente de calidad JS/Python:
   Revisa mantenibilidad, funciones largas, duplicidades, nombres, errores probables, validaciones y compatibilidad.

5. Agente de documentación:
   Revisa README, ARCHITECTURE, ejemplos de config, instalación, troubleshooting y changelog.

6. Agente de validación visual:
   Si hay tooling disponible, intenta generar revisión visual/snapshots locales. Si no, audita estáticamente HTML/CSS/JS.

Consolida los resultados antes de editar.

FASE 4 — PLAN DE MEJORA
Crea una lista priorizada de mejoras con este orden:
1. mejoras seguras de CSS/design system
2. mejoras visuales premium
3. mejoras de estados UI
4. mejoras responsive
5. mejoras de accesibilidad
6. mejoras pequeñas de HTML
7. mejoras pequeñas de JS
8. mejoras de Python/Bash si procede
9. documentación

FASE 5 — IMPLEMENTACIÓN LOCAL
Aplica automáticamente las mejoras principales, sin preguntarme en cada cambio, siempre que cumplan las reglas.

Prioriza un pulido completo:
- design tokens CSS
- coherencia de colores
- contraste
- tipografía
- espaciado
- sombras
- tarjetas
- botones
- inputs
- selectores
- tablas
- badges
- estados hover/focus
- sidebar
- cabecera
- calendario
- módulos
- modo claro/oscuro
- responsive
- estados vacíos
- errores y loaders
- textos visibles
- accesibilidad básica

FASE 6 — VALIDACIÓN
Ejecuta validaciones disponibles:
- `python3 -m py_compile server.py get-token.py` si existen
- `bash -n start.sh` si existe
- `git diff --check`
- revisión de `git status`
- revisión de que no se hayan tocado secretos
- revisión de que no se haya añadido framework pesado

FASE 7 — ENTREGA FINAL
Dame:
- resumen ejecutivo
- archivos modificados
- mejoras aplicadas por categoría
- validaciones ejecutadas
- riesgos pendientes
- cómo probarlo localmente
- qué revisar visualmente antes de publicar
- próximos pasos recomendados

Empieza ahora.
