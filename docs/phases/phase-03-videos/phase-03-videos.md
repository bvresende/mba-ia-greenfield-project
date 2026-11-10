---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-10T20:41:44-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-10T20:44:19-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-10T20:33:18-03:00"
---

# Fase 03 — Upload e Processamento de Vídeos

## Objective

Implementar no backend (`nestjs-project`) o serviço de armazenamento S3/MinIO e fila assíncrona BullMQ/Redis com um video-worker dedicado, permitindo upload multipart direto de vídeos de até 10GB sem consumo de memória no processo da API, geração de slug único de 11 caracteres, extração automática de duração, metadados e thumbnail via FFmpeg/FFprobe, e entrega de mídia via streaming com suporte a Range requests e download com nome original.

---

## Step Implementations

### SI-03.1 — Setup de Infraestrutura (MinIO, Redis, Dockerfile e Configs)

**Description:** Configurar containers MinIO, Redis e video-worker no Docker Compose, instalar FFmpeg/FFprobe no container dev, adicionar dependências BullMQ/ioredis/AWS SDK e definir schemas de configuração com validação Joi.

**Technical actions:**

1. Atualizar `nestjs-project/Dockerfile.dev` adicionando pacotes de sistema `ffmpeg` e `procps` (per `phase-03-videos/TD-05`, `TD-06`).
2. Atualizar `nestjs-project/compose.yaml` adicionando serviços `minio` (portas 9000/9001, volume local), `redis` (porta 6379, volume local) e `video-worker` (build com target dev, comando `npm run start:worker:dev`, dependente de `db`, `minio`, `redis`) (per `phase-03-videos/TD-01`, `TD-04`, `TD-05`).
3. Instalar dependências npm no container: `@nestjs/bullmq@^11.0.4`, `bullmq@^5.69.0`, `ioredis@^5.6.1`, `@aws-sdk/client-s3@^3.758.0`, `@aws-sdk/s3-request-presigner@^3.758.0` (per `phase-03-videos/TD-01`, `TD-04`).
4. Atualizar `src/config/env.validation.ts` com validação Joi para `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET_VIDEOS`, `STORAGE_FORCE_PATH_STYLE` e `VIDEO_MAX_FILE_SIZE_BYTES` (per `phase-03-videos/TD-11`).
5. Criar factories de configuração namespaced `src/config/storage.config.ts`, `src/config/redis.config.ts` e `src/config/video.config.ts` com tipagem forte via `registerAs` (per `phase-01-configuracao-base/TD-03`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `storage.config.ts` | Unit: config factory resolution | `src/config/storage.config.spec.ts` |
| `redis.config.ts` | Unit: config factory resolution | `src/config/redis.config.spec.ts` |
| `video.config.ts` | Unit: config factory resolution | `src/config/video.config.spec.ts` |
| `env.validation.ts` | Integration: Joi schema validation | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose exec nestjs-api which ffmpeg` retorna caminho válido `/usr/bin/ffmpeg`
- `docker compose exec nestjs-api which ffprobe` retorna caminho válido `/usr/bin/ffprobe`
- `docker compose ps` exibe serviços `minio`, `redis` e `video-worker` em status running/healthy
- `env.validation` falha na ausência de variáveis obrigatórias de storage e redis

---

### SI-03.2 — StorageModule (Integração S3/MinIO e Presigning)

**Description:** Criar `StorageModule` e `StorageService` encapsulando operações de bucket, upload multipart e geração de presigned URLs para PUT de partes e GET de streaming/download.

**Technical actions:**

1. Criar `src/storage/storage.service.ts` instanciando `S3Client` com credenciais e endpoints interno/público (per `phase-03-videos/TD-03`, `TD-04`).
2. Implementar métodos multipart: `createMultipartUpload`, `getPresignedPartUrl`, `listParts`, `completeMultipartUpload`, `abortMultipartUpload` (per `phase-03-videos/TD-02`, `TD-04`).
3. Implementar métodos de visualização/download: `getPresignedGetUrl` aceitando opções de `inline` ou `attachment` com filename formatado (per `phase-03-videos/TD-08`).
4. Implementar método utilitário `uploadBuffer` para envio de thumbnails geradas e `ensureBucketExists` para auto-inicialização do bucket (per `phase-03-videos/TD-03`, `TD-04`).
5. Criar `src/storage/storage.module.ts` exportando `StorageService` para injeção em outros módulos.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: multipart lifecycle, presign & upload against real MinIO | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: module compilation | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `createMultipartUpload` cria uploadId no MinIO para bucket configurado
- `getPresignedPartUrl` gera URL assinada válida para método PUT
- `completeMultipartUpload` consolida as partes e torna o objeto acessível
- `getPresignedGetUrl` retorna URL que respeita o cabeçalho `response-content-disposition` configurado

---

### SI-03.3 — Video Entity, Status Lifecycle e Migração TypeORM

**Description:** Criar entidade `Video`, enum `VideoStatus`, relacionamento 1:N com `Channel`, e gerar migração TypeORM com índices adequados.

**Technical actions:**

1. Criar enum `VideoStatus` (`DRAFT`, `PROCESSING`, `READY`, `FAILED`) em `src/videos/enums/video-status.enum.ts` (per `phase-03-videos/TD-09`).
2. Criar entidade `Video` em `src/videos/entities/video.entity.ts` contendo: `id`, `slug`, `title`, `description`, `original_filename`, `file_size_bytes`, `mime_type`, `duration_seconds`, `width`, `height`, `bitrate`, `codec`, `status`, `processing_error`, `storage_key`, `thumbnail_key`, `upload_id`, `channel_id`, timestamps e relação `@ManyToOne(() => Channel)` (per `phase-03-videos/TD-03`, `TD-07`, `TD-09`).
3. Atualizar entidade `Channel` em `src/channels/entities/channel.entity.ts` adicionando relação `@OneToMany(() => Video, (video) => video.channel)` (per `phase-03-videos/TD-03`).
4. Criar migração TypeORM `src/database/migrations/{timestamp}-create-videos.ts` criando enum `video_status_enum`, tabela `videos`, foreign key para `channels`, e índices em `slug` (unique), `channel_id` e `status` (per `phase-03-videos/TD-03`, `TD-07`, `TD-09`).
5. Atualizar migração integration spec garantindo idempotência e execução limpa com TypeORM.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` entity | Integration: constraints, enum defaults, unique slug, cascade foreign key | `src/videos/entities/video.entity.integration-spec.ts` |
| `CreateVideos` migration | Integration: schema migration up/down lifecycle | `src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Migration executa com sucesso gerando a tabela `videos` com foreign key para `channels(id)`
- Inserção de vídeo com mesmo `slug` lança violação de unicidade
- Valor default de `status` ao persistir entidade é `DRAFT`

---

### SI-03.4 — Utilitário de Slug e Resolução de Canal

**Description:** Implementar utilitário de geração de slug único de 11 caracteres base64url-safe e adicionar método `findByUserId` no `ChannelsService` para verificar posse de canal pelo usuário logado.

**Technical actions:**

1. Criar utilitário `src/videos/utils/slug.util.ts` gerando string aleatória de 11 caracteres usando alfabeto `[A-Za-z0-9_-]` com criptografia segura via `crypto.randomBytes` (per `phase-03-videos/TD-07`).
2. Adicionar método `findByUserId(userId: string): Promise<Channel | null>` em `src/channels/channels.service.ts` para mapear usuário autenticado ao canal proprietário (per `phase-03-videos/TD-03`).
3. Exportar `ChannelsModule` para consumo por `VideosModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `slug.util.ts` | Unit: length (11 chars), safe charset regex, entropy uniqueness test | `src/videos/utils/slug.util.spec.ts` |
| `ChannelsService` | Unit: findByUserId resolution logic | `src/channels/channels.service.spec.ts` |
| `ChannelsService` | Integration: DB channel lookup by user id | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- `generateSlug()` produz string de exatamente 11 caracteres correspondendo à regex `^[A-Za-z0-9_-]{11}$`
- 10.000 invocações sucessivas de `generateSlug()` geram 10.000 valores distintos sem colisão
- `channelsService.findByUserId` retorna a entidade do canal pertencente ao usuário ou `null`

---

### SI-03.5 — Endpoint de Pré-cadastro de Vídeo (POST /videos)

**Description:** Implementar endpoint para pré-cadastro de vídeo e inicialização do upload multipart no S3/MinIO, garantindo que o usuário possua canal e gerando registro em status DRAFT.

**Technical actions:**

1. Criar DTO `src/videos/dto/create-video.dto.ts` com validações: `title` (1-100 chars), `description` (opcional, max 5000), `original_filename` (string), `file_size_bytes` (min 1, max 10GB = 10737418240), `mime_type` (video/mp4, video/webm, video/quicktime) (per `phase-03-videos/TD-02`, `TD-09`).
2. Implementar `VideosService.createDraft` que valida existência de canal do usuário, gera slug único (com retry em colisão improvável), inicia multipart upload no S3 (`videos/{videoId}/original.{ext}`), e persiste o vídeo como `DRAFT` com `upload_id` (per `phase-03-videos/TD-02`, `TD-03`, `TD-07`, `TD-09`).
3. Criar `VideosController` com endpoint `POST /videos` protegido por `JwtAuthGuard` (per `phase-03-videos/TD-09`, `TD-12`).
4. Configurar `VideosModule` registrando TypeOrmModule para `Video` e importando `StorageModule` e `ChannelsModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `CreateVideoDto` | Unit: validation constraints | `src/videos/dto/create-video.dto.spec.ts` |
| `VideosService` | Integration: createDraft persistence, storage multipart init and channel verification | `src/videos/videos.service.integration-spec.ts` |
| `VideosModule` | Unit: module compilation | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.2, SI-03.4

**Acceptance criteria:**

- `POST /videos` sem autenticação retorna `401 Unauthorized`
- `POST /videos` de usuário sem canal retorna `403` com `CHANNEL_REQUIRED`
- `POST /videos` com `file_size_bytes > 10737418240` retorna `400` com `FILE_TOO_LARGE`
- `POST /videos` com dados válidos retorna `201` contendo `slug`, `upload_id`, `part_size_bytes` (67108864) e status `DRAFT`

---

### SI-03.6 — Endpoints de Part URLs e Inspeção de Upload

**Description:** Implementar endpoints para geração de URLs pré-assinadas de partes multipart (`POST /videos/:slug/upload/part-urls`) e listagem de partes já enviadas (`GET /videos/:slug/upload/parts`).

**Technical actions:**

1. Criar DTO `src/videos/dto/get-part-urls.dto.ts` validando array `part_numbers` (inteiros entre 1 e 10000, max 100 por requisição) (per `phase-03-videos/TD-02`).
2. Implementar `VideosService.getPartUrls` que localiza vídeo por slug, valida se usuário autenticado é dono do canal, valida se status é `DRAFT`, e solicita ao `StorageService` as presigned PUT URLs para cada `part_number` solicitado (per `phase-03-videos/TD-02`, `TD-04`).
3. Implementar `VideosService.listUploadedParts` que valida posse e status `DRAFT`, chamando `StorageService.listParts` para inspecionar partes já recebidas no MinIO/S3 (per `phase-03-videos/TD-02`).
4. Adicionar rotas `POST /videos/:slug/upload/part-urls` e `GET /videos/:slug/upload/parts` em `VideosController` protegidas por `JwtAuthGuard`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `GetPartUrlsDto` | Unit: validation constraints | `src/videos/dto/get-part-urls.dto.spec.ts` |
| `VideosService` | Integration: part URLs presigning and uploaded parts inspection | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- `POST /videos/:slug/upload/part-urls` por não-proprietário retorna `403` com `VIDEO_ACCESS_DENIED`
- `POST /videos/:slug/upload/part-urls` para vídeo em status não `DRAFT` retorna `409` com `INVALID_VIDEO_STATE`
- `POST /videos/:slug/upload/part-urls` com `part_numbers: [1, 2]` retorna `200` com URLs pré-assinadas contendo parâmetros de assinatura válidos
- `GET /videos/:slug/upload/parts` retorna lista de partes com número e ETag

---

### SI-03.7 — Endpoint de Conclusão de Upload e Enfileiramento

**Description:** Implementar endpoint para concluir o upload multipart no S3, atualizar status do vídeo para `PROCESSING` e despachar job assíncrono para fila BullMQ com jobId determinístico.

**Technical actions:**

1. Criar DTO `src/videos/dto/complete-upload.dto.ts` validando array `parts` contendo objetos `{ part_number: number, etag: string }` ordenados crescentemente (per `phase-03-videos/TD-02`).
2. Configurar fila `video-processing` via `BullModule.registerQueue` no `VideosModule` com opções de retry exponencial e remoção no sucesso (per `phase-03-videos/TD-01`).
3. Implementar `VideosService.completeUpload` que valida posse e status `DRAFT`, invoca `StorageService.completeMultipartUpload`, atualiza o vídeo para status `PROCESSING`, persiste no banco de dados e adiciona job `process-video` na fila BullMQ com `jobId = video.id` (garantindo deduplicação) (per `phase-03-videos/TD-01`, `TD-02`, `TD-09`, `TD-10`).
4. Adicionar rota `POST /videos/:slug/upload/complete` em `VideosController` com `JwtAuthGuard`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `CompleteUploadDto` | Unit: validation constraints | `src/videos/dto/complete-upload.dto.spec.ts` |
| `VideosService` | Integration: complete upload lifecycle, state transition to PROCESSING and BullMQ queue dispatch | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `POST /videos/:slug/upload/complete` com partes faltantes ou ETag inválido retorna `400` com `UPLOAD_INCOMPLETE`
- `POST /videos/:slug/upload/complete` com partes válidas atualiza status para `PROCESSING` e retorna `200`
- Job com nome `process-video` e `jobId = video.id` é enfileirado na fila Redis `video-processing`

---

### SI-03.8 — Serviços de Extração de Metadados e Geração de Thumbnail

**Description:** Implementar serviços isolados que executam nativamente `ffprobe` e `ffmpeg` via child process para extrair metadados técnicos (duração, dimensões, codec, bitrate) e gerar thumbnail em frame representativo do vídeo.

**Technical actions:**

1. Criar `src/videos/services/media-probe.service.ts` executando `ffprobe` com `-v error -show_format -show_streams -print_format json` via `child_process.spawn`, retornando duração em segundos (arredondado para inteiro), largura, altura, codec de vídeo e bitrate (per `phase-03-videos/TD-06`).
2. Criar `src/videos/services/thumbnail.service.ts` executando `ffmpeg` com `-ss {offset} -i {source} -vframes 1 -q:v 2 -f image2 pipe:1` para extrair frame em buffer JPEG em memória sem salvar em disco desnecessariamente (offset calculado para 1s ou 10% da duração) (per `phase-03-videos/TD-06`).
3. Tratar erros de execução, timeout (30s) e código de saída diferente de 0 rejeitando com erro estruturado `MEDIA_PROBE_FAILED` / `THUMBNAIL_EXTRACTION_FAILED`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Integration: execution of real ffprobe binary against fixture media file | `src/videos/services/media-probe.service.integration-spec.ts` |
| `ThumbnailService` | Integration: execution of real ffmpeg extracting JPEG buffer from fixture | `src/videos/services/thumbnail.service.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `MediaProbeService.probe` em fixture de vídeo retorna `duration_seconds > 0`, `width > 0`, `height > 0`, `codec` e `bitrate`
- `ThumbnailService.generateThumbnail` produz buffer JPEG válido iniciando com bytes mágicos `0xFF 0xD8`
- Arquivo corrompido ou inválido rejeita a Promise com erro claro sem travar o processo

---

### SI-03.9 — VideoProcessor e Worker de Processamento em Background

**Description:** Implementar o processador BullMQ (`VideoProcessor`) e o ponto de entrada do worker (`worker.main.ts`) para processamento desacoplado em container independente.

**Technical actions:**

1. Criar `src/videos/processors/video.processor.ts` estendendo `WorkerHost` e anotado com `@Processor('video-processing')` (per `phase-03-videos/TD-01`, `TD-05`).
2. Implementar método `process(job: Job<VideoProcessingJobData>)`: busca vídeo no banco, gera presigned GET URL temporária para leitura do vídeo no MinIO, chama `MediaProbeService.probe`, calcula offset e gera thumbnail com `ThumbnailService`, salva thumbnail no S3 em `videos/{videoId}/thumbnail.jpg`, atualiza `Video` com metadados e status `READY` (per `phase-03-videos/TD-03`, `TD-06`, `TD-09`).
3. Em caso de falha no processamento: capturar erro, salvar mensagem em `video.processing_error`, transicionar status para `FAILED` e relançar exceção para controle de retentativa do BullMQ (per `phase-03-videos/TD-09`).
4. Criar `src/worker.module.ts` e entrypoint standalone `src/worker.main.ts` inicializando contexto NestJS headless (`NestFactory.createApplicationContext`) (per `phase-03-videos/TD-05`).
5. Adicionar script `start:worker:dev` em `package.json` (`nest start --entryFile worker.main --watch`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Integration: full job lifecycle, database update to READY with extracted metadata and thumbnail storage | `src/videos/processors/video.processor.integration-spec.ts` |
| `WorkerModule` | Unit: module compilation | `src/worker.module.spec.ts` |

**Dependencies:** SI-03.7, SI-03.8

**Acceptance criteria:**

- Job processado com sucesso atualiza `Video.status` para `READY`, preenche `duration_seconds`, `width`, `height`, `codec`, `bitrate` e `thumbnail_key`
- Falha na decodificação atualiza `Video.status` para `FAILED` e registra `processing_error` descritivo
- Standalone worker inicia e consome jobs da fila Redis sem inicializar servidor HTTP Express

---

### SI-03.10 — Endpoints de Streaming, Download, Thumbnail e Metadados

**Description:** Implementar endpoints públicos e autenticados para consumo de vídeo: redirecionamento 302 para streaming inline com suporte a Range requests, redirecionamento 302 para download como anexo, redirecionamento 302 para thumbnail, e endpoint de metadados do vídeo.

**Technical actions:**

1. Implementar `VideosService.getStreamUrl` e `GET /videos/:slug/stream`: verifica se vídeo existe; se usuário anônimo ou terceiro, exige status `READY`; se canal dono, permite em status `READY` ou `PROCESSING`; gera presigned GET URL com `inline` disposition e retorna HTTP 302 Found para o cliente (per `phase-03-videos/TD-08`, `TD-09`, `TD-12`).
2. Implementar `VideosService.getDownloadUrl` e `GET /videos/:slug/download`: valida existência e status `READY`, gera presigned GET URL com `attachment; filename="{title}.{ext}"` e retorna HTTP 302 Found (per `phase-03-videos/TD-08`).
3. Implementar `VideosService.getThumbnailUrl` e `GET /videos/:slug/thumbnail`: valida existência de `thumbnail_key` e retorna HTTP 302 Found para a URL da thumbnail no MinIO (per `phase-03-videos/TD-03`, `TD-08`).
4. Implementar `VideosService.getMetadata` e `GET /videos/:slug`: retorna metadados completos do vídeo (restrito ao canal dono autenticado no escopo da Fase 03 conforme decisão técnica) (per `phase-03-videos/TD-09`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (delivery) | Integration: streaming redirect resolution, download disposition and thumbnail retrieval | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.9

**Acceptance criteria:**

- `GET /videos/:slug/stream` para vídeo em status `READY` retorna `302 Found` com header `Location` apontando para o S3/MinIO
- `GET /videos/:slug/stream` para vídeo em status `DRAFT` ou `FAILED` por anônimo retorna `404` com `VIDEO_NOT_FOUND`
- `GET /videos/:slug/download` retorna `302 Found` com header `Location` contendo `response-content-disposition=attachment`
- `GET /videos/:slug/thumbnail` retorna `302 Found` apontando para a imagem gerada
- `GET /videos/:slug` autenticado pelo dono retorna JSON com metadados do vídeo e status atual

---

### SI-03.11 — Teste E2E do Pipeline Completo de Vídeo

**Description:** Criar suite de testes de ponta a ponta exercitando todo o fluxo real integrado com PostgreSQL, MinIO, Redis e FFmpeg: cadastro de usuário/canal -> upload multipart -> worker processing -> streaming -> download.

**Technical actions:**

1. Criar fixture de vídeo de teste válida (`test/fixtures/sample.mp4`) gerada via FFmpeg programático no setup do teste.
2. Criar `test/videos-pipeline.e2e-spec.ts` simulando o fluxo de ponta a ponta via `supertest`:
   - Registro de usuário e canal
   - `POST /videos` criando rascunho
   - `POST /videos/:slug/upload/part-urls` gerando URLs
   - Upload de partes simulando cliente enviando bytes para o MinIO via PUT
   - `POST /videos/:slug/upload/complete` concluindo upload
   - Execução do `VideoProcessor` processando o arquivo
   - Asserção de status `READY` com metadados preenchidos no banco
   - `GET /videos/:slug/stream` validando 302 Found e requisição Range ao destino MinIO retornando 206 Partial Content
   - `GET /videos/:slug/download` validando 302 Found com Content-Disposition attachment

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Full video pipeline | E2E: complete lifecycle from upload init to streaming delivery | `test/videos-pipeline.e2e-spec.ts` |

**Dependencies:** SI-03.10

**Acceptance criteria:**

- Suite E2E passa com sucesso em execução com `--runInBand`
- MinIO responde com HTTP 206 Partial Content quando requisitado com Range header na URL obtida via stream redirect
- Dados técnicos extraídos conferem com a mídia de teste gerada

---

### SI-03.12 — Script de Smoke Test de Upload e Sincronização OpenAPI

**Description:** Criar script versionado de smoke test para validação de upload e sincronizar documentação OpenAPI do projeto.

**Technical actions:**

1. Criar script `scripts/upload-smoke.ts` em TypeScript executável no container via `npx ts-node` que: autentica usuário, cria rascunho de vídeo, fatia um arquivo local em chunks de 5MB, envia partes para MinIO via URLs pré-assinadas, conclui upload, aguarda status READY e testa streaming (per `phase-03-videos/TD-02`, `TD-13`).
2. Adicionar comando `npm run smoke:upload` no `package.json` de `nestjs-project`.
3. Executar exportação da especificação OpenAPI atualizada via `npm run openapi:export`, salvando `openapi.json` na raiz da API.
4. Atualizar `api.http` com os novos endpoints de vídeo para testes interativos no VS Code / Antigravity.

**Tests:** _(empty — Script e docs)_

**Dependencies:** SI-03.11

**Acceptance criteria:**

- `docker compose exec nestjs-api npm run smoke:upload` executa sem erros e confirma status READY
- Arquivo `openapi.json` reflete todas as novas rotas de `/videos`
- `api.http` documenta exemplos de requests para `/videos`

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, default: `uuid_generate_v4()` |
| slug | varchar(11) | unique, not null, index |
| title | varchar(100) | not null |
| description | text | nullable |
| original_filename | varchar(255) | not null |
| file_size_bytes | bigint | not null (up to 10GB = 10737418240) |
| mime_type | varchar(100) | not null |
| duration_seconds | integer | nullable |
| width | integer | nullable |
| height | integer | nullable |
| bitrate | integer | nullable |
| codec | varchar(50) | nullable |
| status | enum (`video_status_enum`) | not null, default: `DRAFT`, index |
| processing_error | text | nullable |
| storage_key | varchar(500) | not null |
| thumbnail_key | varchar(500) | nullable |
| upload_id | varchar(255) | nullable |
| channel_id | uuid | not null, FK -> `channels(id)` ON DELETE CASCADE, index |
| created_at | timestamptz | not null, default: `now()` |
| updated_at | timestamptz | not null, default: `now()` |

**Relations:**
- `Video` belongs to `Channel` (`@ManyToOne(() => Channel, (channel) => channel.videos, { onDelete: 'CASCADE' })`)
- `Channel` has many `Video` (`@OneToMany(() => Video, (video) => video.channel)`)

**Indexes:**
- Unique index on `slug` (`IDX_videos_slug`)
- Index on `channel_id` (`IDX_videos_channel_id`)
- Index on `status` (`IDX_videos_status`)

---

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- title: string, required, min 1, max 100 characters
- description: string, optional, max 5000 characters
- original_filename: string, required
- file_size_bytes: number, required, min 1, max 10737418240 (10GB)
- mime_type: string, required (allowed: `video/mp4`, `video/webm`, `video/quicktime`)

**Response 201:**
- id: string (uuid)
- slug: string (11 chars)
- title: string
- status: "DRAFT"
- upload_id: string
- part_size_bytes: number (67108864)

**Error responses:**
- 401 UNAUTHORIZED: when request is missing valid JWT
- 403 CHANNEL_REQUIRED: when authenticated user does not own a channel
- 400 FILE_TOO_LARGE: when `file_size_bytes` exceeds 10GB
- 400 INVALID_FILE_TYPE: when `mime_type` is not supported
- 400 validation error: when payload fields fail schema validation

---

#### POST /videos/:slug/upload/part-urls (SI-03.6)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- part_numbers: number[], required, array of integers between 1 and 10000 (max 100 per request)

**Response 200:**
- parts: array of objects `{ part_number: number, url: string }`

**Error responses:**
- 401 UNAUTHORIZED: when request is missing valid JWT
- 403 VIDEO_ACCESS_DENIED: when authenticated user does not own the video's channel
- 404 VIDEO_NOT_FOUND: when video with slug does not exist
- 409 INVALID_VIDEO_STATE: when video is not in `DRAFT` status
- 400 validation error: when `part_numbers` is empty or contains invalid numbers

---

#### GET /videos/:slug/upload/parts (SI-03.6)

**Request headers:**
- Authorization: Bearer {token}

**Response 200:**
- upload_id: string
- parts: array of objects `{ part_number: number, etag: string, size_bytes: number }`

**Error responses:**
- 401 UNAUTHORIZED: when request is missing valid JWT
- 403 VIDEO_ACCESS_DENIED: when authenticated user does not own the video's channel
- 404 VIDEO_NOT_FOUND: when video with slug does not exist
- 409 INVALID_VIDEO_STATE: when video is not in `DRAFT` status

---

#### POST /videos/:slug/upload/complete (SI-03.7)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {token}

**Request body:**
- parts: array of objects `{ part_number: number, etag: string }`, required, ordered by `part_number` ascending

**Response 200:**
- slug: string
- status: "PROCESSING"
- message: string

**Error responses:**
- 401 UNAUTHORIZED: when request is missing valid JWT
- 403 VIDEO_ACCESS_DENIED: when authenticated user does not own the video's channel
- 404 VIDEO_NOT_FOUND: when video with slug does not exist
- 409 INVALID_VIDEO_STATE: when video is not in `DRAFT` status
- 400 UPLOAD_INCOMPLETE: when MinIO/S3 reports missing parts or invalid ETags

---

#### GET /videos/:slug/stream (SI-03.10)

**Request headers:**
- Range: optional byte range (e.g. `bytes=0-1048575`)
- Authorization: optional Bearer {token}

**Response 302 Found:**
- Headers: `Location: {presigned_s3_url_with_inline_disposition}`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when video does not exist or status is not `READY` (unless requester is channel owner)

---

#### GET /videos/:slug/download (SI-03.10)

**Request headers:**
- Authorization: optional Bearer {token}

**Response 302 Found:**
- Headers: `Location: {presigned_s3_url_with_attachment_disposition}`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when video does not exist or status is not `READY`

---

#### GET /videos/:slug/thumbnail (SI-03.10)

**Response 302 Found:**
- Headers: `Location: {presigned_or_public_thumbnail_url}`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when video or thumbnail does not exist

---

#### GET /videos/:slug (SI-03.10)

**Request headers:**
- Authorization: Bearer {token}

**Response 200:**
- id: string (uuid)
- slug: string
- title: string
- description: string | null
- original_filename: string
- file_size_bytes: number
- mime_type: string
- duration_seconds: number | null
- width: number | null
- height: number | null
- bitrate: number | null
- codec: string | null
- status: "DRAFT" | "PROCESSING" | "READY" | "FAILED"
- processing_error: string | null
- channel_id: string (uuid)
- created_at: string (iso date)
- updated_at: string (iso date)

**Error responses:**
- 401 UNAUTHORIZED: when request is missing valid JWT
- 403 VIDEO_ACCESS_DENIED: when authenticated user does not own the video's channel
- 404 VIDEO_NOT_FOUND: when video does not exist

---

### Authorization Matrix

| Endpoint | Anonymous | Authenticated (Any User) | Channel Owner |
|----------|-----------|--------------------------|---------------|
| `POST /videos` | ✗ (401) | ✓ (must have channel) | ✓ |
| `POST /videos/:slug/upload/part-urls` | ✗ (401) | ✗ (403) | ✓ (if DRAFT) |
| `GET /videos/:slug/upload/parts` | ✗ (401) | ✗ (403) | ✓ (if DRAFT) |
| `POST /videos/:slug/upload/complete` | ✗ (401) | ✗ (403) | ✓ (if DRAFT) |
| `GET /videos/:slug/stream` | ✓ (if READY) | ✓ (if READY) | ✓ (if READY or PROCESSING) |
| `GET /videos/:slug/download` | ✓ (if READY) | ✓ (if READY) | ✓ (if READY) |
| `GET /videos/:slug/thumbnail` | ✓ (if READY) | ✓ (if READY) | ✓ (if READY) |
| `GET /videos/:slug` | ✗ (401) | ✗ (403) | ✓ |

---

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| `VIDEO_NOT_FOUND` | 404 | Vídeo não encontrado pelo slug informado ou em status não público para anônimo |
| `VIDEO_ACCESS_DENIED` | 403 | Usuário autenticado tentou acessar ou modificar vídeo pertencente a outro canal |
| `CHANNEL_REQUIRED` | 403 | Usuário tentou iniciar upload sem possuir um canal criado |
| `INVALID_VIDEO_STATE` | 409 | Operação incompatível com o status atual do vídeo (ex: gerar URLs de partes em vídeo PROCESSING) |
| `FILE_TOO_LARGE` | 400 | Tamanho informado excede o limite máximo permitido de 10GB (`10737418240` bytes) |
| `INVALID_FILE_TYPE` | 400 | Tipo MIME não suportado para upload de vídeo |
| `UPLOAD_INCOMPLETE` | 400 | Tentativa de conclusão de multipart upload com partes faltantes ou inconsistentes |
| `MEDIA_PROBE_FAILED` | 500 | Falha crítica do worker ao executar FFprobe para extração de metadados |
| `THUMBNAIL_EXTRACTION_FAILED` | 500 | Falha crítica do worker ao extrair frame de thumbnail via FFmpeg |

---

### Events/Messages

#### process-video

**Payload:**

```json
{
  "videoId": "uuid",
  "slug": "string"
}
```

**Producer:** `VideosService.completeUpload` (per `phase-03-videos/TD-01`, `TD-10`)  
**Consumer:** `VideoProcessor.process` no container `video-worker` (per `phase-03-videos/TD-01`, `TD-05`)  
**Trigger:** Emitido imediatamente após o upload multipart ser concluído com sucesso e o status do vídeo ser atualizado para `PROCESSING` no banco de dados.  
**Delivery semantics:** At-least-once com deduplicação nativa via `jobId = video.id`, 3 retentativas automáticas e backoff exponencial (5s).

---

## Dependency Map

```text
SI-03.1 (root: Infra, Compose, Dockerfile, Configs & Packages)
├── SI-03.2 (StorageModule S3/MinIO) — depends on SI-03.1
│   └── SI-03.5 (Video Draft POST /videos) — depends on SI-03.2, SI-03.4
│       └── SI-03.6 (Part URLs & Parts Inspection) — depends on SI-03.5
│           └── SI-03.7 (Complete Upload & Enqueue) — depends on SI-03.6
├── SI-03.3 (Video Entity & Migration) — depends on SI-03.1
│   └── SI-03.4 (Slug Util & Channel Resolution) — depends on SI-03.3
│       └── SI-03.5 (Video Draft POST /videos)
├── SI-03.8 (MediaProbe & Thumbnail Services) — depends on SI-03.1
│   └── SI-03.9 (VideoProcessor & Worker Main) — depends on SI-03.7, SI-03.8
│       └── SI-03.10 (Delivery Endpoints: Stream, Download, Thumb, Metadata) — depends on SI-03.9
│           └── SI-03.11 (Full Pipeline E2E Test) — depends on SI-03.10
│               └── SI-03.12 (Smoke Script & OpenAPI Sync) — depends on SI-03.11
```

---

## Deliverables

- [ ] SI-03.1 — Setup de Infraestrutura (MinIO, Redis, Dockerfile e Configs)
- [ ] SI-03.2 — StorageModule (Integração S3/MinIO e Presigning)
- [ ] SI-03.3 — Video Entity, Status Lifecycle e Migração TypeORM
- [ ] SI-03.4 — Utilitário de Slug e Resolução de Canal
- [ ] SI-03.5 — Endpoint de Pré-cadastro de Vídeo (POST /videos)
- [ ] SI-03.6 — Endpoints de Part URLs e Inspeção de Upload
- [ ] SI-03.7 — Endpoint de Conclusão de Upload e Enfileiramento
- [ ] SI-03.8 — Serviços de Extração de Metadados e Geração de Thumbnail
- [ ] SI-03.9 — VideoProcessor e Worker de Processamento em Background
- [ ] SI-03.10 — Endpoints de Streaming, Download, Thumbnail e Metadados
- [ ] SI-03.11 — Teste E2E do Pipeline Completo de Vídeo
- [ ] SI-03.12 — Script de Smoke Test de Upload e Sincronização OpenAPI

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint checks pass (`docker compose exec nestjs-api npm run lint`)
