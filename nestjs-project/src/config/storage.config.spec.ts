import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from './storage.config';

const loadConfig = async (
  envOverrides: Record<string, string> = {},
): Promise<ConfigType<typeof storageConfig>> => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, envOverrides);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [storageConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof storageConfig>>(
    storageConfig.KEY,
  );
  await module.close();
  process.env = originalEnv;
  return config;
};

describe('storageConfig', () => {
  it('should return default storage configuration when env vars are not set', async () => {
    const config = await loadConfig();
    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.publicEndpoint).toBe('http://localhost:9000');
    expect(config.region).toBe('us-east-1');
    expect(config.accessKey).toBe('minioadmin');
    expect(config.secretKey).toBe('minioadmin');
    expect(config.bucketVideos).toBe('streamtube-videos');
    expect(config.forcePathStyle).toBe(true);
  });

  it('should use provided env vars when set', async () => {
    const config = await loadConfig({
      STORAGE_ENDPOINT: 'https://s3.custom.com',
      STORAGE_PUBLIC_ENDPOINT: 'https://cdn.custom.com',
      STORAGE_REGION: 'eu-west-1',
      STORAGE_ACCESS_KEY: 'custom-key',
      STORAGE_SECRET_KEY: 'custom-secret',
      STORAGE_BUCKET_VIDEOS: 'custom-videos',
      STORAGE_FORCE_PATH_STYLE: 'false',
    });

    expect(config.endpoint).toBe('https://s3.custom.com');
    expect(config.publicEndpoint).toBe('https://cdn.custom.com');
    expect(config.region).toBe('eu-west-1');
    expect(config.accessKey).toBe('custom-key');
    expect(config.secretKey).toBe('custom-secret');
    expect(config.bucketVideos).toBe('custom-videos');
    expect(config.forcePathStyle).toBe(false);
  });
});
