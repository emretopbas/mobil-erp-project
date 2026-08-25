export type ChannelKey = 'wa' | 'tg' | 'em' | 'sms';
export type TranslateKey = 'inMsg' | 'outMsg' | 'voice';
export type AskLang = 'ES' | 'EN' | 'TR';
export type StockFilter = 'Tümü' | 'Düşük stok' | 'Üretimde';

export interface DraftState {
  customer: string;
  lines: Record<string, number>;
}

export interface QueueAppState {
  screen: number;
  done: Record<string, boolean>;
  stage: string;
  stockFilter: StockFilter;
  connected: Record<ChannelKey, boolean>;
  qty: [number, number, number];
  tr: Record<TranslateKey, boolean>;
  toast: string;
  waError: boolean;
  askTpl: number;
  askLang: AskLang;
  draft: DraftState;
  custOpen: boolean;
  custQuery: string;
}
