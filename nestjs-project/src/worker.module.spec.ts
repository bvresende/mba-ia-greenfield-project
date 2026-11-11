import { Test } from '@nestjs/testing';
import { WorkerModule } from './worker.module';
import { VideoProcessor } from './videos/processors/video.processor';

describe('WorkerModule', () => {
  it('should compile successfully and provide VideoProcessor', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module).toBeDefined();
    const processor = module.get<VideoProcessor>(VideoProcessor);
    expect(processor).toBeDefined();
    await module.close();
  }, 30000);
});
