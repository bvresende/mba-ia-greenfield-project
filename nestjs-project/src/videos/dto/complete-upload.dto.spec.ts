import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CompleteUploadDto } from './complete-upload.dto';

describe('CompleteUploadDto', () => {
  it('should pass validation with properly ordered parts', async () => {
    const dto = plainToInstance(CompleteUploadDto, {
      parts: [
        { part_number: 1, etag: 'etag1' },
        { part_number: 2, etag: 'etag2' },
        { part_number: 5, etag: 'etag5' },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when parts array is empty', async () => {
    const dto = plainToInstance(CompleteUploadDto, {
      parts: [],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when parts are not in strictly ascending order', async () => {
    const dto = plainToInstance(CompleteUploadDto, {
      parts: [
        { part_number: 2, etag: 'etag2' },
        { part_number: 1, etag: 'etag1' },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when parts have duplicate part_number', async () => {
    const dto = plainToInstance(CompleteUploadDto, {
      parts: [
        { part_number: 1, etag: 'etag1' },
        { part_number: 1, etag: 'etag1-dup' },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when part_number is <= 0 or etag is empty', async () => {
    const dto = plainToInstance(CompleteUploadDto, {
      parts: [{ part_number: 0, etag: 'etag0' }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);

    const emptyEtagDto = plainToInstance(CompleteUploadDto, {
      parts: [{ part_number: 1, etag: '' }],
    });
    const emptyEtagErrors = await validate(emptyEtagDto);
    expect(emptyEtagErrors.length).toBeGreaterThan(0);
  });
});
