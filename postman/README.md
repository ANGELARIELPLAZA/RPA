# Postman

Colecciones y environments del repo (centralizados en esta carpeta).

## Archivos

### RPA-NODE-V2

- Colección: `postman/collections/RPA_NODE_V2.postman_collection.json`
- Environment: `postman/environments/RPA_NODE_V2.postman_environment.json` (nombre: `RPA_NODE_V2_local`)

### rpa-tracking-service

- Colección: `postman/collections/rpa-tracking-service.postman_collection.json`
- Environment: `postman/environments/rpa-tracking-service.local.postman_environment.json` (nombre: `rpa-tracking-service (local/docker)`)

## Uso

1. Levanta el stack (desde la raíz del repo): `docker compose up -d --build`
2. En Postman:
   - Importa la colección que necesites (`Import` → `File`).
   - Importa el environment correspondiente.
3. Selecciona el environment en la esquina superior derecha y ejecuta requests.

## Auth (API Keys)

- `RPA-NODE-V2`: setea `api_key` en el environment (`x-api-key`).
- `rpa-tracking-service`: setea `apiKey` en el environment.
  - Si `apiKey` está vacío, la colección no envía `x-api-key` (útil cuando el servicio corre sin API key).

## Notas

- Puertos por defecto (ver `docker-compose.yml`):
  - `RPA-NODE-V2`: `http://localhost:3000`
  - `rpa-tracking-service`: `http://localhost:3100`
