import { GetManyBaseQueryParams } from '@/common/dtos/get-many-base.dto';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/** A query string carries a single value as a plain string. */
const toArray = ({ value }: { value: unknown }): unknown[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/** Optional project scope shared by every generate/preview request. */
const ProjectIdsProperty = () =>
  applyDecorators(
    ApiProperty({
      required: false,
      type: [String],
      description:
        'Limit the report to the assets of these projects (active projects of the workspace)',
    }),
    IsOptional(),
    Transform(toArray),
    IsArray(),
    ArrayMaxSize(50),
    IsUUID(undefined, { each: true }),
  );

const ReportType = {
  SUMMARY: 'SUMMARY',
  VULNERABILITY: 'VULNERABILITY',
} as const;
export type ReportType = (typeof ReportType)[keyof typeof ReportType];

export class ReportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  path: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty({ enum: ['SUMMARY', 'VULNERABILITY'] })
  type: ReportType;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    description:
      'Presigned S3 download URL (hour-bucketed signature, default 2 days)',
  })
  downloadUrl: string;

  @ApiProperty({
    example: 172800,
    description: 'Presigned URL lifetime in seconds',
  })
  downloadExpiresIn: number;
}

export class GenerateSummaryReportBodyDto {
  @ApiProperty({
    required: false,
    description: 'Start date for summary report filter',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({
    required: false,
    description: 'End date for summary report filter',
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({
    required: false,
    description: 'Target IDs to filter summary data',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetIds?: string[];

  @ProjectIdsProperty()
  projectIds?: string[];
}

export class GenerateVulReportBodyDto {
  @ApiProperty({
    required: false,
    description: 'Start date for vulnerability report filter',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({
    required: false,
    description: 'End date for vulnerability report filter',
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({
    required: false,
    description: 'Target IDs to filter vulnerabilities',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetIds?: string[];

  @ProjectIdsProperty()
  projectIds?: string[];

  @ApiProperty({
    required: false,
    description: 'Vulnerability IDs to include in report',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vulnIds?: string[];

  @ApiProperty({
    required: false,
    description: 'Minimum severity level (CRITICAL, HIGH, MEDIUM, LOW, INFO)',
    enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
  })
  @IsOptional()
  @IsEnum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
  minSeverity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
}

export class PreviewSummaryQueryDto {
  @ApiProperty({ required: false, description: 'Start date for filter' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({ required: false, description: 'End date for filter' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({ required: false, description: 'Target IDs to filter', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetIds?: string[];

  @ProjectIdsProperty()
  projectIds?: string[];
}

export class PreviewVulQueryDto {
  @ApiProperty({ required: false, description: 'Start date for filter' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({ required: false, description: 'End date for filter' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({ required: false, description: 'Target IDs to filter', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetIds?: string[];

  @ProjectIdsProperty()
  projectIds?: string[];

  @ApiProperty({ required: false, description: 'Vulnerability IDs to include', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vulnIds?: string[];

  @ApiProperty({ required: false, description: 'Minimum severity level', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] })
  @IsOptional()
  @IsEnum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
  minSeverity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
}

export class GetManyReportsQueryDto extends GetManyBaseQueryParams {
  @ApiProperty({
    required: false,
    enum: ['SUMMARY', 'VULNERABILITY'],
    description: 'Filter by report type',
  })
  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType;
}
