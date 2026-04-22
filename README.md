# RPA

## Servicios

- `RPA-NODE-V2` (API + robot Playwright): `http://localhost:3000`
- `rpa-tracking-service` (MongoDB tracking): `http://localhost:3100`

## Endpoints (RPA-NODE-V2)

- `POST /cotizar-cetelem-async` → responde `202` con `task_id` y `status_response`
- `GET /status/:task_id` → polling de estado

### Debug de status

Para ver el estado técnico completo de una tarea:

- `GET /status/:task_id?formato=debug`

Opcional: incluir payloads (útil para soporte):

- `GET /status/:task_id?formato=debug&include_payload=true`

#### Screenshot en errores

Cuando la tarea falla, el status incluye:

- `screenshot_url`: URL pública del screenshot (si existe).
- `screenshot.base64`: imagen en base64 (solo en `formato=debug`, si el archivo existe en disco).
