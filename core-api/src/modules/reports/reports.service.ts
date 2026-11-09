import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { generateToken } from '@/utils/genToken';
import { getManyResponse } from '@/utils/getManyResponse';
import { StorageService } from '@/modules/storage/storage.service';
import { Project } from '@/modules/projects/entities/project.entity';
import type {
  MinSeverity,
  VulnerabilityFilterOptions,
} from '@/modules/statistic/vulnerability-filter';
import { GetManyReportsQueryDto } from './dto/reports.dto';
import { Report } from './entities/report.entity';
import type { ReportData } from './types/report-data.type';
import type { VulnerabilityReportData } from './types/vulnerability-report-data.type';
import { VulnerabilityReportService } from './services/vulnerability-report.service';
import { SummaryReportService } from './services/summary-report.service';
import { renderReportPdf } from './renderer/pdf-renderer';

@Injectable()
export class ReportsService {
  private readonly logoPath: string;
  private logoBase64: string | null = null;

  constructor(
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly storageService: StorageService,
    private readonly vulnerabilityReportService: VulnerabilityReportService,
    private readonly summaryReportService: SummaryReportService,
  ) {
    this.logoPath = path.join(process.cwd(), 'public', 'images', 'logo.png');
    this.loadLogo();
  }

  async findById(id: string, workspaceId: string): Promise<Report> {
    const report = await this.reportRepo.findOne({
      where: { id, workspace: { id: workspaceId } },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  async getMany(query: GetManyReportsQueryDto, workspaceId: string) {
    const { limit, page, sortBy, sortOrder, search, type } = query;
    const offset = (page - 1) * limit;

    const qb = this.reportRepo
      .createQueryBuilder('report')
      .where('report.workspaceId = :workspaceId', { workspaceId });

    if (search) {
      qb.andWhere('report.fileName ILIKE :search', {
        search: `%${search}%`,
      });
    }

    if (type) {
      qb.andWhere('report.type = :type', { type });
    }

    const allowedSortColumns = [
      'id',
      'createdAt',
      'updatedAt',
      'fileName',
      'userId',
    ];
    const sortColumn = allowedSortColumns.includes(sortBy)
      ? `report.${sortBy}`
      : 'report.createdAt';
    qb.orderBy(sortColumn, sortOrder);

    const total = await qb.getCount();
    const reports = await qb.limit(limit).offset(offset).getMany();

    const data = await Promise.all(
      reports.map(async (report) => {
        const idx = report.path.indexOf('/');
        const bucket = report.path.slice(0, idx);
        const filePath = report.path.slice(idx + 1);
        const { url: downloadUrl, expiresIn } =
          await this.storageService.getPresignedDownloadUrl({
            bucket,
            key: filePath,
            fileName: report.fileName,
            contentType: 'application/pdf',
          });
        return { ...report, downloadUrl, downloadExpiresIn: expiresIn };
      }),
    );

    return getManyResponse({ query, data, total });
  }

  private loadLogo(): void {
    try {
      if (fs.existsSync(this.logoPath)) {
        const logoBuffer = fs.readFileSync(this.logoPath);
        this.logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
      }
    } catch {
      // ignore — logo is optional
    }
  }

  async generateReport(
    workspaceId: string,
    userId: string,
    type: 'SUMMARY' | 'VULNERABILITY' = 'SUMMARY',
    options?: VulnerabilityFilterOptions,
  ): Promise<{ filePath: string; fileName: string }> {
    const pdfBuffer = await this.renderReport(workspaceId, type, options);

    const fileName = `report-${type.toLowerCase()}-${generateToken(24)}-${Date.now()}.pdf`;
    const { path: uploadPath } = await this.storageService.uploadFile(
      fileName,
      pdfBuffer,
      'reports',
    );

    await this.reportRepo.save({
      workspace: { id: workspaceId },
      user: { id: userId },
      type,
      path: uploadPath,
      fileName,
    });

    return { filePath: uploadPath, fileName };
  }

  async previewSummaryReport(
    workspaceId: string,
    options?: {
      startDate?: string;
      endDate?: string;
      targetIds?: string[];
      projectIds?: string[];
    },
  ): Promise<Buffer> {
    return this.renderReport(workspaceId, 'SUMMARY', {
      startDate: options?.startDate ? new Date(options.startDate) : undefined,
      endDate: options?.endDate ? new Date(options.endDate) : undefined,
      targetIds: options?.targetIds,
      projectIds: options?.projectIds,
    });
  }

  async previewVulnerabilityReport(
    workspaceId: string,
    options?: {
      startDate?: string;
      endDate?: string;
      targetIds?: string[];
      projectIds?: string[];
      vulnIds?: string[];
      minSeverity?: MinSeverity;
    },
  ): Promise<Buffer> {
    return this.renderReport(workspaceId, 'VULNERABILITY', {
      startDate: options?.startDate ? new Date(options.startDate) : undefined,
      endDate: options?.endDate ? new Date(options.endDate) : undefined,
      targetIds: options?.targetIds,
      projectIds: options?.projectIds,
      vulnIds: options?.vulnIds,
      minSeverity: options?.minSeverity,
    });
  }

  private async renderReport(
    workspaceId: string,
    type: 'SUMMARY' | 'VULNERABILITY',
    options?: VulnerabilityFilterOptions,
  ): Promise<Buffer> {
    const projectNames = await this.resolveProjectNames(
      workspaceId,
      options?.projectIds,
    );

    const data: ReportData | VulnerabilityReportData =
      type === 'VULNERABILITY'
        ? await this.vulnerabilityReportService.getVulnerabilityReportData(
            workspaceId,
            options,
          )
        : await this.summaryReportService.getSummaryReportData(
            workspaceId,
            options,
          );

    return renderReportPdf(type, {
      ...data,
      logoBase64: this.logoBase64 ?? data.logoBase64,
      projectNames,
    });
  }

  /**
   * Names of the projects a report is scoped to, for its cover. Each id must
   * be an active project of the workspace: an unknown id would otherwise
   * yield a silently empty report, and an archived project is read-only.
   */
  private async resolveProjectNames(
    workspaceId: string,
    projectIds?: string[],
  ): Promise<string[] | undefined> {
    if (!projectIds?.length) return undefined;
    const ids = [...new Set(projectIds)];
    const projects = await this.projectRepo.find({
      where: { id: In(ids), workspace: { id: workspaceId } },
      order: { name: 'ASC' },
    });
    if (projects.length !== ids.length) {
      throw new NotFoundException('One or more projects were not found');
    }
    if (projects.some((project) => project.archivedAt)) {
      throw new BadRequestException(
        'Archived projects cannot be reported on; reopen them first',
      );
    }
    return projects.map((project) => project.name);
  }

  async deleteReport(id: string, workspaceId: string): Promise<void> {
    const report = await this.findById(id, workspaceId);

    try {
      const idx = report.path.indexOf('/');
      const bucket = report.path.slice(0, idx);
      const filePath = report.path.slice(idx + 1);
      await this.storageService.deleteFile(filePath, bucket);
    } catch {
      // File may not exist, ignore
    }

    await this.reportRepo.remove(report);
  }
}
