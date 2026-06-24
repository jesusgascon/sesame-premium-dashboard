# Guía de contribución

Gracias por tu interés en **Sesame Premium Dashboard**. Es un panel **local, ligero y de un solo usuario**
sobre Sesame HR. Toda contribución debe preservar esa filosofía.

## Principios

- **Stack vanilla**: HTML5, CSS3 y JavaScript ES6+ sin frameworks (nada de React/Vue/Angular/Vite).
- **Backend**: proxy local en Python 3 (`server.py`), sin dependencias pesadas injustificadas.
- **Ejecución local** siempre disponible vía `bash start.sh`.
- **Seguridad primero**: cero telemetría, cero tracking, nunca enviar datos reales de empleados a terceros.
- Ver también [`AGENTS.md`](./AGENTS.md) para las reglas detalladas del proyecto.

## Puesta en marcha

```bash
pip install -r requirements.txt
bash start.sh token   # extraer credenciales (genera config.secrets.json)
bash start.sh local   # arrancar solo en este equipo
# Abrir http://localhost:8765
```

## Estilo de código

- **JavaScript**: ES6+, sin transpilación. Funciones pequeñas y nombres descriptivos.
- **CSS**: variables CSS y sistema de diseño glassmorphism existente. Respeta `prefers-reduced-motion`.
- **Python**: PEP 8.
- Comentarios en español (inglés admitido para lógica compleja), coherentes con el código existente.

## Mensajes de commit

Formato: `tipo: descripción` — tipos: `feat`, `fix`, `refactor`, `docs`, `perf`, `security`, `test`.

```
feat: botón flotante "subir arriba" en zonas con scroll
fix: cargar la plantilla por empresa para no mezclar empleados
docs: alinear README y ARCHITECTURE con el estado actual
```

## Antes de abrir un PR

```bash
python3 -m py_compile server.py get-token.py
for f in app.core.js app.boot.js app.vacaciones.js app.misc.js app.fichajes.js; do node --check "$f"; done
# Revisa que el diff no contenga secretos:
git diff | grep -iE "token|password|key" | grep -vE "example|gitignore"
```

- Prueba en `bash start.sh local` y, si aplica, en modo multi-empresa.
- Actualiza `README.md` / `CHANGELOG.md` / docs si cambia el comportamiento.
- Marca el checklist de la plantilla de PR.

## Licencia

Al contribuir, aceptas que tu código se publique bajo la licencia **MIT** (ver [`LICENSE`](./LICENSE)).
