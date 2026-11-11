import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import storageConfig from '../config/storage.config';
import redisConfig from '../config/redis.config';
import videoConfig from '../config/video.config';
import {
  ALL_ENTITIES,
  createTestDataSource,
} from '../test/create-test-data-source';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile and provide VideosService', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            appConfig,
            authConfig,
            storageConfig,
            redisConfig,
            videoConfig,
          ],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
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
      ],
    }).compile();

    expect(module).toBeDefined();
    const service = module.get<VideosService>(VideosService);
    expect(service).toBeDefined();
    await module.close();
  }, 30000);
});
