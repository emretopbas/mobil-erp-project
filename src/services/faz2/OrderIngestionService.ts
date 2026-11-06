// OrderIngestionService (CLAUDE.md §6, §9 step 10): "interface tanımlanır,
// içi Faz 1'de sadece manuel giriş. `ingestFromChannel()` metodu
// `NotImplemented` stub." — this is that interface. `ingestManual` is the
// real Faz 1 path (thin wrapper over OrderService.create, which already
// enforces RBAC and always sets `source: 'manual'`); `ingestFromChannel` is
// the documented, deliberate NotImplemented — Faz 2's NLP pipeline
// (text/voice → structured order) fills this in without any caller of
// `ingestManual` needing to change.

import type { UUID } from '../../models';
import type { ActorContext } from '../context';
import { orderService } from '../OrderService';
import type { InboundChannelMessage } from './Channel';

export interface OrderIngestionService {
  ingestManual(ctx: ActorContext, input: { customer_id: UUID; currency: string }): ReturnType<typeof orderService.create>;
  /** Faz 2 only. Always throws in Faz 1 — see this file's header. */
  ingestFromChannel(message: InboundChannelMessage): ReturnType<typeof orderService.create>;
}

class OrderIngestionServiceImpl implements OrderIngestionService {
  ingestManual(ctx: ActorContext, input: { customer_id: UUID; currency: string }) {
    return orderService.create(ctx, input);
  }

  ingestFromChannel(_message: InboundChannelMessage): ReturnType<typeof orderService.create> {
    throw new Error(
      'NotImplemented: ingestFromChannel() is a Faz 2 feature (NLP-based order detection from channel messages) — CLAUDE.md §1/§6. Faz 1 only supports ingestManual().',
    );
  }
}

export const orderIngestionService: OrderIngestionService = new OrderIngestionServiceImpl();
