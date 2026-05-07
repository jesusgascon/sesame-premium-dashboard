# 🏗️ Arquitectura Técnica - Sesame Premium Dashboard

Este documento detalla la ingeniería y los patrones de diseño implementados para garantizar la resiliencia y la precisión en la visualización de datos de Sesame HR.

---

## 1. Pipeline de Normalización de Datos

El dashboard enfrenta el reto de consumir APIs de Sesame que devuelven estructuras inconsistentes según el endpoint (REST v1, v3 o BI Engine). Para resolverlo, implementamos un pipeline de tres etapas:

1.  **Ingesta Multi-fuente**: Se lanzan peticiones paralelas (usando `Promise.allSettled`) a:
    *   **BI Engine**: Proporciona el grueso de los datos históricos y auditoría (GPS, IP).
    *   **REST v3 (Checks)**: Backup en caso de fallo del BI.
    *   **REST v3 (Incidences/Requests)**: Identifica acciones pendientes de aprobación que el BI aún no conoce.
2.  **Normalización Universal (`upsertEmployee`)**: Convierte cualquier objeto de empleado (parcial o completo) a un modelo estándar, deduciendo fechas de nacimiento y fotos desde campos anidados.
3.  **Cruce de Datos (Smart Match)**: El motor de `parseRealSignings` proyecta los fichajes sobre el mapa de ausencias, detectando solapamientos y asignando etiquetas de "Vacaciones" o "Permiso" a los tramos de trabajo realizados en esos periodos.

---

## 2. Estrategia de Resiliencia y Redundancia

### Failover de Servidores (Domain Flipping)
La función `apiFetch` implementa una lógica de reintento que, ante un fallo de red o error de servidor (5xx), conmuta automáticamente el subdominio de Sesame entre `back-eu1` y `api-eu1`, garantizando disponibilidad continua.

### BI Discovery & WAF Protection
Debido a que algunas empresas tienen restringido el motor de BI o carecen de ciertos permisos de auditoría, el sistema:
- Realiza una **query de prueba** al iniciar para descubrir qué campos (`latitude`, `ip`, `deviceName`) son accesibles.
- Si el BI devuelve un error 403 persistente, el sistema marca la empresa como "BI Blocked" en `localStorage` y redirige todas las consultas futuras a la API REST v3 de forma transparente.

---

## 3. Gestión de Estado y Persistencia

El dashboard utiliza un modelo de estado centralizado (`STATE`) que se sincroniza con el almacenamiento del navegador:

- **LocalStorage**: Almacena preferencias persistentes como el tema (Dark/Light), el estado de colapso de la sidebar y la configuración de las empresas (tokens, colores, logos).
- **SessionStorage**: Mantiene el estado de la sesión actual, como el "Desbloqueo por CIF", la fecha de navegación y el **módulo activo**, evitando que el usuario pierda su trabajo al refrescar la página.

---

## 4. Deep Birthday Harvest (Motor de Descubrimiento)

Dado que la API de Sesame no suele devolver la fecha de nacimiento en los listados generales, implementamos un motor de dos niveles:
1.  **Nivel BI**: Intenta obtener todas las fechas mediante una query agregada al motor de Analytics.
2.  **Nivel Serial**: Para los empleados que faltan, inicia un escáner en segundo plano que consulta los perfiles individuales de forma secuencial (para evitar bloqueos por Rate Limit) hasta completar el mapa de cumpleaños del equipo.

---

## 5. Visual Stack & Diseño

- **Arquitectura**: Vanilla Javascript (ES6+) organizado en módulos lógicos (`FichajesModule`, `VacacionesModule`).
- **Sistema de Diseño**: Basado en variables CSS dinámicas que permiten el cambio de tema instantáneo y la aplicación de la identidad corporativa de cada empresa (branding dinámico).
- **Componentes**: Uso de *Skeleton Screens* para mejorar la percepción de velocidad durante la carga de datos masivos.

---

## 6. Auditoría y Geolocation

Cada fichaje se enriquece con metadatos de contexto:
- **GPS**: Si las coordenadas están disponibles, se genera un enlace dinámico a Google Maps.
- **Origen**: Identificación visual del canal (Web, App, Tablet).
- **Audit**: Rastro de quién creó o modificó el registro y desde qué dirección IP.

---
*Este proyecto demuestra cómo extender una plataforma SaaS mediante capas de valor añadido, transformando datos crudos en inteligencia operativa.*
