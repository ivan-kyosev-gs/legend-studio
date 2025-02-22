/**
 * Copyright (c) 2020-present, Goldman Sachs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { EditorStore } from '../EditorStore.js';
import type { EditorSDLCState } from '../EditorSDLCState.js';
import { action, flow, flowResult, makeObservable, observable } from 'mobx';
import {
  type GeneratorFn,
  type PlainObject,
  assertErrorThrown,
  LogEvent,
  getNullableFirstEntry,
} from '@finos/legend-shared';
import { generateSetupRoute } from '../../../__lib__/LegendStudioNavigation.js';
import {
  type NewVersionType,
  CreateVersionCommand,
  ReviewState,
  Revision,
  RevisionAlias,
  Version,
  Workspace,
  Review,
  areWorkspacesEquivalent,
} from '@finos/legend-server-sdlc';
import { LEGEND_STUDIO_APP_EVENT } from '../../../__lib__/LegendStudioEvent.js';
import { ProjectDependantEditorState } from './ProjectDependantEditorState.js';
import {
  StoreProjectData,
  ProjectVersionPlatformDependency,
} from '@finos/legend-server-depot';
import { compareSemVerVersions } from '@finos/legend-storage';

export enum PROJECT_OVERVIEW_ACTIVITY_MODE {
  RELEASE = 'RELEASE',
  OVERVIEW = 'OVERVIEW',
  DEPENDANTS = 'DEPENDANTS',
  VERSIONS = 'VERSIONS',
  WORKSPACES = 'WORKSPACES',
}

export class ProjectOverviewState {
  editorStore: EditorStore;
  sdlcState: EditorSDLCState;
  activityMode = PROJECT_OVERVIEW_ACTIVITY_MODE.OVERVIEW;
  releaseVersion: CreateVersionCommand;
  committedReviewsBetweenMostRecentVersionAndProjectLatest: Review[] = [];
  latestProjectVersion?: Version | null; // `undefined` if API is not yet called, `null` if fetched but no version exists
  currentProjectRevision?: Revision | undefined;
  projectWorkspaces: Workspace[] = [];
  projectDependantEditorState: ProjectDependantEditorState;

  isCreatingVersion = false;
  isFetchingProjectWorkspaces = false;
  isDeletingWorkspace = false;
  isUpdatingProject = false;
  isFetchingLatestVersion = false;
  isFetchingCurrentProjectRevision = false;

  constructor(editorStore: EditorStore, sdlcState: EditorSDLCState) {
    makeObservable(this, {
      activityMode: observable,
      releaseVersion: observable,
      committedReviewsBetweenMostRecentVersionAndProjectLatest: observable,
      latestProjectVersion: observable,
      currentProjectRevision: observable,
      projectWorkspaces: observable,
      isCreatingVersion: observable,
      isFetchingProjectWorkspaces: observable,
      isDeletingWorkspace: observable,
      isUpdatingProject: observable,
      isFetchingLatestVersion: observable,
      isFetchingCurrentProjectRevision: observable,
      projectDependantEditorState: observable,
      setActivityMode: action,
      fetchProjectWorkspaces: flow,
      deleteWorkspace: flow,
      updateProject: flow,
      fetchLatestProjectVersion: flow,
      fetchDependants: flow,
      createVersion: flow,
    });

    this.editorStore = editorStore;
    this.sdlcState = sdlcState;
    this.releaseVersion = new CreateVersionCommand();
    this.projectDependantEditorState = new ProjectDependantEditorState(
      this,
      this.editorStore,
    );
  }

  setActivityMode(activityMode: PROJECT_OVERVIEW_ACTIVITY_MODE): void {
    this.activityMode = activityMode;
  }

  *fetchProjectWorkspaces(): GeneratorFn<void> {
    try {
      this.isFetchingProjectWorkspaces = true;
      this.projectWorkspaces = (
        (yield this.editorStore.sdlcServerClient.getWorkspaces(
          this.sdlcState.activeProject.projectId,
        )) as PlainObject<Workspace>[]
      ).map((v) => Workspace.serialization.fromJson(v));
    } catch (error) {
      assertErrorThrown(error);
      this.editorStore.applicationStore.logService.error(
        LogEvent.create(LEGEND_STUDIO_APP_EVENT.SDLC_MANAGER_FAILURE),
        error,
      );
    } finally {
      this.isFetchingProjectWorkspaces = false;
    }
  }

  *deleteWorkspace(workspace: Workspace): GeneratorFn<void> {
    try {
      this.isDeletingWorkspace = true;
      yield this.editorStore.sdlcServerClient.deleteWorkspace(
        this.sdlcState.activeProject.projectId,
        workspace,
      );
      this.projectWorkspaces = this.projectWorkspaces.filter(
        (w) => !areWorkspacesEquivalent(workspace, w),
      );
      // redirect to home page if current workspace is deleted
      if (
        areWorkspacesEquivalent(
          this.editorStore.sdlcState.activeWorkspace,
          workspace,
        )
      ) {
        this.editorStore.applicationStore.notificationService.notifyWarning(
          'Current workspace is deleted. Redirecting to workspace setup',
        );
        this.editorStore.applicationStore.navigationService.navigator.goToLocation(
          generateSetupRoute(
            this.editorStore.sdlcState.activeProject.projectId,
          ),
          {
            ignoreBlocking: true,
          },
        );
      }
    } catch (error) {
      assertErrorThrown(error);
      this.editorStore.applicationStore.logService.error(
        LogEvent.create(LEGEND_STUDIO_APP_EVENT.SDLC_MANAGER_FAILURE),
        error,
      );
    } finally {
      this.isDeletingWorkspace = false;
    }
  }

  *updateProject(
    name: string,
    description: string,
    tags: string[],
  ): GeneratorFn<void> {
    try {
      this.isUpdatingProject = true;
      yield this.editorStore.sdlcServerClient.updateProject(
        this.sdlcState.activeProject.projectId,
        {
          name,
          description,
          tags,
        },
      );
      this.editorStore.applicationStore.notificationService.notifySuccess(
        `Project '${name}' is succesfully updated`,
      );
      yield flowResult(
        this.sdlcState.fetchCurrentProject(
          this.sdlcState.activeProject.projectId,
        ),
      );
    } catch (error) {
      assertErrorThrown(error);
      this.editorStore.applicationStore.notificationService.notifyError(error);
    } finally {
      this.isUpdatingProject = false;
    }
  }

  *fetchDependants(): GeneratorFn<void> {
    const groupId =
      this.editorStore.projectConfigurationEditorState
        .currentProjectConfiguration.groupId;
    const artifactId =
      this.editorStore.projectConfigurationEditorState
        .currentProjectConfiguration.artifactId;
    const latestVersion = this.editorStore.sdlcState.projectVersions[0]?.id.id;
    if (!groupId || !artifactId || !latestVersion) {
      return;
    }

    try {
      this.projectDependantEditorState.fetchingDependantInfoState.inProgress();

      const fetchedDependants = (
        (yield this.editorStore.depotServerClient.getIndexedDependantProjects(
          groupId,
          artifactId,
          latestVersion,
        )) as PlainObject<ProjectVersionPlatformDependency>[]
      )
        .map((v) => ProjectVersionPlatformDependency.serialization.fromJson(v))
        .sort(
          (
            a: { groupId: string; artifactId: string },
            b: { groupId: string; artifactId: string },
          ) => (a.groupId + a.artifactId > b.groupId + b.artifactId ? 1 : -1),
        )
        .sort((a: { versionId: string }, b: { versionId: string }) =>
          compareSemVerVersions(a.versionId, b.versionId) > 0 ? 1 : -1,
        )
        .filter(
          (filteredDependant: ProjectVersionPlatformDependency) =>
            filteredDependant.versionId !== 'master-SNAPSHOT',
        );

      const uniqueProjects = [
        ...new Map(
          fetchedDependants.map((item: ProjectVersionPlatformDependency) => [
            `${item.groupId}:${item.artifactId}`,
            item,
          ]),
        ).values(),
      ];

      this.projectDependantEditorState.setDependants(uniqueProjects);
      this.projectDependantEditorState.dependants?.map(
        async (dependant: ProjectVersionPlatformDependency): Promise<void> => {
          try {
            const project = StoreProjectData.serialization.fromJson(
              await this.editorStore.depotServerClient.getProject(
                dependant.groupId,
                dependant.artifactId,
              ),
            );
            dependant.projectId = project.projectId;
          } catch (error) {
            assertErrorThrown(error);
          }
        },
      );
      this.projectDependantEditorState.fetchingDependantInfoState.complete();
    } catch (error) {
      assertErrorThrown(error);
      this.projectDependantEditorState.fetchingDependantInfoState.fail();
      this.editorStore.applicationStore.logService.error(
        LogEvent.create(LEGEND_STUDIO_APP_EVENT.DEPOT_MANAGER_FAILURE),
        error,
      );
    }
  }

  *fetchLatestProjectVersion(): GeneratorFn<void> {
    try {
      this.isFetchingLatestVersion = true;
      // fetch latest version
      const version = (yield this.editorStore.sdlcServerClient.getLatestVersion(
        this.sdlcState.activeProject.projectId,
      )) as PlainObject<Version> | undefined;
      this.latestProjectVersion = version
        ? Version.serialization.fromJson(version)
        : null;
      // fetch current project revision and set release revision ID
      this.currentProjectRevision = Revision.serialization.fromJson(
        (yield this.editorStore.sdlcServerClient.getRevision(
          this.sdlcState.activeProject.projectId,
          undefined,
          RevisionAlias.CURRENT,
        )) as PlainObject<Revision>,
      );
      this.releaseVersion.setRevisionId(this.currentProjectRevision.id);

      // fetch committed reviews between most recent version and project latest
      if (this.latestProjectVersion) {
        const latestProjectVersionRevision = Revision.serialization.fromJson(
          (yield this.editorStore.sdlcServerClient.getRevision(
            this.sdlcState.activeProject.projectId,
            undefined,
            this.latestProjectVersion.revisionId,
          )) as PlainObject<Revision>,
        );
        // we find the review associated with the latest version revision, this usually exist, except in 2 cases:
        // 1. the revision is somehow directly added to the branch by the user (in the case of `git`, user directly pushed to unprotected default branch)
        // 2. the revision is the merged/comitted review revision (this usually happens for projects where fast forwarding merging is not default)
        // in those case, we will get the time from the revision
        const latestProjectVersionRevisionReviewObj = getNullableFirstEntry(
          (yield this.editorStore.sdlcServerClient.getReviews(
            this.sdlcState.activeProject.projectId,
            ReviewState.COMMITTED,
            [latestProjectVersionRevision.id],
            undefined,
            undefined,
            1,
          )) as PlainObject<Review>[],
        );
        const latestProjectVersionRevisionReview =
          latestProjectVersionRevisionReviewObj
            ? Review.serialization.fromJson(
                latestProjectVersionRevisionReviewObj,
              )
            : undefined;
        this.committedReviewsBetweenMostRecentVersionAndProjectLatest = (
          (yield this.editorStore.sdlcServerClient.getReviews(
            this.sdlcState.activeProject.projectId,
            ReviewState.COMMITTED,
            undefined,
            latestProjectVersionRevisionReview?.committedAt ??
              latestProjectVersionRevision.committedAt,
            undefined,
            undefined,
          )) as PlainObject<Review>[]
        )
          .map((v) => Review.serialization.fromJson(v))
          .filter(
            (review) =>
              !latestProjectVersionRevisionReview ||
              review.id !== latestProjectVersionRevisionReview.id,
          ); // make sure to exclude the base review
      } else {
        this.committedReviewsBetweenMostRecentVersionAndProjectLatest = (
          (yield this.editorStore.sdlcServerClient.getReviews(
            this.sdlcState.activeProject.projectId,
            ReviewState.COMMITTED,
            undefined,
            undefined,
            undefined,
            undefined,
          )) as PlainObject<Review>[]
        ).map((v) => Review.serialization.fromJson(v));
      }
    } catch (error) {
      assertErrorThrown(error);
      this.editorStore.applicationStore.logService.error(
        LogEvent.create(LEGEND_STUDIO_APP_EVENT.SDLC_MANAGER_FAILURE),
        error,
      );
    } finally {
      this.isFetchingLatestVersion = false;
    }
  }

  *createVersion(versionType: NewVersionType): GeneratorFn<void> {
    if (!this.editorStore.sdlcServerClient.features.canCreateVersion) {
      this.editorStore.applicationStore.notificationService.notifyError(
        `Can't create version: not supported by SDLC server`,
      );
      return;
    }
    this.isCreatingVersion = true;
    try {
      this.releaseVersion.versionType = versionType;
      this.releaseVersion.validate();
      this.latestProjectVersion = Version.serialization.fromJson(
        (yield this.editorStore.sdlcServerClient.createVersion(
          this.sdlcState.activeProject.projectId,
          CreateVersionCommand.serialization.toJson(this.releaseVersion),
        )) as PlainObject<Version>,
      );
      yield flowResult(this.fetchLatestProjectVersion());
    } catch (error) {
      assertErrorThrown(error);
      this.editorStore.applicationStore.logService.error(
        LogEvent.create(LEGEND_STUDIO_APP_EVENT.SDLC_MANAGER_FAILURE),
        error,
      );
      this.editorStore.applicationStore.notificationService.notifyError(error);
    } finally {
      this.isCreatingVersion = false;
    }
  }
}
