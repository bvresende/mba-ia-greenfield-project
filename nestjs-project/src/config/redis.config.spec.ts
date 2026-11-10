import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import redisConfig from './redis.config';

const loadConfig = async (
  envOverrides: Record<string, string> = {},
): Promise<ConfigType<typeof redisConfig>> => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, envOverrides);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [redisConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof redisConfig>>(redisConfig.KEY);
  await module.close();
  process.env = originalEnv;
  return config;
};

describe('redisConfig', () => {
  it('should return default redis configuration when env vars are not set', async () => {
    const config = await loadConfig();
    expect(config.host).toBe('redis');
    expect(config.port).toBe(6379);
    expect(config.password).toBeUndefined();
  });

  it('should return overridden values when env vars are set', async () => {
    const config = await loadConfig({
      REDIS_HOST: 'custom-redis',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'secretpassword',
    });

    expect(config.host).toBe('custom-redis');
    expect(config.port).toBe(6380);
    expect(config.password).toBe('secretpassword');
  });
});
