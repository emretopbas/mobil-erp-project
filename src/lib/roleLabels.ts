// Turkish display labels for enums that show up directly in the UI. Kept
// separate from the enums themselves (models/common.ts) since those stay in
// their spec-defined English form — this is presentation only.

import type { EmployeeRole, TaskStatus, StockMovementType, ExpenseCategory, RevenueCategory, PaymentMethod, CheckStatus, OrderStatus } from '../models';

export const roleLabel: Record<EmployeeRole, string> = {
  owner: 'Sahibi',
  manager: 'Yönetici',
  production: 'Üretim',
  sales: 'Satış',
  viewer: 'Görüntüleyici',
};

export const taskStatusLabel: Record<TaskStatus, string> = {
  todo: 'Yapılacak',
  in_progress: 'Devam ediyor',
  done: 'Tamamlandı',
};

export const stockMovementTypeLabel: Record<StockMovementType, string> = {
  in: 'Giriş',
  out: 'Çıkış',
  adjustment: 'Düzeltme',
};

export const expenseCategoryLabel: Record<ExpenseCategory, string> = {
  raw_material: 'Hammadde',
  rent: 'Kira',
  labor: 'İşçilik',
  shipping: 'Nakliye',
  other: 'Diğer',
};

export const revenueCategoryLabel: Record<RevenueCategory, string> = {
  interest: 'Faiz',
  scrap_sale: 'Hurda satışı',
  rent_income: 'Kira geliri',
  other: 'Diğer',
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'Nakit',
  credit_card: 'Kredi kartı',
  check: 'Çek',
  deposit: 'Kapora',
};

export const checkStatusLabel: Record<CheckStatus, string> = {
  pending: 'Bekliyor',
  cleared: 'Tahsil edildi',
  bounced: 'Karşılıksız',
  cashed: 'Elden bozduruldu',
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  draft: 'Taslak',
  confirmed: 'Onaylandı',
  in_production: 'Üretimde',
  ready: 'Hazır',
  shipped: 'Gönderildi',
};
