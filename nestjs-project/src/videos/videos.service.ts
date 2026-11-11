import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';
import { CreateVideoDto, ALLOWED_MIME_TYPES } from './dto/create-video.dto';
import { StorageService } from '../storage/storage.service';
import { ChannelsService } from '../channels/channels.service';
import videoConfig from '../config/video.config';
import { generateSlug } from './utils/slug.util';
import {
  ChannelRequiredException,
  FileTooLargeException,
  InvalidFileTypeException,
  VideoNotFoundException,
  VideoAccessDeniedException,
  InvalidVideoStateException,
} from '../common/exceptions/domain.exception';

export interface CreateDraftResponse {
  id: string;
  slug: string;
  title: string;
  status: VideoStatus;
  upload_id: string;
  part_size_bytes: number;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async createDraft(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<CreateDraftResponse> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelRequiredException();
    }

    if (dto.file_size_bytes > this.config.maxFileSizeBytes) {
      throw new FileTooLargeException();
    }

    if (!ALLOWED_MIME_TYPES.includes(dto.mime_type as any)) {
      throw new InvalidFileTypeException();
    }

    let slug = generateSlug();
    while (await this.videoRepository.findOne({ where: { slug } })) {
      slug = generateSlug();
    }

    const videoId = randomUUID();
    const ext = dto.original_filename.includes('.')
      ? dto.original_filename.split('.').pop()
      : 'mp4';
    const storageKey = `videos/${videoId}/original.${ext}`;

    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      dto.mime_type,
    );

    const video = this.videoRepository.create({
      id: videoId,
      slug,
      title: dto.title,
      description: dto.description || null,
      original_filename: dto.original_filename,
      file_size_bytes: dto.file_size_bytes,
      mime_type: dto.mime_type,
      status: VideoStatus.DRAFT,
      channel_id: channel.id,
      storage_key: storageKey,
      upload_id: uploadId,
    });

    await this.videoRepository.save(video);

    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      upload_id: uploadId,
      part_size_bytes: this.config.partSizeBytes,
    };
  }

  async findBySlug(slug: string): Promise<Video | null> {
    return this.videoRepository.findOne({ where: { slug } });
  }
}
