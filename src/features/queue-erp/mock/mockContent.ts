// ⚠️ MOCK CONTENT — NOT APP DATA. Delete this file once the Repository
// layer exists (CLAUDE.md §3/§4/§6: SqliteRepository + Customer/Order/
// StockLevel/Employee schemas) and replace every import from here with a
// real repository call. This only exists so the queue-erp screens have
// something to render before that layer is built; nothing here should be
// treated as a source of truth. Content is carried over from the Claude
// Design mockup (B2B ERP Mobil v2.dc.html) verbatim, for visual parity only.

export const customerBook = [
  { name: 'Maria Sanchez', place: 'Valencia, ES', last: '4 Ağu' },
  { name: 'Hout & Co', place: 'Rotterdam, NL', last: '18 Ağu' },
  { name: 'Atelier Duval', place: 'Lyon, FR', last: '21 Ağu' },
  { name: 'Bodega Luz', place: 'Lizbon, PT', last: '12 Ağu' },
  { name: 'Nordic Wool', place: 'Aarhus, DK', last: '9 Ağu' },
  { name: 'Casa Ferro', place: 'Milano, IT', last: '2 Tem' },
  { name: 'Kraft & Kin', place: 'Berlin, DE', last: '27 Haz' },
  { name: 'Studio Öz', place: 'İzmir, TR', last: '14 Haz' },
] as const;

export const catalog = [
  { sku: 'LIN-SH-M', name: 'Keten gömlek · M', price: 38 },
  { sku: 'LIN-SH-L', name: 'Keten gömlek · L', price: 38 },
  { sku: 'BRD-WAL', name: 'Kesme tahtası · ceviz', price: 38 },
  { sku: 'BAG-01', name: 'Kumaş çanta', price: 9 },
  { sku: 'APR-01', name: 'Atölye önlüğü', price: 24 },
  { sku: 'BLK-WOL', name: 'Yün battaniye', price: 90 },
  { sku: 'JAR-250', name: 'Kavanoz · 250 ml', price: 3 },
  { sku: 'JAR-500', name: 'Kavanoz · 500 ml', price: 4 },
  { sku: 'LBL-01', name: 'Dokuma etiket', price: 1 },
] as const;

export const queueDefs = [
  {
    key: 'q1', type: 'Onay', tint: '#25D366', time: '09:14',
    title: 'Maria Sanchez · 65 keten gömlek',
    detail: 'WhatsApp mesajından çıkarıldı. Adres eksik, teslim 12 Eylül.',
    cta: 'İncele', screen: 2,
  },
  {
    key: 'q2', type: 'Netleştir', tint: '#201e1d', time: '08:52',
    title: 'Bodega Luz · "400 küçük kavanoz"',
    detail: 'Ürün eşleşmedi. AI, hazır soru şablonuyla netleştirme gönderebilir.',
    cta: 'Soru gönder', screen: 8,
  },
  {
    key: 'q3', type: 'Stok', tint: '#ec3013', time: '08:20',
    title: 'Keten kumaş 18 m kaldı',
    detail: 'Bekleyen siparişler 42 m gerektiriyor. Tedarikçi siparişi öneriliyor.',
    cta: 'Stoğa git', screen: 4,
  },
  {
    key: 'q4', type: 'Sevkiyat', tint: '#229ED9', time: '07:40',
    title: 'ORD-2292 paketlemeye hazır',
    detail: 'Atelier Duval · 80 önlük · Mert K. atanmış.',
    cta: 'Akışa git', screen: 3,
  },
] as const;

export const lineDefs = [
  { name: 'Keten gömlek · M', meta: 'LIN-SH-M · €38', price: 38 },
  { name: 'Keten gömlek · L', meta: 'LIN-SH-L · €38', price: 38 },
  { name: 'Kumaş çanta', meta: 'BAG-01 · €9', price: 9 },
] as const;

export const orderDefs = [
  { id: 'ORD-2294', customer: 'Maria Sanchez', items: '65 gömlek', total: '€2.578', stage: 'Yeni', owner: 'atanmadı', tint: '#25D366', ai: true, due: 'bugün', next: 'Üretime al' },
  { id: 'ORD-2293', customer: 'Hout & Co', items: '30 kesme tahtası', total: '€1.140', stage: 'Üretimde', owner: 'Ayşe Y.', tint: '#229ED9', ai: true, due: 'yarın', next: 'Hazır işaretle' },
  { id: 'ORD-2290', customer: 'Nordic Wool', items: '24 battaniye', total: '€2.160', stage: 'Üretimde', owner: 'Hakan D.', tint: '#229ED9', ai: true, due: '28 Ağu', next: 'Hazır işaretle' },
  { id: 'ORD-2292', customer: 'Atelier Duval', items: '80 önlük', total: '€1.920', stage: 'Hazır', owner: 'Mert K.', tint: '#201e1d', ai: false, due: '14:00', next: 'Sevk et' },
  { id: 'ORD-2291', customer: 'Bodega Luz', items: '400 kavanoz', total: '€3.200', stage: 'Sevk', owner: 'kapandı', tint: '#7d7979', ai: false, due: 'dün', next: 'Tahsilat işaretle' },
] as const;

export const stageNames = ['Yeni', 'Üretimde', 'Hazır', 'Sevk'] as const;

export const stockDefs = [
  { name: 'Keten kumaş · doğal', sku: 'RAW-LIN', qty: 18, cap: 200, stage: 'Hammadde', warn: 'Bekleyen siparişler 42 m istiyor' },
  { name: 'Keten gömlek · M', sku: 'LIN-SH-M', qty: 46, cap: 120, stage: 'Üretimde', warn: '' },
  { name: 'Keten gömlek · L', sku: 'LIN-SH-L', qty: 12, cap: 120, stage: 'Numune', warn: 'Numune onayı bekliyor' },
  { name: 'Kesme tahtası · ceviz', sku: 'BRD-WAL', qty: 64, cap: 100, stage: 'Hazır', warn: '' },
  { name: 'Kumaş çanta', sku: 'BAG-01', qty: 210, cap: 300, stage: 'Hazır', warn: '' },
  { name: 'Dokuma etiket', sku: 'LBL-01', qty: 90, cap: 1000, stage: 'Hammadde', warn: 'Yeniden sipariş eşiğinin altında' },
] as const;

export const monthData = [
  { label: 'Mar', rev: 11, exp: 8 },
  { label: 'Nis', rev: 14, exp: 9 },
  { label: 'May', rev: 12, exp: 10 },
  { label: 'Haz', rev: 16, exp: 10 },
  { label: 'Tem', rev: 15, exp: 11 },
  { label: 'Ağu', rev: 18, exp: 11 },
] as const;

export const expenses = [
  { label: 'Hammadde', value: '€5.400', pct: '72%' },
  { label: 'İşçilik', value: '€3.200', pct: '43%' },
  { label: 'Kargo', value: '€1.650', pct: '22%' },
  { label: 'Kira', value: '€1.000', pct: '13%' },
] as const;

export const channelDefs = [
  { key: 'wa', name: 'WhatsApp Business', meta: 'Siparişlerin %70’i', tint: '#25D366' },
  { key: 'tg', name: 'Telegram', meta: 'Toptancı grupları', tint: '#229ED9' },
  { key: 'em', name: 'E-posta', meta: 'Kurumsal alıcılar', tint: '#f3f2f2' },
  { key: 'sms', name: 'SMS', meta: 'Yedek kanal', tint: '#807b79' },
] as const;

export const teamDefs = [
  { initials: 'AY', name: 'Ayşe Y.', role: 'Üretim', task: 'ORD-2293 dikim', state: 'Vardiyada' },
  { initials: 'MK', name: 'Mert K.', role: 'Sevkiyat', task: 'ORD-2292 paketleme', state: 'Vardiyada' },
  { initials: 'HD', name: 'Hakan D.', role: 'Üretim', task: 'Kesim · keten', state: 'Vardiyada' },
  { initials: 'SE', name: 'Selin E.', role: 'Satış', task: 'Bodega Luz teklifi', state: 'İzinli' },
] as const;

export const toggleDefs = [
  { key: 'inMsg', label: 'Gelen mesajları çevir', sub: 'Otomatik dil algılama' },
  { key: 'outMsg', label: 'Giden mesajları çevir', sub: 'Müşterinin diline' },
  { key: 'voice', label: 'Sesli mesaj çevirisi', sub: 'Yalnızca Pro' },
] as const;

export const askTemplateDefs = [
  { label: 'Ürün netleştirme', tr: 'Hangi ürünü kastettiğinizi netleştirebilir misiniz? Elimizde 250 ml ve 500 ml kavanoz var.', ES: '¿Puede confirmar cuál producto? Tenemos tarros de 250 ml y 500 ml.', EN: 'Could you confirm which product? We stock 250 ml and 500 ml jars.' },
  { label: 'Teslim tarihi', tr: 'Teslimi hangi tarihte istiyorsunuz?', ES: '¿Para qué fecha necesita la entrega?', EN: 'What delivery date do you need?' },
  { label: 'Adres & sevkiyat', tr: 'Sevkiyat adresini ve tercih ettiğiniz kargoyu paylaşır mısınız?', ES: '¿Nos comparte la dirección de envío y el transportista preferido?', EN: 'Could you share the shipping address and preferred carrier?' },
  { label: 'Adet onayı', tr: 'Adedi 400 olarak anladık, doğru mu?', ES: 'Entendimos 400 unidades, ¿es correcto?', EN: 'We understood 400 units — is that correct?' },
] as const;

export const askLangOptions = ['ES', 'EN', 'TR'] as const;

export const identities = [
  { tint: '#25D366', value: '+34 6•• ••• 214' },
  { tint: '#229ED9', value: '@sanchez_tex' },
  { tint: '#f3f2f2', value: 'maria@sanchez.es' },
] as const;

export const custStats = [
  { label: 'Ciro', value: '€42.9K' },
  { label: 'Sipariş', value: '27' },
  { label: 'Ort. teslim', value: '11 gün' },
] as const;

export const timeline = [
  { title: 'Sipariş algılandı · 65 gömlek', meta: 'WhatsApp · bugün 09:14', tint: '#25D366' },
  { title: 'ORD-2288 sevk edildi', meta: 'E-posta bildirimi · 4 Ağu', tint: '#f3f2f2' },
  { title: 'Beden tablosu istendi', meta: 'Telegram · 28 Tem', tint: '#229ED9' },
  { title: 'ORD-2271 ödendi · €3.140', meta: 'Manuel giriş · 19 Tem', tint: '#807b79' },
  { title: 'İlk sipariş', meta: 'WhatsApp · 2 Mar', tint: '#25D366' },
] as const;

export const screenNames = [
  'Bugün', 'Sipariş Onayı', 'İş Akışı', 'Stok & Üretim', 'Para',
  'Müşteri', 'Ayarlar', 'Netleştirme', 'Manuel Sipariş',
] as const;

export const screenKickers = [
  'Karar kuyruğu', 'AI çıkarımı', 'Aşamalar', 'Envanter', 'Ön muhasebe',
  'Birleşik profil', 'Kurulum', 'Soru şablonu', 'Elle giriş',
] as const;

export const askClarifyContext = {
  channelDot: '#f3f2f2',
  contact: 'Bodega Luz · E-posta',
  quote: '"Could you quote 400 boxes of the small jars, delivery to Lisbon?"',
  mismatchLabel: 'Eşleşmeyen alan: ürün · "small jars"',
} as const;

export const railOrder = [1, 3, 4, 5, 6] as const;

export const railDefs = [
  { label: 'Bugün', glyph: '▤', n: 1 },
  { label: 'Akış', glyph: '▦', n: 3 },
  { label: 'Stok', glyph: '▣', n: 4 },
  { label: 'Para', glyph: '▥', n: 5 },
  { label: 'Müşteri', glyph: '◧', n: 6 },
] as const;

export const footNotes: Record<number, string> = {
  1: 'Karar verilmemiş her kart burada birikir.',
  2: 'Adetler düzenlenebilir · AI güveni %92.',
  3: 'Aşama sayıları canlı; kart tek dokunuşla ilerler.',
  4: 'Eşik altı kalemler kırmızı işaretlenir.',
  5: 'Fatura ve vergi kapsam dışı.',
  6: 'Tüm kanallar tek kimlik altında.',
  7: 'Ücretsiz planda 1 kanal, 100 sipariş.',
  8: 'Şablonlar müşterinin dilinde gönderilir.',
  9: 'Kanaldan gelmeyen siparişler için.',
};
