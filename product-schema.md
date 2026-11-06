-- =============================================================
--  DURUM NOTU (2026-10-10, güncellendi) — bu dosya hedef/referans şema.
--  Faz 1'de bunun TAMAMI değil, bir alt kümesi uygulandı. Bu notun geri
--  kalanı (2026-09-10'dan) hâlâ geçerli — neyin gerçek kodda olduğunu
--  anlatıyor:
--
--  Gerçekten uygulanan alt küme (src/db/schema.ts migration 7+,
--  src/models/entities.ts, src/repository/, src/services/,
--  src/app/products.tsx):
--    - product: + category (TEXT, düz metin — henüz ayrı tablo yok),
--      description, unit (varsayılan 'adet'), is_purchasable
--    - product_variant: + barcode, eksen tabanlı varyant sistemi
--      (variant_key, attribute/attribute_option/variant_attribute —
--      aşağıdaki Bölüm A'nın gerçek koddaki karşılığı), cost_price_minor
--      (COGS — marj raporu için altyapı, henüz raporu yok),
--      price_minor (ürün fiyatını varyant bazında override eder),
--      business_id (diğer tüm alt tablolar gibi denormalize edildi)
--    - stock_level: + reorder_quantity (bu dosyada MODELLENMEDİ — stok
--      hareketleri/seviyeleri ayrı bir domain, bkz. database-schema.md §3)
--    - Gerçek koddaki para birimi/zaman/soft-delete kuralları için
--      database-schema.md'ye bakın — bu dosya yalnızca katalog şemasını
--      kapsar, cari/finans/sipariş/satın alma orada.
--
--  =============================================================
--  BU GEÇİŞ (2026-10-10) — doküman temizliği, GERÇEK KODA DOKUNULMADI.
--  Üç kritik, veri göçü gerektiren düzeltme yapıldı (ileride gerçek koda
--  uygulanacaksa aşağıda ⚠ işaretli):
--    ⚠ 1. Para alanları REAL → INTEGER + `_minor` soneki (gerçek kod zaten
--         böyle; referans şema ona uyduruldu).
--    ⚠ 2. Her tabloya `business_id` eklendi; unique indeksler
--         `business_id` ile başlıyor (ürüne/varyanta bağlı olanlar hariç
--         — aşağıda her birinde gerekçesi var).
--    ⚠ 3. `variant.is_default` KALDIRILDI — iki farklı anlamı (yer tutucu
--         varyant / vitrin varyantı) birbirine karışıyordu. Yer tutucu
--         artık yalnızca `variant_key = ''` ile, vitrin varyantı yeni
--         `is_primary` kolonuyla ayrı ayrı ifade ediliyor.
--  Diğer düzeltmeler (ölü kolonlar, çakışan mekanizmalar, barkod
--  birleştirme, vb.) ilgili tablonun yanında tek satırlık gerekçeyle not
--  edildi — hiçbiri sessizce silinmedi.
--
--  DOSYA İKİYE BÖLÜNDÜ:
--    Bölüm A — Çekirdek: uygulanan ya da yakın vadede uygulanacak
--      (unit, attribute, attribute_option, product, variant,
--       variant_attribute, barcode, v_variant görünümü).
--    Bölüm B — Ertelenenler: çok sektörlü katalog, kademeli B2B
--      fiyatlandırma veya set/koli ürünleri GERÇEKTEN gerektiğinde
--      uygulanacak doküman — bugün çalışan kod değil (category,
--      product_type, product_type_attribute, product_attribute,
--      packaging, bundle_item, price_list, price_list_item,
--      supplier_product, product_media).
--  Bölüm B'deki tablolar SİLİNMEDİ, yalnızca ayrıldı — ileride gerekecekler.
--
--  TAMAMEN KALDIRILAN: `brand` tablosu + `product.brand_id`. Küçük bir
--  üretici/toptancıda marka genelde işletmenin kendisidir; soft-delete'li
--  ayrı bir tablo bu ölçekte fazla — gerekirse düz metin ya da bir
--  `attribute` ("Marka") olarak çözülür.
-- =============================================================

-- =============================================================
--  ÜRÜN & VARYANT ŞEMASI  —  sektörden bağımsız
--  SQLite 3.37+ / libSQL (Turso) uyumlu
--  Tasarım kuralları:
--    1) Her ürünün EN AZ bir varyantı vardır (tekil üründe gizli, boş
--       `variant_key`'li "yer tutucu" varyant — "vitrin" varyantıyla
--       KARIŞTIRILMAZ, bkz. Bölüm A §4'teki not)
--    2) Stok, fiyat, barkod, sipariş satırı DAİMA variant_id'ye bağlanır
--    3) Sektöre özgü alanlar kolon değil, "attribute" kaydıdır
--    4) Soft delete + updated_at → çok cihazlı senkron için
--    5) Para alanları her zaman INTEGER, minor unit'te (kuruş/cent) —
--       `_minor` soneki taşır; görüntüleme katmanı böler/formatlar.
--       Float ile para tutulmaz (gerçek koddaki `formatMoney` kuralıyla
--       birebir aynı).
--    6) Her tablo `business_id` taşır — çok kiracılı (tenant) izolasyonu;
--       gerçek kodda olduğu gibi alt tablolarda bile denormalize edilir
--       (join'süz filtre için).
-- =============================================================

PRAGMA foreign_keys = ON;

-- Bu dosya kendi başına (örn. bir test veritabanında) çalıştırılabilsin
-- diye minimal bir tenant stub'u. Gerçek uygulamada `business` tablosu
-- zaten var (src/db/schema.ts migration 1) — bu satır onunla birlikte
-- çalıştırılırsa `IF NOT EXISTS` sayesinde zararsızdır, gerçek tabloyu
-- asla ezmez. Bu dosyanın kapsamı yalnızca katalog şeması; kimlik/tenant
-- modeli database-schema.md §1'de.
CREATE TABLE IF NOT EXISTS business (
  id TEXT PRIMARY KEY
);

-- =============================================================
--  BÖLÜM A — ÇEKİRDEK  (uygulanan / yakın vadede uygulanacak)
-- =============================================================

-- =============================================================
-- A.1 REFERANS TABLOLARI
-- =============================================================

-- Ölçü birimleri — SADE HALİ (§3.1): `base_unit_id`/`factor` (kg↔g gibi
-- çevrim) kaldırıldı. Faz 1'de ölçü birimi çevrimi hiç kullanılmıyor;
-- "1 koli = 12 adet" gibi TİCARİ paketleme zaten ayrı bir kavram
-- (Bölüm B'deki `packaging`, bkz. §3.1 kararı). Gerçek dönüşüm ihtiyacı
-- doğarsa bu iki kolon geri eklenir.
CREATE TABLE unit (
  id             TEXT    PRIMARY KEY,
  business_id    TEXT    NOT NULL REFERENCES business(id),
  code           TEXT    NOT NULL,                    -- 'adet','kg','m','lt'
  name           TEXT    NOT NULL,
  decimal_places INTEGER NOT NULL DEFAULT 0,          -- adet=0, kg=3
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT
) STRICT;
CREATE UNIQUE INDEX ux_unit_code ON unit(business_id, code) WHERE deleted_at IS NULL;

-- =============================================================
-- A.2 NİTELİK (ATTRIBUTE) SİSTEMİ
--    Sektör farkı burada yaşar. Kolon eklemeden yeni sektör açılır.
--    (Gerçek koddaki attribute/attribute_option/variant_attribute
--    üçlüsünün karşılığı — bkz. database-schema.md §2.)
-- =============================================================

CREATE TABLE attribute (
  id           TEXT    PRIMARY KEY,
  business_id  TEXT    NOT NULL REFERENCES business(id),
  code         TEXT    NOT NULL,                      -- 'color','beden','gramaj','kalinlik'
  name         TEXT    NOT NULL,
  data_type    TEXT    NOT NULL CHECK (data_type IN ('option','text','number','bool','date')),
  unit_id      TEXT    REFERENCES unit(id),           -- data_type='number' ise: mm, gr, mikron
  -- Bu nitelik varyant ekseni OLABİLİR mi? (renk evet, "menşei" hayır)
  can_be_axis  INTEGER NOT NULL DEFAULT 1 CHECK (can_be_axis IN (0,1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
) STRICT;
CREATE UNIQUE INDEX ux_attribute_code ON attribute(business_id, code) WHERE deleted_at IS NULL;

-- Kaldırılanlar (gerekçeler, §3.4 / §4):
--   position       → eksenlerin sırası ürün tipine göre belirlenir
--                     (product_type_attribute.position, Bölüm B), burada
--                     ayrıca tutmak üçüncü bir "sıra" kaynağı yaratıyordu.
--   is_filterable  → hiçbir sorgu kullanmıyor; filtrelenebilir nitelik
--                     ihtiyacı gerçekten doğunca geri eklenir.

-- data_type='option' olan niteliklerin seçenekleri
CREATE TABLE attribute_option (
  id           TEXT    PRIMARY KEY,
  business_id  TEXT    NOT NULL REFERENCES business(id),
  attribute_id TEXT    NOT NULL REFERENCES attribute(id) ON DELETE CASCADE,
  value        TEXT    NOT NULL,                      -- 'RED'  (makine tarafı, sabit)
  label        TEXT    NOT NULL,                      -- 'Kırmızı' (kullanıcıya görünen)
  swatch_hex   TEXT,                                  -- renk seçeneği ise önizleme
  sku_token    TEXT,                                  -- SKU üretiminde kullanılacak kısaltma: 'KRM'
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
) STRICT;
-- §1.2 gözden geçirmesi: business_id ile prefiklenmedi — `attribute_id`
-- zaten tek bir business'a ait (attribute.business_id üzerinden), tıpkı
-- aşağıdaki ux_variant_combo'nun product_id ile kapsanıp ayrıca
-- business_id istememesi gibi ("ürüne/ebeveyne bağlı olanlar hariç").
CREATE UNIQUE INDEX ux_attr_option ON attribute_option(attribute_id, value) WHERE deleted_at IS NULL;

-- =============================================================
-- A.3 ÜRÜN
-- =============================================================

CREATE TABLE product (
  id              TEXT    PRIMARY KEY,
  business_id     TEXT    NOT NULL REFERENCES business(id),

  -- `category` artık bir FK DEĞİL, düz metin — gerçek kodla birebir aynı
  -- (dosya başındaki durum notu). Ayrı bir `category` ağaç tablosu
  -- (Bölüm B) yalnızca alt-ağaç sorgusu gerçekten gerektiğinde devreye
  -- girer; o zamana kadar Bölüm A'nın Bölüm B'ye FK vermesini istemiyoruz
  -- (Bölüm B doküman/referans, çalışan kod değil).
  category        TEXT,

  sku             TEXT    NOT NULL,                   -- ana/model kodu
  name            TEXT    NOT NULL,
  description     TEXT,

  stock_unit_id   TEXT    NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
  base_price_minor INTEGER NOT NULL DEFAULT 0,        -- minor unit; varyant override etmezse geçerli
  base_cost_minor  INTEGER,                            -- minor unit; COGS

  -- TÜRETİLMİŞ ÖNBELLEK (§1.3'ün son notu) — tek doğruluk kaynağı
  -- `variant.variant_key`'dir ("bu ürünün yer tutucudan başka varyantı
  -- var mı?" sorusu oradan cevaplanır). Bu alan yalnızca UI'ye hızlı bir
  -- ipucu verir ("varyant ekranını göster/gösterme"); hiçbir sorgu
  -- KOŞULU bu alana bağlanmaz.
  has_variants    INTEGER NOT NULL DEFAULT 0 CHECK (has_variants IN (0,1)),

  track_lot       INTEGER NOT NULL DEFAULT 0 CHECK (track_lot    IN (0,1)),
  track_serial    INTEGER NOT NULL DEFAULT 0 CHECK (track_serial IN (0,1)),
  track_expiry    INTEGER NOT NULL DEFAULT 0 CHECK (track_expiry IN (0,1)),

  is_sellable     INTEGER NOT NULL DEFAULT 1 CHECK (is_sellable   IN (0,1)),
  -- §5.2: artık "malzeme mi ürün mü" ayrımı DEĞİL — malzemeler gerçek
  -- kodda ayrı, eksensiz bir `material` tablosuna taşındı (Satın Almalar
  -- v2). Bu bayrak yalnızca "alınıp aynen satılan ticari mal" ayrımı için
  -- kalır. Satın alma ekranının Tümü/Malzemeler/Ürünler filtresi BUNA
  -- değil, tablo ayrımına (material vs. product) dayanır — filtreleme
  -- mantığı bu bayrağa bağlanmaz.
  is_purchasable  INTEGER NOT NULL DEFAULT 1 CHECK (is_purchasable IN (0,1)),
  is_stocked      INTEGER NOT NULL DEFAULT 1 CHECK (is_stocked    IN (0,1)), -- hizmet ise 0

  status          TEXT    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('draft','active','archived')),

  -- Filtrelenmeyecek serbest ek bilgiler (sezon notu, gümrük kodu vb.).
  -- §3.3: `product_attribute` tablosuyla aynı işi görüyordu, ikisi de şu
  -- an kullanılmıyor — filtrelenebilir nitelik gerçekten gerekene kadar
  -- yalnızca bu kalır, `product_attribute` Bölüm B'ye taşındı.
  extra           TEXT    CHECK (extra IS NULL OR json_valid(extra)),

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  CHECK (base_price_minor >= 0)
) STRICT;

-- ux_product_sku zaten (business_id, sku) sırasıyla kurulu — işletme
-- bazlı "tüm ürünler" sorguları bu indeksin soldan önekini kullanabilir;
-- ayrıca bir `ix_product_business` eklemek gereksiz tekrar olurdu.
CREATE UNIQUE INDEX ux_product_sku      ON product(business_id, sku) WHERE deleted_at IS NULL;
CREATE INDEX        ix_product_category ON product(business_id, category);
CREATE INDEX        ix_product_status   ON product(status) WHERE deleted_at IS NULL;

-- Kaldırılanlar (gerekçeler):
--   product_type_id, category_id (FK hali) → Bölüm B'ye taşındı;
--     product_type gerçek kodda hiç yok, category düz metin kolon oldu
--     (yukarıya bakın).
--   brand_id (+ brand tablosu) → §4, dosya başı notuna bakın.
--   currency  → §5.1 — para birimi üründe değil, cari/sipariş/fiyat
--     listesi seviyesinde taşınır (aynı siparişte iki para birimi riskini
--     ve cari bakiye hesabının bozulmasını önler).
--   tax_rate  → §4 — resmi muhasebe/vergi özellikleri bilinçli olarak
--     kapsam dışı (CLAUDE.md'nin Faz 1 "basit tutulur" çizgisi).

-- =============================================================
-- A.4 VARYANT — stok ve fiyatın gerçek sahibi
-- =============================================================

CREATE TABLE variant (
  id             TEXT    PRIMARY KEY,
  business_id    TEXT    NOT NULL REFERENCES business(id),
  product_id     TEXT    NOT NULL REFERENCES product(id) ON DELETE CASCADE,

  sku            TEXT    NOT NULL,

  -- Eksen kombinasyonunun kanonik imzası: 'color=RED|size=42'
  -- (attribute.code'a göre alfabetik sıralanır). Aynı kombinasyonun iki
  -- kez girilmesini engelleyen TEK mekanizma budur (ux_variant_combo).
  --
  -- YER TUTUCU varyant (§1.3) — varyantsız bir ürünün kullanıcıya hiç
  -- gösterilmeyen tek varyantı — SADECE `variant_key = ''` ile tanımlanır.
  -- Bunun ürün başına tekilliğini ux_variant_combo zaten garanti eder;
  -- ayrı bir "bu mu yer tutucu" kolonu YOK. VİTRİN varyantı (aşağıdaki
  -- `is_primary`) tamamen AYRI bir kavramdır — birbirine karıştırılmaz.
  variant_key    TEXT    NOT NULL DEFAULT '',

  price_override_minor INTEGER,                       -- minor unit; NULL ise product.base_price_minor
  cost_price_minor     INTEGER,                        -- minor unit

  is_bundle      INTEGER NOT NULL DEFAULT 0 CHECK (is_bundle  IN (0,1)),

  -- VİTRİN varyantı (§1.3) — eksenli bir üründe öne çıkan/varsayılan
  -- GÖSTERİLEN gerçek varyant (örn. "kırmızı" rengi). Yer tutucudan
  -- (variant_key='') tamamen ayrı bir rol: bir ürünün YA yer tutucusu
  -- olur YA vitrin varyantı seçilmiş eksenli varyantları — ikisi asla
  -- aynı satırda anlamlı olmaz. Eski `is_default` bu iki rolü tek
  -- kolonda karıştırıyordu; artık ayrılar.
  is_primary     INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),

  position       INTEGER NOT NULL DEFAULT 0,

  status         TEXT    NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','archived')),

  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT,
  CHECK (price_override_minor IS NULL OR price_override_minor >= 0)
) STRICT;

CREATE UNIQUE INDEX ux_variant_sku      ON variant(business_id, sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_variant_combo    ON variant(product_id, variant_key) WHERE deleted_at IS NULL;
-- Vitrin varyantı ürün başına en fazla bir tane; yer tutucuda
-- (variant_key='') hiç kullanılmaz (bkz. aşağıdaki seed'in karton koli
-- örneği — is_primary o satırda hiç set edilmiyor).
CREATE UNIQUE INDEX ux_variant_primary  ON variant(business_id, product_id) WHERE is_primary = 1 AND deleted_at IS NULL;
CREATE INDEX        ix_variant_product  ON variant(product_id) WHERE deleted_at IS NULL;

-- Kaldırılanlar (gerekçeler):
--   barcode        → §2.5 — tek, paylaşılan `barcode` tablosuna taşındı
--     (aşağıda A.5). Eskiden `variant.barcode` ve `packaging.barcode` ayrı
--     ayrı unique'ti; aynı barkod ikisinde birden bulunabiliyordu ve
--     okuyucu hangisini bulacağını bilemiyordu.
--   display_name   → §2.1 — bakımsız önbellekti, hiçbir trigger/kod
--     güncellemiyordu (bir attribute_option.label değişince varyantlar
--     eski adla kalırdı). `v_variant` görünümünde canlı hesaplanıyor.
--   is_default     → §1.3, yukarıya bakın.
--   weight_grams   → §4 — kargo/sevkiyat modülü yok.
--   min_stock, reorder_qty → §3.2 — eşik DEPO bazlıdır, varyant bazında
--     değil; gerçek koddaki `stock_level.low_stock_threshold`/
--     `reorder_quantity`'de kalır (bu dosyanın kapsamı dışı, bkz.
--     database-schema.md §3).

-- Varyantı tanımlayan eksen değerleri
CREATE TABLE variant_attribute (
  business_id  TEXT NOT NULL REFERENCES business(id),
  variant_id   TEXT NOT NULL REFERENCES variant(id)   ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attribute(id) ON DELETE RESTRICT,
  option_id    TEXT REFERENCES attribute_option(id)   ON DELETE RESTRICT,
  value_text   TEXT,
  value_number REAL,
  PRIMARY KEY (variant_id, attribute_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_variant_attr_lookup ON variant_attribute(attribute_id, option_id);

-- =============================================================
-- A.5 BARKOD  (§2.5 — yeni, birleşik tablo)
--    Varyant barkodu ve paketleme (koli/palet) barkodu TEK namespace'i
--    paylaşır — aynı işletmede bir barkod yalnızca bir hedefe ait
--    olabilir. Okuyucu bir kodu okuyunca tek sorguyla hangi tabloda
--    arayacağını (target_type) öğrenir, tahmin etmek zorunda kalmaz.
-- =============================================================

CREATE TABLE barcode (
  id          TEXT    PRIMARY KEY,
  business_id TEXT    NOT NULL REFERENCES business(id),
  code        TEXT    NOT NULL,                        -- GTIN/EAN/ITF-14 ...
  target_type TEXT    NOT NULL CHECK (target_type IN ('variant','packaging')),
  -- target_id kasıtlı olarak FK DEĞİL — polimorfik (ya variant.id ya
  -- packaging.id). Gerçek koddaki cari_movement.source_id ile aynı
  -- desen (bkz. database-schema.md §7, "Bölüm 10.6").
  target_id   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
) STRICT;
CREATE UNIQUE INDEX ux_barcode_code   ON barcode(business_id, code) WHERE deleted_at IS NULL;
CREATE INDEX        ix_barcode_target ON barcode(target_type, target_id);

-- =============================================================
-- A.6 GÖRÜNÜM
-- =============================================================

-- Sipariş/stok ekranlarının kullanacağı düzleştirilmiş varyant görünümü.
-- `full_name` artık bakımsız bir `display_name` önbelleğinden değil,
-- varyantın eksen etiketlerinden CANLI hesaplanır (§2.1).
CREATE VIEW v_variant AS
SELECT
  v.id              AS variant_id,
  v.business_id,
  v.sku             AS variant_sku,
  bc.code           AS barcode,
  p.id              AS product_id,
  p.sku             AS product_sku,
  p.name            AS product_name,
  CASE WHEN v.variant_key = ''
       THEN p.name
       ELSE p.name || ' — ' || (
         SELECT GROUP_CONCAT(COALESCE(ao.label, va.value_text, va.value_number), ' / ')
         FROM variant_attribute va
         JOIN attribute a ON a.id = va.attribute_id
         LEFT JOIN attribute_option ao ON ao.id = va.option_id
         WHERE va.variant_id = v.id
         ORDER BY a.code
       )
  END AS full_name,
  COALESCE(v.price_override_minor, p.base_price_minor) AS effective_price_minor,
  COALESCE(v.cost_price_minor,     p.base_cost_minor)  AS effective_cost_minor,
  p.stock_unit_id,
  u.code            AS stock_unit_code,
  p.track_lot, p.track_serial, p.track_expiry,
  v.is_bundle, v.is_primary, v.status
FROM variant v
JOIN product p ON p.id = v.product_id
JOIN unit    u ON u.id = p.stock_unit_id
LEFT JOIN barcode bc ON bc.target_type = 'variant' AND bc.target_id = v.id AND bc.deleted_at IS NULL
WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL;

-- =============================================================
-- A.7 TETİKLEYİCİLER
-- =============================================================

-- §2.3: `updated_at` ARTIK TRIGGER'LA GÜNCELLENMİYOR. Eski hal yalnızca
-- `product`/`variant` üzerinde vardı, dosyadaki diğer 12 tabloda yoktu —
-- tutarsızdı. Tercih edilen çözüm: hiçbir tabloda trigger yok, her
-- UPDATE'te `updated_at`'i repository katmanı tek yerden yazar (gerçek
-- koddaki repository deseniyle tutarlı — daha az sihir, daha az bakım).
-- (Eski `trg_product_touch`/`trg_variant_touch` bu yüzden kaldırıldı.)

-- Ürünün son varyantı silinemez: her ürün en az bir varyant taşımalı.
-- (Bu bir updated_at/touch trigger'ı DEĞİL — iş kuralı; §2.3'ün kapsamı
-- dışında, dokunulmadı.)
CREATE TRIGGER trg_variant_keep_one
BEFORE UPDATE OF deleted_at ON variant
FOR EACH ROW
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
 AND (SELECT COUNT(*) FROM variant
      WHERE product_id = OLD.product_id AND deleted_at IS NULL) <= 1
BEGIN
  SELECT RAISE(ABORT, 'Bir urunun son varyanti silinemez');
END;

-- =============================================================
-- A.8 SEED — Bölüm A'ya uyarlanmış (§6)
--    product_type/product_type_attribute Bölüm B'de olduğu için seed
--    artık "üç sektör" örneğini değil, iki ÇEKİRDEK örneği gösterir:
--    varyantlı ürün (vitrin varyantı DOĞRU kullanılmış) ve varyantsız
--    ürün (yer tutucu, variant_key='').
-- =============================================================

INSERT INTO business (id) VALUES ('biz_demo');

INSERT INTO unit (id, business_id, code, name, decimal_places) VALUES
  ('u_adet','biz_demo','adet','Adet',0),
  ('u_kg',  'biz_demo','kg',  'Kilogram',3),
  ('u_m',   'biz_demo','m',   'Metre',2);

INSERT INTO attribute (id, business_id, code, name, data_type, can_be_axis) VALUES
  ('a_color','biz_demo','color','Renk','option',1),
  ('a_size', 'biz_demo','size', 'Ölçü','option',1);

INSERT INTO attribute_option (id, business_id, attribute_id, value, label, sku_token) VALUES
  ('o_red', 'biz_demo','a_color','RED','Kırmızı','KRM'),
  ('o_blue','biz_demo','a_color','BLU','Mavi','MAV');

-- A) Varyantlı ürün: kumaş, renk ekseni. Kırmızı VİTRİN varyantı
--    (is_primary=1) — ürünün varsayılan gösterilen rengi; mavi değil.
INSERT INTO product (id, business_id, sku, name, category, stock_unit_id, base_price_minor, has_variants, track_lot)
VALUES ('p_kumas','biz_demo','KMS-001','Pamuklu Kumaş','Kumaş','u_m', 12000, 1, 1);

INSERT INTO variant (id, business_id, product_id, sku, variant_key, is_primary) VALUES
  ('v_kumas_red', 'biz_demo','p_kumas','KMS-001-KRM','color=RED',1),
  ('v_kumas_blue','biz_demo','p_kumas','KMS-001-MAV','color=BLU',0);

INSERT INTO variant_attribute (business_id, variant_id, attribute_id, option_id) VALUES
  ('biz_demo','v_kumas_red', 'a_color','o_red'),
  ('biz_demo','v_kumas_blue','a_color','o_blue');

INSERT INTO barcode (id, business_id, code, target_type, target_id) VALUES
  ('bc_kumas_red','biz_demo','8690000000011','variant','v_kumas_red');

-- B) Varyantsız ürün: kullanıcı varyant ekranını hiç görmez, ama arka
--    planda tek YER TUTUCU varyant vardır (variant_key='') → sorgular tek
--    yol. is_primary burada HİÇ kullanılmaz (vitrin kavramı yer tutucuda
--    anlamsızdır — §1.3).
INSERT INTO product (id, business_id, sku, name, category, stock_unit_id, base_price_minor, has_variants)
VALUES ('p_koli','biz_demo','AMB-010','Karton Koli 40x30','Ambalaj','u_adet', 850, 0);

INSERT INTO variant (id, business_id, product_id, sku, variant_key)
VALUES ('v_koli','biz_demo','p_koli','AMB-010','');

-- =============================================================
--  BÖLÜM B — ERTELENENLER  (doküman/referans, çalışan kod DEĞİL)
--  Çok sektörlü bir katalog, kademeli B2B fiyatlandırma veya set/koli
--  ürünleri GERÇEKTEN gerektiğinde bir sonraki adım olarak uygulanacak.
--  Aşağıdaki tablolar Bölüm A'daki tablolara FK verebilir (product,
--  variant) — tersi olmaz: Bölüm A hiçbir Bölüm B tablosuna bağımlı
--  değildir.
-- =============================================================

-- =============================================================
-- B.1 KATEGORİ AĞACI
-- =============================================================

-- SADE HALİ (§2.4): `path` denormalize alanı kaldırıldı — onu güncelleyen
-- hiçbir trigger/kod yoktu. Alt-ağaç sorgusu gerçekten gerekene kadar
-- `parent_id` üzerinden recursive CTE ile hesaplanır.
CREATE TABLE category (
  id          TEXT    PRIMARY KEY,
  business_id TEXT    NOT NULL REFERENCES business(id),
  parent_id   TEXT    REFERENCES category(id) ON DELETE RESTRICT,
  name        TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
) STRICT;
CREATE INDEX ix_category_parent   ON category(parent_id);
-- category'nin başka hiçbir indeksi business_id ile başlamıyor (unique
-- indeksi yok) — bu yüzden burada ayrı bir indeks gerçekten gerekli.
CREATE INDEX ix_category_business ON category(business_id) WHERE deleted_at IS NULL;

-- =============================================================
-- B.2 ÜRÜN TİPİ = SEKTÖR ŞABLONU
--    "Kumaş", "Ambalajlı Gıda", "Bağlantı Elemanı" gibi.
--    Yeni sektör paketi = birkaç product_type + attribute seed'i.
-- =============================================================

CREATE TABLE product_type (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  default_track_lot    INTEGER NOT NULL DEFAULT 0 CHECK (default_track_lot IN (0,1)),
  default_track_serial INTEGER NOT NULL DEFAULT 0 CHECK (default_track_serial IN (0,1)),
  default_track_expiry INTEGER NOT NULL DEFAULT 0 CHECK (default_track_expiry IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
) STRICT;
CREATE UNIQUE INDEX ux_product_type_code ON product_type(business_id, code) WHERE deleted_at IS NULL;

CREATE TABLE product_type_attribute (
  business_id     TEXT    NOT NULL REFERENCES business(id),
  product_type_id TEXT    NOT NULL REFERENCES product_type(id) ON DELETE CASCADE,
  attribute_id    TEXT    NOT NULL REFERENCES attribute(id)    ON DELETE RESTRICT,
  -- 1 ise bu nitelik varyant ekseni: her değeri ayrı varyant/ayrı stok üretir
  -- 0 ise ürün seviyesinde açıklayıcı bilgidir
  is_axis         INTEGER NOT NULL DEFAULT 0 CHECK (is_axis IN (0,1)),
  is_required     INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
  position        INTEGER NOT NULL DEFAULT 0,          -- §3.4: attribute.position kaldırıldığı için SIRA kaynağı artık yalnızca bu
  PRIMARY KEY (product_type_id, attribute_id)
) STRICT, WITHOUT ROWID;

-- =============================================================
-- B.3 ÜRÜN SEVİYESİNDE NİTELİK (eksen olmayan)
-- =============================================================

-- §3.3: `product.extra` (JSON) ile aynı işi görüyordu, ikisi de pratikte
-- kullanılmıyor. Karar: filtrelenebilir ürün niteliği gerçekten gerekene
-- kadar yalnızca Bölüm A'daki `product.extra` kalsın, bu tablo buraya
-- (Bölüm B) taşındı.
CREATE TABLE product_attribute (
  business_id  TEXT NOT NULL REFERENCES business(id),
  product_id   TEXT NOT NULL REFERENCES product(id)   ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attribute(id) ON DELETE RESTRICT,
  option_id    TEXT REFERENCES attribute_option(id)   ON DELETE RESTRICT,
  value_text   TEXT,
  value_number REAL,
  PRIMARY KEY (product_id, attribute_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_product_attr_lookup ON product_attribute(attribute_id, option_id);

-- =============================================================
-- B.4 PAKETLEME  (adet ↔ koli ↔ palet)
--    Sipariş "5 koli" gelir, stok "60 adet" düşer.
-- =============================================================

CREATE TABLE packaging (
  id            TEXT    PRIMARY KEY,
  business_id   TEXT    NOT NULL REFERENCES business(id),
  variant_id    TEXT    NOT NULL REFERENCES variant(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,                     -- 'Koli','Palet','Düzine'
  -- `barcode` kolonu kaldırıldı (§2.5) — artık A.5'teki paylaşılan
  -- `barcode` tablosunda, target_type='packaging'.
  qty_in_stock_unit REAL NOT NULL,                    -- 1 koli = 12 adet (miktar oranı, para DEĞİL — REAL kalır)
  is_default_sales_unit INTEGER NOT NULL DEFAULT 0 CHECK (is_default_sales_unit IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  CHECK (qty_in_stock_unit > 0)
) STRICT;
CREATE INDEX ix_packaging_variant ON packaging(variant_id);

-- =============================================================
-- B.5 SET / KARIŞIK KOLİ  (is_bundle = 1 olan varyantın içeriği)
--    Karışık gıda kolisi, hırdavat seti, promosyon paketi — hepsi aynı yapı.
--    Sipariş satırı tek satır kalır; stok bileşenlerden düşer.
-- =============================================================

CREATE TABLE bundle_item (
  id                   TEXT PRIMARY KEY,
  business_id          TEXT NOT NULL REFERENCES business(id),
  bundle_variant_id    TEXT NOT NULL REFERENCES variant(id) ON DELETE CASCADE,
  component_variant_id TEXT NOT NULL REFERENCES variant(id) ON DELETE RESTRICT,
  quantity             REAL NOT NULL,                 -- miktar oranı, para DEĞİL — REAL kalır
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (quantity > 0),
  CHECK (bundle_variant_id <> component_variant_id)
) STRICT;
-- bundle_variant_id zaten tek bir varyanta (dolayısıyla tek bir business'a)
-- ait — ux_variant_combo/ux_attr_option ile aynı "ebeveyne bağlı" istisnası.
CREATE UNIQUE INDEX ux_bundle_item ON bundle_item(bundle_variant_id, component_variant_id);

-- Set varyantı kendi kendini içeremez (1. seviye koruma; derin döngü kontrolü uygulamada)
CREATE TRIGGER trg_bundle_no_self
BEFORE INSERT ON bundle_item
FOR EACH ROW
WHEN (SELECT is_bundle FROM variant WHERE id = NEW.component_variant_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'Set icinde set kullanilamaz');
END;

-- =============================================================
-- B.6 FİYAT LİSTESİ  (B2B'de neredeyse zorunlu)
-- =============================================================

CREATE TABLE price_list (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  name        TEXT NOT NULL,                          -- 'Toptan','İhracat EUR','Bayi A'
  -- §5.1: para birimi BURADA taşınır (üründe değil) — her fiyat listesi
  -- kendi para biriminde, sipariş de kendi para biriminde; cari bakiye
  -- hesabı buna karışmaz.
  currency    TEXT NOT NULL DEFAULT 'TRY',
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  valid_from  TEXT,
  valid_to    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
) STRICT;
-- price_list'in başka hiçbir indeksi business_id ile başlamıyor — burada
-- ayrı bir indeks gerçekten gerekli (category ile aynı durum).
CREATE INDEX ix_price_list_business ON price_list(business_id) WHERE deleted_at IS NULL;

CREATE TABLE price_list_item (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES business(id),
  price_list_id TEXT NOT NULL REFERENCES price_list(id) ON DELETE CASCADE,
  variant_id    TEXT NOT NULL REFERENCES variant(id)    ON DELETE CASCADE,
  min_quantity  REAL NOT NULL DEFAULT 1,               -- kademeli fiyat (miktar eşiği, para DEĞİL)
  price_minor   INTEGER NOT NULL,                      -- minor unit
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (price_minor >= 0 AND min_quantity > 0)
) STRICT;
-- §1.2'de açıkça listelendi: business_id ile prefiklendi.
CREATE UNIQUE INDEX ux_price_item    ON price_list_item(business_id, price_list_id, variant_id, min_quantity);
CREATE INDEX        ix_price_variant ON price_list_item(variant_id);

-- =============================================================
-- B.7 TEDARİKÇİ KODU & GÖRSEL
-- =============================================================

CREATE TABLE supplier_product (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES business(id),
  variant_id     TEXT NOT NULL REFERENCES variant(id) ON DELETE CASCADE,
  -- §2.6: artık FK'li. Gerçek koddaki cari/contact karşılığı `account`
  -- tablosu (tedarikçi/fasoncu — database-schema.md §6). Bu dosya kendi
  -- başına `account`'u tanımlamıyor; gerçek şemayla birlikte kullanılır.
  supplier_id    TEXT NOT NULL REFERENCES account(id),
  supplier_sku   TEXT,                                -- tedarikçinin kendi kodu
  lead_time_days INTEGER,
  last_cost_minor INTEGER,                             -- minor unit
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
-- §1.2'de açıkça listelendi: business_id ile prefiklendi.
CREATE UNIQUE INDEX ux_supplier_product ON supplier_product(business_id, supplier_id, variant_id);

CREATE TABLE product_media (
  id          TEXT    PRIMARY KEY,
  business_id TEXT    NOT NULL REFERENCES business(id),
  product_id  TEXT    NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  variant_id  TEXT    REFERENCES variant(id) ON DELETE CASCADE,  -- NULL = tüm ürün için
  local_path  TEXT,
  remote_url  TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),  -- "ana görsel" — variant.is_primary'den bağımsız, farklı bir kavram
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),       -- §2.2: eksikti, eklendi
  deleted_at  TEXT
) STRICT;
CREATE INDEX ix_media_product ON product_media(product_id);
