import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  publicEndpoint:
    process.env.STORAGE_PUBLIC_ENDPOINT ||
    process.env.STORAGE_ENDPOINT ||
    'http://localhost:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.STORAGE_SECRET_KEY || 'minioadmin',
  bucketVideos: process.env.STORAGE_BUCKET_VIDEOS || 'streamtube-videos',
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
}));
