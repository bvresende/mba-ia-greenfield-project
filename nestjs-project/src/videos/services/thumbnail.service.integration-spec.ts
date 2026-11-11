import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ThumbnailService } from './thumbnail.service';

describe('ThumbnailService (integration)', () => {
  let service: ThumbnailService;
  const fixturePath = path.join('/tmp', 'test-thumb-fixture.mp4');
  const corruptPath = path.join('/tmp', 'test-thumb-corrupt.mp4');

  beforeAll(() => {
    service = new ThumbnailService();

    // Generate valid 3-second test video with ffmpeg
    spawnSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=3:size=320x240:rate=30',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      fixturePath,
    ]);

    fs.writeFileSync(corruptPath, 'corrupted data');
  });

  afterAll(() => {
    try {
      if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
      if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
    } catch {
      // Ignore cleanup error
    }
  });

  it('generates a valid JPEG thumbnail buffer starting with magic bytes 0xFF 0xD8', async () => {
    const buffer = await service.generateThumbnail(fixturePath, 1);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer[0]).toBe(0xff);
    expect(buffer[1]).toBe(0xd8);
  });

  it('rejects with error when file is corrupt or invalid', async () => {
    await expect(service.generateThumbnail(corruptPath, 1)).rejects.toThrow(
      /THUMBNAIL_EXTRACTION_FAILED/,
    );
  });

  it('rejects with error when file does not exist', async () => {
    await expect(
      service.generateThumbnail('/tmp/nonexistent-thumb-file.mp4', 1),
    ).rejects.toThrow(/THUMBNAIL_EXTRACTION_FAILED/);
  });
});
