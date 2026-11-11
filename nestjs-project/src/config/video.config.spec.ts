import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import videoConfig from './video.config';

const loadConfig = async (
  envOverrides: Record<string, string> = {},
): Promise<ConfigType<typeof videoConfig>> => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, envOverrides);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [videoConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);
  await module.close();
  process.env = originalEnv;
  return config;
};

describe('videoConfig', () => {
  it('should return default video limits when env vars are not set', async () => {
    const config = await loadConfig();
    expect(config.maxFileSizeBytes).toBe(10737418240); // 10 GB
    expect(config.partSizeBytes).toBe(67108864); // 64 MB
  });

  it('should return overridden values when env vars are set', async () => {
    const config = await loadConfig({
      VIDEO_MAX_FILE_SIZE_BYTES: '524288000',
      VIDEO_PART_SIZE_BYTES: '10485760',
    });

    expect(config.maxFileSizeBytes).toBe(524288000);
    expect(config.partSizeBytes).toBe(10485760);
  });
});
