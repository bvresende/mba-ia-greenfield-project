import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';
import { CreateVideoDto, ALLOWED_MIME_TYPES } from './dto/create-video.dto';
import { GetPartUrlsDto } from './dto/get-part-urls.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
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
  UploadIncompleteException,
} from '../common/exceptions/domain.exception';

export interface CreateDraftResponse {
  id: string;
  slug: string;
  title: string;
  status: VideoStatus;
  upload_id: string;
  part_size_bytes: number;
}

export interface PartUrlItem {
  part_number: number;
  url: string;
}

export interface GetPartUrlsResponse {
  parts: PartUrlItem[];
}

export interface UploadedPartResponseItem {
  part_number: number;
  etag: string;
  size_bytes: number;
}

export interface ListUploadedPartsResponse {
  upload_id: string;
  parts: UploadedPartResponseItem[];
}

export interface CompleteUploadResponse {
  slug: string;
  status: VideoStatus;
  message: string;
}

export interface VideoProcessingJobData {
  videoId: string;
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
    @InjectQueue('video-processing')
    private readonly videoQueue: Queue,
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

  async getOwnedVideo(userId: string, slug: string): Promise<Video> {
    const video = await this.findBySlug(slug);
    if (!video) {
      throw new VideoNotFoundException();
    }
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoAccessDeniedException();
    }
    return video;
  }

  async getPartUrls(
    userId: string,
    slug: string,
    dto: GetPartUrlsDto,
  ): Promise<GetPartUrlsResponse> {
    const video = await this.getOwnedVideo(userId, slug);
    if (video.status !== VideoStatus.DRAFT) {
      throw new InvalidVideoStateException();
    }

    const parts = await Promise.all(
      dto.part_numbers.map(async (partNumber) => {
        const url = await this.storageService.getPresignedPartUrl(
          video.storage_key,
          video.upload_id!,
          partNumber,
        );
        return {
          part_number: partNumber,
          url,
        };
      }),
    );

    return { parts };
  }

  async listUploadedParts(
    userId: string,
    slug: string,
  ): Promise<ListUploadedPartsResponse> {
    const video = await this.getOwnedVideo(userId, slug);
    if (video.status !== VideoStatus.DRAFT) {
      throw new InvalidVideoStateException();
    }

    const items = await this.storageService.listParts(
      video.storage_key,
      video.upload_id!,
    );

    return {
      upload_id: video.upload_id!,
      parts: items.map((item) => ({
        part_number: item.partNumber,
        etag: item.etag,
        size_bytes: item.sizeBytes,
      })),
    };
  }

  async completeUpload(
    userId: string,
    slug: string,
    dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponse> {
    const video = await this.getOwnedVideo(userId, slug);
    if (video.status !== VideoStatus.DRAFT) {
      throw new InvalidVideoStateException();
    }

    try {
      await this.storageService.completeMultipartUpload(
        video.storage_key,
        video.upload_id!,
        dto.parts,
      );
    } catch (err: any) {
      throw new UploadIncompleteException(
        err?.message || 'Upload parts are incomplete or missing',
      );
    }

    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);

    await this.videoQueue.add(
      'process-video',
      { videoId: video.id },
      { jobId: video.id },
    );

    return {
      slug: video.slug,
      status: video.status,
      message: 'Upload completed and processing initiated',
    };
  }
}
