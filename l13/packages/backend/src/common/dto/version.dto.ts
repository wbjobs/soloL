import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateVersionDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class GetVersionDiffDto {
  @IsNumber()
  fromVersion: number;

  @IsNumber()
  toVersion: number;
}
