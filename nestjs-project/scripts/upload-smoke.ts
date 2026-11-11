import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { User } from '../src/users/entities/user.entity';

// Ensure MinIO host inside container is reachable
process.env.STORAGE_PUBLIC_ENDPOINT =
  process.env.STORAGE_ENDPOINT || 'http://minio:9000';

async function main() {
  console.log('🚀 Starting StreamTube Video Upload Smoke Test...');

  let app: INestApplication | null = null;
  let workerContext: any = null;
  let baseUrl = process.env.API_URL || 'http://localhost:3000';

  // Check if API is already running on baseUrl
  let serverRunning = false;
  try {
    const res = await fetch(`${baseUrl}/`);
    if (res.status === 200) {
      serverRunning = true;
      console.log(`📡 Connected to running NestJS API at ${baseUrl}`);
    }
  } catch {
    serverRunning = false;
  }

  if (!serverRunning) {
    console.log('⚙️ API not running on default port. Bootstrapping embedded NestJS instance...');
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.listen(0);
    const address = app.getHttpServer().address() as any;
    baseUrl = `http://localhost:${address.port}`;
    console.log(`✅ Embedded NestJS instance listening on ${baseUrl}`);
  }

  // Bootstrap WorkerModule context to ensure background jobs are processed
  console.log('⚙️ Bootstrapping background video-worker context...');
  workerContext = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  console.log('✅ Background worker active and listening for video processing jobs');

  const tempVideoPath = path.join('/tmp', `smoke-sample-${Date.now()}.mp4`);

  try {
    // 1. Generate ~5.8MB valid test video with FFmpeg
    console.log('🎥 Generating ~5.8MB test video via FFmpeg lavfi generator...');
    const ffmpegRes = spawnSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=640x480,geq=random(1)*255:128:128',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      tempVideoPath,
    ]);

    if (ffmpegRes.status !== 0) {
      throw new Error(`FFmpeg failed: ${ffmpegRes.stderr?.toString()}`);
    }

    const fileSize = fs.statSync(tempVideoPath).size;
    console.log(`✅ Generated test video (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);

    // 2. User registration and authentication
    const email = `smoke_${Date.now()}@example.com`;
    const password = 'Password123!';
    console.log(`👤 Registering test user (${email})...`);

    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (regRes.status !== 201) {
      const err = await regRes.text();
      throw new Error(`User registration failed (${regRes.status}): ${err}`);
    }

    // Confirm email directly via DataSource
    const dataSource = (app || workerContext).get(DataSource);
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.findOneBy({ email });
    if (!user) throw new Error('Registered user not found in DB');
    user.is_confirmed = true;
    await userRepo.save(user);

    // Login to get access token
    console.log('🔑 Authenticating and obtaining access token...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (loginRes.status !== 200) {
      const err = await loginRes.text();
      throw new Error(`Login failed (${loginRes.status}): ${err}`);
    }

    const loginData = (await loginRes.json()) as { access_token: string };
    const accessToken = loginData.access_token;
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    // 3. Pre-register video
    console.log('📝 Pre-registering video draft (POST /videos)...');
    const createRes = await fetch(`${baseUrl}/videos`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Smoke Test Multipart Video',
        description: 'Smoke test executing full upload and processing lifecycle',
        original_filename: 'smoke-sample.mp4',
        file_size_bytes: fileSize,
        mime_type: 'video/mp4',
      }),
    });

    if (createRes.status !== 201) {
      const err = await createRes.text();
      throw new Error(`Failed to create video draft (${createRes.status}): ${err}`);
    }

    const videoDraft = (await createRes.json()) as {
      id: string;
      slug: string;
      upload_id: string;
      status: string;
    };
    const { slug } = videoDraft;
    console.log(`✅ Draft created with slug [${slug}], status: ${videoDraft.status}`);

    // 4. Request multipart URLs (chunks of 5MB)
    const chunkSize = 5 * 1024 * 1024; // 5MB
    const totalParts = Math.ceil(fileSize / chunkSize);
    console.log(`📦 Slicing ${fileSize} bytes into ${totalParts} parts (${(chunkSize / (1024 * 1024)).toFixed(0)}MB each)...`);

    const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
    const partUrlsRes = await fetch(`${baseUrl}/videos/${slug}/upload/part-urls`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ part_numbers: partNumbers }),
    });

    if (partUrlsRes.status !== 200) {
      const err = await partUrlsRes.text();
      throw new Error(`Failed to get part URLs (${partUrlsRes.status}): ${err}`);
    }

    const partUrlsData = (await partUrlsRes.json()) as {
      parts: Array<{ part_number: number; url: string }>;
    };

    // 5. Upload chunks directly to MinIO
    const fileBuffer = fs.readFileSync(tempVideoPath);
    const completedParts: Array<{ part_number: number; etag: string }> = [];

    for (const part of partUrlsData.parts) {
      const start = (part.part_number - 1) * chunkSize;
      const end = Math.min(start + chunkSize, fileSize);
      const chunk = fileBuffer.subarray(start, end);

      console.log(`⬆️ Uploading Part ${part.part_number}/${totalParts} (${chunk.length} bytes)...`);
      const putRes = await fetch(part.url, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'video/mp4' },
      });

      if (putRes.status !== 200) {
        throw new Error(`Upload of part ${part.part_number} failed with status ${putRes.status}`);
      }

      const rawEtag = putRes.headers.get('etag');
      if (!rawEtag) {
        throw new Error(`Missing ETag for part ${part.part_number}`);
      }
      const etag = rawEtag.replace(/"/g, '');
      completedParts.push({ part_number: part.part_number, etag });
      console.log(`  ✓ Part ${part.part_number} uploaded (ETag: ${etag})`);
    }

    // 6. List uploaded parts
    console.log('📋 Inspecting uploaded parts in storage (GET /videos/:slug/upload/parts)...');
    const listPartsRes = await fetch(`${baseUrl}/videos/${slug}/upload/parts`, {
      headers: authHeaders,
    });
    if (listPartsRes.status !== 200) {
      const err = await listPartsRes.text();
      throw new Error(`Failed to list parts (${listPartsRes.status}): ${err}`);
    }
    const listPartsData = (await listPartsRes.json()) as { parts: any[] };
    console.log(`✅ Storage confirms ${listPartsData.parts.length} parts uploaded`);

    // 7. Complete upload
    console.log('🏁 Completing multipart upload (POST /videos/:slug/upload/complete)...');
    const completeRes = await fetch(`${baseUrl}/videos/${slug}/upload/complete`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ parts: completedParts }),
    });

    if (completeRes.status !== 200) {
      const err = await completeRes.text();
      throw new Error(`Failed to complete upload (${completeRes.status}): ${err}`);
    }
    console.log('✅ Upload completed, processing initiated in background queue');

    // 8. Poll for READY status
    console.log('⏳ Waiting for background worker to process video...');
    let isReady = false;
    let videoMeta: any = null;
    const maxAttempts = 30; // 15 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const metaRes = await fetch(`${baseUrl}/videos/${slug}`, {
        headers: authHeaders,
      });

      if (metaRes.status === 200) {
        videoMeta = await metaRes.json();
        if (videoMeta.status === 'READY') {
          isReady = true;
          break;
        } else if (videoMeta.status === 'FAILED') {
          throw new Error(`Video processing failed: ${videoMeta.processing_error}`);
        }
      }
      process.stdout.write(`  Polling attempt ${attempt}/${maxAttempts} (status: ${videoMeta?.status || 'unknown'})...\r`);
    }

    console.log('');
    if (!isReady) {
      throw new Error(`Timed out waiting for video status READY. Last status: ${videoMeta?.status}`);
    }

    console.log(`🎉 Video marked READY! Metadata:`);
    console.log(`   - Duration: ${videoMeta.duration_seconds}s`);
    console.log(`   - Resolution: ${videoMeta.width}x${videoMeta.height}`);
    console.log(`   - Codec: ${videoMeta.codec}`);
    console.log(`   - Bitrate: ${videoMeta.bitrate} bps`);
    console.log(`   - Thumbnail: ${baseUrl}/videos/${slug}/thumbnail`);

    // 9. Test streaming with Range request
    console.log('🎬 Testing video streaming delivery (GET /videos/:slug/stream)...');
    const streamRes = await fetch(`${baseUrl}/videos/${slug}/stream`, {
      redirect: 'manual',
    });

    if (streamRes.status !== 302) {
      throw new Error(`Expected 302 redirect for stream, received ${streamRes.status}`);
    }

    const streamUrl = streamRes.headers.get('location');
    if (!streamUrl) throw new Error('Missing Location header in stream redirect');

    console.log(`   Redirected to presigned URL: ${streamUrl.substring(0, 80)}...`);
    const rangeRes = await fetch(streamUrl, {
      headers: { Range: 'bytes=0-1024' },
    });

    if (rangeRes.status !== 206) {
      throw new Error(`Expected 206 Partial Content for Range stream request, received ${rangeRes.status}`);
    }
    const contentRange = rangeRes.headers.get('content-range');
    console.log(`✅ Streaming verified! HTTP 206 Partial Content (Content-Range: ${contentRange})`);

    // 10. Test download endpoint
    console.log('💾 Testing download delivery (GET /videos/:slug/download)...');
    const downloadRes = await fetch(`${baseUrl}/videos/${slug}/download`, {
      redirect: 'manual',
    });
    if (downloadRes.status !== 302) {
      throw new Error(`Expected 302 redirect for download, received ${downloadRes.status}`);
    }
    const downloadUrl = downloadRes.headers.get('location');
    if (!downloadUrl?.includes('response-content-disposition=attachment')) {
      throw new Error('Missing attachment disposition in download URL');
    }
    console.log('✅ Download redirect verified with attachment disposition');

    // 11. Test thumbnail endpoint
    console.log('🖼️ Testing thumbnail delivery (GET /videos/:slug/thumbnail)...');
    const thumbRes = await fetch(`${baseUrl}/videos/${slug}/thumbnail`, {
      redirect: 'manual',
    });
    if (thumbRes.status !== 302) {
      throw new Error(`Expected 302 redirect for thumbnail, received ${thumbRes.status}`);
    }
    const thumbUrl = thumbRes.headers.get('location')!;
    const thumbFetch = await fetch(thumbUrl);
    if (thumbFetch.status !== 200) {
      throw new Error(`Thumbnail fetch failed with status ${thumbFetch.status}`);
    }
    const thumbBuf = Buffer.from(await thumbFetch.arrayBuffer());
    if (thumbBuf[0] !== 0xff || thumbBuf[1] !== 0xd8) {
      throw new Error('Thumbnail bytes are not a valid JPEG');
    }
    console.log(`✅ Thumbnail verified! Valid JPEG (${thumbBuf.length} bytes)`);

    console.log('\n======================================================');
    console.log('✨ ALL SMOKE TEST CHECKS PASSED SUCCESSFULLY! ✨');
    console.log('======================================================\n');
  } finally {
    if (fs.existsSync(tempVideoPath)) {
      try {
        fs.unlinkSync(tempVideoPath);
      } catch {
        // ignore
      }
    }
    if (workerContext) {
      await workerContext.close();
    }
    if (app) {
      await app.close();
    }
  }
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Smoke Test Failed:\n', err);
    process.exit(1);
  });
