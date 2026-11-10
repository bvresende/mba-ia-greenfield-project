---
libs:
  "@nestjs/bullmq":
    version: "^11.0.4"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-11-10T20:43:00-03:00"
  bullmq:
    version: "^5.69.0"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-11-10T20:43:00-03:00"
  ioredis:
    version: "^5.6.1"
    context7_id: "/redis/ioredis"
    fetched_at: "2026-11-10T20:43:00-03:00"
  "@aws-sdk/client-s3":
    version: "^3.758.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-10T20:43:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.758.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-10T20:43:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-10T20:33:18-03:00"
---

# phase-03-videos — Library References

Distilled documentation and integration patterns for libraries decided in Phase 03. Pulled via Context7.

## @nestjs/bullmq & bullmq

**Sources:** `/nestjs/bull` and `/taskforcesh/bullmq` (Context7) — Maps to `phase-03-videos/TD-01` Decision A.

### Module Configuration

```typescript
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password') || undefined,
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'video-processing',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
})
export class VideosModule {}
```

### Worker / Processor Pattern

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

export interface VideoProcessingJobData {
  videoId: string;
  slug: string;
}

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId, slug } = job.data;
    // Execute probing, metadata extraction, and thumbnail extraction
  }
}
```

### Job Enqueueing with Deduplication

```typescript
await this.videoQueue.add(
  'process-video',
  { videoId: video.id, slug: video.slug },
  { jobId: video.id }, // Deterministic job ID ensures deduplication
);
```

---

## @aws-sdk/client-s3 & @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7) — Maps to `phase-03-videos/TD-02`, `TD-03`, `TD-04`, `TD-08`.

### S3 Client Initialization (MinIO & AWS S3 compatible)

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  endpoint: storageConfig.endpoint, // e.g., http://minio:9000 for internal
  region: storageConfig.region,     // e.g., us-east-1
  credentials: {
    accessKeyId: storageConfig.accessKey,
    secretAccessKey: storageConfig.secretKey,
  },
  forcePathStyle: true,             // Required for MinIO
});
```

### Multipart Upload Commands & Presigning

```typescript
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  GetObjectCommand,
  CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 1. Create Multipart Upload
const createRes = await s3Client.send(
  new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
  }),
);
const uploadId = createRes.UploadId;

// 2. Presign Part URL (for PUT chunk direct to storage)
const presignedPartUrl = await getSignedUrl(
  presignClient, // Client configured with public endpoint (e.g., http://localhost:9000)
  new UploadPartCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  }),
  { expiresIn: 3600 },
);

// 3. Complete Multipart Upload
const completeRes = await s3Client.send(
  new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts, // Array of { PartNumber, ETag }
    },
  }),
);

// 4. Presign GET URL for streaming (inline) or download (attachment)
const presignedStreamUrl = await getSignedUrl(
  presignClient,
  new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: isDownload
      ? `attachment; filename="${downloadFilename}"`
      : 'inline',
  }),
  { expiresIn: 7200 },
);
```
