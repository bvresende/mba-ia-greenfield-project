import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';

export interface PresignedGetUrlOptions {
  disposition?: 'inline' | 'attachment';
  filename?: string;
  expiresInSeconds?: number;
}

export interface UploadedPartItem {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly internalClient: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = this.config.bucketVideos;

    this.internalClient = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      forcePathStyle: this.config.forcePathStyle,
    });

    this.presignClient = new S3Client({
      endpoint: this.config.publicEndpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      forcePathStyle: this.config.forcePathStyle,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucketExists();
    } catch (error) {
      this.logger.warn(
        `Could not ensure bucket on startup: ${(error as Error).message}`,
      );
    }
  }

  async ensureBucketExists(bucketName?: string): Promise<void> {
    const bucket = bucketName || this.bucket;
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      const isNotFound =
        err?.$metadata?.httpStatusCode === 404 ||
        err?.name === 'NotFound' ||
        err?.name === 'NoSuchBucket';
      if (isNotFound) {
        this.logger.log(`Bucket "${bucket}" not found. Creating it now...`);
        await this.internalClient.send(
          new CreateBucketCommand({ Bucket: bucket }),
        );
        this.logger.log(`Bucket "${bucket}" created successfully.`);
      } else {
        throw err;
      }
    }
  }

  async createMultipartUpload(key: string, mimeType: string): Promise<string> {
    const res = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      }),
    );

    if (!res.UploadId) {
      throw new Error(`Failed to create multipart upload for key ${key}`);
    }

    return res.UploadId;
  }

  async getPresignedPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds = 3600,
    useInternalClient = false,
  ): Promise<string> {
    const client = useInternalClient ? this.internalClient : this.presignClient;
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPartItem[]> {
    const res = await this.internalClient.send(
      new ListPartsCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );

    return (res.Parts || []).map((part) => ({
      partNumber: part.PartNumber ?? 0,
      etag: (part.ETag || '').replace(/"/g, ''),
      sizeBytes: part.Size ?? 0,
    }));
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ part_number: number; etag: string }>,
  ): Promise<void> {
    const completedParts: CompletedPart[] = parts.map((part) => ({
      PartNumber: part.part_number,
      ETag: part.etag.startsWith('"') ? part.etag : `"${part.etag}"`,
    }));

    await this.internalClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: completedParts,
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.internalClient.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async getPresignedGetUrl(
    key: string,
    options: PresignedGetUrlOptions = {},
    useInternalClient = false,
  ): Promise<string> {
    const {
      disposition = 'inline',
      filename,
      expiresInSeconds = 7200,
    } = options;
    const client = useInternalClient ? this.internalClient : this.presignClient;

    const contentDisposition =
      disposition === 'attachment'
        ? `attachment; filename="${encodeURIComponent(filename || 'video.mp4')}"`
        : 'inline';

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition,
    });

    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  getBucketName(): string {
    return this.bucket;
  }
}
