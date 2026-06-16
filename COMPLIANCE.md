# Cumplimiento, Uso Autorizado y Riesgos Legales

Este documento no es asesoramiento legal ni certifica que el uso del proyecto sea conforme a contrato o normativa en todos los escenarios. Su objetivo es dejar por escrito las condiciones prudentes de uso, los límites técnicos conocidos y los puntos que deben validarse con la empresa, Sesame HR y, si procede, asesoría legal.

## 1. Naturaleza de la integración

El proyecto no usa un API token público generado desde el panel oficial de integraciones de Sesame. Según el código actual, la aplicación reutiliza una sesión web autenticada del usuario:

- `Authorization: Bearer ...`
- `csid` de empresa

El token se captura localmente desde una sesión iniciada en `app.sesametime.com` y se guarda en `config.secrets.json`. El frontend llama al proxy local `/sesame-api/*`, y `server.py` reenvía la petición a Sesame inyectando la autorización cuando corresponde.

Implicación: aunque técnicamente funcione con los permisos de la sesión del usuario, puede no coincidir con el mecanismo contractual recomendado por Sesame para integraciones. Si Sesame indica que estos endpoints son privados/no documentados o que su uso no está permitido, debe detenerse el uso de este método y migrarse a la API oficial o a un mecanismo expresamente autorizado.

## 2. API oficial de Sesame

La documentación pública de Sesame describe una API oficial como add-on. Según esa documentación, el token oficial se obtiene y gestiona desde:

`Configuration > Integrations > API`

También indica que la API usa autenticación Bearer y servidores regionales con formato:

`https://api-{region}.sesametime.com`

Si el cliente tiene disponible ese add-on, esa debe ser la vía preferente para integraciones estables, auditables y contractualmente claras.

## 3. Condiciones mínimas de uso

Antes de usar este proyecto con datos reales, deben cumplirse estas condiciones:

1. Autorización expresa de la empresa titular de la cuenta de Sesame.
2. Uso por personal con rol legítimo y permisos suficientes dentro de Sesame.
3. Finalidad empresarial concreta: control horario, planificación, auditoría interna o reporting autorizado.
4. Validación de que el contrato, condiciones de uso o instrucciones de Sesame permiten el método de integración usado.
5. Base jurídica aplicable al tratamiento de datos personales según RGPD u otra normativa local aplicable.
6. Información interna a empleados si la política de privacidad, normativa laboral o acuerdos internos lo requieren.
7. Revisión especial si se visualizan datos como geolocalización, IP, dispositivo, cumpleaños, ausencias médicas o etiquetas que puedan revelar información sensible.

## 4. Principios de protección de datos

El proyecto debe usarse bajo estos principios:

- **Minimización**: consultar y mostrar solo los datos necesarios.
- **Limitación de finalidad**: no reutilizar datos de RRHH para fines distintos a los autorizados.
- **Acceso por necesidad**: usar una cuenta/rol con permisos ajustados, no credenciales personales innecesariamente amplias.
- **Seguridad local**: proteger el equipo, el navegador y la red donde se ejecuta el panel.
- **Confidencialidad**: no compartir capturas, logs o exportaciones con datos reales de empleados.
- **Retención limitada**: no conservar volcados, capturas o ficheros auxiliares más tiempo del necesario.
- **Transparencia**: documentar internamente qué datos se consultan, para qué y quién puede verlos.

## 5. Medidas técnicas existentes

El proyecto ya incorpora varias medidas de reducción de riesgo:

- `config.secrets.json` está separado de `config.json` y contiene tanto los tokens de sesión web/USID como las contraseñas maestras locales (cifrados en reposo). Está en `.gitignore` y no debe subirse a Git.
- `/config` no devuelve tokens ni contraseñas al navegador.
- El proxy local inyecta `Authorization` desde el servidor cuando usa secretos guardados.
- Los tokens y contraseñas maestras se cifran en reposo con Fernet. `cryptography` es una dependencia declarada en `requirements.txt` (`cryptography>=42.0.0`), por lo que el cifrado está disponible en una instalación estándar.
- Las rutas sensibles como `config.secrets.json`, claves TLS y claves locales se bloquean desde `server.py`.
- No se añade telemetría ni se envían datos reales de empleados a servicios externos.
- El acceso LAN debe usarse solo en redes de confianza; `bash start.sh local` limita el panel al equipo actual.

## 6. Riesgos que no puede resolver el código

El código no puede garantizar por sí mismo:

- Que Sesame permita contractualmente el uso de endpoints web/internos.
- Que el rol usado tenga una base jurídica suficiente para todos los datos visibles.
- Que la política de privacidad interna de la empresa cubra todos los usos del dashboard.
- Que las llamadas a endpoints no documentados sigan funcionando o sean aceptadas por Sesame.
- Que la visualización de geolocalización, IP, cumpleaños o ausencias sea proporcionada en todos los casos.

## 7. Criterio operativo recomendado

Si Sesame confirma que no existe API pública activa para el cliente y que no autoriza el uso de sesión web sobre endpoints internos, el proyecto debe considerarse solo una herramienta local de análisis técnico y no debe usarse en producción con datos reales hasta regularizar la integración.

Si Sesame habilita la API oficial, se recomienda migrar gradualmente las llamadas posibles a esa API y mantener este documento actualizado con el nuevo alcance.

## 8. Balance horario y trazabilidad

La sección **Fichajes > Balances** puede mostrar datos especialmente sensibles desde el punto de vista laboral: horas trabajadas, jornada teórica, saldo horario, pausas, ausencias, vacaciones, permisos retribuidos, horarios medios y detalle diario de fichajes.

Para reducir riesgo de interpretación:

- La interfaz indica si el dato procede de `Sesame Statistics` o de `Calculado local`.
- Si el endpoint oficial `GET /schedule/v1/reports/worked-hours` no está disponible para la sesión o no devuelve datos, el resultado local debe entenderse como cálculo técnico de soporte, no como certificación oficial de Sesame.
- Endpoints privados o no disponibles como variantes de `hours-bag-overtime` no se consideran fuente productiva cuando devuelven `403` o `404`.
- El cálculo local documenta sus reglas: permisos retribuidos como ajuste de jornada, vísperas de festivo, vacaciones separadas de ausencias y exclusión de calendarios de empresa del contador personal.
- Cualquier discrepancia relevante entre Sesame y el dashboard debe revisarse contra el portal oficial y, si procede, con RRHH antes de tomar decisiones laborales.

El uso de estos datos debe limitarse a personas autorizadas y a finalidades legítimas de control horario, auditoría interna o reporting autorizado.

## 9. Referencias públicas consultadas

- Sesame HR: documentación pública de la API oficial y gestión de token desde `Configuration > Integrations > API`: https://help.sesamehr.com/en_US/api/what-is-the-sesame-api-and-what-is-it-for
- Sesame HR: documentación de privacidad de datos por roles y accesos: https://help.sesamehr.com/es_ES/roles/gestionar-el-acceso-a-los-datos-de-los-empleados
- Comisión Europea: principios RGPD de licitud, lealtad, transparencia y minimización: https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/overview-principles/what-data-can-we-process-and-under-which-conditions_en
- Comisión Europea: bases jurídicas para el tratamiento de datos personales: https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/legal-grounds-processing-data/grounds-processing/when-can-personal-data-be-processed_en
