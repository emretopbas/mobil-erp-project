// Faz 2 seam (CLAUDE.md §1, §9 step 10): "Kanal entegrasyonları (WhatsApp
// Business, Telegram, Email, SMS) — adapter mimarisi." Not implemented in
// Faz 1 — this is the interface Faz 2's adapters (one per channel) will
// implement, so `Customer.primary_channel` and `Order.source` already have
// somewhere real to point once channels exist, without a schema or type
// change at that point.

export type ChannelKind = 'whatsapp' | 'telegram' | 'email' | 'sms';

/** A message received from a channel, before any NLP processing. */
export interface InboundChannelMessage {
  channel: ChannelKind;
  /** The channel's own id for this message — for idempotent re-processing. */
  externalMessageId: string;
  /** The customer's channel-specific identity (phone number, chat id, email
   * address, ...) — this is what `Customer.contact_ref` will end up storing. */
  fromRef: string;
  text?: string;
  audioUrl?: string;
  receivedAt: string; // ISO 8601, UTC
}

/** One implementation per channel in Faz 2 (WhatsAppChannel,
 * TelegramChannel, ...). Faz 1 has none — `OrderIngestionService` is the
 * only thing that will hold a `Channel`, and it doesn't yet. */
export interface Channel {
  readonly kind: ChannelKind;
  send(toRef: string, text: string): Promise<void>;
}
