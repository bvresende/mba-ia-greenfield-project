import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

export class ThumbnailExtractionException extends Error {
  readonly code = 'THUMBNAIL_EXTRACTION_FAILED';
  constructor(message: string) {
    super(`THUMBNAIL_EXTRACTION_FAILED: ${message}`);
    this.name = 'ThumbnailExtractionException';
  }
}

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);

  async generateThumbnail(
    source: string,
    offsetSeconds = 1,
    timeoutMs = 30000,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [
        '-ss',
        offsetSeconds.toString(),
        '-i',
        source,
        '-vframes',
        '1',
        '-q:v',
        '2',
        '-f',
        'image2',
        'pipe:1',
      ];

      const child = spawn('ffmpeg', args);
      const stdoutChunks: Buffer[] = [];
      let stderrData = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new ThumbnailExtractionException(
            `Timeout of ${timeoutMs}ms exceeded while generating thumbnail`,
          ),
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new ThumbnailExtractionException(
            `Failed to spawn ffmpeg: ${err.message}`,
          ),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          return reject(
            new ThumbnailExtractionException(
              `ffmpeg exited with code ${code}: ${stderrData.trim() || 'unknown error'}`,
            ),
          );
        }

        const buffer = Buffer.concat(stdoutChunks);
        if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
          return reject(
            new ThumbnailExtractionException(
              'Generated thumbnail is not a valid JPEG image',
            ),
          );
        }

        resolve(buffer);
      });
    });
  }
}
