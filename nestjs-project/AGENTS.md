# AGENTS.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/minio/health/live` — expect `200`

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev

# Run the video worker (watch mode, background)
docker compose exec video-worker npm run start:worker:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `video-worker` — Video processing worker container (FFmpeg/FFprobe nativo, BullMQ consumer)
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `redis` — Redis 7, port `6379` (BullMQ message broker)
- `minio` — MinIO S3 Object Storage, port `9000` (API), port `9001` (Web Console)
- `mailpit` — Mailpit SMTP, port `1025` (SMTP), port `8025` (Web UI)

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Verify Redis is ready
docker compose exec redis redis-cli ping

# Verify MinIO is ready
curl -I http://localhost:9000/minio/health/live

# Verify FFmpeg in video worker
docker compose exec video-worker which ffmpeg

# Check container logs
docker compose logs nestjs-api
docker compose logs video-worker
docker compose logs db
docker compose logs redis
docker compose logs minio

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run start:worker:dev                 # Standalone video worker dev server (run in video-worker container)
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)
npm run smoke:upload                     # Full multipart upload & streaming smoke test
npm run openapi:export                   # Export OpenAPI 3.0 specification to openapi.json

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `AGENTS.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.agents/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module registered in `AppModule`:
  - `AuthModule` (`src/auth/`) — JWT auth, refresh tokens, email verification, password reset, guards (`JwtAuthGuard`, `@Public`).
  - `UsersModule` (`src/users/`) — User management and persistence.
  - `ChannelsModule` (`src/channels/`) — 1:1 user channels, nickname generation, channel profile.
  - `StorageModule` (`src/storage/`) — S3/MinIO Object Storage service using AWS SDK v3. Encapsulates multipart upload lifecycle, chunk presigning, buffer upload for thumbnails, and presigned streaming/download URLs.
  - `VideosModule` (`src/videos/`) — Video entity, 11-char URL slug generator, draft pre-registration, upload parts inspection, upload completion, BullMQ job producer, and delivery endpoints.
  - `WorkerModule` (`src/worker.module.ts`, `src/worker.main.ts`) — Dedicated standalone background application context consuming the `video-processing` BullMQ queue. Hosts `VideoProcessor`, `MediaProbeService` (native FFprobe execution), and `ThumbnailService` (native FFmpeg execution).

## Videos Module & Pipeline (Phase 03)

### Upload Architecture (Up to 10GB)
1. **Pre-registration:** Client sends `POST /videos` with metadata. API initiates multipart upload on MinIO/S3 via `createMultipartUpload`, creates video record in `DRAFT` status with a unique 11-char slug, and returns `upload_id` and `part_size_bytes` (64MB).
2. **Chunk URLs:** Client calls `POST /videos/:slug/upload/part-urls` requesting presigned PUT URLs for each chunk.
3. **Direct Upload:** Client streams 64MB parts directly to MinIO via HTTP PUT. Zero media traffic touches the NestJS API process.
4. **Completion:** Client calls `POST /videos/:slug/upload/complete` with parts list `[{ part_number, etag }]`. API finalizes S3 multipart upload, updates video status to `PROCESSING`, and dispatches a BullMQ job with deterministic deduplication (`jobId = video.id`).

### Worker & Background Processing
- Dedicated `video-worker` process consumes `video-processing` queue.
- Generates internal presigned GET URL and runs `MediaProbeService` (native `ffprobe`) to extract duration, resolution (width/height), codec, and bitrate.
- Runs `ThumbnailService` (native `ffmpeg`) extracting a JPEG frame at 10% duration (or 1s), validated by magic bytes `0xFF, 0xD8`.
- Uploads thumbnail to `videos/{videoId}/thumbnail.jpg` in MinIO and marks video `READY` (or `FAILED` with `processing_error`).

### Video Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/videos` | JWT (Bearer) | Pre-registers video draft, generates 11-char slug, and initiates S3 multipart upload |
| `POST` | `/videos/:slug/upload/part-urls` | JWT (Channel Owner) | Generates presigned S3 PUT URLs for requested part numbers |
| `GET` | `/videos/:slug/upload/parts` | JWT (Channel Owner) | Lists parts already uploaded to Object Storage |
| `POST` | `/videos/:slug/upload/complete` | JWT (Channel Owner) | Completes multipart upload, updates status to `PROCESSING`, enqueues BullMQ job |
| `GET` | `/videos/:slug/stream` | Public (or Owner) | Returns `302 Found` redirect to presigned S3 URL (`inline`), natively supporting `Range` requests (`206 Partial Content`) |
| `GET` | `/videos/:slug/download` | Public (or Owner) | Returns `302 Found` redirect to presigned S3 URL with `Content-Disposition: attachment; filename="{title}.{ext}"` |
| `GET` | `/videos/:slug/thumbnail` | Public (or Owner) | Returns `302 Found` redirect to presigned thumbnail JPEG URL |
| `GET` | `/videos/:slug` | JWT (Channel Owner) | Returns technical metadata, video status (`DRAFT`, `PROCESSING`, `READY`, `FAILED`), and processing errors |

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.

