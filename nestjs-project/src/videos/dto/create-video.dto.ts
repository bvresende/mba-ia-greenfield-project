import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

export class CreateVideoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  original_filename: string;

  @IsInt()
  @Min(1)
  @Max(10737418240) // 10 GB
  file_size_bytes: number;

  @IsString()
  @IsIn(ALLOWED_MIME_TYPES, {
    message: 'mime_type must be one of: video/mp4, video/webm, video/quicktime',
  })
  mime_type: string;
}
