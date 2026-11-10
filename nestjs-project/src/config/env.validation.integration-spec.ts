import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ACCESS_KEY: 'minioadmin',
  STORAGE_SECRET_KEY: 'minioadmin',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — Storage & Redis', () => {
  it('should reject when STORAGE_ACCESS_KEY is missing', () => {
    const env = { ...requiredEnv };
    delete (env as any).STORAGE_ACCESS_KEY;
    const { error } = envValidationSchema.validate(env, { abortEarly: false });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ACCESS_KEY');
  });

  it('should reject when STORAGE_SECRET_KEY is missing', () => {
    const env = { ...requiredEnv };
    delete (env as any).STORAGE_SECRET_KEY;
    const { error } = envValidationSchema.validate(env, { abortEarly: false });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_SECRET_KEY');
  });

  it('should reject invalid redis port', () => {
    const { error } = validate({ REDIS_PORT: 'not-a-port' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('REDIS_PORT');
  });

  it('should apply default storage and redis values', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.STORAGE_ENDPOINT).toBe('http://minio:9000');
    expect(value.STORAGE_PUBLIC_ENDPOINT).toBe('http://localhost:9000');
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.VIDEO_MAX_FILE_SIZE_BYTES).toBe(10737418240);
  });
});

