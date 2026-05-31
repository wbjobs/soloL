import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsNotEmpty,
} from 'class-validator';

export class CreateProofreadBlockDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsNumber()
  index: number;

  @IsNumber()
  startTime: number;

  @IsNumber()
  endTime: number;

  @IsString()
  @IsNotEmpty()
  originalText: string;
}

export class UpdateProofreadBlockDto {
  @IsOptional()
  @IsString()
  correctedText?: string;

  @IsOptional()
  @IsEnum(['pending', 'in-progress', 'done'])
  status?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsNumber()
  startTime?: number;

  @IsOptional()
  @IsNumber()
  endTime?: number;
}

export class MoveTimelineDto {
  @IsNumber()
  startTime: number;

  @IsNumber()
  endTime: number;

  @IsOptional()
  @IsString()
  userId?: string;
}
