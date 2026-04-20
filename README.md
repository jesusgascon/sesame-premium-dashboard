# 🗓️ Sesame Premium Dashboard

Un dashboard de alta fidelidad, inteligencia operativa y monitorización avanzada para **Sesame HR**. Centraliza la gestión de vacaciones, ausencias, registros de actividad, cumpleaños del equipo y presencia en tiempo real en una interfaz panorámica y profesional.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-JS%20Vanilla-yellow.svg)
![Backend](https://img.shields.io/badge/backend-Python%20Proxy-green.svg)
![Version](https://img.shields.io/badge/version-1.1.0-success.svg)
![Status](https://img.shields.io/badge/status-Stable-success.svg)

---

## 📋 Índice

- [Características Principales](#-características-principales)
- [Capturas de Pantalla](#-capturas-de-pantalla)
- [Instalación Rápida](#-instalación-rápida)
- [Configuración](#-configuración)
- [Arquitectura Técnica](#️-arquitectura-técnica)
- [Módulos del Dashboard](#-módulos-del-dashboard)
- [Changelog](#-changelog)
- [Licencia](#-licencia)

---

## ✨ Características Principales

### 🎂 Panel de Cumpleaños del Equipo *(Nuevo en v1.1.0)*
- **Vista Anual Completa**: Todos los cumpleaños de la empresa agrupados por mes, de Enero a Diciembre.
- **Resaltado del Mes Actual**: El mes en curso aparece destacado para localización inmediata.
- **Detección de Hoy**: Los empleados que cumplen años hoy se marcan con 🎉.
- **Sincronización Inteligente**: Escáner automático en segundo plano que consulta perfiles individuales para obtener las fechas de nacimiento que la API estándar no devuelve en listados.
- **Actualización Progresiva**: La lista se va rellenando en tiempo real conforme el sistema descubre los datos.

### 📡 Radar de Disponibilidad (Live Presence)
- **Monitorización en Tiempo Real**: Visualiza quién está trabajando, en pausa o ausente en este preciso instante.
- **Indicadores Visuales**: Semáforos de estado (Verde/Ámbar/Rojo) integrados en la barra lateral y en el panel de equipo.
- **Resumen Ejecutivo**: Contador rápido de empleados activos vs. pausados.

### 🧠 Operational Insights (Paneles de Control)
- **Detección de Incidencias**: Identificación automática de salidas no registradas, jornadas incompletas o posibles horas extra.
- **Validaciones Sugeridas**: Alertas sobre registros que requieren revisión humana (múltiples tramos, solapamientos).
- **Radar de Anomalías**: KPIs de cumplimiento horario y fragmentación de jornada.
- **Previsión de Ausencias**: Panel dedicado a las próximas vacaciones y permisos de los próximos 14 días.

### 📊 Módulo de Fichajes
- **Análisis Semanal ("Mis Patrones")**: Media de entrada/salida y detección de jornada más productiva.
- **Cruce Inteligente (Smart Match)**: Vincula fichajes reales con ausencias del calendario.
- **Panel de Detalle Expandible**: Vista completa de cada tramo de trabajo con horario, duración y tipo.
- **Rastreo de Origen (Device Tracking)**: Identificación del dispositivo de entrada y salida (Web, App, Tablet) con soporte para transiciones (Origen -> Destino).
- **Timeline de Actividad**: Vista gráfica panorámica con indicadores de Trabajo, Pausas y Ausencias.
- **Exportación Directa**: Reportes en CSV y JSON con filtros aplicados.

### 👤 Fichas de Empleado
- **Perfil Completo**: Email, teléfono, empresa, cargo, foto de perfil.
- **Hitos**: Cumpleaños y aniversario de empresa con indicador visual si es hoy.
- **Acceso Rápido**: Clic en el avatar del empleado desde cualquier módulo.

### 🎨 Experiencia de Usuario Premium
- **Motor de Temas Dual**: Modo Claro y Modo Oscuro con glassmorphism, sombras y microanimaciones.
- **Multi-empresa**: Cambio instantáneo entre empresas con sincronización automática del logo.
- **Reactividad Total**: Filtrado instantáneo por empleado, búsqueda y navegación temporal fluida.
- **Modo Kiosco**: Vista de pantalla completa para pantallas de sala de reuniones o recepción.

---

## 🚀 Instalación Rápida

### Requisitos previos
- Python 3.8 o superior instalado.
- Cuenta activa en Sesame HR con permisos de acceso a la API.

### 1. Clonar el repositorio

```bash
git clone https://github.com/jesusgascon/calendario-vacaciones.git
cd calendario-vacaciones
```

### 2. Configurar credenciales

Copia los archivos de ejemplo y rellena tus datos:

```bash
cp config.example.json config.json
cp config.secrets.example.json config.secrets.json
```

Edita `config.secrets.json` con tus tokens de Sesame HR (ver sección [Configuración](#-configuración)).

### 3. Iniciar

```bash
bash start.sh
```

O manualmente:

```bash
python3 server.py
```

Accede en: **`http://localhost:8765`**

---

## ⚙️ Configuración

El proyecto usa una **estrategia de dos archivos** para separar datos públicos de secretos:

### `config.json` — Datos públicos de la empresa
```json
[
  {
    "name": "Mi Empresa S.L.",
    "companyId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "color": "#5a52e6",
    "logoUrl": "https://..."
  }
]
```

### `config.secrets.json` — Tokens privados *(ignorado por Git)*
```json
[
  {
    "companyId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "usid": "tu-token-de-sesame-hr"
  }
]
```

> **¿Cómo obtengo el USID?**  
> Accede a Sesame HR desde el navegador, abre las DevTools (F12), ve a **Application → Cookies** y copia el valor de la cookie `USID`.

### Variables del entorno del proxy (`server.py`)
El servidor Python actúa como proxy para:
- Gestionar cookies de sesión automáticamente.
- Evitar errores CORS desde el navegador.
- Redirigir peticiones al endpoint `api.sesametime.com`.

---

## 🛠️ Arquitectura Técnica

```
┌─────────────────────────────────────────────────┐
│                  NAVEGADOR                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Calendario│  │ Fichajes │  │  Cumpleaños  │  │
│  │ Vacaciones│  │ + Insights│ │  del Equipo  │  │
│  └─────┬────┘  └─────┬────┘  └──────┬───────┘  │
│        └─────────────┴───────────────┘           │
│                      │ app.js                    │
│              ┌───────▼───────┐                   │
│              │  STATE global  │                   │
│              │ allEmployees  │                   │
│              │ companyId     │                   │
│              └───────┬───────┘                   │
└──────────────────────┼──────────────────────────┘
                       │ HTTP fetch
              ┌────────▼────────┐
              │  server.py      │
              │  Python Proxy   │
              │  :8765          │
              └────────┬────────┘
                       │ HTTPS
              ┌────────▼────────┐
              │ api.sesametime  │
              │     .com        │
              └─────────────────┘
```

### Estrategia de Doble Servidor (Failover)
La aplicación detecta fallos de conectividad o bloqueos de CORS y conmuta automáticamente:
1. **Modo Proxy**: Todas las peticiones pasan por `server.py` → Sesame API.
2. **Modo Directo (fallback)**: Si el proxy falla, intenta acceder directamente (requiere misma sesión de navegador).

### Normalización de Datos
- `upsertEmployee(emp)` — Normalizador central de perfiles. Acepta objetos de cualquier endpoint de Sesame y los convierte al modelo interno estándar, incluyendo extracción de fechas de nacimiento desde campos anidados (`personalData.birthDate`, `birthday`, `dateOfBirth`, etc.).
- `apiFetch(path)` — Wrapper de peticiones con reintentos y manejo de errores 401/403.
- `apiFetchBi(query)` — Wrapper para el motor de analytics de Sesame BI.

Para más detalles, consulta [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 📦 Módulos del Dashboard

### FichajesModule
Controlador principal del módulo de fichajes. Gestiona:
- Carga de datos del BI Engine de Sesame.
- Renderizado de tabla con filas expandibles.
- Filtros por empleado, búsqueda textual y presencia en tiempo real.
- Insights operativos (incidencias, validaciones, anomalías, solicitudes).
- **Panel de Cumpleaños**: Botón 🎂 con escáner serial en segundo plano.

### Calendario de Vacaciones
- Vista mensual/anual de ausencias por tipo (vacaciones, permisos, bajas).
- Soporte multi-empresa.
- Agrupación por tipo de ausencia y empleado.

### Live Presence
- Consulta en tiempo real del estado de presencia.
- Integrado en la tabla de fichajes como columna visual.

---

## 📝 Changelog

### v1.2.1 — 2026-04-20
- 🐛 **fix**: Cálculo del Resumen de Jornada ahora excluye correctamente las pausas. Solo se contabilizan los tramos de tipo "Trabajo" en el total diario.

### v1.2.0 — 2026-04-20
- ✨ **feat**: Seguimiento de Origen de Fichajes (Device Tracking).
  - Nueva columna "ORIGEN" en el detalle expandible de fichajes.
  - Soporte para transiciones de dispositivo (ej. Web -> App Móvil) si el empleado cambia de medio durante el tramo.
  - Iconografía dedicada para Web 🌐, App 📱 y Tablet/Wall 📟.
- 🎨 **style**: Mejoras críticas de legibilidad y contraste.
  - Rediseño del modal de detalles del calendario para **Tema Claro** (fuentes con mayor peso y contraste).
  - Mejora de visibilidad del nombre de empresa en la barra lateral (Modo Oscuro).
  - Selector de empresa rediseñado con iconos y colores de alto contraste para evitar "texto blanco sobre fondo blanco".
- 🛠️ **refactor**: Normalización mejorada de orígenes desde Sesame BI y API v3.

### v1.1.0 — 2026-04-20
- ✨ **feat**: Panel de Cumpleaños del Equipo en módulo Fichajes.
  - Vista anual completa agrupada por mes.
  - Escaneo serial automático de perfiles individuales.
  - Indicador de sincronización progresiva.
- 🎨 **style**: Rediseño panel de detalle de fichajes con glassmorphism.
  - Fondo oscuro coherente con el dashboard.
  - Badges de tipo rediseñados (Trabajo/Pausa/Ausencia).
  - Panel de resumen con tipografía grande y borde accent.
- 🐛 **fix**: Compatibilidad completa del panel de detalle con tema claro.
- 📐 **style**: Padding mejorado en tabla de detalle para mayor legibilidad.

### v1.0.0 — 2026-04-17
- ✨ **feat**: Insights operativos reactivos al empleado seleccionado.
- ✨ **feat**: Exportación CSV y JSON con filtros aplicados.
- 🐛 **fix**: Logo de empresa se actualiza al cambiar de compañía.
- 🛠️ **refactor**: Estrategia de configuración separada (config + secrets).
- 📡 **feat**: Modo Kiosco (pantalla completa).

---

## 📄 Licencia

Este proyecto está bajo la licencia **MIT**. Consulta el archivo `LICENSE` para más detalles.

---

*Desarrollado para optimizar la visibilidad y el control operativo en entornos Sesame HR.*
