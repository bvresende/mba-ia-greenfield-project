import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import {
  VideosService,
  CreateDraftResponse,
  GetPartUrlsResponse,
  ListUploadedPartsResponse,
  CompleteUploadResponse,
  VideoMetadataResponse,
} from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { GetPartUrlsDto } from './dto/get-part-urls.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Pre-register a video and initiate multipart upload',
    description:
      'Creates a new video record in DRAFT status and initiates a multipart upload in Object Storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Video pre-registered successfully',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string', example: 'aB3_dE7-gH1' },
        title: { type: 'string' },
        status: { type: 'string', example: 'DRAFT' },
        upload_id: { type: 'string' },
        part_size_bytes: { type: 'number', example: 67108864 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or file size too large',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User must have a channel to upload videos',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async createDraft(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<CreateDraftResponse> {
    return this.videosService.createDraft(user.sub, dto);
  }

  @Post(':slug/upload/part-urls')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Generate presigned URLs for multipart upload chunks',
    description:
      'Returns presigned PUT URLs for each requested part number for direct client-to-storage upload.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URLs generated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid part numbers array',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in DRAFT status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: GetPartUrlsDto,
  ): Promise<GetPartUrlsResponse> {
    return this.videosService.getPartUrls(user.sub, slug, dto);
  }

  @Get(':slug/upload/parts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List already uploaded parts for multipart upload',
    description:
      'Queries Object Storage for parts received so far in this multipart session.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of uploaded parts',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in DRAFT status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
  ): Promise<ListUploadedPartsResponse> {
    return this.videosService.listUploadedParts(user.sub, slug);
  }

  @Post(':slug/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete multipart upload and enqueue video processing',
    description:
      'Finalizes S3 multipart upload with the provided parts, updates video status to PROCESSING, and enqueues background processing job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed and processing enqueued',
    schema: {
      properties: {
        slug: { type: 'string' },
        status: { type: 'string', example: 'PROCESSING' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Upload incomplete or parts invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in DRAFT status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponse> {
    return this.videosService.completeUpload(user.sub, slug, dto);
  }

  @Get(':slug/stream')
  @Public()
  @ApiOperation({
    summary: 'Stream video via 302 Found redirect to presigned storage URL',
    description:
      'Redirects to a short-lived presigned URL with inline disposition, allowing Range requests for streaming.',
  })
  @ApiResponse({
    status: 302,
    description: 'Found: redirect to presigned stream URL',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not in streamable status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('slug') slug: string,
    @CurrentUser() user: JwtPayload | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.getStreamUrl(slug, user?.sub);
    res.redirect(HttpStatus.FOUND, url);
  }

  @Get(':slug/download')
  @Public()
  @ApiOperation({
    summary: 'Download video via 302 Found redirect to presigned storage URL',
    description:
      'Redirects to a presigned URL with attachment disposition and video title as filename.',
  })
  @ApiResponse({
    status: 302,
    description: 'Found: redirect to presigned download URL',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not in READY status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.getDownloadUrl(slug);
    res.redirect(HttpStatus.FOUND, url);
  }

  @Get(':slug/thumbnail')
  @Public()
  @ApiOperation({
    summary: 'Get video thumbnail via 302 Found redirect',
    description:
      'Redirects to presigned or public URL of the generated video thumbnail image.',
  })
  @ApiResponse({
    status: 302,
    description: 'Found: redirect to thumbnail image',
  })
  @ApiResponse({
    status: 404,
    description: 'Thumbnail not found or video not in READY status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async thumbnail(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.getThumbnailUrl(slug);
    res.redirect(HttpStatus.FOUND, url);
  }

  @Get(':slug')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get video metadata and status',
    description:
      'Returns technical and descriptive metadata for the specified video. Restricted to channel owner.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getMetadata(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
  ): Promise<VideoMetadataResponse> {
    return this.videosService.getMetadata(user.sub, slug);
  }
}
