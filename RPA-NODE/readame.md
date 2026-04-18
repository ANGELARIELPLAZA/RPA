Proyecto Node.js/Playwright.

npm install
npm start

Salud:
GET /health
GET /healthz

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
