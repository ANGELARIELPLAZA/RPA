# Observabilidad (recomendación aterrizada)

## Recomendación para este RPA

1) **MongoDB** (vía `rpa-tracking-service`) para trazabilidad histórica por `task_id`, etapas, errores y resultados.

2) **Grafana + Loki + MongoDB** para operación:
- **Grafana**: dashboards operativos (up/down, tareas, fallos, duración, últimas ejecuciones).
- **Loki**: logs del backend y del robot (ideal cuando crezca: filtrado por `task_id`, etapa, errores).
- **MongoDB**: histórico estructurado (executions/events) que no depende de parsing de logs.

3) **Metabase** como complemento para análisis histórico (consultas ad‑hoc sobre ejecuciones y fallos).

4) `mongo-express` solo para desarrollo/debugging (no como dashboard principal).

## Compose de referencia

En la raíz del repo: `docker compose up --build`

- API principal: `http://localhost:3000`
- Tracking: `http://localhost:3100`
- Grafana: `http://localhost:3001` (admin/admin)
- Loki: `http://localhost:3101`

Servicios opcionales:

- `docker compose --profile dev up --build` (incluye `mongo-express`)
- `docker compose --profile analysis up --build` (incluye `metabase`)

## Dashboards sugeridos (Grafana)

- Salud general: API up, portal up, robot libre/ocupado, activeContexts/queuedTasks
- Tareas por status: en progreso / completadas / fallidas
- Duración: promedio y p95 por día
- Fallas por etapa (top)
- Últimas ejecuciones (tabla)
- Errores recientes (tabla + link a `screenshot_url`)

