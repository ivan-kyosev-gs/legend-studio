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

import { observable, computed, action, makeObservable, flow } from 'mobx';
import {
  type GeneratorFn,
  type PlainObject,
  assertErrorThrown,
  guaranteeType,
  ActionState,
} from '@finos/legend-shared';
import type { EditorStore } from '../../../EditorStore.js';
import {
  type ServiceExecutionState,
  UnsupportedServiceExecutionState,
  SingleServicePureExecutionState,
  MultiServicePureExecutionState,
  InlineServicePureExecutionState,
} from './ServiceExecutionState.js';
import { ServiceRegistrationState } from '../../../editor-state/element-editor-state/service/ServiceRegistrationState.js';
import { ElementEditorState } from '../../../editor-state/element-editor-state/ElementEditorState.js';
import {
  type PackageableElement,
  type RawLambda,
  Service,
  PureSingleExecution,
  PureMultiExecution,
  PureExecution,
  isStubbed_RawLambda,
} from '@finos/legend-graph';
import { ServiceTestableState } from './testable/ServiceTestableState.js';
import { User } from '@finos/legend-server-sdlc';
import { ServicePostValidationsState } from './ServicePostValidationState.js';

export enum SERVICE_TAB {
  GENERAL = 'GENERAL',
  EXECUTION = 'EXECUTION',
  TEST = 'TEST',
  REGISTRATION = 'REGISTRATION',
  POST_VALIDATION = 'POST_VALIDATION',
  TEMPORARY__SNOWFLAKE_SERVICE_DEPLOYMENT = 'SNOWFLAKE_DEPLOYMENT',
}

class TEMPORARY__SnowflakeServiceRegistrationState {
  readonly editorStore: EditorStore;
  readonly service: Service;
  readonly deploymentState = ActionState.create();

  result?: PlainObject | undefined;

  constructor(editorStore: EditorStore, service: Service) {
    makeObservable(this, {
      result: observable,
      deploy: flow,
    });

    this.editorStore = editorStore;
    this.service = service;
  }

  *deploy(): GeneratorFn<void> {
    const deploymentUrl =
      this.editorStore.applicationStore.config
        .TEMPORARY__snowflakeServiceDeploymentUrl;

    if (!deploymentUrl) {
      this.editorStore.applicationStore.notificationService.notifyWarning(
        `Can't deploy Snowflake service: deployment URL is not configured`,
      );
      return;
    }

    try {
      this.deploymentState.inProgress();
      this.result =
        (yield this.editorStore.graphManagerState.graphManager.TEMPORARY__deploySnowflakeService(
          (this.service.execution as PureExecution).func,
          this.editorStore.graphManagerState.graph,
        )) as PlainObject;
    } catch (error) {
      assertErrorThrown(error);
      this.editorStore.applicationStore.notificationService.notifyError(error);
    } finally {
      this.deploymentState.reset();
    }
  }
}

export const MINIMUM_SERVICE_OWNERS = 2;
export class ServiceEditorState extends ElementEditorState {
  executionState: ServiceExecutionState;
  registrationState: ServiceRegistrationState;
  testableState: ServiceTestableState;
  selectedTab: SERVICE_TAB;
  postValidationState: ServicePostValidationsState;
  TEMPORARY__snowflakeServiceRegistrationState: TEMPORARY__SnowflakeServiceRegistrationState;

  constructor(editorStore: EditorStore, element: PackageableElement) {
    super(editorStore, element);

    makeObservable(this, {
      executionState: observable,
      registrationState: observable,
      selectedTab: observable,
      postValidationState: observable,
      setSelectedTab: action,
      resetExecutionState: action,
      openToTestTab: action,
      service: computed,
      reprocess: action,
      searchUsers: flow,
    });

    this.executionState = this.buildExecutionState();
    this.registrationState = new ServiceRegistrationState(
      editorStore,
      this.service,
      editorStore.applicationStore.config.options.TEMPORARY__serviceRegistrationConfig,
      editorStore.sdlcServerClient.featuresConfigHasBeenFetched &&
        editorStore.sdlcServerClient.features.canCreateVersion,
    );
    this.testableState = new ServiceTestableState(editorStore, this);
    const query = this.executionState.serviceExecutionParameters?.query;
    // default to execution tab if query is defined
    this.selectedTab =
      query && !isStubbed_RawLambda(query)
        ? SERVICE_TAB.EXECUTION
        : SERVICE_TAB.GENERAL;
    this.postValidationState = new ServicePostValidationsState(this);
    this.TEMPORARY__snowflakeServiceRegistrationState =
      new TEMPORARY__SnowflakeServiceRegistrationState(
        this.editorStore,
        this.service,
      );
  }

  setSelectedTab(tab: SERVICE_TAB): void {
    this.selectedTab = tab;
  }

  openToTestTab(): void {
    this.selectedTab = SERVICE_TAB.TEST;
  }

  resetExecutionState(): void {
    this.executionState = this.buildExecutionState();
  }

  buildExecutionState(): ServiceExecutionState {
    const execution = this.service.execution;
    if (
      execution instanceof PureSingleExecution &&
      execution.mapping &&
      execution.runtime
    ) {
      return new SingleServicePureExecutionState(
        this.editorStore,
        this,
        execution,
      );
    } else if (execution instanceof PureSingleExecution) {
      return new InlineServicePureExecutionState(
        this.editorStore,
        this,
        execution,
      );
    } else if (execution instanceof PureMultiExecution) {
      return new MultiServicePureExecutionState(
        this.editorStore,
        this,
        execution,
      );
    }
    return new UnsupportedServiceExecutionState(
      this.editorStore,
      this,
      this.service.execution,
    );
  }

  get service(): Service {
    return guaranteeType(
      this.element,
      Service,
      'Element inside service editor state must be a service',
    );
  }

  get serviceQuery(): RawLambda | undefined {
    const execution = this.service.execution;
    if (execution instanceof PureExecution) {
      return execution.func;
    }
    return undefined;
  }

  *searchUsers(name: string): GeneratorFn<User[]> {
    try {
      return (
        (yield this.editorStore.sdlcServerClient.getUsers(
          name,
        )) as PlainObject<User>[]
      ).map((p) => User.serialization.fromJson(p));
    } catch (error) {
      assertErrorThrown(error);
      this.editorStore.applicationStore.notificationService.notifyError(error);
      return [];
    }
  }

  reprocess(
    newElement: PackageableElement,
    editorStore: EditorStore,
  ): ServiceEditorState {
    const serviceEditorState = new ServiceEditorState(editorStore, newElement);
    serviceEditorState.selectedTab = this.selectedTab;
    return serviceEditorState;
  }
}
