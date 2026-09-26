import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Transport DTO for creating or updating one application setting.
 * The controller also validates it with the shared Zod schema so the API
 * and client use the same runtime contract.
 */
export class SetApplicationSettingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  key!: string;

  @IsString()
  @MaxLength(100_000)
  value!: string;

  @IsBoolean()
  @IsOptional()
  isEncrypted?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

