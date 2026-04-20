# RPA-NODE-V2 (API)

## Endpoints

- `POST /cotizar-cetelem-async` (asíncrono)
- `GET /status/:task_id`
- `GET /health`

## Reglas clave

- Antes de crear `task_id`, el API hace `ping` al portal (`CETELEM_URL`).
- Si el portal responde `502/503` o hay error de red/timeout, responde inmediato `status=fallido` y **no** crea tarea.
- Si el portal está disponible, responde inmediato `status=en progreso` + `task_id` y ejecuta el robot en background (con cola por `MAX_CONTEXTS`).
- En error durante ejecución: toma screenshot y guarda **solo** `screenshot_url` público.

## Ejecutar local (Windows / Linux)

1. Configura variables en `.env` (puedes partir de `.env.example`)
2. Instala deps y arranca:
   - `npm install`
   - `npm start`

## Docker (solo servicio principal)

En `RPA-NODE-V2/`:

- Build: `docker build -t rpa-node-v2 .`
- Run (persistiendo screenshots/logs):
  - `docker run --rm -p 3000:3000 --env-file .env -v ${PWD}/screenshots:/app/screenshots -v ${PWD}/logs:/app/logs rpa-node-v2`

O con compose:

- `docker compose up --build`

## Ejemplos

### Portal fuera de servicio (NO crea task_id)

`POST /cotizar-cetelem-async`:

```json
{
  "status": "fallido",
  "detalle": "portal de cetelem fuera de servicio",
  "fecha_ejecucion": "2026-04-20 11:32:10"
}
```

### Portal disponible (crea task_id)

```json
{
  "task_id": "uuid",
  "status": "en progreso",
  "fecha_ejecucion": "2026-04-20 11:32:10"
}
```

### Consultar status

`GET /status/:task_id`:

```json
{
  "task_id": "uuid",
  "tiempo_transcurrido": "18s",
  "result": null,
  "status": "en progreso",
  "etapa_nombre": "vehiculo",
  "etapa_numero": "2/4"
}
```

### Error con screenshot_url

```json
{
  "task_id": "uuid",
  "tiempo_transcurrido": "41s",
  "result": null,
  "status": "fallido",
  "etapa_nombre": "credito",
  "etapa_numero": "3/4",
  "detalle": "No se pudo llenar vehicleChargeStationAmount",
  "screenshot_url": "http://localhost:3000/screenshots/task_uuid_2026-04-20_11-32-10_credito.png"
}
```
