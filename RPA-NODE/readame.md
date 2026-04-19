Proyecto Node.js/Playwright.

npm install
npm start

Arquitectura Playwright:

```text
src/
  core/
    browser-manager.js   Browser global singleton
    context-queue.js     Cola con maximo 3 BrowserContext simultaneos
    task-logger.js       Logs por task_id, contexts activos y memoria
  cetelem/
    flow.js              Flujo RPA; crea/cierra solo BrowserContext
    form.js              Llenado y lectura de campos
    fields.js            Definicion de campos
  jobs/
    store.js             Estado en memoria de tasks async
  config.js
  server.js
main.js
```

Variables recomendadas:

```env
HEADLESS=true
PORT=3000
HOST=0.0.0.0
MAX_REINTENTOS=3
MAX_CONTEXTS=3
LOG_LEVEL=info
```

Logs:
- `LOG_LEVEL=info`: estilo compacto, similar a contenedores: `created`, `started`, `exited`.
- `LOG_LEVEL=debug`: incluye pasos internos, URLs, consola del navegador, memoria y reintentos finos.
- `LOG_LEVEL=warn|error|silent`: reduce aun mas la salida.

Salud:
GET /health
GET /healthz

La respuesta de salud incluye `activeContexts`, `queuedTasks` y memoria del proceso.

Artefactos:
- Con 1 context activo se graba video y se toma screenshot.
- Con mas de 1 context activo se desactiva video para los contexts adicionales y solo se toma screenshot/log.

Endpoint:
POST /cotizar-cetelem-async

Devuelve 202 con task_id.

Body esperado:
{
  "cliente": {
    "customerType": "3"
  }
}

El endpoint tambien acepta payload plano en español. Se normaliza antes de crear la task:

```json
{
  "tipo_vehiculo": "N",
  "uso_vehicular": "Personal",
  "marca": "KIA",
  "anio": 2026,
  "modelo": "K3 SEDAN",
  "version": "GT LINE",
  "enganche_porcentaje": 30.0,
  "plan_credito": "2435",
  "plazo_credito": "12",
  "codigo_postal": "96536",
  "contratacion_seguro": "01",
  "tipo_seguro": "01",
  "forma_pago": "02",
  "plazo_remanente": "01",
  "paquete_seguro": "PLUS",
  "nivel_detalle": "seguros"
}
```

`nivel_detalle: "seguros"` se ejecuta como `vehiculo`, `credito` y `seguro`, usando los campos disponibles.

Consultar estado:
GET /status/:task_id

Descargar imagen raw cuando termine:
GET /cotizar-cetelem-async/:task_id/image

Para ejecutar el flujo por CLI:
npm run

Para exponer fuera del VPS:
- el proceso ya escucha en 0.0.0.0
- abre el puerto en firewall/security group
- configura nginx para hacer proxy al puerto de Node
