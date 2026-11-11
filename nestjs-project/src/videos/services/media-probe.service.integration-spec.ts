import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MediaProbeService } from './media-probe.service';

describe('MediaProbeService (integration)', () => {
  let service: MediaProbeService;
  const fixturePath = path.join('/tmp', 'test-probe-fixture.mp4');
  const corruptPath = path.join('/tmp', 'test-corrupt-file.mp4');

  beforeAll(() => {
    service = new MediaProbeService();

    // Generate valid 3-second 320x240 test video with ffmpeg
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

    // Create a corrupt file
    fs.writeFileSync(corruptPath, 'this is not a valid video file');
  });

  afterAll(() => {
    try {
      if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
      if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
    } catch {
      // Ignore cleanup error
    }
  });

  it('probes a valid video fixture and extracts technical metadata', async () => {
    const res = await service.probe(fixturePath);

    expect(res.duration_seconds).toBe(3);
    expect(res.width).toBe(320);
    expect(res.height).toBe(240);
    expect(res.codec).toBe('h264');
    expect(res.bitrate).toBeGreaterThan(0);
  });

  it('rejects with error when file is corrupt or invalid', async () => {
    await expect(service.probe(corruptPath)).rejects.toThrow(
      /MEDIA_PROBE_FAILED/,
    );
  });

  it('rejects with error when file does not exist', async () => {
    await expect(
      service.probe('/tmp/nonexistent-media-file.mp4'),
    ).rejects.toThrow(/MEDIA_PROBE_FAILED/);
  });
});
