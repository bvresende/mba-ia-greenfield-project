import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { VideosService, CreateDraftResponse } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
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
}
