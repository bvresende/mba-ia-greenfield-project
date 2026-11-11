import 'reflect-metadata';
import {
  registerDecorator,
  ValidationOptions,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsInt,
  Min,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UploadPartDto {
  @IsInt()
  @Min(1)
  part_number: number;

  @IsString()
  @IsNotEmpty()
  etag: string;
}

export function IsAscendingParts(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAscendingParts',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (!Array.isArray(value)) return false;
          for (let i = 0; i < value.length - 1; i++) {
            if (
              typeof value[i]?.part_number !== 'number' ||
              typeof value[i + 1]?.part_number !== 'number' ||
              value[i].part_number >= value[i + 1].part_number
            ) {
              return false;
            }
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be ordered strictly ascending by part_number`;
        },
      },
    });
  };
}

export class CompleteUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UploadPartDto)
  @IsAscendingParts({
    message:
      'parts must be ordered by part_number ascending without duplicates',
  })
  parts: UploadPartDto[];
}
