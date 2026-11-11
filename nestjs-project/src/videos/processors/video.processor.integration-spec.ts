import { DataSource, Repository } from 'typeorm';
import { Job } from 'bullmq';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  ALL_ENTITIES,
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { ChannelsService } from '../../channels/channels.service';
import { StorageService } from '../../storage/storage.service';
import storageConfig from '../../config/storage.config';
import { Video } from '../entities/video.entity';
import { VideoStatus } from '../enums/video-status.enum';
import { MediaProbeService } from '../services/media-probe.service';
import { ThumbnailService } from '../services/thumbnail.service';
import { VideoProcessor } from './video.processor';
import { VideoProcessingJobData } from '../videos.service';

describe('VideoProcessor (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelsService: ChannelsService;
  let storageService: StorageService;
  let mediaProbeService: MediaProbeService;
  let thumbnailService: ThumbnailService;
  let videoProcessor: VideoProcessor;

  const tempMp4 = path.join('/tmp', 'video-processor-sample.mp4');

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelsService = new ChannelsService(dataSource);

    const sCfg = storageConfig();
    storageService = new StorageService(sCfg);
    await storageService.ensureBucketExists();

    mediaProbeService = new MediaProbeService();
    thumbnailService = new ThumbnailService();

    videoProcessor = new VideoProcessor(
      videoRepository,
      storageService,
      mediaProbeService,
      thumbnailService,
    );

    // Generate valid 3s h264 test video with ffmpeg
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
      tempMp4,
    ]);
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(tempMp4)) fs.unlinkSync(tempMp4);
    } catch {
      // Ignore
    }
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createUserAndChannel(): Promise<{
    user: User;
    channel: Channel;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `proc_test_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelsService.createChannel(user.id, user.email);
    return { user, channel };
  }

  it('processes video successfully: updates status to READY, sets metadata and uploads thumbnail', async () => {
    const { channel } = await createUserAndChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        slug: 'procSlug001',
        title: 'Processor Test Video',
        original_filename: 'sample.mp4',
        file_size_bytes: fs.statSync(tempMp4).size,
        mime_type: 'video/mp4',
        status: VideoStatus.PROCESSING,
        channel_id: channel.id,
        storage_key: `videos/test-proc-${Date.now()}/original.mp4`,
      }),
    );

    // Upload video file into MinIO at video.storage_key
    const fileBuffer = fs.readFileSync(tempMp4);
    await storageService.uploadBuffer(
      video.storage_key,
      fileBuffer,
      'video/mp4',
    );

    const job = {
      id: video.id,
      data: { videoId: video.id },
    } as Job<VideoProcessingJobData>;

    await videoProcessor.process(job);

    const updated = await videoRepository.findOne({
      where: { id: video.id },
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(VideoStatus.READY);
    expect(updated!.duration_seconds).toBe(3);
    expect(updated!.width).toBe(320);
    expect(updated!.height).toBe(240);
    expect(updated!.codec).toBe('h264');
    expect(updated!.bitrate).toBeGreaterThan(0);
    expect(updated!.thumbnail_key).toBe(`videos/${video.id}/thumbnail.jpg`);
    expect(updated!.processing_error).toBeNull();

    // Verify thumbnail in MinIO is accessible and valid JPEG
    const thumbUrl = await storageService.getPresignedGetUrl(
      updated!.thumbnail_key!,
      { disposition: 'inline' },
      true,
    );
    const thumbRes = await fetch(thumbUrl);
    expect(thumbRes.status).toBe(200);
    const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
    expect(thumbBuf[0]).toBe(0xff);
    expect(thumbBuf[1]).toBe(0xd8);
  });

  it('fails processing when video storage file is corrupt: updates status to FAILED and rethrows', async () => {
    const { channel } = await createUserAndChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        slug: 'procSlug002',
        title: 'Corrupt Test Video',
        original_filename: 'corrupt.mp4',
        file_size_bytes: 100,
        mime_type: 'video/mp4',
        status: VideoStatus.PROCESSING,
        channel_id: channel.id,
        storage_key: `videos/corrupt-${Date.now()}/original.mp4`,
      }),
    );

    // Upload corrupt non-video bytes
    await storageService.uploadBuffer(
      video.storage_key,
      Buffer.from('not a real video file'),
      'video/mp4',
    );

    const job = {
      id: video.id,
      data: { videoId: video.id },
    } as Job<VideoProcessingJobData>;

    await expect(videoProcessor.process(job)).rejects.toThrow();

    const updated = await videoRepository.findOne({
      where: { id: video.id },
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(VideoStatus.FAILED);
    expect(updated!.processing_error).toBeDefined();
    expect(updated!.processing_error).toContain('MEDIA_PROBE_FAILED');
  });
});
