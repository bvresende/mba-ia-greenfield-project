import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from '../enums/video-status.enum';

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_videos_slug', { unique: true })
  @Column({ type: 'varchar', length: 11, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value),
    },
  })
  file_size_bytes: number;

  @Column({ type: 'varchar', length: 100 })
  mime_type: string;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ type: 'integer', nullable: true })
  bitrate: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  codec: string | null;

  @Index('IDX_videos_status')
  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'video_status_enum',
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'text', nullable: true })
  processing_error: string | null;

  @Column({ type: 'varchar', length: 500 })
  storage_key: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  upload_id: string | null;

  @Index('IDX_videos_channel_id')
  @Column({ type: 'uuid' })
  channel_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
