import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import {
  VideosService,
  CreateDraftResponse,
  GetPartUrlsResponse,
  ListUploadedPartsResponse,
} from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { GetPartUrlsDto } from './dto/get-part-urls.dto';
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
}

