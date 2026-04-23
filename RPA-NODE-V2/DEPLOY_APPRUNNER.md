# Deploy `RPA-NODE-V2` a AWS App Runner (solo este servicio)

Este servicio usa Playwright, así que **lo recomendado** en App Runner es desplegarlo como **imagen de contenedor** (ECR) usando el `Dockerfile` de `RPA-NODE-V2/`.

## 1) Build + push a ECR (desde este repo)

En tu máquina (Windows/macOS/Linux), desde `RPA-NODE-V2/`:

```bash
docker build -t rpa-node-v2 .
```

Luego crea un repo en ECR (una sola vez) y pushea la imagen:

```bash
# Variables
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
ECR_REPO=rpa-node-v2

# Login a ECR
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Crear repo (si no existe)
aws ecr describe-repositories --region $AWS_REGION --repository-names $ECR_REPO \
  || aws ecr create-repository --region $AWS_REGION --repository-name $ECR_REPO

# Tag + push
docker tag rpa-node-v2:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
```

## 2) Crear el servicio en App Runner (desde imagen)

En AWS Console:

1. App Runner → **Create service**
2. Source: **Container registry**
3. Provider: **Amazon ECR**
4. Image: selecciona `$ECR_REPO:latest`
5. Port: `3000` (este servicio escucha `process.env.PORT` y por default `3000`)
6. Health check: HTTP path `/health`

## 3) Variables de entorno (mínimas)

Configura en App Runner (Runtime environment variables) lo que necesites de `RPA-NODE-V2/.env.example`.

Recomendaciones prácticas:

- `CREDENTIALS_BY_AGENCIA` (requerida): JSON con `{ usuario, password }` por agencia.
- Si **no** vas a desplegar `rpa-tracking-service` ahora, pon `TRACKING_ENABLED=false`.
- Para que `screenshot_url` salga con la URL pública real, define `BASE_URL` con el dominio de App Runner (cuando el servicio ya exista).

## Notas importantes (App Runner)

- El filesystem es efímero: `screenshots/` y `logs/` se pueden perder con reinicios/rollouts. Si necesitas persistencia, migra evidencias a S3 (pendiente).
- Si activas `API_KEY`, `/health` queda público pero el resto de endpoints lo requieren (ver `RPA-NODE-V2/.env.example`).

