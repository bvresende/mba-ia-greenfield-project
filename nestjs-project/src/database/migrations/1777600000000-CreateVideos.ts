import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1777600000000 implements MigrationInterface {
  name = 'CreateVideos1777600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."video_status_enum" AS ENUM('DRAFT', 'PROCESSING', 'READY', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying(11) NOT NULL,
        "title" character varying(100) NOT NULL,
        "description" text,
        "original_filename" character varying(255) NOT NULL,
        "file_size_bytes" bigint NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "duration_seconds" integer,
        "width" integer,
        "height" integer,
        "bitrate" integer,
        "codec" character varying(50),
        "status" "public"."video_status_enum" NOT NULL DEFAULT 'DRAFT',
        "processing_error" text,
        "storage_key" character varying(500) NOT NULL,
        "thumbnail_key" character varying(500),
        "upload_id" character varying(255),
        "channel_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_videos_slug" UNIQUE ("slug"),
        CONSTRAINT "PK_videos_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_videos_slug" ON "videos" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status" ON "videos" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_slug"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."video_status_enum"`);
  }
}
