// Ayarlar / plan (CLAUDE.md §5.4's `settings` row — owner only, everyone
// else gets "—"). The only business-wide settings that exist today: name,
// base currency, and the negative-stock override (§5.1). Plan tier itself
// (`solo`/`team`) isn't user-editable yet — that's a billing/upgrade flow,
// not a settings toggle, and isn't built (no Turso sync exists to upgrade
// into — see progress.md).

import type { Business } from '../models';
import { requirePermission } from './rbac';
import type { ActorContext } from './context';

export class SettingsService {
  async updateBusiness(
    ctx: ActorContext,
    patch: Partial<Pick<Business, 'name' | 'base_currency'>>,
  ): Promise<void> {
    requirePermission(ctx.employee.role, 'settings', 'update');
    await ctx.repository.business.update(ctx.employee.business_id, patch);
  }

  async setAllowNegativeStock(ctx: ActorContext, allow: boolean): Promise<void> {
    requirePermission(ctx.employee.role, 'settings', 'update');
    await ctx.repository.business.update(ctx.employee.business_id, { allow_negative_stock: allow ? 1 : 0 });
  }
}

export const settingsService = new SettingsService();
