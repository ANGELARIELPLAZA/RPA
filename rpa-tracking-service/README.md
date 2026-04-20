# rpa-tracking-service (MongoDB)

Microservicio independiente para persistencia, auditoría y trazabilidad histórica del RPA.

## Qué guarda

- `executions`: estado actual/final + payloads + result + errores + screenshot_url + metas
- `execution_events`: bitácora de eventos (etapas, errores, screenshots, completado, etc.)

## Endpoints

- `GET /health`
- `POST /executions`
- `PATCH /executions/:task_id`
- `GET /executions/:task_id`
- `GET /executions` (filtros: `status`, `etapa_nombre`, `from`, `to`, `limit`)
- `POST /events`
- `GET /executions/:task_id/events`
- `GET /metrics`

## Docker

Build: `docker build -t rpa-tracking-service .`

Run (requiere Mongo):

`docker run --rm -p 3100:3100 -e MONGO_URI=mongodb://host.docker.internal:27017/rpa_tracking rpa-tracking-service`
