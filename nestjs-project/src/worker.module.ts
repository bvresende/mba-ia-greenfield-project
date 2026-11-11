import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import storageConfig from './config/storage.config';
import videoConfig from './config/video.config';
import { envValidationSchema } from './config/env.validation';
import { User } from './users/entities/user.entity';
import { Channel } from './channels/entities/channel.entity';
import { Video } from './videos/entities/video.entity';
import { RefreshToken } from './auth/entities/refresh-token.entity';
import { VerificationToken } from './auth/entities/verification-token.entity';
import { StorageModule } from './storage/storage.module';
import { VideosModule } from './videos/videos.module';
import { VideoProcessor } from './videos/processors/video.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        storageConfig,
        videoConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        entities: [User, Channel, Video, RefreshToken, VerificationToken],
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [redisConfig.KEY],
      useFactory: (rConfig: ConfigType<typeof redisConfig>) => ({
        connection: {
          host: rConfig.host,
          port: rConfig.port,
          password: rConfig.password,
        },
      }),
    }),
    VideosModule,
    StorageModule,
  ],
  providers: [VideoProcessor],
  exports: [VideoProcessor],
})
export class WorkerModule {}
