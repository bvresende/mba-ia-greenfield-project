import { DataSource, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import {
  ALL_ENTITIES,
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';
import { VideosService } from './videos.service';
import {
  ChannelRequiredException,
  FileTooLargeException,
  InvalidFileTypeException,
  VideoNotFoundException,
  VideoAccessDeniedException,
  InvalidVideoStateException,
  UploadIncompleteException,
} from '../common/exceptions/domain.exception';

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let storageService: StorageService;
  let channelsService: ChannelsService;
  let videosService: VideosService;
  let videoQueue: Queue;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelsService = new ChannelsService(dataSource);

    const sCfg = storageConfig();
    storageService = new StorageService(sCfg);
    await storageService.ensureBucketExists();

    videoQueue = new Queue('video-processing', {
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    });

    const vCfg = videoConfig();
    videosService = new VideosService(
      videoRepository,
      storageService,
      channelsService,
      vCfg,
      videoQueue,
    );
  });

  afterAll(async () => {
    await videoQueue.close();
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
        email: `video_test_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelsService.createChannel(user.id, user.email);
    return { user, channel };
  }

  describe('createDraft', () => {
    it('creates a video in DRAFT status with multipart upload initiated and valid slug', async () => {
      const { user, channel } = await createUserAndChannel();

      const res = await videosService.createDraft(user.id, {
        title: 'My First Video',
        description: 'Testing video draft creation',
        original_filename: 'clip.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      expect(res.id).toBeDefined();
      expect(res.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(res.title).toBe('My First Video');
      expect(res.status).toBe(VideoStatus.DRAFT);
      expect(res.upload_id).toBeDefined();
      expect(res.part_size_bytes).toBe(67108864);

      const persisted = await videoRepository.findOne({
        where: { id: res.id },
      });
      expect(persisted).not.toBeNull();
      expect(persisted!.status).toBe(VideoStatus.DRAFT);
      expect(persisted!.channel_id).toBe(channel.id);
      expect(persisted!.storage_key).toBe(`videos/${res.id}/original.mp4`);
      expect(persisted!.upload_id).toBe(res.upload_id);
    });

    it('throws ChannelRequiredException if user does not have a channel', async () => {
      const userWithoutChannel = await userRepository.save(
        userRepository.create({
          email: `no_ch_${++counter}@example.com`,
          password: 'hashed',
        }),
      );

      await expect(
        videosService.createDraft(userWithoutChannel.id, {
          title: 'Orphan Video',
          original_filename: 'clip.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
        }),
      ).rejects.toThrow(ChannelRequiredException);
    });

    it('throws FileTooLargeException if file_size_bytes exceeds limit', async () => {
      const { user } = await createUserAndChannel();

      await expect(
        videosService.createDraft(user.id, {
          title: 'Huge Video',
          original_filename: 'clip.mp4',
          file_size_bytes: 10737418241, // 10GB + 1 byte
          mime_type: 'video/mp4',
        }),
      ).rejects.toThrow(FileTooLargeException);
    });

    it('throws InvalidFileTypeException if mime_type is not supported', async () => {
      const { user } = await createUserAndChannel();

      await expect(
        videosService.createDraft(user.id, {
          title: 'Invalid File',
          original_filename: 'image.png',
          file_size_bytes: 1048576,
          mime_type: 'image/png' as any,
        }),
      ).rejects.toThrow(InvalidFileTypeException);
    });
  });

  describe('findBySlug', () => {
    it('returns video when slug exists', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Searchable Video',
        original_filename: 'clip.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      const found = await videosService.findBySlug(draft.slug);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(draft.id);
      expect(found!.slug).toBe(draft.slug);
    });

    it('returns null when slug does not exist', async () => {
      const found = await videosService.findBySlug('nonexistent1');
      expect(found).toBeNull();
    });
  });

  describe('getPartUrls', () => {
    it('returns presigned URLs containing valid signature parameters for requested parts', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Video with Parts',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      const res = await videosService.getPartUrls(user.id, draft.slug, {
        part_numbers: [1, 2],
      });

      expect(res.parts).toHaveLength(2);
      expect(res.parts[0].part_number).toBe(1);
      expect(res.parts[0].url).toContain('partNumber=1');
      expect(res.parts[0].url).toContain('X-Amz-Signature');
      expect(res.parts[1].part_number).toBe(2);
      expect(res.parts[1].url).toContain('partNumber=2');
      expect(res.parts[1].url).toContain('X-Amz-Signature');
    });

    it('throws VideoAccessDeniedException when called by non-owner', async () => {
      const { user: owner } = await createUserAndChannel();
      const { user: otherUser } = await createUserAndChannel();
      const draft = await videosService.createDraft(owner.id, {
        title: 'Owned Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      await expect(
        videosService.getPartUrls(otherUser.id, draft.slug, {
          part_numbers: [1],
        }),
      ).rejects.toThrow(VideoAccessDeniedException);
    });

    it('throws InvalidVideoStateException when video is not in DRAFT status', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Processing Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      await videoRepository.update(draft.id, {
        status: VideoStatus.READY,
      });

      await expect(
        videosService.getPartUrls(user.id, draft.slug, {
          part_numbers: [1],
        }),
      ).rejects.toThrow(InvalidVideoStateException);
    });

    it('throws VideoNotFoundException when slug does not exist', async () => {
      const { user } = await createUserAndChannel();
      await expect(
        videosService.getPartUrls(user.id, 'not_found_1', {
          part_numbers: [1],
        }),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  describe('listUploadedParts', () => {
    it('returns empty parts array when no parts uploaded yet', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Empty Parts Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      const res = await videosService.listUploadedParts(user.id, draft.slug);
      expect(res.upload_id).toBe(draft.upload_id);
      expect(res.parts).toEqual([]);
    });

    it('throws VideoAccessDeniedException when called by non-owner', async () => {
      const { user: owner } = await createUserAndChannel();
      const { user: otherUser } = await createUserAndChannel();
      const draft = await videosService.createDraft(owner.id, {
        title: 'Private Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      await expect(
        videosService.listUploadedParts(otherUser.id, draft.slug),
      ).rejects.toThrow(VideoAccessDeniedException);
    });

    it('throws InvalidVideoStateException when video is not in DRAFT status', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Non-draft Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      await videoRepository.update(draft.id, {
        status: VideoStatus.FAILED,
      });

      await expect(
        videosService.listUploadedParts(user.id, draft.slug),
      ).rejects.toThrow(InvalidVideoStateException);
    });
  });

  describe('completeUpload', () => {
    it('completes upload, updates status to PROCESSING and enqueues job with jobId = video.id', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Video To Complete',
        original_filename: 'sample.mp4',
        file_size_bytes: 5242880,
        mime_type: 'video/mp4',
      });

      // Upload real chunk to MinIO
      const part1Url = await storageService.getPresignedPartUrl(
        `videos/${draft.id}/original.mp4`,
        draft.upload_id,
        1,
        300,
        true,
      );

      const chunk = Buffer.alloc(5 * 1024 * 1024, 'v');
      const putRes = await fetch(part1Url, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      expect(putRes.status).toBe(200);
      const etag = putRes.headers.get('etag')!.replace(/"/g, '');

      // Complete upload
      const res = await videosService.completeUpload(user.id, draft.slug, {
        parts: [{ part_number: 1, etag }],
      });

      expect(res.slug).toBe(draft.slug);
      expect(res.status).toBe(VideoStatus.PROCESSING);

      // Verify DB status
      const updatedVideo = await videoRepository.findOne({
        where: { id: draft.id },
      });
      expect(updatedVideo!.status).toBe(VideoStatus.PROCESSING);

      // Verify BullMQ job
      const job = await videoQueue.getJob(draft.id);
      expect(job).toBeDefined();
      expect(job!.name).toBe('process-video');
      expect(job!.id).toBe(draft.id);
      expect(job!.data).toEqual({ videoId: draft.id });
    });

    it('throws UploadIncompleteException with invalid parts or missing etags', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Failing Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      await expect(
        videosService.completeUpload(user.id, draft.slug, {
          parts: [{ part_number: 1, etag: 'invalid-nonexistent-etag' }],
        }),
      ).rejects.toThrow(UploadIncompleteException);
    });

    it('throws VideoAccessDeniedException when called by non-owner', async () => {
      const { user: owner } = await createUserAndChannel();
      const { user: otherUser } = await createUserAndChannel();
      const draft = await videosService.createDraft(owner.id, {
        title: 'Owned Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      await expect(
        videosService.completeUpload(otherUser.id, draft.slug, {
          parts: [{ part_number: 1, etag: 'etag' }],
        }),
      ).rejects.toThrow(VideoAccessDeniedException);
    });

    it('throws InvalidVideoStateException when video is not in DRAFT status', async () => {
      const { user } = await createUserAndChannel();
      const draft = await videosService.createDraft(user.id, {
        title: 'Already Ready Video',
        original_filename: 'sample.mp4',
        file_size_bytes: 1048576,
        mime_type: 'video/mp4',
      });

      await videoRepository.update(draft.id, {
        status: VideoStatus.READY,
      });

      await expect(
        videosService.completeUpload(user.id, draft.slug, {
          parts: [{ part_number: 1, etag: 'etag' }],
        }),
      ).rejects.toThrow(InvalidVideoStateException);
    });

    it('throws VideoNotFoundException when video does not exist', async () => {
      const { user } = await createUserAndChannel();
      await expect(
        videosService.completeUpload(user.id, 'nonexistent9', {
          parts: [{ part_number: 1, etag: 'etag' }],
        }),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  describe('getStreamUrl', () => {
    it('returns presigned stream URL with inline disposition for READY video (anonymous)', async () => {
      const { channel } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'streamRdy01',
          title: 'Ready Stream Video',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.READY,
          channel_id: channel.id,
          storage_key: 'videos/stream-key/original.mp4',
        }),
      );

      const url = await videosService.getStreamUrl(video.slug);
      expect(url).toBeDefined();
      expect(url).toContain('response-content-disposition=inline');
      expect(url).toContain('X-Amz-Signature');
    });

    it('returns stream URL for channel owner when video is in PROCESSING status', async () => {
      const { user, channel } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'streamPrc01',
          title: 'Processing Video',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.PROCESSING,
          channel_id: channel.id,
          storage_key: 'videos/proc-key/original.mp4',
        }),
      );

      const url = await videosService.getStreamUrl(video.slug, user.id);
      expect(url).toBeDefined();
      expect(url).toContain('response-content-disposition=inline');
    });

    it('throws VideoNotFoundException when non-owner requests PROCESSING video', async () => {
      const { channel } = await createUserAndChannel();
      const { user: otherUser } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'streamPrc02',
          title: 'Processing Video Other',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.PROCESSING,
          channel_id: channel.id,
          storage_key: 'videos/proc-key/original.mp4',
        }),
      );

      await expect(
        videosService.getStreamUrl(video.slug, otherUser.id),
      ).rejects.toThrow(VideoNotFoundException);

      // Anonymous also gets 404
      await expect(videosService.getStreamUrl(video.slug)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotFoundException for DRAFT or FAILED video', async () => {
      const { user, channel } = await createUserAndChannel();
      const draft = await videoRepository.save(
        videoRepository.create({
          slug: 'streamDft01',
          title: 'Draft Video',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.DRAFT,
          channel_id: channel.id,
          storage_key: 'videos/dft-key/original.mp4',
        }),
      );

      await expect(
        videosService.getStreamUrl(draft.slug, user.id),
      ).rejects.toThrow(VideoNotFoundException);

      const failed = await videoRepository.save(
        videoRepository.create({
          slug: 'streamFld01',
          title: 'Failed Video',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.FAILED,
          channel_id: channel.id,
          storage_key: 'videos/fld-key/original.mp4',
        }),
      );

      await expect(
        videosService.getStreamUrl(failed.slug, user.id),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  describe('getDownloadUrl', () => {
    it('returns presigned download URL with attachment disposition and filename', async () => {
      const { channel } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'dlVideo001',
          title: 'My Awesome Presentation',
          original_filename: 'raw_video.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.READY,
          channel_id: channel.id,
          storage_key: 'videos/dl-key/original.mp4',
        }),
      );

      const url = await videosService.getDownloadUrl(video.slug);
      expect(url).toBeDefined();
      expect(url).toContain('response-content-disposition=attachment');
      expect(url).toContain('My_Awesome_Presentation.mp4');
    });

    it('throws VideoNotFoundException if video is not in READY status or does not exist', async () => {
      const { channel } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'dlNotRdy01',
          title: 'Not Ready',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.PROCESSING,
          channel_id: channel.id,
          storage_key: 'videos/notrdy-key/original.mp4',
        }),
      );

      await expect(videosService.getDownloadUrl(video.slug)).rejects.toThrow(
        VideoNotFoundException,
      );
      await expect(
        videosService.getDownloadUrl('doesnotexist9'),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  describe('getThumbnailUrl', () => {
    it('returns presigned thumbnail URL for READY video with thumbnail_key', async () => {
      const { channel } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'thumbV001',
          title: 'Video with Thumb',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.READY,
          channel_id: channel.id,
          storage_key: 'videos/thumb-key/original.mp4',
          thumbnail_key: 'videos/thumb-key/thumbnail.jpg',
        }),
      );

      const url = await videosService.getThumbnailUrl(video.slug);
      expect(url).toBeDefined();
      expect(url).toContain('videos/thumb-key/thumbnail.jpg');
      expect(url).toContain('X-Amz-Signature');
    });

    it('throws VideoNotFoundException if video does not have a thumbnail or is not READY', async () => {
      const { channel } = await createUserAndChannel();
      const noThumb = await videoRepository.save(
        videoRepository.create({
          slug: 'noThumb001',
          title: 'No Thumb Video',
          original_filename: 'sample.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.READY,
          channel_id: channel.id,
          storage_key: 'videos/nothumb/original.mp4',
          thumbnail_key: null,
        }),
      );

      await expect(videosService.getThumbnailUrl(noThumb.slug)).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  describe('getMetadata', () => {
    it('returns full video metadata when requested by channel owner', async () => {
      const { user, channel } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'metaVideo01',
          title: 'Full Meta Video',
          description: 'A rich description',
          original_filename: 'orig.mp4',
          file_size_bytes: 2048576,
          mime_type: 'video/mp4',
          duration_seconds: 120,
          width: 1920,
          height: 1080,
          bitrate: 4500000,
          codec: 'h264',
          status: VideoStatus.READY,
          channel_id: channel.id,
          storage_key: 'videos/meta/original.mp4',
          thumbnail_key: 'videos/meta/thumbnail.jpg',
        }),
      );

      const meta = await videosService.getMetadata(user.id, video.slug);
      expect(meta.id).toBe(video.id);
      expect(meta.slug).toBe(video.slug);
      expect(meta.title).toBe('Full Meta Video');
      expect(meta.description).toBe('A rich description');
      expect(meta.duration_seconds).toBe(120);
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
      expect(meta.bitrate).toBe(4500000);
      expect(meta.codec).toBe('h264');
      expect(meta.status).toBe(VideoStatus.READY);
      expect(meta.channel_id).toBe(channel.id);
    });

    it('throws VideoAccessDeniedException when requested by non-owner', async () => {
      const { channel } = await createUserAndChannel();
      const { user: otherUser } = await createUserAndChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          slug: 'metaDenied1',
          title: 'Secret Video',
          original_filename: 'orig.mp4',
          file_size_bytes: 1048576,
          mime_type: 'video/mp4',
          status: VideoStatus.READY,
          channel_id: channel.id,
          storage_key: 'videos/sec/original.mp4',
        }),
      );

      await expect(
        videosService.getMetadata(otherUser.id, video.slug),
      ).rejects.toThrow(VideoAccessDeniedException);
    });

    it('throws VideoNotFoundException when video does not exist', async () => {
      const { user } = await createUserAndChannel();
      await expect(
        videosService.getMetadata(user.id, 'metaNotFound'),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });
});
