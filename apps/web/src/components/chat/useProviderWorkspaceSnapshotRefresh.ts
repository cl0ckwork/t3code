import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  createProviderWorkspaceSnapshotRefreshAtomFamily,
  isProviderWorkspaceSnapshotScanning,
  type ProviderWorkspaceSnapshotRefreshState,
} from "@t3tools/client-runtime/providerSkills";
import { Atom } from "effect/reactivity";

import { serverEnvironment } from "../../state/server";

const providerWorkspaceSnapshotRefresh = createProviderWorkspaceSnapshotRefreshAtomFamily({
  providers: serverEnvironment.providersValueAtom,
  refreshProviders: serverEnvironment.refreshProviders,
});

const idleRefreshAtom: Atom.Atom<ProviderWorkspaceSnapshotRefreshState | undefined> = Atom.make<
  ProviderWorkspaceSnapshotRefreshState | undefined
>(undefined).pipe(Atom.withLabel("provider-workspace-snapshot-refresh:idle"));

/**
 * Keeps the selected provider's workspace snapshot fresh for the composer's
 * project or thread worktree while mounted. Returns a check to run when the user types,
 * and whether the workspace's skills are still being scanned.
 */
export function useProviderWorkspaceSnapshotRefresh(input: {
  readonly environmentId: EnvironmentId;
  readonly gitCwd: string | null;
  readonly workspaceProjectId: ProjectId | null;
  readonly activeThreadId: ThreadId | null;
  readonly instanceId: ProviderInstanceId | undefined;
}): { readonly refresh: () => void; readonly scanning: boolean } {
  const { environmentId, gitCwd, workspaceProjectId, activeThreadId, instanceId } = input;
  const atom =
    gitCwd && workspaceProjectId && instanceId
      ? providerWorkspaceSnapshotRefresh({
          environmentId,
          instanceId,
          cwd: gitCwd,
          projectId: workspaceProjectId,
          threadId: activeThreadId,
        })
      : idleRefreshAtom;
  return {
    refresh: useAtomRefresh(atom),
    scanning: isProviderWorkspaceSnapshotScanning(useAtomValue(atom)),
  };
}
