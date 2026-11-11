import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';
import storageConfig from '../config/storage.config';

describe('StorageService (Integration)', () => {
  let module: TestingModule;
  let service: StorageService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    await service.ensureBucketExists();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should ensure bucket exists without error', async () => {
    await expect(service.ensureBucketExists()).resolves.not.toThrow();
  });

  it('should execute full multipart upload lifecycle against real MinIO', async () => {
    const key = `integration-tests/video-${Date.now()}.mp4`;
    const mimeType = 'video/mp4';

    // 1. Create multipart upload
    const uploadId = await service.createMultipartUpload(key, mimeType);
    expect(uploadId).toBeDefined();
    expect(typeof uploadId).toBe('string');

    // 2. Generate presigned part URL (using internal endpoint for in-container fetch)
    const part1Url = await service.getPresignedPartUrl(
      key,
      uploadId,
      1,
      300,
      true,
    );
    expect(part1Url).toContain('http://minio:9000');
    expect(part1Url).toContain('partNumber=1');
    expect(part1Url).toContain(`uploadId=${encodeURIComponent(uploadId)}`);

    // 3. Upload a chunk via HTTP PUT to MinIO (min 5MB for all parts except last in S3, or min 5MB chunk)
    // MinIO allows any size chunks except when strict AWS S3 is enforced; 5MB buffer is standard
    const chunk1 = Buffer.alloc(5 * 1024 * 1024, 'a');
    const putRes = await fetch(part1Url, {
      method: 'PUT',
      body: chunk1,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(putRes.status).toBe(200);
    const etag1 = putRes.headers.get('etag');
    expect(etag1).toBeDefined();

    // 4. List parts
    const parts = await service.listParts(key, uploadId);
    expect(parts.length).toBe(1);
    expect(parts[0].partNumber).toBe(1);
    expect(parts[0].sizeBytes).toBe(5 * 1024 * 1024);

    // 5. Complete multipart upload
    await expect(
      service.completeMultipartUpload(key, uploadId, [
        { part_number: 1, etag: etag1! },
      ]),
    ).resolves.not.toThrow();

    // 6. Presigned GET URL (inline and attachment)
    const streamUrl = await service.getPresignedGetUrl(
      key,
      { disposition: 'inline' },
      true,
    );
    expect(streamUrl).toContain('response-content-disposition=inline');

    const downloadUrl = await service.getPresignedGetUrl(
      key,
      { disposition: 'attachment', filename: 'my-video.mp4' },
      true,
    );
    expect(downloadUrl).toContain('attachment');
    expect(downloadUrl).toContain('my-video.mp4');

    // 7. Verify fetching the uploaded object returns 200 and correct length
    const getRes = await fetch(streamUrl);
    expect(getRes.status).toBe(200);
    expect(parseInt(getRes.headers.get('content-length') || '0', 10)).toBe(
      5 * 1024 * 1024,
    );
  });

  it('should upload a buffer and retrieve it successfully', async () => {
    const key = `integration-tests/thumb-${Date.now()}.jpg`;
    const buffer = Buffer.from('fake-jpeg-binary-data');

    await service.uploadBuffer(key, buffer, 'image/jpeg');

    const url = await service.getPresignedGetUrl(
      key,
      { disposition: 'inline' },
      true,
    );
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const downloaded = Buffer.from(await res.arrayBuffer());
    expect(downloaded.toString()).toBe('fake-jpeg-binary-data');
  });

  it('should abort multipart upload cleanly', async () => {
    const key = `integration-tests/abort-${Date.now()}.mp4`;
    const uploadId = await service.createMultipartUpload(key, 'video/mp4');

    await expect(
      service.abortMultipartUpload(key, uploadId),
    ).resolves.not.toThrow();

    // Listing parts after abort should fail
    await expect(service.listParts(key, uploadId)).rejects.toThrow();
  });
});
