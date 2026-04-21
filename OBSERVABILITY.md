# Observabilidad (Docker) - RPA

## Arquitectura (final)
- Logs: `promtail -> loki -> grafana`
- MÃ©tricas: `node-exporter + cadvisor + blackbox-exporter + rpa-tracking-service(/metrics/prometheus) -> prometheus -> grafana`
- Datos RPA (opcional): `MongoDB (executions / execution_events) -> Grafana MongoDB datasource (Enterprise)`

## Servicios / URLs
- RPA API: `http://localhost:3000`
- Tracking: `http://localhost:3100`
- Tracking metrics (Prometheus): `http://localhost:3100/metrics/prometheus`
- Grafana: `http://localhost:3001` (admin/admin)
- Prometheus: `http://localhost:9090`
- Loki: `http://localhost:3101`
- Blackbox exporter: `http://localhost:9115`
- cAdvisor: `http://localhost:8080`

## Arranque
```bash
docker compose up --build -d
```

MongoDB datasource (Enterprise / con licencia):
```bash
docker compose -f docker-compose.yml -f docker-compose.enterprise.yml up --build -d
```

Opcionales:
```bash
docker compose --profile dev up --build -d
docker compose --profile analysis up --build -d
```

## ValidaciÃ³n rÃ¡pida
1) Prometheus targets: `http://localhost:9090/targets` (UP: loki, promtail, node-exporter, cadvisor, blackbox, rpa-tracking-service).
2) Grafana datasources: `Connections -> Data sources` (Prometheus/Loki; MongoDB solo con Enterprise).
3) Loki recibe logs:
   - Explore -> Loki -> `{service=~"rpa-node-v2|rpa-tracking-service"}`
4) Dashboards provisionados: carpeta **RPA** (RPA Overview, Task Monitor, Logs en tiempo real, Errors Center, Server Monitoring, Docker / Containers Monitoring).

## Notas
- `node-exporter` y `cAdvisor` asumen host Linux (montajes `/proc`, `/sys`, `/var/lib/docker`). En Docker Desktop (Windows/Mac) pueden requerir ajustes.
- Si ves `Enterprise License Error` o `license.jwt not found`, estÃ¡s intentando usar el plugin `grafana-mongodb-datasource` sin licencia. Usa `docker-compose.enterprise.yml` y coloca `./observability/grafana/license.jwt`.
