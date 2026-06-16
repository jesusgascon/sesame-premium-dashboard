# Política de Seguridad

## Reportar una vulnerabilidad

**No abras un issue público** para vulnerabilidades de seguridad. En su lugar:

1. Usa el aviso de seguridad privado de GitHub: **Security → Report a vulnerability**
   (https://github.com/jesusgascon/sesame-premium-dashboard/security/advisories/new), o
2. Escribe a **jesusgascon@gmail.com** con el asunto
   `[SECURITY] Sesame Premium Dashboard`.

Incluye una descripción, los pasos para reproducir (sin exponer tokens o credenciales reales),
el impacto estimado y, si la tienes, una propuesta de solución. Se acusará recibo en un plazo
razonable y se comunicará una estimación de corrección.

## Ámbito

Cubierto por esta política:
- Fuga de tokens, contraseñas, cookies, CIF o datos personales en código o logs.
- Bypass de la allowlist de upstreams o del CORS del proxy.
- Acceso a ficheros fuera del alcance previsto del servidor local.
- Telemetría o exfiltración de datos no autorizada.

Fuera de ámbito:
- Vulnerabilidades de la propia API de Sesame HR.
- Ataques que requieran acceso físico al equipo que ejecuta el panel.
- Ingeniería social para obtener credenciales.

## Buenas prácticas para usuarios

1. **Nunca** subas tokens o contraseñas reales al repositorio (`config.secrets.json` está en `.gitignore`).
2. Usa `bash start.sh local` en redes no confiables; el modo LAN solo en redes de confianza.
3. Protege `config.secrets.json` con permisos de fichero adecuados.
4. Renueva tus tokens periódicamente.
