import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateVideoDto } from './create-video.dto';

describe('CreateVideoDto', () => {
  const validData = {
    title: 'Valid Video Title',
    description: 'A valid description',
    original_filename: 'sample.mp4',
    file_size_bytes: 1048576,
    mime_type: 'video/mp4',
  };

  it('should pass validation with valid data', async () => {
    const dto = plainToInstance(CreateVideoDto, validData);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass validation without optional description', async () => {
    const { description, ...rest } = validData;
    const dto = plainToInstance(CreateVideoDto, rest);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when title is empty or exceeds 100 chars', async () => {
    const emptyTitleDto = plainToInstance(CreateVideoDto, {
      ...validData,
      title: '',
    });
    const emptyErrors = await validate(emptyTitleDto);
    expect(emptyErrors.length).toBeGreaterThan(0);

    const longTitleDto = plainToInstance(CreateVideoDto, {
      ...validData,
      title: 'a'.repeat(101),
    });
    const longErrors = await validate(longTitleDto);
    expect(longErrors.length).toBeGreaterThan(0);
  });

  it('should fail when file_size_bytes is less than 1 or exceeds 10GB', async () => {
    const zeroSizeDto = plainToInstance(CreateVideoDto, {
      ...validData,
      file_size_bytes: 0,
    });
    const zeroErrors = await validate(zeroSizeDto);
    expect(zeroErrors.length).toBeGreaterThan(0);

    const overSizeDto = plainToInstance(CreateVideoDto, {
      ...validData,
      file_size_bytes: 10737418241, // 10GB + 1 byte
    });
    const overErrors = await validate(overSizeDto);
    expect(overErrors.length).toBeGreaterThan(0);
  });

  it('should fail when mime_type is not supported', async () => {
    const invalidMimeDto = plainToInstance(CreateVideoDto, {
      ...validData,
      mime_type: 'image/png',
    });
    const errors = await validate(invalidMimeDto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
