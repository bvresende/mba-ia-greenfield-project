import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/enums/video-status.enum';
import { VideoProcessor } from '../src/videos/processors/video.processor';
import { StorageService } from '../src/storage/storage.service';
import { MediaProbeService } from '../src/videos/services/media-probe.service';
import { ThumbnailService } from '../src/videos/services/thumbnail.service';

describe('Videos Pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let throttlerStorage: ThrottlerStorageService;
  let storageService: StorageService;
  let mediaProbeService: MediaProbeService;
  let thumbnailService: ThumbnailService;
  let videoProcessor: VideoProcessor;

  const fixturesDir = path.join(__dirname, 'fixtures');
  const sampleMp4Path = path.join(fixturesDir, 'sample.mp4');

  const origPublicEndpoint = process.env.STORAGE_PUBLIC_ENDPOINT;

  beforeAll(async () => {
    // Ensure STORAGE_PUBLIC_ENDPOINT points to minio container during in-container e2e tests
    process.env.STORAGE_PUBLIC_ENDPOINT =
      process.env.STORAGE_ENDPOINT || 'http://minio:9000';

    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    if (!fs.existsSync(sampleMp4Path)) {
      spawnSync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=3:size=320x240:rate=30',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        sampleMp4Path,
      ]);
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );

    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);

    storageService = moduleFixture.get(StorageService);
    mediaProbeService = moduleFixture.get(MediaProbeService);
    thumbnailService = moduleFixture.get(ThumbnailService);

    videoProcessor = new VideoProcessor(
      videoRepository,
      storageService,
      mediaProbeService,
      thumbnailService,
    );
  }, 60000);

  afterAll(async () => {
    if (origPublicEndpoint !== undefined) {
      process.env.STORAGE_PUBLIC_ENDPOINT = origPublicEndpoint;
    }
    if (fs.existsSync(sampleMp4Path)) {
      try {
        fs.unlinkSync(sampleMp4Path);
      } catch {
        // ignore
      }
    }
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function registerAndLogin(
    email: string,
    password = 'Password123!',
  ): Promise<{ accessToken: string; userId: string }> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const user = await userRepository.findOneBy({ email });
    expect(user).not.toBeNull();

    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken })
      .expect(204);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return {
      accessToken: loginRes.body.access_token,
      userId: user!.id,
    };
  }

  it('runs complete video lifecycle: pre-registration -> upload parts -> complete -> worker processing -> streaming -> download', async () => {
    const { accessToken } = await registerAndLogin(
      'e2e_pipeline_owner@example.com',
    );
    const sampleStats = fs.statSync(sampleMp4Path);
    const fileSize = sampleStats.size;

    // 1. Pre-register video (POST /videos)
    const createRes = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Full Pipeline E2E Video',
        description: 'Testing the entire video pipeline from upload to stream',
        original_filename: 'sample.mp4',
        file_size_bytes: fileSize,
        mime_type: 'video/mp4',
      })
      .expect(201);

    const videoId = createRes.body.id;
    const slug = createRes.body.slug;
    expect(videoId).toBeDefined();
    expect(slug).toBeDefined();
    expect(createRes.body.status).toBe(VideoStatus.DRAFT);
    expect(createRes.body.upload_id).toBeDefined();

    // 2. Request part upload URLs (POST /videos/:slug/upload/part-urls)
    const partUrlsRes = await request(app.getHttpServer())
      .post(`/videos/${slug}/upload/part-urls`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ part_numbers: [1] })
      .expect(200);

    expect(partUrlsRes.body.parts).toHaveLength(1);
    expect(partUrlsRes.body.parts[0].part_number).toBe(1);
    const uploadUrl = partUrlsRes.body.parts[0].url;
    expect(uploadUrl).toBeDefined();

    // 3. Client uploads part directly to Object Storage via PUT
    const fileBytes = fs.readFileSync(sampleMp4Path);
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileBytes,
      headers: {
        'Content-Type': 'video/mp4',
      },
    });
    expect(putRes.status).toBe(200);
    const rawEtag = putRes.headers.get('etag');
    expect(rawEtag).toBeTruthy();
    const etag = rawEtag!.replace(/"/g, '');

    // 4. Verify part is visible (GET /videos/:slug/upload/parts)
    const listPartsRes = await request(app.getHttpServer())
      .get(`/videos/${slug}/upload/parts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(listPartsRes.body.parts).toHaveLength(1);
    expect(listPartsRes.body.parts[0].part_number).toBe(1);

    // 5. Complete multipart upload (POST /videos/:slug/upload/complete)
    const completeRes = await request(app.getHttpServer())
      .post(`/videos/${slug}/upload/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        parts: [{ part_number: 1, etag }],
      })
      .expect(200);

    expect(completeRes.body.message).toContain('processing initiated');

    // Verify video transitioned to PROCESSING in database
    const inProcessingVideo = await videoRepository.findOneBy({ id: videoId });
    expect(inProcessingVideo!.status).toBe(VideoStatus.PROCESSING);

    // 6. Simulate worker processing the video
    await videoProcessor.process({
      id: videoId,
      data: { videoId },
    } as any);

    // 7. Verify status READY and probed technical metadata in DB
    const processedVideo = await videoRepository.findOneBy({ id: videoId });
    expect(processedVideo).not.toBeNull();
    expect(processedVideo!.status).toBe(VideoStatus.READY);
    expect(processedVideo!.duration_seconds).toBe(3);
    expect(processedVideo!.width).toBe(320);
    expect(processedVideo!.height).toBe(240);
    expect(processedVideo!.codec).toBe('h264');
    expect(processedVideo!.bitrate).toBeGreaterThan(0);
    expect(processedVideo!.thumbnail_key).toBe(
      `videos/${videoId}/thumbnail.jpg`,
    );
    expect(processedVideo!.processing_error).toBeNull();

    // 8. Test stream delivery (GET /videos/:slug/stream)
    const streamRes = await request(app.getHttpServer())
      .get(`/videos/${slug}/stream`)
      .expect(302);

    const streamLocation = streamRes.headers['location'];
    expect(streamLocation).toBeDefined();
    expect(streamLocation).toContain('/videos/');

    // Acceptance criterion: Range request to destination returns HTTP 206 Partial Content
    const rangeRes = await fetch(streamLocation, {
      headers: {
        Range: 'bytes=0-1024',
      },
    });
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get('content-range')).toContain('bytes 0-1024/');
    const rangeBuffer = Buffer.from(await rangeRes.arrayBuffer());
    expect(rangeBuffer.length).toBe(1025);

    // 9. Test download delivery (GET /videos/:slug/download)
    const downloadRes = await request(app.getHttpServer())
      .get(`/videos/${slug}/download`)
      .expect(302);

    const downloadLocation = downloadRes.headers['location'];
    expect(downloadLocation).toBeDefined();
    expect(downloadLocation).toContain(
      'response-content-disposition=attachment',
    );

    const downloadFetchRes = await fetch(downloadLocation);
    expect(downloadFetchRes.status).toBe(200);
    const contentDisposition = downloadFetchRes.headers.get(
      'content-disposition',
    );
    expect(contentDisposition).toContain('attachment');
    expect(contentDisposition).toContain('Full_Pipeline_E2E_Video.mp4');

    // 10. Test thumbnail delivery (GET /videos/:slug/thumbnail)
    const thumbRes = await request(app.getHttpServer())
      .get(`/videos/${slug}/thumbnail`)
      .expect(302);

    const thumbLocation = thumbRes.headers['location'];
    expect(thumbLocation).toBeDefined();

    const thumbFetchRes = await fetch(thumbLocation);
    expect(thumbFetchRes.status).toBe(200);
    const thumbBytes = Buffer.from(await thumbFetchRes.arrayBuffer());
    // JPEG magic numbers: 0xFF, 0xD8
    expect(thumbBytes[0]).toBe(0xff);
    expect(thumbBytes[1]).toBe(0xd8);

    // 11. Test authenticated video metadata endpoint (GET /videos/:slug)
    const metaRes = await request(app.getHttpServer())
      .get(`/videos/${slug}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(metaRes.body.id).toBe(videoId);
    expect(metaRes.body.slug).toBe(slug);
    expect(metaRes.body.status).toBe(VideoStatus.READY);
    expect(metaRes.body.duration_seconds).toBe(3);
    expect(metaRes.body.width).toBe(320);
    expect(metaRes.body.height).toBe(240);
    expect(metaRes.body.codec).toBe('h264');

    // 12. Security assertion: non-owner cannot read metadata
    const { accessToken: strangerToken } = await registerAndLogin(
      'stranger_user@example.com',
    );
    await request(app.getHttpServer())
      .get(`/videos/${slug}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });
});
