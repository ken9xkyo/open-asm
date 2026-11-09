import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '@/test/utils';
import Reports from '@/pages/reports/reports';

const { projectsParamsMock, vulnMutateMock, summaryMutateMock } = vi.hoisted(
  () => ({
    projectsParamsMock: vi.fn(),
    vulnMutateMock: vi.fn(),
    summaryMutateMock: vi.fn(),
  }),
);

vi.mock('@/hooks/useWorkspaceSelector', () => ({
  useWorkspaceSelector: () => ({
    workspaces: [{ id: 'ws-1', name: 'Workspace' }],
    selectedWorkspace: 'ws-1',
    isLoading: false,
  }),
  useWorkspaceState: () => ({
    state: { selectedWorkspaceId: 'ws-1' },
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    permissions: ['*'],
    isOwner: true,
    hasPermission: () => true,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/services/apis/gen/queries', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/services/apis/gen/queries')
  >();
  return {
    ...actual,
    useReportsControllerGetMany: () => ({
      data: { data: [], total: 0 },
      isLoading: false,
      refetch: vi.fn(),
    }),
    useProjectsControllerGetMany: (params: unknown) => {
      projectsParamsMock(params);
      return {
        data: {
          data: [
            { id: 'p-1', name: 'Alpha' },
            { id: 'p-2', name: 'Beta' },
          ],
        },
      };
    },
    useReportsControllerGenerateVulReport: () => ({
      mutate: vulnMutateMock,
      isPending: false,
    }),
    useReportsControllerGenerateSummaryReport: () => ({
      mutate: summaryMutateMock,
      isPending: false,
    }),
    useReportsControllerDeleteReport: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

const openDialog = async (template: string) => {
  renderWithProviders(<Reports />, {
    routePath: '/reports',
    initialEntries: ['/reports?tab=templates'],
  });
  await userEvent.click(await screen.findByRole('button', { name: template }));
};

// jsdom has no ResizeObserver; the project picker's popover measures itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  projectsParamsMock.mockReset();
  vulnMutateMock.mockReset();
  summaryMutateMock.mockReset();
});

describe('Reports generate dialog', () => {
  it('offers only active projects and sends the selected ones', async () => {
    await openDialog('Vulnerability Report');

    expect(projectsParamsMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );

    await userEvent.click(
      screen.getByRole('combobox', { name: 'All projects (whole workspace)' }),
    );
    await userEvent.click(await screen.findByRole('option', { name: 'Alpha' }));
    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(vulnMutateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectIds: ['p-1', 'p-2'] }),
    });
  });

  it('leaves projectIds out for a workspace-wide report', async () => {
    await openDialog('Summary Report');

    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(summaryMutateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectIds: undefined }),
    });
  });
});
