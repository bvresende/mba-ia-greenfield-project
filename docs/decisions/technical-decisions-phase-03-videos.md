---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-04-08
scope_description: "Backend video upload, processing, storage, streaming, and worker infrastructure: S3 presigned multipart upload for up to 10GB, MinIO object storage, BullMQ + Redis background processing, FFmpeg/FFprobe metadata and thumbnail extraction, unique short URL generation, and presigned 302 streaming/download."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend delivering video draft pre-registration, presigned multipart upload management, upload completion, BullMQ background job processing, FFmpeg/FFprobe metadata extraction and thumbnail generation, unique slug generation, streaming and download endpoints, plus Docker Compose infrastructure (MinIO, Redis, video-worker).
- `next-frontend/` — Frontend video playback and upload UI deferred to subsequent phases (Fase 04/05) as planned. No open decision in this document.

---

## TD-01: Background Queue and Job Processing Engine

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Video processing (duration probe, metadata extraction, thumbnail extraction) is CPU- and I/O-intensive. Processing must run asynchronously off the HTTP request/response cycle, guaranteeing job retries, progress visibility, and concurrency limits without blocking the API server.

**Options:**

### Option A: BullMQ with Redis
- Modern Redis-backed queue system for NodeJS built on Redis streams and Lua scripts. Native NestJS integration via `@nestjs/bullmq` and `bullmq`.
- **Pros:** Robust job lifecycle (active, completed, failed, delayed), native concurrency controls, backoff retries, dead-letter support, fast in-memory Redis backend, clean NestJS decorators (`@Processor`, `@Process`).
- **Cons:** Requires a Redis service instance in Docker Compose and production infra.

### Option B: PostgreSQL-based queue (pg-boss or transactional outbox)
- Uses PostgreSQL table locking (`SKIP LOCKED`) to poll and claim jobs without introducing an additional Redis service.
- **Pros:** Reuses existing PostgreSQL database; transactional enqueueing with domain entities.
- **Cons:** Adds polling load to relational DB; less efficient for high-throughput job events; lacks rich job lifecycle monitoring tools out-of-the-box compared to BullMQ.

### Option C: In-memory EventEmitter / NestJS microservices
- Internal event bus using Node.js event emitters or memory queues.
- **Pros:** Zero infrastructure footprint.
- **Cons:** Jobs lost on container restart; no persistence; cannot distribute work across multiple worker containers.

**Recommendation:** **BullMQ with Redis (Option A)** — BullMQ is the de facto standard in NestJS for robust asynchronous background jobs. It provides battle-tested retries, isolation from the API web process, and clean Docker service decoupling.

**Decision:** A (BullMQ with Redis)

**Libraries:**
- `@nestjs/bullmq@^11.0.4`
- `bullmq@^5.69.0`
- `ioredis@^5.6.1`

---

## TD-02: 10GB Large File Upload Strategy

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The platform requires supporting video uploads up to 10GB (10 GiB = 10,737,418,240 bytes) without degrading API server performance, consuming API memory buffers, or blocking HTTP worker threads.

**Options:**

### Option A: Direct-to-Storage Presigned S3 Multipart Upload
- Client requests upload initialization from NestJS API; API generates a draft video record and S3 multipart upload ID. Client requests presigned URLs for each part (e.g. 64 MiB parts), uploads chunks directly to Object Storage (MinIO/S3), and notifies API upon completion.
- **Pros:** Zero upload bandwidth or memory pressure on the NestJS API server; supports files up to 5TB; robust chunk resume and retry; native S3 standard; scales seamlessly.
- **Cons:** Requires client orchestration of multipart chunks and completion handshake.

### Option B: S3 Presigned Single-PUT Upload
- API generates a single presigned PUT URL for the entire file.
- **Pros:** Simpler client implementation (single HTTP PUT).
- **Cons:** Hard 5GB maximum file size limit in AWS S3 and MinIO single PUT; no chunk resumption on network interruptions for multi-gigabyte uploads.

### Option C: Streaming upload through NestJS API to S3 (Busboy/Multer)
- Browser streams bytes directly to NestJS API, which pipes the stream into S3.
- **Pros:** Simpler client API interface (regular multipart form-data).
- **Cons:** Binds API network bandwidth and Node.js process resources for gigabyte transfers; fails the requirement of "uploading up to 10GB without impact on system performance".

**Recommendation:** **Direct-to-Storage Presigned S3 Multipart Upload (Option A)** — Essential for files up to 10GB, eliminating API memory and bandwidth bottlenecks while allowing resilient chunk-level retries.

**Decision:** A (Direct-to-Storage Presigned S3 Multipart Upload)

---

## TD-03: Object Storage Organization and Key Hierarchy

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The system stores raw original video files, generated thumbnails, and potential future transcoded variants. A consistent, secure bucket and key naming convention is needed to avoid collisions and facilitate lifecycle rules.

**Options:**

### Option A: Dedicated Bucket with Video ID Namespaces
- Single bucket (`streamtube-videos` or configurable via `STORAGE_BUCKET_VIDEOS`) containing structured object keys:
  - Original video: `videos/{videoId}/original.{ext}`
  - Thumbnail: `videos/{videoId}/thumbnail.jpg`
- **Pros:** Clean per-video folder isolation; predictable paths; allows bucket-level IAM policies and straightforward deletion of all video assets upon video removal.
- **Cons:** Single bucket namespace requires appropriate prefixing.

### Option B: Separate Buckets for Videos and Thumbnails
- Two separate buckets: `streamtube-raw-videos` and `streamtube-thumbnails`.
- **Pros:** Granular bucket policies (e.g., public read on thumbnails bucket, private on videos bucket).
- **Cons:** Extra infrastructure management; increased configuration complexity; thumbnails in StreamTube are served via presigned URLs or application redirects with authorization.

**Recommendation:** **Dedicated Bucket with Video ID Namespaces (Option A)** — Collocating all artifacts of a video under `videos/{videoId}/` enables clean lifecycle management and uniform access control.

**Decision:** A (Dedicated Bucket with Video ID Namespaces)

---

## TD-04: S3 Object Storage Client SDK

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The backend needs to communicate with S3-compatible storage (MinIO locally and AWS S3 in production) to initiate multipart uploads, generate presigned URLs for upload parts and downloads, and manage object metadata.

**Options:**

### Option A: AWS SDK v3 Modular Packages (@aws-sdk/client-s3 and @aws-sdk/s3-request-presigner)
- Official, modern modular AWS SDK for JavaScript/TypeScript.
- **Pros:** Modular tree-shaking; officially maintained; comprehensive TypeScript definitions; supports modern S3 features, custom endpoints (for MinIO), and path-style addressing.
- **Cons:** AWS SDK v3 has modular package imports rather than a single monolithic client.

### Option B: MinIO JavaScript SDK (minio)
- Specialized client library maintained by MinIO.
- **Pros:** Designed specifically for MinIO API idioms.
- **Cons:** Extra third-party dependency with less widespread enterprise adoption than the standard AWS SDK; AWS SDK already works flawlessly with MinIO via S3 compatibility.

**Recommendation:** **AWS SDK v3 Modular Packages (Option A)** — Industry standard, high performance, fully compatible with both MinIO and production AWS S3.

**Decision:** A (AWS SDK v3 Modular Packages)

**Libraries:**
- `@aws-sdk/client-s3@^3.758.0`
- `@aws-sdk/s3-request-presigner@^3.758.0`

---

## TD-05: Video Worker Runtime and Service Architecture

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Video processing jobs require dedicated CPU resources and native FFmpeg/FFprobe binaries. We must define whether the worker runs inside the main NestJS API container or as a dedicated standalone worker service.

**Options:**

### Option A: Dedicated Standalone Worker Service in Docker Compose
- `video-worker` service running in its own container, booting a NestJS standalone application context (`src/worker.main.ts` or compiled `dist/worker.main.js`) sharing domain entities and configuration.
- **Pros:** Prevents heavy FFmpeg CPU usage from degrading HTTP API responsiveness; independent scaling; isolated container resource limits; crashes during media encoding do not take down the web server.
- **Cons:** Adds one container service definition in `compose.yaml`.

### Option B: Embedded Worker within the NestJS API Process
- Worker runs inside the same process as the HTTP API using `@Processor()` in AppModule.
- **Pros:** Single container for dev.
- **Cons:** FFmpeg transcoding/probing steals CPU threads from HTTP request handling; violation of container process separation.

**Recommendation:** **Dedicated Standalone Worker Service (Option A)** — Follows 12-factor application design, isolates media processing load from HTTP traffic, and enables independent CPU resource allocation.

**Decision:** A (Dedicated Standalone Worker Service)

---

## TD-06: Video Duration, Metadata, and Thumbnail Extraction Engine

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The system must inspect uploaded videos to extract duration (seconds), width, height, codec, and bitrate, and extract a representative thumbnail image frame at a predictable offset (e.g., at 1 second or 10% of duration).

**Options:**

### Option A: Native FFmpeg and FFprobe CLI via child_process.spawn
- Install `ffmpeg` package in the Docker image; spawn `ffprobe` (with `-print_format json -show_format -show_streams`) and `ffmpeg` (with `-ss 00:00:01 -vframes 1`) directly using Node.js `child_process.spawn` or `execFile`.
- **Pros:** Zero unmaintained npm wrappers; native performance; modern security with argument arrays (no shell injection); full control over streaming arguments and timeouts.
- **Cons:** Requires handling process exit codes, stdout/stderr streams, and timeout abort controllers manually.

### Option B: fluent-ffmpeg npm package
- Popular Node.js wrapper around FFmpeg CLI.
- **Pros:** Fluent chainable API.
- **Cons:** Library is deprecated and largely unmaintained; adds obsolete wrapper code with callback-heavy APIs around simple CLI commands.

**Recommendation:** **Native FFmpeg and FFprobe CLI via child_process.spawn (Option A)** — Direct process execution without deprecated wrappers provides optimal reliability, predictable security, and clean async/await Promise wrapping.

**Decision:** A (Native FFmpeg and FFprobe CLI via child_process.spawn)

---

## TD-07: Unique Video URL and Public Slug Generation

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Videos must be uniquely addressable via short, clean, URL-safe identifiers (e.g. YouTube-style `dQw4w9WgXcQ`), distinct from internal UUID primary keys.

**Options:**

### Option A: 11-character URL-safe random string (Base64URL / Nanoid alphabet)
- Generate an 11-character random string from `[A-Za-z0-9_-]` alphabet (66 bits of entropy, ~7.37 x 10^19 combinations). Enforce unique constraint at the database schema level (`videos.slug UNIQUE`) and implement retry on collision in application logic.
- **Pros:** Familiar short video URL format (like YouTube); URL-safe without encoding; collisions astronomically rare; unique index prevents data corruption.
- **Cons:** Requires indexed column and collision retry logic.

### Option B: Standard UUID v4 as slug
- Use standard 36-character hyphenated UUID string.
- **Pros:** Zero collision risk; already supported by PostgreSQL uuid type.
- **Cons:** Long, cumbersome URLs (`/videos/123e4567-e89b-12d3-a456-426614174000`) that do not match the expected YouTube-like user experience.

### Option C: Auto-incrementing numeric ID with base62 encoding
- Sequential integer encoded into base62.
- **Pros:** Shortest possible length for early videos.
- **Cons:** Easily guessable/crawlable; leaks platform volume metrics.

**Recommendation:** **11-character URL-safe random string (Option A)** — Combines YouTube-standard URL ergonomics, high entropy, URL safety, and robust DB uniqueness enforcement.

**Decision:** A (11-character URL-safe random string)

---

## TD-08: Streaming and Download Delivery Architecture

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** Video playback requires Range requests (HTTP 206 Partial Content) for seeking and streaming. Video downloads require triggering browser file downloads with appropriate `Content-Disposition`. The C4 architecture specifies direct streaming from Object Storage rather than streaming through API Node buffers.

**Options:**

### Option A: HTTP 302 Found Redirect to Presigned Object Storage URL
- API verifies permissions and video readiness, then responds with `302 Found` (or `307 Temporary Redirect`) to a short-lived presigned MinIO/S3 GET URL.
  - Streaming: presigned URL with `response-content-disposition=inline`, MinIO natively handles `Range` headers and `206 Partial Content`.
  - Download: presigned URL with `response-content-disposition=attachment; filename="{video-title}.{ext}"`.
- **Pros:** Offloads 100% of video delivery bandwidth from API server; native HTTP range/streaming support by Object Storage; enforces authorization at redirect time.
- **Cons:** Client must follow redirects (standard in HTML5 video players and browsers).

### Option B: Reverse Proxy Streaming through NestJS API
- NestJS API receives range header, requests byte range from S3, and pipes chunks back to client.
- **Pros:** Client only ever sees the API domain.
- **Cons:** Heavy network and CPU load on API server; violates C4 container design; bottleneck for 10GB video playback.

**Recommendation:** **HTTP 302 Found Redirect to Presigned Object Storage URL (Option A)** — Conforms to C4 architecture, maximizes delivery performance, natively supports video player seeking via MinIO/S3 Range headers, and protects files with short-lived presigned signatures.

**Decision:** A (HTTP 302 Found Redirect to Presigned Object Storage URL)

---

## TD-09: Video Status Lifecycle and Error Handling

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** Videos transition across multiple stages: draft pre-registration, upload in progress, upload completed, background processing, and ready for streaming (or failed). A clear state machine is required to prevent invalid operations.

**Options:**

### Option A: Explicit Enum State Machine (DRAFT -> PROCESSING -> READY | FAILED)
- `VideoStatus` enum:
  - `DRAFT`: Pre-registered upon initiating multipart upload. Not playable or streamable.
  - `PROCESSING`: Multipart completed, BullMQ job queued or currently executing.
  - `READY`: Metadata extracted, thumbnail generated, video ready for public/channel streaming.
  - `FAILED`: Processing failed (corrupt file, ffprobe timeout, unreadable codec). Error message stored in `processing_error`.
- **Pros:** Clear semantics; prevents streaming unfinished or corrupt videos; allows channel owner to inspect failure reasons; idempotent retry support.
- **Cons:** Requires status checks in streaming/download endpoints.

### Option B: Boolean Flags (is_published, is_processed)
- Multiple boolean columns.
- **Pros:** Loose coupling.
- **Cons:** High risk of invalid state combinations (e.g. `is_published=true` while `is_processed=false`); lacks clarity for processing errors.

**Recommendation:** **Explicit Enum State Machine (Option A)** — Provides strict state transitions, guarantees only `READY` videos are streamable, and stores processing errors for diagnosability.

**Decision:** A (Explicit Enum State Machine)

---

## TD-10: Database and Queue Consistency for Job Enqueueing

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** When the client completes an upload, the video status must change to `PROCESSING` and a job must be dispatched to BullMQ. We must ensure consistency so no completed video is left unqueued.

**Options:**

### Option A: Commit Status Update Before BullMQ Enqueue with Deterministic Job ID
- Transition video to `PROCESSING` within a DB transaction. Once committed, enqueue job in BullMQ with `jobId = video.id` (deterministic job deduplication). If enqueue fails, return 500 so client or retry worker can reconcile.
- **Pros:** Simple, robust; prevents duplicate processing jobs; ensures database record is persisted before worker attempts to read it.
- **Cons:** Small theoretical window if Redis is down right after DB commit (mitigated by retry).

### Option B: Two-phase commit / Distributed transaction
- Distributed consensus across PostgreSQL and Redis.
- **Pros:** Atomic across disparate datastores.
- **Cons:** High complexity and overhead; unnecessary for idempotent video processing.

**Recommendation:** **Commit Status Update Before BullMQ Enqueue with Deterministic Job ID (Option A)** — Clean, deterministic, and leverages BullMQ's native job ID deduplication.

**Decision:** A (Commit Status Update Before BullMQ Enqueue with Deterministic Job ID)

---

## TD-11: Canonical Set of Environment Variable Keys

**Scope:** Repo-wide

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails), Serviço de processamento em segundo plano (filas), Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The new storage, queue, and worker services require consistent environment variable names across `.env`, `compose.yaml`, Joi validation schema, and NestJS ConfigModule.

**Options:**

### Option A: Centralized Namespaced Keys with Strict Joi Validation
- Keys defined:
  - Storage: `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET_VIDEOS`, `STORAGE_FORCE_PATH_STYLE`
  - Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
  - Limits: `VIDEO_MAX_FILE_SIZE_BYTES=10737418240`, `VIDEO_PART_SIZE_BYTES=67108864`
- **Pros:** Consistent naming; validates all required infrastructure variables on startup; supports separate internal (container-to-container) and public presigned endpoints.
- **Cons:** Must be maintained in both Docker Compose and NestJS configuration schemas.

### Option B: Hardcoded Defaults with Minimal Env Overrides
- Default directly to localhost or container names without validation schemas.
- **Pros:** Fewer env lines.
- **Cons:** Prone to silent runtime failures and production deployment mismatches.

**Recommendation:** **Centralized Namespaced Keys with Strict Joi Validation (Option A)** — Follows the project's established pattern in `config.schema.ts` and `compose.yaml`.

**Decision:** A (Centralized Namespaced Keys with Strict Joi Validation)

---

## TD-12: Rate Limiting and Throttling Policy for Video Endpoints

**Scope:** Backend

**Capability:** Transversal — covers: Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance, Reprodução via streaming (sem necessidade de download completo)

**Context:** Video upload initialization and part URL generation require distinct throttling rules compared to general authentication endpoints to allow multi-part uploads without hitting artificial 429 errors.

**Options:**

### Option A: Specific @Throttle Decorators on High-Frequency Video Endpoints
- Retain global ThrottlerGuard, but apply tailored `@Throttle` limits on `/videos/:slug/upload/part-urls` and `/videos/:slug/stream` (e.g. 100 requests per minute) while keeping `/videos` draft creation protected (e.g. 10 per minute per channel).
- **Pros:** Protects against abuse while preventing multi-part chunk uploads from failing with 429 Too Many Requests.
- **Cons:** Requires decorator configuration on controller methods.

### Option B: Exclude Video Module Entirely from Throttler
- Completely disable rate limiting for all video routes.
- **Pros:** Zero risk of 429 during upload.
- **Cons:** Exposes draft creation and upload endpoints to denial-of-service spam.

**Recommendation:** **Specific @Throttle Decorators on High-Frequency Video Endpoints (Option A)** — Balances robust DoS protection with seamless multipart upload and streaming performance.

**Decision:** A (Specific @Throttle Decorators on High-Frequency Video Endpoints)

---

## TD-13: Testing Strategy with Real Infrastructure in Docker

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails), Serviço de processamento em segundo plano (filas), Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Testing video multipart upload, S3 presigned URLs, BullMQ queues, and FFmpeg metadata extraction requires a reliable test harness consistent with the project's testing principles (real services in integration/e2e, mocked only in unit tests).

**Options:**

### Option A: Real MinIO, Redis, and FFmpeg in Integration/E2E Test Suites
- Test suites run inside `nestjs-api` container connected to real `minio` and `redis` containers in Docker Compose, with native `ffmpeg` installed in the image. Integration tests verify real S3 multipart lifecycles and real video probing on sample video fixtures. Unit tests mock external SDKs and child process calls.
- **Pros:** 100% fidelity; catches real S3 protocol, Redis stream, and FFmpeg CLI errors; eliminates divergence between test mocks and production behavior.
- **Cons:** Requires `minio`, `redis`, and sample video test fixtures in the repository.

### Option B: In-Memory Mocks for All S3, Redis, and FFmpeg Calls
- Mock all S3 commands, BullMQ queues, and child processes in all tests.
- **Pros:** Fast test execution without external services.
- **Cons:** Cannot catch real multipart XML/S3 API incompatibilities, Redis command failures, or FFprobe JSON parsing quirks.

**Recommendation:** **Real MinIO, Redis, and FFmpeg in Integration/E2E Test Suites (Option A)** — Fully adheres to the project's testing policy ("Integration exercises real DB, real repositories, real modules; Unit pure logic").

**Decision:** A (Real MinIO, Redis, and FFmpeg in Integration/E2E Test Suites)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Background Queue and Job Processing Engine | BullMQ with Redis | A (BullMQ with Redis) |
| TD-02 | Backend | 10GB Large File Upload Strategy | Direct-to-Storage Presigned S3 Multipart Upload | A (Direct-to-Storage Presigned S3 Multipart Upload) |
| TD-03 | Backend | Object Storage Organization and Key Hierarchy | Dedicated Bucket with Video ID Namespaces | A (Dedicated Bucket with Video ID Namespaces) |
| TD-04 | Backend | S3 Object Storage Client SDK | AWS SDK v3 Modular Packages | A (AWS SDK v3 Modular Packages) |
| TD-05 | Backend | Video Worker Runtime and Service Architecture | Dedicated Standalone Worker Service in Docker Compose | A (Dedicated Standalone Worker Service in Docker Compose) |
| TD-06 | Backend | Video Duration, Metadata, and Thumbnail Extraction Engine | Native FFmpeg and FFprobe CLI via child_process.spawn | A (Native FFmpeg and FFprobe CLI via child_process.spawn) |
| TD-07 | Backend | Unique Video URL and Public Slug Generation | 11-character URL-safe random string | A (11-character URL-safe random string) |
| TD-08 | Backend | Streaming and Download Delivery Architecture | HTTP 302 Found Redirect to Presigned Object Storage URL | A (HTTP 302 Found Redirect to Presigned Object Storage URL) |
| TD-09 | Backend | Video Status Lifecycle and Error Handling | Explicit Enum State Machine | A (Explicit Enum State Machine) |
| TD-10 | Backend | Database and Queue Consistency for Job Enqueueing | Commit Status Update Before BullMQ Enqueue with Deterministic Job ID | A (Commit Status Update Before BullMQ Enqueue with Deterministic Job ID) |
| TD-11 | Repo-wide | Canonical Set of Environment Variable Keys | Centralized Namespaced Keys with Strict Joi Validation | A (Centralized Namespaced Keys with Strict Joi Validation) |
| TD-12 | Backend | Rate Limiting and Throttling Policy for Video Endpoints | Specific @Throttle Decorators on High-Frequency Video Endpoints | A (Specific @Throttle Decorators on High-Frequency Video Endpoints) |
| TD-13 | Backend | Testing Strategy with Real Infrastructure in Docker | Real MinIO, Redis, and FFmpeg in Integration/E2E Test Suites | A (Real MinIO, Redis, and FFmpeg in Integration/E2E Test Suites) |
