import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GetPartUrlsDto } from './get-part-urls.dto';

describe('GetPartUrlsDto', () => {
  it('should pass validation with valid part numbers', async () => {
    const dto = plainToInstance(GetPartUrlsDto, {
      part_numbers: [1, 2, 3],
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when part_numbers is empty', async () => {
    const dto = plainToInstance(GetPartUrlsDto, {
      part_numbers: [],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when part_numbers exceeds 100 elements', async () => {
    const numbers = Array.from({ length: 101 }, (_, i) => i + 1);
    const dto = plainToInstance(GetPartUrlsDto, {
      part_numbers: numbers,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when any part_number is less than 1 or greater than 10000', async () => {
    const zeroDto = plainToInstance(GetPartUrlsDto, {
      part_numbers: [0],
    });
    const zeroErrors = await validate(zeroDto);
    expect(zeroErrors.length).toBeGreaterThan(0);

    const overDto = plainToInstance(GetPartUrlsDto, {
      part_numbers: [10001],
    });
    const overErrors = await validate(overDto);
    expect(overErrors.length).toBeGreaterThan(0);
  });

  it('should fail when part_numbers contains non-integers', async () => {
    const dto = plainToInstance(GetPartUrlsDto, {
      part_numbers: [1.5],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
