# AGENTS.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Subproject Instructions

Detailed instructions, Docker runtime environments, and testing commands are maintained in their respective subproject instruction files:

- @[NestJS Backend Instructions](nestjs-project/AGENTS.md)
- @[Next.js Frontend Instructions](next-frontend/AGENTS.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` (Next.js) — Frontend application (Next.js App Router, React Server Components)

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, uploads to storage, publishes jobs to queue, sends emails
- **Video Worker** (Standalone NestJS + FFmpeg/FFprobe) → consumes jobs from BullMQ queue, extracts video duration/metadata, generates thumbnails, updates DB and storage
- **Database** (PostgreSQL 17) → users, channels, videos, comments, likes
- **Object Storage** (MinIO / S3) → video files (`videos/{videoId}/original.{ext}`) and thumbnails (`videos/{videoId}/thumbnail.jpg`)
- **Message Queue** (BullMQ + Redis 7) → video processing job queue (`video-processing`)
- **Email Service** (Mailpit / SMTP) → account confirmation and password recovery

## Video Upload and Processing (Phase 03)

The platform supports video uploads of up to 10GB via direct-to-storage multipart presigned URLs:

- **10GB Multipart Upload:** Client obtains presigned URLs from `/videos/:slug/upload/part-urls` and uploads chunks directly to Object Storage (MinIO/S3). Zero media upload bandwidth or memory overhead on the NestJS API server.
- **Draft Pre-Registration:** Upload starts by creating a record in `DRAFT` status (`POST /videos`) with an 11-character URL-safe unique slug (e.g. `dQw4w9WgXcQ`).
- **Asynchronous Background Processing:** Upon upload completion (`POST /videos/:slug/upload/complete`), the video transitions to `PROCESSING` and a job is dispatched to BullMQ with deterministic deduplication (`jobId = video.id`).
- **Worker & Media Tools:** Dedicated `video-worker` container executes native FFprobe to extract technical metadata (duration, resolution, codec, bitrate) and native FFmpeg to generate JPEG thumbnails.
- **Status Lifecycle:** `DRAFT` → `PROCESSING` → `READY` (or `FAILED` with `processing_error`).
- **Streaming & Delivery:**
  - `GET /videos/:slug/stream`: 302 Found redirect to presigned MinIO URL with `response-content-disposition=inline`, supporting HTTP Range requests (`206 Partial Content`).
  - `GET /videos/:slug/download`: 302 Found redirect to presigned MinIO URL with `response-content-disposition=attachment; filename="..."`.
  - `GET /videos/:slug/thumbnail`: 302 Found redirect to presigned thumbnail image URL.
  - `GET /videos/:slug`: Channel owner-only access to full video metadata and processing status.

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.


## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code 
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, 
reviewing, etc.), decompose the request into its underlying subtasks and 
concerns, then identify which available skills match any of them and activate 
those skills.

## Library Documentation Lookup

Before implementing any feature, you MUST use the **context7** MCP tool to look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest
- Retrieve the corresponding documentation using context7
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.
If the documentation returned does not match the installed version, flag the discrepancy before proceeding.