RPA-TEST es solo un harness de pruebas para RPA-NODE.

No levanta otra API ni contiene una version alternativa del robot. Sus comandos llaman por HTTP a RPA-NODE.

Primero levanta RPA-NODE:

```bash
cd ..\RPA-NODE
npm start
```

Despues ejecuta pruebas desde RPA-TEST:

```bash
npm run health
npm run test:cliente
npm run test:vehiculo
npm run test:credito
npm run test:completo
```

Por defecto apunta a:

```env
RPA_NODE_BASE_URL=http://127.0.0.1:3100
```

Puedes cambiarlo en `.env` o como variable de entorno.

Las pruebas disponibles son:

- `cliente`: manda `NIVEL_DETALLE=CLIENTE`.
- `vehiculo`: manda `NIVEL_DETALLE=VEHICULO`.
- `credito`: manda `NIVEL_DETALLE=CREDITO`.
- `completo`: manda `flujos=["cliente","vehiculo","credito"]`.

La respuesta final se obtiene desde `/cotizar-cetelem-async/{task_id}/result` y debe incluir `executedFlows`.
