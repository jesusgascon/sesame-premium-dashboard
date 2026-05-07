# 🗓️ Sesame Premium Dashboard

Un dashboard de alta fidelidad, inteligencia operativa y monitorización avanzada para **Sesame HR**. Centraliza la gestión de vacaciones, ausencias, registros de actividad, cumpleaños del equipo y presencia en tiempo real en una interfaz panorámica y profesional.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-JS%20Vanilla-yellow.svg)
![Backend](https://img.shields.io/badge/backend-Python%20Proxy-green.svg)
![Version](https://img.shields.io/badge/version-1.4.0-success.svg)
![Status](https://img.shields.io/badge/status-Stable-success.svg)

---

## 📋 Índice

- [Características Principales](#-características-principales)
- [Inteligencia de Datos](#-inteligencia-de-datos)
- [Capturas de Pantalla](#-capturas-de-pantalla)
- [Instalación Rápida](#-instalación-rápida)
- [Configuración](#-configuración)
- [Arquitectura Técnica](#️-arquitectura-técnica)
- [Seguridad y Privacidad](#-seguridad-y-privacidad)
- [Changelog](#-changelog)
- [Licencia](#-licencia)

---

## ✨ Características Principales

### 🧠 Operational Insights & Auditoría
- **Detección de Incidencias**: Identificación automática de salidas no registradas, jornadas incompletas o posibles horas extra.
- **Validaciones Sugeridas**: Alertas sobre registros que requieren revisión humana (múltiples tramos, solapamientos).
- **Detección de Cambios Pendientes**: Motor de triple cruce que detecta solicitudes de borrado o edición en tiempo real desde la REST API (`check-incidences`, `work-entry-requests`), marcando los registros como `⏳ PENDIENTE`.

### 📊 Módulo de Fichajes (Avanzado)
- **Análisis Semanal ("Mis Patrones")**: Media de entrada/salida y detección de jornada más productiva.
- **Cruce Inteligente (Smart Match)**: Vincula fichajes reales con ausencias del calendario en una línea de tiempo unificada.
- **Rastreo de Origen & Geolocation**: Identificación del dispositivo (Web, App, Tablet), IP de conexión y coordenadas con enlace directo a **Google Maps**.
- **Audit Metadata**: Visualiza quién realizó el fichaje (el empleado o un administrador) y desde qué oficina.

### 🎂 Deep Birthday Harvest
- **Escaneo Dual**: Combina consultas masivas al motor de BI con un escáner serial de perfiles individuales para descubrir fechas de nacimiento ocultas.
- **Vista Anual Completa**: Cumpleaños agrupados por mes con resaltado de eventos actuales y aniversarios de empresa.

### 📡 Radar de Disponibilidad (Live Presence)
- **Monitorización en Tiempo Real**: Visualiza quién está trabajando, en pausa o ausente mediante semáforos de estado sincronizados en todo el dashboard.

---

## 🧠 Inteligencia de Datos

Este dashboard no es solo una interfaz; incluye lógica de procesamiento avanzada:

- **Descubrimiento de Esquema BI**: Proba dinámicamente qué campos de auditoría (GPS, IPs, Dispositivos) tiene habilitados la empresa para evitar errores de consulta y optimizar el rendimiento.
- **Failover Automático**: Si el motor de BI de Sesame está bloqueado por WAF o mantenimiento, el sistema conmuta automáticamente a la API REST v3 para reconstruir la jornada.
- **Normalización Universal**: Capa intermedia que unifica más de 5 formatos distintos de respuesta de Sesame (BI, REST v1, v3, Me, Presence) en un modelo de datos coherente.
- **Persistencia Inteligente**: Recuerda tu tema (Dark/Light), el módulo activo (Vacaciones/Fichajes) y el estado de la barra lateral mediante `localStorage`.

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
```bash
cp config.example.json config.json
cp config.secrets.example.json config.secrets.json
```
Edita `config.secrets.json` con tus tokens de Sesame HR.

### 3. Iniciar
```bash
bash start.sh
```
Accede en: **`http://localhost:8765`**

---

## 🛠️ Arquitectura Técnica

La aplicación utiliza una **Estrategia de Doble Servidor**:
1. **Frontend (Navegador)**: Gestiona la lógica de UI, el estado global (`STATE`) y el filtrado reactivo.
2. **Backend (Python Proxy)**: Actúa como puente para inyectar cabeceras de seguridad, gestionar la autenticación multi-empresa y evitar bloqueos de CORS.

Para detalles profundos sobre el pipeline de datos, consulta [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 📝 Changelog

### v1.4.0 — 2026-05-07
- ✨ **UX**: El sistema ahora recuerda el módulo activo (Fichajes/Vacaciones) tras refrescar.
- ✨ **Audit**: Motor de detección de **Solicitudes de Borrado/Edición** pendientes de aprobación.
- 🎨 **UI**: Rediseño de espaciado en sidebar y fixes de contraste en Tema Oscuro.
- 🐛 **Fix**: Corregido error en edición de perfiles de empresa (`loadSavedConfig`).

### v1.3.0 — 2026-05-06
- ✨ **Data**: Implementación de **BI Schema Discovery**. Detección automática de campos GPS e IPs disponibles.
- ✨ **UI**: Edición completa de metadatos de empresa (Nombre, Logo, Color) desde el Dashboard.

### v1.2.0 — 2026-04-20
- ✨ **feat**: Seguimiento de Origen de Fichajes y Device Tracking (Web/App/Tablet).
- 🎨 **style**: Rediseño del panel de detalle con glassmorphism y temas duales mejorados.

---

## 📄 Licencia
Este proyecto está bajo la licencia **MIT**.

---
*Desarrollado para optimizar la visibilidad y el control operativo en entornos Sesame HR.*
