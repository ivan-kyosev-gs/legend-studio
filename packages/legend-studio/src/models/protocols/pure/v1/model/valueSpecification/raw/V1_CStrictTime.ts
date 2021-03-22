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

import { V1_ValueSpecification } from '../../../model/valueSpecification/V1_ValueSpecification';
import type { V1_Multiplicity } from '../../../model/packageableElements/domain/V1_Multiplicity';
import type { Hashable } from '@finos/legend-studio-shared';
import { hashArray } from '@finos/legend-studio-shared';
import { CORE_HASH_STRUCTURE } from '../../../../../../MetaModelConst';
import type { V1_ValueSpecificationVisitor } from '../../../model/valueSpecification/V1_ValueSpecification';

export class V1_CStrictTime extends V1_ValueSpecification implements Hashable {
  multiplicity!: V1_Multiplicity;

  values: string[] = [];
  accept_ValueSpecificationVisitor<T>(
    visitor: V1_ValueSpecificationVisitor<T>,
  ): T {
    return visitor.visit_CStrictTime(this);
  }

  get hashCode(): string {
    return hashArray([
      CORE_HASH_STRUCTURE.CSTRICT_TIME,
      hashArray([this.multiplicity]),
      hashArray(this.values),
    ]);
  }
}
