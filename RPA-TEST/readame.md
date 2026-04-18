Proyecto Node.js/Playwright para QTEST.

1. Copia `.env.example` a `.env`
2. Configura `USUARIO` y `PASSWORD`
3. Ejecuta `npm install`
4. Ejecuta `npm start`

Simulacion principal:

```bash
npm run simulate:5
```

Ese comando ejecuta 5 clientes al mismo tiempo usando Playwright, sin depender de una llamada HTTP externa. La concurrencia por defecto y el limite maximo son 5:

```env
DEFAULT_BATCH_CONCURRENCY=5
MAX_BATCH_CONCURRENCY=5
```

Endpoints:

`GET /health`

`POST /cetelem-cotizar-async`

Body:
```json
{
  "NIVEL_DETALLE": "CREDITO",
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
  },
  "vehiculo": {
    "vehicleType": "N",
    "insuranceVehicleUse": "1"
  },
  "credito": {
    "creditDepositPercent": "10",
    "creditDepositAmount": "50000",
    "creditDepositPlan": "2504",
    "creditDepositTerm": "48"
  }
}
```

`NIVEL_DETALLE` es opcional y permite ejecutar un solo flujo aunque el JSON incluya mas secciones. Valores soportados: `CLIENTE`, `VEHICULO`, `CREDITO`. `flujos` tambien es opcional; si se manda, tiene prioridad sobre `NIVEL_DETALLE`. Si no se manda ninguno, se ejecutan las secciones presentes en el JSON.

Para ejecutar solo Datos del Credito:

```json
{
  "NIVEL_DETALLE": "CREDITO",
  "credito": {
    "creditDepositPercent": "10",
    "creditDepositAmount": "50000",
    "creditDepositPlan": "2504",
    "creditDepositTerm": "48"
  }
}
```

Las opciones de `creditDepositPlan` pueden variar en el portal; manda el `value` actual de la opcion.
Para enganche, si mandas `creditDepositPercent` y `creditDepositAmount`, se usa `creditDepositPercent`. Si solo mandas uno, se llena el que venga en el payload.

En Datos del Vehiculo, `vehiclePriceTax` no es obligatorio. Si no viene en el payload, el portal lo calcula al seleccionar marca, anio, modelo y version, y la API lo regresa como `vehiclePriceTax`.

Respuesta: JSON con `screenshotRaw`, `screenshotPath`, `consolePath`, `elapsedSeconds`, `executedFlows`, `vehiclePriceTax` y `vehicleTotalAmount`.

`POST /clientes/masivo`

Body minimo:
```json
{
  "concurrency": 5,
  "clientes": [
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
      },
      "vehiculo": {
        "vehicleType": "N",
        "insuranceVehicleUse": "1"
      }
    },
    {
      "cliente": {
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
      },
      "vehiculo": {
        "vehicleType": "N",
        "insuranceVehicleUse": "1"
      }
    },
    {
      "cliente": {
        "customerType": "3",
        "genero": "1",
        "customerTitle": "1",
        "customerName": "CARLOS",
        "customerAPaterno": "RAMIREZ",
        "customerAMaterno": "GARCIA",
        "customerBirthDate": "12/03/1988",
        "customerRfc": "RAGC880312ABC",
        "customerNumUnidades": "1",
        "customerFirstCredit": "1"
      },
      "vehiculo": {
        "vehicleType": "N",
        "insuranceVehicleUse": "1"
      }
    },
    {
      "cliente": {
        "customerType": "3",
        "genero": "2",
        "customerTitle": "2",
        "customerName": "LAURA",
        "customerAPaterno": "MARTINEZ",
        "customerAMaterno": "SOTO",
        "customerBirthDate": "21/11/1995",
        "customerRfc": "MASL951121ABC",
        "customerNumUnidades": "2",
        "customerFirstCredit": "2"
      },
      "vehiculo": {
        "vehicleType": "N",
        "insuranceVehicleUse": "1"
      }
    },
    {
      "cliente": {
        "customerType": "3",
        "genero": "1",
        "customerTitle": "1",
        "customerName": "JORGE",
        "customerAPaterno": "HERNANDEZ",
        "customerAMaterno": "DIAZ",
        "customerBirthDate": "30/06/1985",
        "customerRfc": "HEDJ850630ABC",
        "customerNumUnidades": "3",
        "customerFirstCredit": "1"
      },
      "vehiculo": {
        "vehicleType": "N",
        "insuranceVehicleUse": "1"
      }
    }
  ]
}
```

La respuesta es JSON con el resumen de ejecuciones y el detalle por cliente. Si se manda una concurrencia mayor que `MAX_BATCH_CONCURRENCY`, el servidor la limita al maximo configurado.
