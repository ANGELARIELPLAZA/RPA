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
```

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
