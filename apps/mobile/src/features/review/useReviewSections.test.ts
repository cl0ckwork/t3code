import { AuthFilesystemReadScope, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const sessionAtom = vi.hoisted(() => ({}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (atom === "turn-diffs" ? {} : []),
}));
vi.mock("@t3tools/client-runtime/state/thread-checkpoints", () => ({
  deriveThreadCheckpointSummaries: () => [],
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => sessionAtom },
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: "connected", error: null } },
  }),
}));
vi.mock("../../state/use-thread-detail", () => ({
  useSelectedThreadProjection: () => ({ projection: {} }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data: atom === sessionAtom ? { authenticated: true, scopes: [AuthFilesystemReadScope] } : null,
    error: null,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/queries", () => ({
  useCheckpointDiff: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));
vi.mock("../../state/review", () => ({
  lastReviewGitSectionsAtom: () => "git-sections",
  reviewEnvironment: { diffPreview: vi.fn() },
}));
vi.mock("../../state/reviewTurnDiffs", () => ({
  lastReviewTurnDiffsAtom: () => "turn-diffs",
}));
vi.mock("./reviewState", () => ({ setReviewSelectedSectionId: vi.fn() }));

import { reviewEnvironment } from "../../state/review";
import { useReviewSections } from "./useReviewSections";

it("does not request live workspace diffs from a host without thread-scoped review support", () => {
  const result = useReviewSections({
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    supportsThreadScopedReviewDiffs: false,
    threadScopedReviewDiffsUnavailable: true,
    reviewCache: {
      threadKey: "environment:thread",
      selectedSectionId: null,
      expandedFileIdsBySection: {},
      revealedLargeFileIdsBySection: {},
      viewedFileIdsBySection: {},
    },
  });

  expect(reviewEnvironment.diffPreview).not.toHaveBeenCalled();
  expect(result.error).toBe("Update this host to view live workspace diffs.");
});
