import { Test, TestingModule } from '@nestjs/testing';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [StorageModule],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should compile and provide StorageService', () => {
    const service = module.get<StorageService>(StorageService);
    expect(service).toBeDefined();
  });
});
