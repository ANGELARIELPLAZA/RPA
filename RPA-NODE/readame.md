Proyecto Node.js/Playwright.

npm install
npm start

Endpoint:
POST /cotizar-cetelem-async

Devuelve 202 con jobId.

Body esperado:
{
  "cliente": {
    "customerType": "3"
  }
}

Consultar estado:
GET /cotizar-cetelem-async/:jobId

Descargar imagen raw cuando termine:
GET /cotizar-cetelem-async/:jobId/image

Para ejecutar el flujo por CLI:
npm run
