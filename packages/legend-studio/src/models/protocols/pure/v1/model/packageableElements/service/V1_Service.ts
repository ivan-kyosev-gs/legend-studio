/**
 * Copyright Goldman Sachs
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

import { hashArray } from '@finos/legend-studio-shared';
import type { Hashable } from '@finos/legend-studio-shared';
import { CORE_HASH_STRUCTURE } from '../../../../../../MetaModelConst';
import type { V1_PackageableElementVisitor } from '../../../model/packageableElements/V1_PackageableElement';
import { V1_PackageableElement } from '../../../model/packageableElements/V1_PackageableElement';
import type { V1_ServiceExecution } from './V1_ServiceExecution';
import type { V1_ServiceTest } from './V1_ServiceTest';

export class V1_Service extends V1_PackageableElement implements Hashable {
  pattern!: string;
  owners: string[] = [];
  documentation!: string;
  autoActivateUpdates = true;
  execution!: V1_ServiceExecution;
  test!: V1_ServiceTest;

  get hashCode(): string {
    return hashArray([
      CORE_HASH_STRUCTURE.SERVICE,
      super.hashCode,
      this.pattern,
      hashArray(this.owners),
      this.documentation,
      this.autoActivateUpdates.toString(),
      this.execution,
      this.test,
    ]);
  }

  accept_PackageableElementVisitor<T>(
    visitor: V1_PackageableElementVisitor<T>,
  ): T {
    return visitor.visit_Service(this);
  }
}
