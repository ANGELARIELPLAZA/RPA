Proyecto Node.js/Playwright para QTEST.

1. Copia `.env.example` a `.env`
2. Configura `USUARIO` y `PASSWORD`
3. Ejecuta `npm install`
4. Ejecuta `npm start`

Endpoints:

`GET /health`

`POST /cetelem-cotizar-async`

Body:
```json
{
  "cliente": {
    "customerType": "3",
    "genero": "1",
    "customerTitle": "1",
    "customerName": "ANGEL",
    "customerAPaterno": "PLAZA",
    "customerAMaterno": "HERNANDEZ",
    "customerBirthDate": "01/01/1990",
    "customerRfc": "PEHA900101ABC",
    "customerNumUnidades": "2",
    "customerFirstCredit": "1"
  }
}
```

Respuesta: `image/png` con headers `X-Screenshot-Path`, `X-Console-Path` y `X-Elapsed-Seconds`.

`POST /clientes/masivo`

Body:
```json
{
  "concurrency": 2,
  "clientes": [
    {
      "customerType": "3",
      "genero": "1",
      "customerTitle": "1",
      "customerName": "ANGEL",
      "customerAPaterno": "PLAZA",
      "customerAMaterno": "HERNANDEZ",
      "customerBirthDate": "01/01/1990",
      "customerRfc": "PEHA900101ABC",
      "customerNumUnidades": "2",
      "customerFirstCredit": "1"
    },
    {
      "customerType": "3",
      "genero": "2",
      "customerTitle": "2",
      "customerName": "MARIA",
      "customerAPaterno": "LOPEZ",
      "customerAMaterno": "PEREZ",
      "customerBirthDate": "05/08/1992",
      "customerRfc": "LOPM920805ABC",
      "customerNumUnidades": "1",
      "customerFirstCredit": "2"
    }
  ]
}
```

La respuesta es JSON con el resumen de ejecuciones y el detalle por cliente.
