import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

export interface MediaProbeResult {
  duration_seconds: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
}

export class MediaProbeException extends Error {
  readonly code = 'MEDIA_PROBE_FAILED';
  constructor(message: string) {
    super(`MEDIA_PROBE_FAILED: ${message}`);
    this.name = 'MediaProbeException';
  }
}

@Injectable()
export class MediaProbeService {
  private readonly logger = new Logger(MediaProbeService.name);

  async probe(source: string, timeoutMs = 30000): Promise<MediaProbeResult> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-print_format',
        'json',
        source,
      ];

      const child = spawn('ffprobe', args);
      let stdoutData = '';
      let stderrData = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new MediaProbeException(
            `Timeout of ${timeoutMs}ms exceeded while probing media`,
          ),
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new MediaProbeException(`Failed to spawn ffprobe: ${err.message}`),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          return reject(
            new MediaProbeException(
              `ffprobe exited with code ${code}: ${stderrData.trim() || 'unknown error'}`,
            ),
          );
        }

        try {
          const parsed = JSON.parse(stdoutData);
          const format = parsed.format || {};
          const videoStream = (parsed.streams || []).find(
            (s: any) => s.codec_type === 'video',
          );

          if (!videoStream) {
            return reject(
              new MediaProbeException('No video stream found in media file'),
            );
          }

          const rawDuration = parseFloat(
            videoStream.duration || format.duration || '0',
          );
          const durationSeconds = Math.round(rawDuration);
          const width = parseInt(videoStream.width || '0', 10);
          const height = parseInt(videoStream.height || '0', 10);
          const codec = videoStream.codec_name || 'unknown';
          const bitrate = parseInt(
            format.bit_rate || videoStream.bit_rate || '0',
            10,
          );

          resolve({
            duration_seconds: durationSeconds,
            width,
            height,
            codec,
            bitrate,
          });
        } catch (err: any) {
          reject(
            new MediaProbeException(
              `Failed to parse ffprobe output: ${err.message}`,
            ),
          );
        }
      });
    });
  }
}
