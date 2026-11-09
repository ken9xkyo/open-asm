import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GenerateSummaryReportBodyDto, PreviewVulQueryDto } from './reports.dto';

const uuid = '3835f4fc-195a-489f-a589-0e9eabcd450d';

describe('report projectIds', () => {
  it('accepts a single query value as a one-item list', async () => {
    const dto = plainToInstance(PreviewVulQueryDto, { projectIds: uuid });

    expect(dto.projectIds).toEqual([uuid]);
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects ids that are not UUIDs', async () => {
    const dto = plainToInstance(GenerateSummaryReportBodyDto, {
      projectIds: [uuid, 'not-a-uuid'],
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['projectIds']);
  });

  it('is optional', async () => {
    const dto = plainToInstance(GenerateSummaryReportBodyDto, {});

    expect(await validate(dto)).toEqual([]);
  });
});
