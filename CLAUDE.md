# Lightweight B2B ERP — Claude Code Yapım Şartnamesi
### Faz 1: Uygulama İskeleti (Skeleton)

> Bu doküman Claude Code için bir **yapım şartnamesi ve kural setidir**. Amaç, uygulamanın çalışan bir iskeletini (auth + veri katmanı + çekirdek modüller + backend servisleri) kurmaktır. NLP ve kanal entegrasyonları **bu fazda YAPILMAYACAK** — sadece ileride sorunsuz eklenebilecekleri "boşluklar" (interface/stub) bırakılacak.

---

## 1. Faz Ayrımı (KRİTİK — önce bunu oku)

### FAZ 1 — Şimdi yapılacak (bu şartnamenin kapsamı)
- Kimlik doğrulama (Firebase Auth) + tenant/işletme yapısı
- Veri katmanı: SQLite (yerel) + Turso senkron katmanı iskeleti
- Çekirdek modüller ve iş kuralları:
  - Stok giriş/çıkış
  - Eleman (personel) yönetimi
  - Mesai / görev atama
  - Rol ve yetkilendirme (RBAC)
  - Gelir / gider tabloları + basit raporlar
- Backend servisleri (auth, repository, sync-stub, backup, notification)
- Firebase bağlantıları (Auth, FCM, Storage)

### FAZ 2 — ERTELENDİ (şu an KOD YAZILMAYACAK, sadece arayüz/stub bırakılacak)
- NLP tabanlı sipariş algılama (metin + sesli not → yapılandırılmış sipariş)
- Kanal entegrasyonları (WhatsApp Business, Telegram, Email, SMS) — adapter mimarisi
- Çeviri katmanı (metin çeviri + ses klonlama/dublaj)

> **Kural:** Faz 1'de yazılan hiçbir modül, Faz 2 geldiğinde yeniden yazmayı (refactor) gerektirmemeli. `Order` modeli, `Channel` arayüzü ve bir `OrderIngestionService` **interface** olarak tanımlanacak ama içi Faz 1'de sadece **manuel sipariş girişi** ile doldurulacak. NLP'yi çağıran metotlar `NotImplemented` stub'ı olarak bırakılacak.

---

## 2. Teknoloji Yığını (Tech Stack)

| Katman | Seçim | Gerekçe |
|---|---|---|
| Uygulama | **Expo / React Native + TypeScript** | Mobil öncelikli (işletme sahibi sahada/atölyede); tek kod tabanı iOS+Android. Claude Design'ın React çıktısı görsel/yapısal referans olarak kullanılır, RN primitifleriyle yeniden yazılır. |
| Yerel veritabanı | **SQLite** (`op-sqlite` veya `expo-sqlite`) | Cihazda birincil veri deposu, çevrimdışı çalışır, işlem başına maliyet yok. |
| Senkron (takım katmanı) | **Turso / libSQL embedded replicas** | Çok kullanıcılı gerçek zamanlı senkron; yerel SQLite'ın hızını korur, yazma merkeze gider. Solo katmanda devre dışı. |
| Kimlik | **Firebase Auth** | Cömert ücretsiz katman (email/telefon/social), hazır SDK. |
| Bildirim | **Firebase Cloud Messaging (FCM)** | Ücretsiz sınırsız; düşük stok / görev atama bildirimleri için. |
| Yedekleme (solo katman) | Şifreli SQLite blob → **Firebase Storage** (veya S3 uyumlu) | Günde 1 kez tek dosya yükleme; işlem-bazlı Firestore maliyetinden kaçınır. |
| Backend | İnce katman: Firebase servisleri; Faz 2 webhook'ları için Cloud Functions ayrılır | Turso'ya doğrudan SDK ile erişildiği için ağır bir API sunucusu gerekmez. |

> **YASAK:** Operasyonel veriyi (sipariş, stok, görev, finans) **Firestore'a yazma**. Firestore işlem başına ücretlendirir ve ölçekte maliyeti patlatır. Firestore yalnızca küçük yapılandırma/metadata için (gerekirse) düşünülebilir. Operasyonel veri = SQLite + Turso.

---

## 3. Veri Katmanı Stratejisi (katmanlı)

- **Solo / Free (1 kullanıcı):** Saf yerel SQLite. Günde 1 kez (veya değişiklik biriktikçe) **şifreli** yedek Firebase Storage'a yüklenir. Senkron yok.
- **Takım / Ücretli (2+ kullanıcı):** Turso embedded replica. Okumalar yerelden anında; yazmalar arka planda merkezî libSQL'e senkron. Gerçek zamanlı ekip koordinasyonu.
- **Soyutlama zorunlu:** UI asla doğrudan SQL çağırmaz. Tüm veri erişimi bir **Repository arayüzü** üzerinden geçer. `SqliteRepository` (Faz 1) ve `TursoSyncRepository` (takım katmanı) aynı arayüzü uygular — böylece depolama arka ucu değiştirilebilir.
- **Tek yazıcı sınırı notu:** SQLite/libSQL tek-yazıcı modeline dayanır. Hedef segment (3–10 kişilik ekipler, saniyede birkaç yazma) için sorun değil; kod bunu varsayabilir.
- **Kalıcılık ve "önbellek temizliği" güvenliği:** SQLite verisi cihazın **kalıcı veri dizininde** tutulur (cache dizininde DEĞİL). Normal "önbellek temizliği" (clear cache) yalnızca cache dizinini boşaltır → **veri kaybolmaz.** Ancak "uygulama verilerini temizle" (clear data/storage) veya uygulamayı kaldırma → veri gider. Bu senaryoların güvenlik ağı: solo katmanda **günlük şifreli yedek**, takım katmanında **Turso senkron**. Yeniden kurulum/yeni cihaz akışında "yedekten geri yükle" birinci sınıf bir özellik olmalı.

```
UI (React Native)
   │
   ▼
Service Layer  ← yetki kontrolü, iş kuralları burada
   │
   ▼
Repository (interface)
   ├── SqliteRepository        (solo + yerel)
   └── TursoSyncRepository     (takım katmanı)
```

---

## 4. Veri Modeli (Schema)

> Para birimi: tüm parasal alanlar **tam sayı (minor unit, örn. kuruş/cent)** + **ISO 4217 currency kodu** olarak tutulur. Çok ülkeli ihracat senaryosu için baştan çok para birimli tasarlanır; FX dönüşümü Faz 1'de YOK, sadece alan mevcut.
> Silme: **hard delete YOK.** Her tabloda `is_active` / `deleted_at` (soft delete) — denetim izi + KVKK/GDPR.
> Zaman: tüm timestamp'ler **UTC**.

```sql
-- İşletme (tenant)
Business(id, name, base_currency, plan_tier /* solo|team */, created_at)

-- Kimlik (Firebase Auth uid ile eşlenir) + personel
Employee(
  id, business_id, firebase_uid, display_name, email, phone,
  role /* owner|manager|production|sales|viewer */,
  is_active, created_at, deleted_at
)

-- Ürün + varyant (ayakkabı: beden × renk gibi)
Product(id, business_id, name, sku, base_price_minor, currency, is_active, ...)
ProductVariant(id, product_id, attributes /* JSON: {size, color} */, sku, is_active)

-- Stok hareketi (mevcut stok = hareketlerin toplamı VEYA running balance)
StockMovement(
  id, business_id, variant_id,
  type /* in|out|adjustment */, quantity, reason, note,
  related_order_id NULL, created_by /* employee_id */, created_at
)
-- opsiyonel hızlı erişim için:
StockLevel(variant_id, on_hand, low_stock_threshold)

-- Görev / mesai atama
Task(
  id, business_id, title, description,
  assignee_id /* employee */, status /* todo|in_progress|done */,
  due_date, related_order_id NULL, created_by, created_at, deleted_at
)
Shift(id, business_id, employee_id, date, note)   -- basit; İK/bordro DEĞİL

-- Finans
ExpenseEntry(
  id, business_id, category /* raw_material|rent|labor|shipping|other */,
  amount_minor, currency, date, note, related_order_id NULL,
  payment_method /* cash|credit_card|check */, created_by, deleted_at
)
RevenueEntry(
  id, business_id, source /* order|manual */, related_order_id NULL,
  amount_minor, currency, date, note,
  payment_method /* cash|credit_card|check */, created_by, deleted_at
)

-- Çek takibi (payment_method=check olduğunda oluşur/bağlanır)
Check(
  id, business_id,
  direction /* received (müşteriden) | issued (tedarikçiye) */,
  related_entry_id /* RevenueEntry veya ExpenseEntry */, related_entry_type,
  check_number, bank_name, amount_minor, currency,
  issue_date, due_date /* vade */,
  status /* pending | cleared | bounced | cashed */,
  note, created_by, created_at, deleted_at
)

-- FAZ 2 tohumu: şimdi SADECE manuel doldurulur, NLP yok
Customer(id, business_id, name, primary_channel, contact_ref, is_active, deleted_at)
Order(
  id, business_id, customer_id, status /* draft|confirmed|in_production|ready|shipped */,
  source /* manual (faz1) | nlp (faz2) */, currency, created_by, created_at, deleted_at
)
OrderLine(id, order_id, variant_id, quantity, unit_price_minor)
```

---

## 5. Modül Kural Setleri (İş Kuralları)

### 5.1 Stok Giriş/Çıkış
- Her hareket bir `variant_id` referansı taşımak **zorunda**.
- `type=out` işleminde, `on_hand - quantity < 0` ise: varsayılan olarak **engelle** (işletme ayarıyla "negatife izin ver" açılabilir).
- Her hareket `created_by` ve `created_at` ile **değiştirilemez log** olarak yazılır; düzeltme silme değil, ters `adjustment` hareketi ile yapılır.
- `on_hand <= low_stock_threshold` olduğunda FCM bildirimi tetiklenir.

### 5.2 Eleman (Personel) Yönetimi
- Personel eklerken zorunlu: `display_name`, `role`. `firebase_uid` davet kabul edilince bağlanır.
- Çıkarma = **soft delete** (`is_active=false`, `deleted_at`), kayıtları ve geçmiş atamaları silmez.
- Bir işletmede **en az 1 `owner`** her zaman aktif kalmalı — son owner pasifleştirilemez.

### 5.3 Mesai / Görev Atama
- `Task` bir çalışana atanır; durum akışı: `todo → in_progress → done` (geri alınabilir).
- Bir çalışan yalnızca **kendi** görevlerinin durumunu değiştirebilir; `manager`/`owner` herkesinkini.
- `Shift` basit tutulur (tarih + not); bordro/ücret hesabı **kapsam dışı**.

### 5.4 Rol ve Yetkilendirme (RBAC)
- Yetki kontrolü **service layer'da** yapılır, UI'da değil. UI sadece butonları gizler; asıl kapı serviste.

| Kaynak / Rol | owner | manager | production | sales | viewer |
|---|---|---|---|---|---|
| Ürün/varyant | CRUD | CRUD | oku | oku | oku |
| Stok hareketi | CRUD | CRUD | CRUD | oku | oku |
| Sipariş (manuel) | CRUD | CRUD | oku | CRUD | oku |
| Görev atama | tümü | tümü | kendi | kendi | oku |
| Personel | CRUD | CRUD | — | — | — |
| Finans (gelir/gider) | CRUD | CRUD | — | — | — |
| Raporlar | tümü | tümü | kısıtlı | kısıtlı | oku |
| Ayarlar / plan | CRUD | — | — | — | — |

### 5.5 Gelir / Gider Tabloları
- `RevenueEntry.source=order` olanlar sipariş onaylanınca **otomatik** oluşturulabilir; `manual` olanlar elle eklenir.
- Gider kategorileri sabit enum ile başlar (raw_material, rent, labor, shipping, other) — sonradan genişletilebilir.
- Basit raporlar (Faz 1): aylık gelir–gider özeti, kategori bazlı gider dağılımı, en çok satan varyant, müşteri bazlı ciro. Karmaşık muhasebe/vergi/fatura **YOK**.
- Farklı para birimli kayıtlar rapor edilirken **dönüştürülmez**, para birimine göre gruplanır (FX Faz 2+).

### 5.6 Ödeme Yöntemi ve Çek Takibi
- Her gelir/gider kaydı bir `payment_method` taşır: `cash | credit_card | check` (havale/bank_transfer ileride kolayca eklenebilir).
- `payment_method=check` seçilirse, kayda bağlı bir `Check` kaydı oluşturulur (zorunlu alanlar: `direction`, `amount`, `due_date`).
- **Çek durum akışı:** `pending → cleared` (tahsil/ödendi) veya `pending → bounced` (karşılıksız). `cashed` = elden bozduruldu.
- **Vade (`due_date`) hatırlatması:** düşük stok bildirimiyle aynı mantıkla, vadesi yaklaşan çekler için FCM bildirimi (örn. 3 gün kala).
- Çek raporu (Faz 1, basit): yaklaşan vadeler listesi + toplam bekleyen (received) / ödenecek (issued) çek tutarı, para birimine göre gruplu.
- Nakit ve kredi kartı için ekstra takip yok — sadece `payment_method` etiketi raporlarda dağılım için kullanılır.

---

## 6. Backend Servis Yapısı (Faz 1)

Her biri net bir arayüz (interface) olarak tanımlanır:

- `AuthService` — Firebase Auth sarmalayıcı (giriş, davet, uid ↔ Employee eşleme).
- `Repository` — CRUD arayüzü (bkz. bölüm 3); implementasyon `SqliteRepository`.
- `SyncService` — Turso push/pull; Faz 1'de takım katmanı için **temel** implementasyon veya stub (solo'da no-op).
- `BackupService` — SQLite dosyasını şifreleyip Storage'a yükleme (günlük tetik).
- `NotificationService` — FCM ile düşük stok / görev atama bildirimi.
- `OrderIngestionService` — **interface tanımlanır, içi Faz 1'de sadece manuel giriş.** `ingestFromChannel()` metodu `NotImplemented` stub.

---

## 7. Firebase Entegrasyon Noktaları

1. **Auth:** email + (opsiyonel) telefon; her kullanıcı bir `Employee.firebase_uid`'e bağlanır.
2. **FCM:** cihaz token'ı `Employee` ile eşlenir; bildirim tetikleyicileri service layer'da.
3. **Storage:** solo katman şifreli yedek hedefi. Dosya adı `business_id/date.enc`.
4. **Firestore:** operasyonel veri için **KULLANILMAYACAK** (bkz. bölüm 2 uyarısı).
5. **Cloud Functions:** Faz 1'de boş/minimal; Faz 2 kanal webhook'ları için ayrılmış alan.

---

## 8. Kodlama Kuralları (Claude Code için)

- **TypeScript strict mode** açık; `any` yasak (zorunlu hallerde gerekçeli).
- UI'dan **doğrudan DB/SQL çağrısı yok** — her şey Repository üzerinden.
- **Yetki kontrolü her zaman service layer'da** — UI gizleme yeterli değil.
- **Hard delete yok** — soft delete + `deleted_at`.
- **Para = integer minor unit + currency**; float ile para tutma yasak. Depolama tam sayıdır (örn. `12345`), gösterim katmanı `/100` yapıp yerel formatla basar (örn. `123,45 ₺`). Ondalık **kaybolmaz** — sadece hesap/depolama tam sayıda, ekranda formatlanır. Bir merkezi `formatMoney(amountMinor, currency)` yardımcısı kullan; UI hiçbir yerde ham tam sayıyı göstermez.
- **Veri dayanıklılığı:** SQLite dosyası **kalıcı veri dizinine** yazılır (Expo `FileSystem.documentDirectory` / uygulamanın private data dizini), **asla cache dizinine değil**. Cache dizini OS tarafından veya kullanıcı "önbellek temizliği" yaptığında silinebilir; kalıcı dizin silinmez. (Detaylı gerekçe: bölüm 3 notu.)
- **Tüm zaman UTC**, gösterimde yerelleştir.
- **Faz 2 dikişleri:** `Channel`, `OrderIngestionService`, çeviri servisi **interface** olarak durur, implementasyon boş stub. Faz 1 kodu bu arayüzlere göre yazılır ki sonradan refactor gerekmesin.
- Her modül için **birim test** iskeleti (en azından iş kuralları: negatif stok engeli, RBAC kapıları, son-owner koruması).

---

## 9. İskelet Yapım Sırası (Claude Code görev listesi)

1. Proje kurulumu: Expo + TypeScript, klasör yapısı (`/ui`, `/services`, `/repository`, `/models`, `/db`).
2. SQLite şeması + migration + `Repository` arayüzü ve `SqliteRepository`.
3. Firebase Auth entegrasyonu + `Business` / `Employee` oluşturma akışı.
4. RBAC: rol enum, yetki matrisi, service-layer guard'ları.
5. Modüller (sırayla): Personel → Ürün/Varyant → Stok hareketi → Görev/Mesai → Gelir/Gider.
6. Basit raporlar (aylık özet, kategori dağılımı).
7. `NotificationService` (FCM) — düşük stok + görev atama.
8. `BackupService` — şifreli günlük yedek (solo).
9. `SyncService` (Turso) — takım katmanı iskeleti.
10. Faz 2 arayüzleri: `Channel`, `OrderIngestionService`, çeviri servisi — **boş stub** olarak yerleştir.

> Bittiğinde elde edilmesi gereken: giriş yapılabilen, personel/ürün/stok/görev/finans girişi yapılıp raporlanabilen, çevrimdışı çalışan, yedeklenen bir **çalışan iskelet**. NLP ve kanallar henüz yok ama onlar için hazır boşluklar mevcut.
