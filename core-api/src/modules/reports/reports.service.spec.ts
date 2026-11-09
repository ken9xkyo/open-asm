import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { StorageService } from '@/modules/storage/storage.service';
import { Project } from '@/modules/projects/entities/project.entity';
import { Report } from './entities/report.entity';
import { renderReportPdf } from './renderer/pdf-renderer';
import { ReportsService } from './reports.service';
import { VulnerabilityReportService } from './services/vulnerability-report.service';
import { SummaryReportService } from './services/summary-report.service';

jest.mock('./renderer/pdf-renderer', () => ({
  renderReportPdf: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
}));

describe('ReportsService', () => {
  let service: ReportsService;
  let reportRepository: Repository<Report>;
  let storageService: StorageService;
  let projectFind: jest.Mock;
  let vulnReportData: jest.Mock;

  const mockReport = {
    id: '123e4567-e89b-12d3-a456-42614174000',
    userId: 'user-1',
    path: 'reports/test-report.pdf',
    fileName: 'test-report.pdf',
    workspace: { id: 'workspace-1' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    projectFind = jest.fn();
    vulnReportData = jest.fn().mockResolvedValue({ reportTitle: 'Vulns' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: getRepositoryToken(Report),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getCount: jest.fn(),
              getMany: jest.fn(),
            })),
          },
        },
        {
          provide: getRepositoryToken(Project),
          useValue: { find: projectFind },
        },
        {
          provide: StorageService,
          useValue: {
            uploadFile: jest.fn(),
            deleteFile: jest.fn(),
          },
        },
        {
          provide: VulnerabilityReportService,
          useValue: {
            getVulnerabilityReportData: vulnReportData,
          },
        },
        {
          provide: SummaryReportService,
          useValue: {
            getSummaryReportData: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    reportRepository = module.get<Repository<Report>>(
      getRepositoryToken(Report),
    );
    storageService = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('should return a report by id and workspace', async () => {
      jest
        .spyOn(reportRepository, 'findOne')
        .mockResolvedValue(mockReport as Report);

      const result = await service.findById('report-1', 'workspace-1');
      expect(result).toEqual(mockReport);
    });

    it('should throw NotFoundException if report not found', async () => {
      jest.spyOn(reportRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.findById('non-existent', 'workspace-1'),
      ).rejects.toThrow('Report not found');
    });
  });

  describe('deleteReport', () => {
    it('should delete a report and its file', async () => {
      jest
        .spyOn(reportRepository, 'findOne')
        .mockResolvedValue(mockReport as Report);
      jest
        .spyOn(reportRepository, 'remove')
        .mockResolvedValue(mockReport as Report);

      await expect(
        service.deleteReport('report-1', 'workspace-1'),
      ).resolves.not.toThrow();

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        'test-report.pdf',
        'reports',
      );
      expect(reportRepository.remove).toHaveBeenCalledWith(mockReport);
    });

    it('should still remove from DB even if file does not exist', async () => {
      jest
        .spyOn(reportRepository, 'findOne')
        .mockResolvedValue(mockReport as Report);
      jest.spyOn(storageService, 'deleteFile').mockImplementation(() => {
        throw new Error('ENOENT');
      });
      jest
        .spyOn(reportRepository, 'remove')
        .mockResolvedValue(mockReport as Report);

      await expect(
        service.deleteReport('report-1', 'workspace-1'),
      ).resolves.not.toThrow();

      expect(reportRepository.remove).toHaveBeenCalledWith(mockReport);
    });
  });

  describe('project scope', () => {
    const projectIds = ['p1', 'p2', 'p1'];

    it('passes the projects to the report data and names them on the cover', async () => {
      projectFind.mockResolvedValue([
        { id: 'p1', name: 'Alpha', archivedAt: null },
        { id: 'p2', name: 'Beta', archivedAt: null },
      ]);

      await service.previewVulnerabilityReport('workspace-1', { projectIds });

      expect(projectFind).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workspace: { id: 'workspace-1' } }),
        }),
      );
      expect(vulnReportData).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ projectIds }),
      );
      expect(renderReportPdf).toHaveBeenCalledWith(
        'VULNERABILITY',
        expect.objectContaining({ projectNames: ['Alpha', 'Beta'] }),
      );
    });

    it('rejects a project outside the workspace', async () => {
      projectFind.mockResolvedValue([{ id: 'p1', name: 'Alpha', archivedAt: null }]);

      await expect(
        service.previewVulnerabilityReport('workspace-1', { projectIds }),
      ).rejects.toThrow('One or more projects were not found');
      expect(vulnReportData).not.toHaveBeenCalled();
    });

    it('rejects an archived project', async () => {
      projectFind.mockResolvedValue([
        { id: 'p1', name: 'Alpha', archivedAt: null },
        { id: 'p2', name: 'Beta', archivedAt: new Date() },
      ]);

      await expect(
        service.previewVulnerabilityReport('workspace-1', { projectIds }),
      ).rejects.toThrow('Archived projects cannot be reported on');
    });

    it('skips the project lookup for a workspace-wide report', async () => {
      await service.previewVulnerabilityReport('workspace-1', {});

      expect(projectFind).not.toHaveBeenCalled();
      expect(renderReportPdf).toHaveBeenCalledWith(
        'VULNERABILITY',
        expect.objectContaining({ projectNames: undefined }),
      );
    });
  });
});
