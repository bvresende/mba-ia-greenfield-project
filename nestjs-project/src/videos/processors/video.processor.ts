import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Video } from '../entities/video.entity';
import { VideoStatus } from '../enums/video-status.enum';
import { StorageService } from '../../storage/storage.service';
import { MediaProbeService } from '../services/media-probe.service';
import { ThumbnailService } from '../services/thumbnail.service';
import { VideoProcessingJobData } from '../videos.service';

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly mediaProbeService: MediaProbeService,
    private readonly thumbnailService: ThumbnailService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId } = job.data;
    this.logger.log(`Starting processing for video ${videoId} (job ${job.id})`);

    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });

    if (!video) {
      this.logger.error(`Video with ID ${videoId} not found`);
      throw new Error(`Video with ID ${videoId} not found`);
    }

    try {
      // 1. Generate presigned GET URL with internal client for in-container download
      const presignedUrl = await this.storageService.getPresignedGetUrl(
        video.storage_key,
        { disposition: 'inline', expiresInSeconds: 3600 },
        true,
      );

      // 2. Probe video technical metadata
      const probeResult = await this.mediaProbeService.probe(presignedUrl);

      // 3. Extract thumbnail at 1s or 10% duration
      const offsetSeconds =
        probeResult.duration_seconds >= 2
          ? Math.max(1, Math.floor(probeResult.duration_seconds * 0.1))
          : 0;

      const thumbBuffer = await this.thumbnailService.generateThumbnail(
        presignedUrl,
        offsetSeconds,
      );

      // 4. Save thumbnail in Object Storage
      const thumbnailKey = `videos/${video.id}/thumbnail.jpg`;
      await this.storageService.uploadBuffer(
        thumbnailKey,
        thumbBuffer,
        'image/jpeg',
      );

      // 5. Update video status and metadata
      video.duration_seconds = probeResult.duration_seconds;
      video.width = probeResult.width;
      video.height = probeResult.height;
      video.codec = probeResult.codec;
      video.bitrate = probeResult.bitrate;
      video.thumbnail_key = thumbnailKey;
      video.status = VideoStatus.READY;
      video.processing_error = null;

      await this.videoRepository.save(video);
      this.logger.log(
        `Video ${videoId} successfully processed and marked READY`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed processing video ${videoId}: ${error.message}`,
        error.stack,
      );

      video.status = VideoStatus.FAILED;
      video.processing_error = error?.message || 'Processing failed';
      await this.videoRepository.save(video);

      throw error;
    }
  }
}
