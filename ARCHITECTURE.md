# 🏗️ Arquitectura Técnica - Sesame Premium Dashboard

Este documento detalla la ingeniería detrás del dashboard, centrándose en la resiliencia y el procesamiento de datos.

## 1. Estrategia de Conectividad Híbrida (Doble Servidor)

Para garantizar que el dashboard funcione incluso en entornos corporativos restrictivos o ante cambios en la API de Sesame, hemos implementado una **lógica de failover automático**:

- **Capa Primaria (Directa)**: Intenta conectar directamente con `api.sesametime.com` o `back-eu1.sesametime.com` usando cabeceras de navegador.
- **Capa Secundaria (Proxy)**: Si la primaria falla (error 403, CORS o red), la aplicación desvía la petición al servidor local `server.py`.
- **Ventaja**: Máxima velocidad cuando es posible, y fiabilidad total cuando es necesario.

## 2. Motor de Procesamiento de Datos (Normalization Layer)

La API de Sesame devuelve datos en múltiples formatos (REST estándar y BI Engine). El dashboard utiliza una capa de normalización que:
1. **Unifica**: Convierte estructuras anidadas de "Work Entries" en un modelo plano de `Signings`.
2. **Cruce (Smart Match)**: Cruza el calendario de ausencias (módulo `schedule/v1`) con los fichajes (`work-entries/v3`) en tiempo real.
3. **Validación**: Detecta inconsistencias (fichajes en días de vacaciones, falta de marcaje de salida) antes de renderizar la UI.

## 3. Monitorización de Presencia en Vivo (Radar)

El radar de disponibilidad funciona mediante un sondeo optimizado a la ruta `/api/v3/work-entries/presence`:
- **Estado Local**: La aplicación mantiene un mapa de IDs de empleados vinculados a sus fotos y nombres.
- **Difusión**: El estado se propaga a tres puntos de la interfaz simultáneamente: la barra lateral, el resumen de cabecera y el panel de fichajes.

## 4. Seguridad y Persistencia

- **Configuración Segura (Split Strategy)**: Implementamos una arquitectura de dos archivos para proteger los datos:
  - `config.json`: Metadatos públicos de empresas.
  - `config.secrets.json`: Tokens USID y secretos de autenticación (ignorado por Git).
- **Fusión en Memoria**: El servidor Python (`server.py`) fusiona ambos archivos en tiempo de ejecución, proporcionando una vista unificada al frontend sin exponer secretos en el repositorio.

## 5. Visual Stack

- **Motor UI**: Vanilla Javascript (ES6+). Sin frameworks pesados para garantizar una carga instantánea.
- **Diseño**: CSS3 moderno con variables dinámicas, Flexbox y Grid Layout de alta densidad.
- **Componentes**: Arquitectura basada en módulos (`FichajesModule`, `VacacionesModule`) para facilitar la mantenibilidad.

---
*Este proyecto demuestra cómo extender una plataforma SaaS cerrada mediante ingeniería inversa y capas de valor añadido sobre su API.*
