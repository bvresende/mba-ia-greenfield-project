import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  maxFileSizeBytes: parseInt(
    process.env.VIDEO_MAX_FILE_SIZE_BYTES || '10737418240',
    10,
  ),
  partSizeBytes: parseInt(
    process.env.VIDEO_PART_SIZE_BYTES || '67108864',
    10,
  ),
}));
