# AML/FT Panamá

Sistema de Cumplimiento AML/FT - Ley 23 de 2015 de Panamá.

## Requisitos

- Node.js >= 18
- Una API key de Anthropic (variable `ANTHROPIC_API_KEY`)

## Desarrollo local

```bash
npm install
cp .env.example .env   # y completa ANTHROPIC_API_KEY
npm run dev             # o: npm start
```

El servidor arranca en `http://localhost:3000` (o el puerto definido en `PORT`).

## Datos en `datos/`

La carpeta `datos/` no se versiona en git (ver `.gitignore`). Contiene:

- `consultas.db` — base de datos SQLite (historial de consultas), se crea sola.
- `ofac_sdn.xml`, `onu_consolidated.xml`, `eu_sanctions.xml` — cachés de listas de sanciones, se descargan automáticamente desde sus fuentes oficiales la primera vez que se necesitan.
- `clientes/` — expedientes/archivos de clientes subidos, datos sensibles.

En producción (Render) estos archivos se conservan gracias al disco persistente definido en `render.yaml`, montado en esa misma carpeta.

## Despliegue en Render.com

El repo incluye `render.yaml` (Blueprint). Pasos:

1. Sube el repo a GitHub (ver más abajo).
2. En Render: **New > Blueprint**, conecta el repo y selecciona `render.yaml`.
3. En el dashboard del servicio, ve a **Environment** y define `ANTHROPIC_API_KEY` con tu clave real (no se sube a git, queda marcada como `sync: false` en el blueprint).
4. Despliega. El plan `starter` mantiene el servicio activo 24/7 (el plan free de Render duerme tras inactividad) y habilita el disco persistente de 1GB montado en `datos/`.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/aml-panama.git
git push -u origin main
```
