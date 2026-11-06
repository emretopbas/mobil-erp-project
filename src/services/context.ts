// Every guarded service method takes the acting Employee explicitly rather
// than reading it from some ambient/global session — makes the RBAC check
// visible at every call site and keeps services testable without mocking a
// session provider.

import type { Business, Employee } from '../models';
import type { Repository } from '../repository';

export interface ActorContext {
  readonly employee: Employee;
  readonly business: Business;
  readonly repository: Repository;
}
