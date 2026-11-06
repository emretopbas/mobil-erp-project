# Lightweight B2B ERP — Ürün Özellik & Ekran Listesi

## Ürün Özeti
**Kime:** Küçük/orta ölçekli üretici ve toptancılar (tekstil, ayakkabı, el işi/zanaat ürünleri, gıda üretimi vb.) — Avrupa, Kuzey Amerika, Güney Amerika odaklı.
**Ne:** WhatsApp/Telegram/Email/SMS gibi kanallardan gelen dağınık B2B siparişleri AI ile otomatik yapılandırılmış veriye çeviren, stok ve basit ön muhasebeyi tek yerde toplayan, karmaşık olmayan bir operasyon aracı.
**Neden farklı:** Shopify/Etsy gibi devler B2C vitrin + ödeme altyapısı sunuyor. Bu araç B2C vitrini değil, **arka ofis operasyonunu** (sipariş algılama, stok, ekip, nakit akışı) hedefliyor — rakip değil, tamamlayıcı.

---

## Çekirdek Modüller

### 1. Çok Kanallı Gelen Kutusu (Unified Inbox)
- WhatsApp Business, Telegram, Email, SMS bağlantıları (adapter mimarisi)
- Tüm mesajlar tek akışta, kanal etiketiyle
- Müşteri bazında konuşma geçmişi (telefon/email/username kimlik birleştirme)

### 2. NLP Sipariş Algılama (ürünün kalbi)
- Metin veya sesli nottan otomatik sipariş çıkarma (ürün, beden/varyant, adet, fiyat)
- Belirsiz/eksik bilgide otomatik netleştirme sorusu gönderme
- Çıkarılan siparişi onaya sunma (müşteriye veya işletme sahibine)
- Çok dilli algılama (gelen mesaj hangi dilde olursa olsun)

### 3. Stok & Üretim Takibi
- Basit stok seviyeleri (SKU/varyant bazlı)
- Üretim aşaması etiketleri (örn: numune → üretimde → hazır → sevk edildi)
- Düşük stok uyarısı
- Müşteriye otomatik durum güncellemesi ("siparişiniz üretimde")

### 4. Basit Ekip/Personel Yönetimi
- Personel listesi, rol atama (üretim/sevkiyat/satış)
- Sipariş/görev atama ve durum takibi
- Basit vardiya/görev notu (bordro veya karmaşık İK değil)

### 5. Ön Muhasebe (Lite)
- Gider kalemleri (kategori bazlı: hammadde, kira, işçilik, kargo vb.)
- Gelir kaynakları (sipariş bazlı otomatik, manuel de eklenebilir)
- Basit raporlar: aylık gelir-gider özeti, en çok satan ürün, müşteri bazlı ciro
- **Kapsam dışı (bilinçli):** fatura kesme, vergi, resmi muhasebe entegrasyonu — bunlar yok, sadece görünürlük

### 6. Çeviri Katmanı (opsiyonel eklenti)
- Gelen/giden mesaj otomatik çeviri
- İleri seviye: sesli mesaj çevirisi (yalnızca ücretli katmanda)

---

## Free Tier Kapsamı (öneri)
- 1 kanal bağlantısı (örn. sadece WhatsApp veya sadece Telegram)
- Aylık sipariş/mesaj limiti (örn. 100 sipariş/ay)
- Temel stok + 1 kullanıcı
- Basit raporlar (aylık özet)
- **Ücretli katmanlar:** çoklu kanal, sınırsız sipariş, çoklu kullanıcı/ekip, çeviri + ses klonlama, gelişmiş raporlar

---

## Claude Design için Ekran Listesi

1. **Onboarding / Kanal Bağlama** — WhatsApp/Telegram/Email bağlantı kartları, adım adım kurulum
2. **Ana Panel (Dashboard)** — günlük özet: yeni siparişler, düşük stok uyarıları, bugünkü gelir/gider, bekleyen onaylar
3. **Birleşik Gelen Kutusu** — sol tarafta konuşma listesi (kanal ikonlu), sağda mesaj akışı + "algılanan sipariş" kartı
4. **Sipariş Onay Kartı** — AI'nin çıkardığı sipariş satırları (ürün/adet/fiyat), düzenlenebilir alanlar, onayla/reddet butonları
5. **Sipariş Listesi** — durum bazlı görünüm (yeni/üretimde/hazır/sevk edildi), filtreleme
6. **Stok Yönetimi** — ürün/varyant listesi, stok seviyesi, düşük stok uyarı rozetleri
7. **Ekip Ekranı** — personel listesi, atanan görevler, basit durum takibi
8. **Ön Muhasebe / Raporlar** — gelir-gider grafik özeti, kategori bazlı gider dağılımı, en çok satan ürünler
9. **Müşteri Profili** — birleşik iletişim geçmişi (tüm kanallardan), sipariş geçmişi, toplam ciro
10. **Ayarlar** — kanal yönetimi, dil/çeviri tercihleri, plan/fatura bilgisi

---

## Tasarım Vurguları
- **Sadelik önce:** Odoo/Zoho'nun aksine, tek bakışta anlaşılır — KOBİ sahibi muhasebeci değil
- **Mobil-first:** işletme sahibi çoğu zaman sahada/atölyede, masaüstünde değil
- **Kanal kimliği görünür kalmalı:** her mesajın hangi platformdan geldiği net (ikon/renk kodu)
- **AI şeffaflığı:** "bu sipariş AI tarafından algılandı" göstergesi + kolay düzeltme — güven inşası için kritik
