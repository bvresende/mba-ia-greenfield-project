import { DataSource, Repository } from 'typeorm';
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
} from '../common/exceptions/domain.exception';

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let storageService: StorageService;
  let channelsService: ChannelsService;
  let videosService: VideosService;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    channelsService = new ChannelsService(dataSource);

    const sCfg = storageConfig();
    storageService = new StorageService(sCfg);
    await storageService.ensureBucketExists();

    const vCfg = videoConfig();
    videosService = new VideosService(
      videoRepository,
      storageService,
      channelsService,
      vCfg,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createUserAndChannel(): Promise<{ user: User; channel: Channel }> {
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
});
