# 🚀 Sesame Premium Dashboard

**Sesame Premium Dashboard** es una plataforma de análisis y monitorización operativa de alta fidelidad, construida como una capa superior sobre el ecosistema de **Sesame HR**. Diseñado para directores de recursos humanos, managers operativos y administradores de sistemas, este dashboard extrae, cruza y visualiza datos que normalmente están fragmentados o son inaccesibles en la interfaz estándar.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-Vanilla%20JS%20(ES6+)-yellow.svg)
![Backend](https://img.shields.io/badge/backend-Python%20Proxy-green.svg)
![Version](https://img.shields.io/badge/version-1.4.0-success.svg)
![Status](https://img.shields.io/badge/status-Production%20Ready-success.svg)

---

## 📋 Índice

- [Visión del Proyecto](#-visión-del-proyecto)
- [Módulos Principales](#-módulos-principales)
  - [1. Fichajes Avanzados e Insights](#1-fichajes-avanzados-e-insights)
  - [2. Radar de Presencia en Vivo](#2-radar-de-presencia-en-vivo)
  - [3. Deep Birthday Harvest](#3-deep-birthday-harvest)
  - [4. Calendario Híbrido](#4-calendario-híbrido)
- [Inteligencia Analítica y Auditoría](#-inteligencia-analítica-y-auditoría)
- [Stack Tecnológico](#-stack-tecnológico)
- [Guía de Instalación Rápida](#-guía-de-instalación-rápida)
- [Arquitectura Técnica](#️-arquitectura-técnica)
- [Changelog Detallado](#-changelog-detallado)
- [Licencia](#-licencia)

---

## 🎯 Visión del Proyecto

El objetivo de este proyecto es transformar los datos crudos de recursos humanos en **inteligencia operativa accionable**. Mientras que Sesame HR proporciona una excelente base de datos de control horario, este dashboard cruza esas bases de datos en tiempo real (REST API vs BI Analytics Engine) para revelar patrones ocultos, detectar anomalías automáticamente y ofrecer una experiencia de usuario (UX) inmersiva y ultrarrápida.

---

## 🧩 Módulos Principales

### 1. Fichajes Avanzados e Insights
Un panel forense para auditar el control horario de toda la plantilla.
- **Smart Match Geométrico**: Superpone los fichajes reales sobre las ausencias programadas. Si un empleado ficha en un día festivo o de vacaciones, el sistema lo resalta gráficamente.
- **Auditoría de Dispositivos**: Muestra desde qué dispositivo se realizó el fichaje (Web, App iOS/Android, Tablet Kiosko), la dirección IP y el nombre de la red u oficina.
- **Geolocalización Inyectada**: Convierte las coordenadas crudas en enlaces interactivos a Google Maps para verificar fichajes remotos.
- **Patrones de Productividad**: Calcula automáticamente la media semanal de la hora de entrada y salida, e identifica el "Día más productivo" del equipo.

### 2. Radar de Presencia en Vivo
- **Sincronización Total**: Un semáforo de estado (Trabajando, En Pausa, Ausente) que se propaga por toda la interfaz (Barra lateral, cabecera, tabla de empleados).
- **Filtros Smart**: Permite filtrar la tabla de fichajes instantáneamente para ver "Sólo quién está trabajando ahora".
- **Kiosko Mode**: Un modo de pantalla completa a prueba de distracciones, ideal para proyectar en pantallas de oficinas, que oculta menús y maximiza los datos en tiempo real.

### 3. Deep Birthday Harvest
- **Motor de Extracción Dual**: Dado que las APIs públicas de Sesame censuran las fechas de nacimiento, el dashboard inyecta consultas directas al motor de Business Intelligence (BI). Si falla, ejecuta un escáner secundario perfil a perfil.
- **Timeline Anual**: Agrupa los cumpleaños por mes, destacando con insignias pulsantes a los cumpleañeros del día y generando un calendario visual hermoso.

### 4. Calendario Híbrido
- **Visión Panorámica**: Muestra meses completos o semanas, permitiendo cruzar de un vistazo qué equipos están mermados por vacaciones o bajas médicas.
- **Soporte Multi-Festivos**: Soporte para inyección de calendarios laborales locales (ej. festivos de Zaragoza, Madrid, etc.) para cálculo preciso de jornadas teóricas.

---

## 🧠 Inteligencia Analítica y Auditoría

La verdadera magia ocurre en segundo plano (Backend/JS Engine):

- **Incidence Detection Engine (NUEVO)**: Monitoriza las colas de peticiones de RRHH. Si un empleado solicita borrar un fichaje erróneo, pero RRHH aún no lo ha aprobado, el dashboard lo detecta y lo marca como `⏳ PENDIENTE`, excluyéndolo del cómputo total de horas para evitar desviaciones.
- **BI Schema Discovery**: Un algoritmo que escanea la licencia de la empresa en Sesame y autoconfigura el esquema de datos, activando o desactivando llamadas a campos GPS/IP para evitar bloqueos del WAF corporativo.
- **Domain Flipping**: Si la API principal de Sesame cae, el sistema conmuta instantáneamente entre los subdominios `api-` y `back-` para asegurar el 100% de *Uptime*.

---

## 🛠️ Stack Tecnológico

- **Frontend**: `HTML5` semántico, `CSS3` (Vanilla con diseño basado en Glassmorphism, CSS Variables para theming dinámico) y `Javascript ES6+` puro. 0 KB de librerías externas (sin React ni Vue) para máximo rendimiento.
- **Backend / Proxy**: Servidor local escrito en `Python 3` (módulos `http.server`, `urllib`). Maneja la superación de bloqueos CORS, inyección de certificados SSL locales (HTTPS) y cifrado AES de credenciales.
- **Seguridad**: Los tokens de API se guardan cifrados (`Fernet/AES-128-CBC`) en el disco duro.

---

## 🚀 Guía de Instalación Rápida

### Requisitos
- **Python 3.8+** (Para ejecutar el proxy local).
- **Credenciales**: Usuario y contraseña de Sesame HR con permisos de Administrador/Manager.

### Pasos
1. **Clonar**:
   ```bash
   git clone https://github.com/jesusgascon/calendario-vacaciones.git
   cd calendario-vacaciones
   ```
2. **Preparar Configuración**:
   Copia las plantillas y rellena `config.secrets.json` con tus tokens de Sesame.
   ```bash
   cp config.example.json config.json
   cp config.secrets.example.json config.secrets.json
   ```
3. **Lanzar el Servidor**:
   El script generará certificados locales y lanzará el dashboard.
   ```bash
   bash start.sh
   ```
4. **Disfrutar**: El navegador se abrirá automáticamente en `https://localhost:8765`.

---

## 🏗️ Arquitectura Técnica

Para una inmersión profunda en los algoritmos de cruce de datos, heurísticas de red y topología del estado local, dirígete a nuestro documento técnico detallado:
👉 **[Leer ARCHITECTURE.md](./ARCHITECTURE.md)**

---

## 📜 Changelog Detallado

### [v1.4.0] — 2026-05-07 | *The Persistence & Audit Update*
- **Añadido**: Nuevo motor `Incidence Detection Engine`. Detecta en tiempo real solicitudes de borrado o edición pendientes cruzando la REST API con el BI Engine.
- **Añadido**: UX Memory. El sistema guarda en `localStorage` si estabas en Fichajes o Vacaciones; un `F5` ya no interrumpe el flujo.
- **Mejorado**: El espaciado de la barra lateral (Sidebar) se ha recalibrado para mayor respiro visual bajo el logo de la empresa.
- **Corregido**: En el Modo Oscuro, el selector de empleados (`<select>`) presentaba problemas de contraste (texto blanco sobre fondo blanco nativo); arreglado con estilos dedicados.
- **Corregido**: Bug crítico al guardar ediciones en el panel de configuración de empresas (`loadSavedConfig` vs `loadConfig`).
- **Seguridad**: Limpieza profunda del repositorio. Eliminadas todas las carpetas `_scratch` y `scratch` del índice de Git para proteger datos de prueba y privacidad de empleados.

### [v1.3.0] — 2026-05-06 | *The Intelligence Update*
- **Añadido**: **BI Schema Discovery**. Detección automática y *auto-tuning* de campos GPS e IPs disponibles por licencia de empresa.
- **Añadido**: Edición completa de metadatos de empresa (Nombre, Logo, Color corporativo) directamente desde el Dashboard.
- **Mejorado**: Cálculo de horas teóricas cruzando calendarios locales e integrando el *Smart Match* de ausencias.

### [v1.2.0] — 2026-04-20 | *The Forensics & Glass Update*
- **Añadido**: Seguimiento forense del origen de los fichajes (Web/App/Tablet) y Device Tracking.
- **Añadido**: Integración dinámica con **Google Maps** en las coordenadas de check-in/out.
- **Diseño**: Refactorización del panel de detalles hacia una arquitectura "Bento-Box" usando Glassmorphism (efectos translúcidos y blur).

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **MIT**. Eres libre de usarlo, modificarlo y distribuirlo comercialmente.

---
*Diseñado y desarrollado por Jesús Gascón para optimizar la toma de decisiones en entornos operativos de Sesame HR.*
