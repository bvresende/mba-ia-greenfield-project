import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { StorageModule } from '../storage/storage.module';
import { ChannelsModule } from '../channels/channels.module';
import videoConfig from '../config/video.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({
      name: 'video-processing',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
      },
    }),
    StorageModule,
    ChannelsModule,
    ConfigModule.forFeature(videoConfig),
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService, TypeOrmModule, BullModule],
})
export class VideosModule {}
