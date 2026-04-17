# 🗓️ Sesame Premium Dashboard

Un dashboard de alta fidelidad, inteligencia operativa y monitorización avanzada para **Sesame HR**. Diseñado para centralizar la gestión de vacaciones, ausencias de calendario y registros de actividad real en una interfaz panorámica y profesional.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-JS%20Vanilla-yellow.svg)
![Backend](https://img.shields.io/badge/backend-Python%20Proxy-green.svg)
![Status](https://img.shields.io/badge/status-Stable-success.svg)

## ✨ Características Principales

### 📡 Radar de Disponibilidad (Live Presence)
- **Monitorización en Tiempo Real**: Visualiza quién está trabajando, quién está en pausa y quién está ausente en este preciso instante.
- **Indicadores Visuales**: Semáforos de estado (Verde/Ámbar/Rojo) integrados en la barra lateral y en el panel de equipo.
- **Resumen Ejecutivo**: Contador rápido de empleados activos vs. pausados para una gestión de carga inmediata.

### 🧠 Operational Insights (Paneles de Control)
- **Detección de Incidencias**: Identificación automática de salidas no registradas, jornadas incompletas o posibles horas extra.
- **Validaciones Sugeridas**: Alertas sobre registros que requieren revisión humana (múltiples tramos, solapamientos).
- **Radar de Anomalías**: Cálculo automático de KPIs de cumplimiento horario y fragmentación de la jornada.
- **Previsión de Ausencias**: Panel dedicado a las próximas vacaciones y permisos de los próximos 14 días.

### 📊 Módulo de Fichajes y "Mis Patrones"
- **Análisis Semanal**: Calcula automáticamente tu media de entrada, salida y detecta tu jornada más productiva (la más larga).
- **Cruce Inteligente (Smart Match)**: Vincula fichajes reales con ausencias del calendario para explicar huecos en la actividad.
- **Timeline de Actividad**: Vista gráfica panorámica con indicadores de Trabajo, Pausas y Ausencias.
- **Exportación Directa**: Generación de reportes CSV para administración.

### 🎨 Experiencia de Usuario Premium
- **Motor de Temas Dual**: Modo Claro y Modo Oscuro con estética de alta gama (glassmorphism y sombras suaves).
- **Estética Empresarial**: Diseño compacto de alta densidad informativa, ideal para pantallas grandes.
- **Reactividad Total**: Filtrado instantáneo por empleado, búsqueda y navegación temporal fluida.

## 🚀 Instalación Rápida

### Requisitos previos
- Python 3.8 o superior instalado.

### Configuración
1. Clona el repositorio.
2. Crea un archivo `config.json` (usa el ejemplo proporcionado en la documentación interna).
3. Asegúrate de tener tu Token de Sesión de Sesame configurado.

### Ejecución
Usa el script de inicio:
```bash
bash start.sh
```
O manualmente:
```bash
python3 server.py
```
Accede en: `http://localhost:8765`

## 🛠️ Arquitectura Técnica Avanzada

El proyecto implementa soluciones de ingeniería para maximizar la fiabilidad:
1. **Estrategia de Doble Servidor (Failover)**: La aplicación detecta fallos de conectividad o bloqueos de CORS y conmuta automáticamente entre la API directa y el **Proxy Local de Python**.
2. **Normalización de Datos BI**: Motor interno para procesar respuestas complejas del motor de BI de Sesame y transformarlas en objetos de negocio simplificados.
3. **Bypass de CORS**: Servidor intermedio en Python que gestiona la persistencia de cookies y cabeceras de seguridad.

Para más detalles técnicos, consulta el archivo [ARCHITECTURE.md](./ARCHITECTURE.md).

## 📄 Licencia
Este proyecto está bajo la licencia MIT.

---
*Desarrollado para optimizar la visibilidad y el control operativo en entornos Sesame HR.*
