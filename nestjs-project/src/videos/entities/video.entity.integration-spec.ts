import { DataSource, Repository } from 'typeorm';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Video } from './video.entity';
import { VideoStatus } from '../enums/video-status.enum';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${++counter}@example.com`,
        password: 'hashedpassword',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  it('should persist a video with default DRAFT status and correct fields', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        slug: 'aB3_dE7-gH1',
        title: 'My Test Video',
        description: 'Test description',
        original_filename: 'sample.mp4',
        file_size_bytes: 10737418240, // 10GB
        mime_type: 'video/mp4',
        storage_key: 'videos/test-id/original.mp4',
        channel_id: channel.id,
      }),
    );

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.file_size_bytes).toBe(10737418240);
    expect(video.created_at).toBeDefined();
    expect(video.updated_at).toBeDefined();
    expect(video.duration_seconds).toBeNull();
  });

  it('should enforce unique slug constraint', async () => {
    const channel = await createChannel();

    await videoRepository.save(
      videoRepository.create({
        slug: 'uniqueSlug1',
        title: 'First Video',
        original_filename: 'first.mp4',
        file_size_bytes: 1000,
        mime_type: 'video/mp4',
        storage_key: 'videos/1/original.mp4',
        channel_id: channel.id,
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          slug: 'uniqueSlug1',
          title: 'Second Video Same Slug',
          original_filename: 'second.mp4',
          file_size_bytes: 2000,
          mime_type: 'video/mp4',
          storage_key: 'videos/2/original.mp4',
          channel_id: channel.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should cascade delete videos when channel is deleted', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        slug: 'cascadeSlug',
        title: 'Cascade Video',
        original_filename: 'video.mp4',
        file_size_bytes: 5000,
        mime_type: 'video/mp4',
        storage_key: 'videos/3/original.mp4',
        channel_id: channel.id,
      }),
    );

    await channelRepository.delete(channel.id);

    const found = await videoRepository.findOne({ where: { id: video.id } });
    expect(found).toBeNull();
  });

  it('should load video with related channel and vice versa', async () => {
    const channel = await createChannel();

    await videoRepository.save(
      videoRepository.create({
        slug: 'relationSlg',
        title: 'Relation Video',
        original_filename: 'video.mp4',
        file_size_bytes: 5000,
        mime_type: 'video/mp4',
        storage_key: 'videos/4/original.mp4',
        channel_id: channel.id,
      }),
    );

    const foundChannel = await channelRepository.findOne({
      where: { id: channel.id },
      relations: ['videos'],
    });

    expect(foundChannel?.videos).toHaveLength(1);
    expect(foundChannel?.videos[0].title).toBe('Relation Video');
  });
});
