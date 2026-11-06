import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, Dialog, Divider, Field, Heading, Input, Tag, color, font, space } from '@/design-system';
import { autoBarcodeFromSku } from '@/lib/barcode';
import {
  canonicalNumberString,
  canonicalVariantKey,
  renderSkuTemplate,
  type Axis,
  type AxisValue,
  type Combination,
} from '@/lib/variantAxes';
import type { AttributeDataType, AxisPreset, Product } from '@/models';
import { attributeService, productService, type ActorContext, type AttributeWithOptions, type DefaultVariantUsage, type VariantDetails } from '@/services';
import { useReloadOnMount } from '@/hooks/use-reload';

import { AttributeChipInput } from './AttributeChipInput';

interface SelectedAxis {
  attributeId: string;
  code: string;
  name: string;
  dataType: AttributeDataType;
  unitLabel: string | null;
  values: AxisValue[];
}

type Step = 'axes' | 'grid' | 'details';

const MAX_COMFORTABLE_AXES = 3;

/** Eksen tabanlı varyant sistemi — Adım A (eksenleri belirle) → Adım B
 * (ızgarayı buda) → Adım C (detayları doldur). Ürün kartındaki eski flat
 * "+ Varyant ekle" formunun yerine geçer; kaydettiği her şey
 * `ProductService.previewCombinations`/`commitVariants` üzerinden gerçek
 * `Attribute`/`AttributeOption`/`VariantAttribute` satırları olarak yazılır.
 *
 * İnce bir dış sarmalayıcı + `visible` iken monte edilen bir iç `Content` —
 * `ProductStockGroup`'un `VariantStockDialog`/`VariantStockDialogContent`
 * ayrımıyla aynı desen (bkz. o dosyanın yorumu). Bu, "her açılışta sıfırdan
 * başla" davranışını bedava veriyor: `Content` her kapanışta unmount olur,
 * her açılışta taze `useState` başlangıç değerleriyle yeniden monte olur —
 * elle bir `reset()` çağrısına gerek yok. Daha da önemlisi, `Content`'in
 * kendi `useReloadOnMount`'u artık her açılışta (sadece ürün kartının ilk
 * mount'unda değil) yeniden çalışıyor — bu da ürünün var olan eksenlerini
 * (`getProductAxes`) HER açılışta taze çekip Adım A'yı önceden doldurmayı
 * mümkün kılıyor (product feedback: "aynı eksenlere ... yeni varyantlar
 * ekleyebilmeliyim" — kullanıcı Renk/Beden'i her seferinde sıfırdan
 * kurmak zorunda kalmamalı, sadece yeni bir değer eklemeli). */
export function VariantAxisWizard({
  ctx,
  product,
  visible,
  onClose,
  onCommitted,
}: {
  ctx: ActorContext;
  product: Product;
  visible: boolean;
  onClose: () => void;
  onCommitted: () => void;
}) {
  return (
    <Dialog visible={visible} onRequestClose={onClose} title="Varyant ekle">
      {visible && <VariantAxisWizardContent key={product.id} ctx={ctx} product={product} onClose={onClose} onCommitted={onCommitted} />}
    </Dialog>
  );
}

function VariantAxisWizardContent({
  ctx,
  product,
  onClose,
  onCommitted,
}: {
  ctx: ActorContext;
  product: Product;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [step, setStep] = useState<Step>('axes');
  const [attributes, setAttributes] = useState<AttributeWithOptions[] | null>(null);
  const [presets, setPresets] = useState<AxisPreset[] | null>(null);
  // Ürünün zaten kullandığı eksenlerle önceden doldurulur (aşağıdaki
  // `reload`), boş değil — böylece "Renk × Beden"e yeni bir değer eklemek
  // eksenleri sıfırdan yeniden kurmayı gerektirmiyor.
  const [selectedAxes, setSelectedAxes] = useState<SelectedAxis[]>([]);
  // Üründe stok hareketi olan bir varyant varsa true — SADECE "+ Eksen
  // ekle"/"Ekseni kaldır" kontrollerini gizler, eksen DEĞERİ eklemeyi asla
  // engellemez (bkz. ProductService.canEditAxes'in doc yorumu).
  const [axesLocked, setAxesLocked] = useState(false);
  const [preview, setPreview] = useState<{ new: Combination[]; existing: Combination[] } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Eksensiz "default" varyant stok/sipariş/alım geçmişi taşıyorsa silinemez:
  // kullanıcı hangi kombinasyona dönüştürüleceğini seçer (bkz.
  // ProductService.commitVariants).
  const [defaultUsage, setDefaultUsage] = useState<DefaultVariantUsage | null>(null);
  const [convertKey, setConvertKey] = useState<string | null>(null);

  // Sadece `attributes`/`presets`'i tazeler — yeni bir eksen/değer
  // oluşturulduğunda (`StepAxes`'in `onAttributesChanged`'i) çağrılır.
  // Kasıtlı olarak `selectedAxes`'e dokunmaz: aşağıdaki `reload`'un aksine,
  // bu her tuş vuruşunda tetiklenebilir ve `selectedAxes`'i sunucudaki
  // "var olan eksenler" durumuna geri sıfırlarsa kullanıcının o an
  // üzerinde çalıştığı (henüz kaydedilmemiş) eksen/değer seçimini silerdi.
  const loadAttributes = useCallback(async () => {
    const [attrs, ps] = await Promise.all([attributeService.list(ctx), attributeService.listPresets(ctx)]);
    setAttributes(attrs);
    setPresets(ps);
  }, [ctx]);

  // Sadece mount'ta (= bu diyalog her açılışında, üstteki dış sarmalayıcının
  // yorumuna bkz.) çalışır: `attributes`/`presets`'in yanında ürünün var
  // olan eksenlerini de (`getProductAxes`) çekip `selectedAxes`'i önceden
  // doldurur — bu yüzden `loadAttributes`'ten ayrı tutuluyor.
  const reload = useCallback(async () => {
    const [attrs, ps, existingAxes, editable, usage] = await Promise.all([
      attributeService.list(ctx),
      attributeService.listPresets(ctx),
      productService.getProductAxes(ctx, product.id),
      productService.canEditAxes(ctx, product.id),
      productService.getDefaultVariantUsage(ctx, product.id),
    ]);
    setDefaultUsage(usage);
    setAttributes(attrs);
    setPresets(ps);
    setAxesLocked(!editable);
    setSelectedAxes(
      existingAxes.map((axis) => {
        const attr = attrs.find((a) => a.id === axis.attributeId);
        return {
          attributeId: axis.attributeId,
          code: axis.code,
          name: attr?.name ?? axis.code,
          dataType: axis.dataType,
          unitLabel: attr?.unit_label ?? null,
          values: axis.values,
        };
      }),
    );
  }, [ctx, product.id]);

  useReloadOnMount(reload);

  const close = () => {
    onClose();
  };

  const saveNoVariant = async () => {
    setBusy(true);
    setError(null);
    try {
      await productService.createDefaultVariant(ctx, product.id, product.sku);
      onCommitted();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Gerçek bir çarpım — herhangi bir eksenin henüz değeri yoksa (kullanıcı
  // eksen ekleyip değer girmeyi henüz bitirmemiş) sonuç 0 olmalı, yanıltıcı
  // bir "1 varyant" göstermemeli.
  const combinationCount = selectedAxes.length === 0 ? 0 : selectedAxes.reduce((n, a) => n * a.values.length, 1);
  const readyForGrid = selectedAxes.length > 0 && selectedAxes.every((a) => a.values.length > 0);

  const goToGrid = async () => {
    setBusy(true);
    setError(null);
    try {
      const axesInput: Axis[] = selectedAxes.map((a) => ({ attributeId: a.attributeId, code: a.code, dataType: a.dataType, values: a.values }));
      const result = await productService.previewCombinations(ctx, product.id, axesInput);
      setPreview(result);
      setSelectedKeys(new Set(result.new.map((c) => canonicalVariantKey(c))));
      setStep('grid');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const goToDetails = () => setStep('details');

  const commit = async (rows: Map<string, VariantDetails>) => {
    if (!preview) return;
    if (defaultUsage?.inUse && !convertKey) {
      setError('Mevcut varsayılan varyantın geçmişi var — önce hangi kombinasyona dönüştürüleceğini seçin.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const toCreate = preview.new.filter((c) => selectedKeys.has(canonicalVariantKey(c)));
      await productService.commitVariants(ctx, product.id, toCreate, rows, { convertDefaultToKey: convertKey ?? undefined });
      onCommitted();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = async (preset: AxisPreset) => {
    try {
      const definition = JSON.parse(preset.definition) as { attributeId: string; values: AxisValue[] }[];
      if (!attributes) return;
      const next: SelectedAxis[] = [];
      for (const entry of definition) {
        const attr = attributes.find((a) => a.id === entry.attributeId);
        if (!attr) continue;
        next.push({ attributeId: attr.id, code: attr.code, name: attr.name, dataType: attr.data_type, unitLabel: attr.unit_label, values: entry.values });
      }
      setSelectedAxes(next);
      await attributeService.applyPreset(ctx, preset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const title = step === 'axes' ? 'Varyant · Eksenleri belirle' : step === 'grid' ? 'Varyant · Kombinasyonları seç' : 'Varyant · Detayları doldur';

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Heading level={4}>{title}</Heading>
        {!!error && <BodyText style={styles.error}>{error}</BodyText>}

        {step === 'axes' && (
          <StepAxes
            ctx={ctx}
            attributes={attributes}
            presets={presets}
            selectedAxes={selectedAxes}
            setSelectedAxes={setSelectedAxes}
            axesLocked={axesLocked}
            onAttributesChanged={loadAttributes}
            onApplyPreset={applyPreset}
            combinationCount={combinationCount}
          />
        )}

        {step === 'grid' && preview && (
          <StepGrid axes={selectedAxes} preview={preview} selectedKeys={selectedKeys} setSelectedKeys={setSelectedKeys} />
        )}

        {step === 'details' && preview && defaultUsage?.inUse && (
          <View style={styles.convertBox}>
            <Heading level={5}>Mevcut varsayılan varyant ({defaultUsage.variant.sku})</Heading>
            <BodyText muted>
              Bu varyantın geçmişi var ({defaultUsage.movementCount} stok hareketi
              {defaultUsage.orderLineCount > 0 ? `, ${defaultUsage.orderLineCount} sipariş satırı` : ''}
              {defaultUsage.purchaseLineCount > 0 ? `, ${defaultUsage.purchaseLineCount} alım satırı` : ''}). Silinmez; seçtiğiniz kombinasyona dönüştürülür ve
              stoğu korunur:
            </BodyText>
            <View style={styles.convertChips}>
              {preview.new
                .filter((c) => selectedKeys.has(canonicalVariantKey(c)))
                .map((c) => {
                  const key = canonicalVariantKey(c);
                  const selected = convertKey === key;
                  return (
                    <Pressable key={key} onPress={() => setConvertKey(key)} style={[styles.convertChip, selected && styles.convertChipOn]}>
                      <Text style={[styles.convertChipText, selected && styles.convertChipTextOn]}>{c.picks.map((pick) => pick.value.label).join(' · ')}</Text>
                    </Pressable>
                  );
                })}
            </View>
          </View>
        )}

        {step === 'details' && preview && (
          <StepDetails
            product={product}
            axes={selectedAxes}
            combinations={preview.new.filter((c) => selectedKeys.has(canonicalVariantKey(c)))}
            busy={busy}
            onSave={commit}
          />
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step === 'axes' && (
          <>
            <Button label="Varyant yok, direkt kaydet" variant="ghost" disabled={busy} onPress={() => void saveNoVariant()} />
            <View style={styles.footerRow}>
              <Button label="Vazgeç" variant="secondary" onPress={close} />
              <Button label={busy ? '…' : 'İleri'} variant="primary" disabled={busy || !readyForGrid} onPress={() => void goToGrid()} />
            </View>
          </>
        )}
        {step === 'grid' && (
          <View style={styles.footerRow}>
            <Button label="Geri" variant="secondary" onPress={() => setStep('axes')} />
            <Button label="İleri" variant="primary" disabled={selectedKeys.size === 0} onPress={goToDetails} />
          </View>
        )}
        {step === 'details' && (
          <View style={styles.footerRow}>
            <Button label="Geri" variant="secondary" onPress={() => setStep('grid')} />
          </View>
        )}
      </View>
    </>
  );
}

// ─── Adım A ─────────────────────────────────────────────────────────────

function StepAxes({
  ctx,
  attributes,
  presets,
  selectedAxes,
  setSelectedAxes,
  axesLocked,
  onAttributesChanged,
  onApplyPreset,
  combinationCount,
}: {
  ctx: ActorContext;
  attributes: AttributeWithOptions[] | null;
  presets: AxisPreset[] | null;
  selectedAxes: SelectedAxis[];
  setSelectedAxes: (axes: SelectedAxis[]) => void;
  /** true ⇒ üründe stok hareketi olan bir varyant var, eksen SETİ (hangi
   * attribute'lar kullanılıyor) sabitlendi — sadece "+ Eksen ekle"/"Ekseni
   * kaldır"/hazır set uygulama kontrollerini gizler, aşağıdaki
   * `AttributeChipInput`'lar (yeni DEĞER ekleme) her zaman açık kalır. */
  axesLocked: boolean;
  onAttributesChanged: () => Promise<void>;
  onApplyPreset: (preset: AxisPreset) => Promise<void>;
  combinationCount: number;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState('');

  const selectedIds = new Set(selectedAxes.map((a) => a.attributeId));
  const availableAttributes = (attributes ?? []).filter((a) => !selectedIds.has(a.id));

  const addAxis = (attr: AttributeWithOptions) => {
    setSelectedAxes([
      ...selectedAxes,
      { attributeId: attr.id, code: attr.code, name: attr.name, dataType: attr.data_type, unitLabel: attr.unit_label, values: [] },
    ]);
    setShowAdd(false);
  };

  const removeAxis = (attributeId: string) => {
    setSelectedAxes(selectedAxes.filter((a) => a.attributeId !== attributeId));
  };

  const updateAxisValues = (attributeId: string, values: AxisValue[]) => {
    setSelectedAxes(selectedAxes.map((a) => (a.attributeId === attributeId ? { ...a, values } : a)));
  };

  const resolveValueFor = (axis: SelectedAxis) => async (raw: string): Promise<AxisValue | null> => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (axis.dataType === 'number') {
      const n = Number(trimmed.replace(',', '.'));
      if (Number.isNaN(n)) throw new Error(`"${raw}" geçerli bir sayı değil.`);
      const canonical = canonicalNumberString(n);
      return { label: axis.unitLabel ? `${canonical} ${axis.unitLabel}` : canonical, canonicalValue: canonical };
    }
    if (axis.dataType === 'text') {
      return { label: trimmed, canonicalValue: trimmed };
    }
    // 'option' — mevcut bir değere (büyük/küçük harf duyarsız) karşılık
    // geliyorsa onu yeniden kullan, yoksa yeni bir attribute_option oluştur.
    const attr = attributes?.find((a) => a.id === axis.attributeId);
    const existing = attr?.options.find((o) => o.label.toLocaleLowerCase('tr') === trimmed.toLocaleLowerCase('tr'));
    if (existing) {
      return { label: existing.label, canonicalValue: existing.value, optionId: existing.id, skuToken: existing.sku_token ?? undefined };
    }
    const created = await attributeService.addOption(ctx, axis.attributeId, { value: trimmed, label: trimmed });
    void onAttributesChanged();
    return { label: created.label, canonicalValue: created.value, optionId: created.id, skuToken: created.sku_token ?? undefined };
  };

  const savePreset = async () => {
    if (!presetName.trim() || selectedAxes.length === 0) return;
    const definition = JSON.stringify(selectedAxes.map((a) => ({ attributeId: a.attributeId, values: a.values })));
    await attributeService.savePreset(ctx, { name: presetName.trim(), definition });
    setPresetName('');
    setShowSavePreset(false);
  };

  return (
    <View style={styles.stepGap}>
      <BodyText muted>Bu üründe ne değişiyor? İstediğiniz kadar eksen ekleyin, her biri için değerleri girin.</BodyText>
      {axesLocked && (
        <BodyText muted style={styles.lockedHint}>
          Bu üründe stok hareketi olan bir varyant var — eksen seti ({selectedAxes.map((a) => a.name).join(' × ') || '—'}) sabitlendi. Aşağıdaki
          eksenlere yeni değer ekleyebilirsiniz, ama yeni bir eksen ekleyemez veya mevcut birini kaldıramazsınız.
        </BodyText>
      )}

      {selectedAxes.map((axis) => {
        const attr = attributes?.find((a) => a.id === axis.attributeId);
        const suggestions: AxisValue[] = (attr?.options ?? []).map((o) => ({
          label: o.label,
          canonicalValue: o.value,
          optionId: o.id,
          skuToken: o.sku_token ?? undefined,
        }));
        return (
          <View key={axis.attributeId} style={styles.axisBlock}>
            <View style={styles.axisHeader}>
              <Heading level={5}>{axis.name}{axis.unitLabel ? ` (${axis.unitLabel})` : ''}</Heading>
              {!axesLocked && (
                <Pressable onPress={() => removeAxis(axis.attributeId)} hitSlop={6}>
                  <Text style={styles.removeAxis}>Ekseni kaldır</Text>
                </Pressable>
              )}
            </View>
            <AttributeChipInput
              dataType={axis.dataType}
              unitLabel={axis.unitLabel}
              values={axis.values}
              onChange={(values) => updateAxisValues(axis.attributeId, values)}
              suggestions={axis.dataType === 'option' ? suggestions : []}
              resolveValue={resolveValueFor(axis)}
            />
          </View>
        );
      })}

      {!axesLocked &&
        (!showAdd ? (
          <Button label="+ Eksen ekle" variant="secondary" onPress={() => setShowAdd(true)} />
        ) : (
          <AddAxisPanel ctx={ctx} available={availableAttributes} onPick={addAxis} onCreated={onAttributesChanged} onCancel={() => setShowAdd(false)} />
        ))}

      {!axesLocked && presets && presets.length > 0 && (
        <View style={styles.presetSection}>
          <Text style={styles.presetLabel}>Hazır setler</Text>
          <View style={styles.presetRow}>
            {presets.map((p) => (
              <Tag key={p.id} label={p.name} variant="accent" onPress={() => void onApplyPreset(p)} />
            ))}
          </View>
        </View>
      )}

      {selectedAxes.length > 0 && (
        <View style={styles.presetSection}>
          {!showSavePreset ? (
            <Button label="Bu eksen setini kaydet" variant="ghost" onPress={() => setShowSavePreset(true)} />
          ) : (
            <View style={styles.footerRow}>
              <View style={{ flex: 1 }}>
                <Input value={presetName} onChangeText={setPresetName} placeholder="Set adı, örn. Ayakkabı 36-46" />
              </View>
              <Button label="Kaydet" variant="secondary" disabled={!presetName.trim()} onPress={() => void savePreset()} />
            </View>
          )}
        </View>
      )}

      {combinationCount > 0 && (
        <View style={styles.counterBox}>
          <Text style={styles.counterText}>
            {selectedAxes.map((a) => `${a.values.length} ${a.name.toLocaleLowerCase('tr')}`).join(' × ')} = {combinationCount} varyant
          </Text>
          {selectedAxes.length > MAX_COMFORTABLE_AXES && (
            <Text style={styles.warnText}>Bu {combinationCount} varyant üretecek — çok sayıda eksen listeyi kalabalıklaştırabilir.</Text>
          )}
        </View>
      )}
    </View>
  );
}

function AddAxisPanel({
  ctx,
  available,
  onPick,
  onCreated,
  onCancel,
}: {
  ctx: ActorContext;
  available: AttributeWithOptions[];
  onPick: (attr: AttributeWithOptions) => void;
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [dataType, setDataType] = useState<AttributeDataType>('option');
  const [unitLabel, setUnitLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const createAndPick = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const attr = await attributeService.createAttribute(ctx, { name: name.trim(), data_type: dataType, unit_label: unitLabel.trim() || null });
      await onCreated();
      onPick({ ...attr, options: [] });
      setName('');
      setUnitLabel('');
      setShowNew(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.addAxisPanel}>
      {available.length > 0 && (
        <View style={styles.chipRow}>
          {available.map((a) => (
            <Tag key={a.id} label={a.name} variant="outline" onPress={() => onPick(a)} />
          ))}
        </View>
      )}
      {!showNew ? (
        <Button label="+ Yeni eksen tanımla" variant="ghost" onPress={() => setShowNew(true)} />
      ) : (
        <View style={styles.stepGap}>
          <Field label="Eksen adı">
            <Input value={name} onChangeText={setName} placeholder="Örn. Kaplama" />
          </Field>
          <View style={styles.chipRow}>
            {(['option', 'number', 'text'] as AttributeDataType[]).map((t) => (
              <Tag
                key={t}
                label={t === 'option' ? 'Liste (Renk gibi)' : t === 'number' ? 'Sayı (Boy gibi)' : 'Serbest metin'}
                variant={dataType === t ? 'accent' : 'outline'}
                onPress={() => setDataType(t)}
              />
            ))}
          </View>
          {dataType === 'number' && (
            <Field label="Birim (opsiyonel)">
              <Input value={unitLabel} onChangeText={setUnitLabel} placeholder="cm, gr, mm…" />
            </Field>
          )}
          <Button label={busy ? '…' : 'Ekseni oluştur'} variant="primary" disabled={busy || !name.trim()} onPress={() => void createAndPick()} />
        </View>
      )}
      <Button label="Vazgeç" variant="ghost" onPress={onCancel} />
    </View>
  );
}

// ─── Adım B ─────────────────────────────────────────────────────────────

function StepGrid({
  axes,
  preview,
  selectedKeys,
  setSelectedKeys,
}: {
  axes: SelectedAxis[];
  preview: { new: Combination[]; existing: Combination[] };
  selectedKeys: Set<string>;
  setSelectedKeys: (keys: Set<string>) => void;
}) {
  const total = preview.new.length + preview.existing.length;
  const toggle = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const isTwoAxes = axes.length === 2;

  return (
    <View style={styles.stepGap}>
      <View style={styles.counterBox}>
        <Text style={styles.counterText}>
          {total} kombinasyondan {selectedKeys.size}&apos;i seçildi
        </Text>
        {preview.existing.length > 0 && <Text style={styles.warnText}>{preview.existing.length} kombinasyon zaten var (değişmeyecek), {preview.new.length} yeni oluşturulacak.</Text>}
      </View>

      {isTwoAxes ? (
        <MatrixGrid axes={axes} preview={preview} selectedKeys={selectedKeys} toggle={toggle} setSelectedKeys={setSelectedKeys} />
      ) : (
        <FlatCombinationList preview={preview} selectedKeys={selectedKeys} toggle={toggle} />
      )}
    </View>
  );
}

function comboLabel(c: Combination): string {
  return c.picks.map((p) => p.value.label).join(' · ');
}

function FlatCombinationList({
  preview,
  selectedKeys,
  toggle,
}: {
  preview: { new: Combination[]; existing: Combination[] };
  selectedKeys: Set<string>;
  toggle: (key: string) => void;
}) {
  return (
    <View style={styles.stepGap}>
      {preview.new.map((c) => {
        const key = canonicalVariantKey(c);
        const checked = selectedKeys.has(key);
        return (
          <Pressable key={key} onPress={() => toggle(key)} style={styles.comboRow}>
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked && <Text style={styles.checkboxMark}>✓</Text>}</View>
            <BodyText style={{ flex: 1 }}>{comboLabel(c)}</BodyText>
          </Pressable>
        );
      })}
      {preview.existing.map((c) => {
        const key = canonicalVariantKey(c);
        return (
          <View key={key} style={[styles.comboRow, styles.comboRowLocked]}>
            <View style={[styles.checkbox, styles.checkboxChecked]}>
              <Text style={styles.checkboxMark}>✓</Text>
            </View>
            <BodyText style={{ flex: 1 }} muted>{comboLabel(c)}</BodyText>
            <Tag label="Mevcut" variant="neutral" />
          </View>
        );
      })}
    </View>
  );
}

/** Tam 2 eksende: satır = 1. eksenin değerleri, sütun = 2. eksenin
 * değerleri. Yatayda kaydırılabilir (mobil genişlikte 8+ sütun sığmaz) —
 * satır/sütun başlığına dokununca o satır/sütun toggle'lanır. */
function MatrixGrid({
  axes,
  preview,
  selectedKeys,
  toggle,
  setSelectedKeys,
}: {
  axes: SelectedAxis[];
  preview: { new: Combination[]; existing: Combination[] };
  selectedKeys: Set<string>;
  toggle: (key: string) => void;
  setSelectedKeys: (keys: Set<string>) => void;
}) {
  const [rowAxis, colAxis] = axes;
  const allCombos = useMemo(() => [...preview.new, ...preview.existing], [preview]);
  const existingKeySet = useMemo(() => new Set(preview.existing.map((c) => canonicalVariantKey(c))), [preview]);

  const comboAt = (rowValue: AxisValue, colValue: AxisValue): Combination | undefined =>
    allCombos.find(
      (c) =>
        c.picks.find((p) => p.attributeId === rowAxis.attributeId)?.value.canonicalValue === rowValue.canonicalValue &&
        c.picks.find((p) => p.attributeId === colAxis.attributeId)?.value.canonicalValue === colValue.canonicalValue,
    );

  const toggleRow = (rowValue: AxisValue) => {
    const keys = colAxis.values.map((cv) => comboAt(rowValue, cv)).filter((c): c is Combination => !!c && !existingKeySet.has(canonicalVariantKey(c))).map((c) => canonicalVariantKey(c));
    const allChecked = keys.every((k) => selectedKeys.has(k));
    const next = new Set(selectedKeys);
    for (const k of keys) {
      if (allChecked) next.delete(k);
      else next.add(k);
    }
    setSelectedKeys(next);
  };

  const toggleCol = (colValue: AxisValue) => {
    const keys = rowAxis.values.map((rv) => comboAt(rv, colValue)).filter((c): c is Combination => !!c && !existingKeySet.has(canonicalVariantKey(c))).map((c) => canonicalVariantKey(c));
    const allChecked = keys.every((k) => selectedKeys.has(k));
    const next = new Set(selectedKeys);
    for (const k of keys) {
      if (allChecked) next.delete(k);
      else next.add(k);
    }
    setSelectedKeys(next);
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={styles.matrixRow}>
          <View style={styles.matrixCorner} />
          {colAxis.values.map((cv) => (
            <Pressable key={cv.canonicalValue} style={styles.matrixHeadCell} onPress={() => toggleCol(cv)}>
              <Text style={styles.matrixHeadText}>{cv.label}</Text>
            </Pressable>
          ))}
        </View>
        {rowAxis.values.map((rv) => (
          <View key={rv.canonicalValue} style={styles.matrixRow}>
            <Pressable style={styles.matrixRowHead} onPress={() => toggleRow(rv)}>
              <Text style={styles.matrixHeadText}>{rv.label}</Text>
            </Pressable>
            {colAxis.values.map((cv) => {
              const combo = comboAt(rv, cv);
              if (!combo) return <View key={cv.canonicalValue} style={styles.matrixCell} />;
              const key = canonicalVariantKey(combo);
              const isExisting = existingKeySet.has(key);
              const checked = isExisting || selectedKeys.has(key);
              return (
                <Pressable key={cv.canonicalValue} style={styles.matrixCell} onPress={() => !isExisting && toggle(key)} disabled={isExisting}>
                  <View style={[styles.checkbox, checked && styles.checkboxChecked, isExisting && styles.checkboxLocked]}>
                    {checked && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Adım C ─────────────────────────────────────────────────────────────

interface DetailRow {
  key: string;
  combo: Combination;
  sku: string;
  barcode: string;
  cost: string;
  price: string;
  stock: string;
}

function StepDetails({
  product,
  axes,
  combinations,
  busy,
  onSave,
}: {
  product: Product;
  axes: SelectedAxis[];
  combinations: Combination[];
  busy: boolean;
  onSave: (rows: Map<string, VariantDetails>) => Promise<void>;
}) {
  const defaultTemplate = `{${'sku'}}` + axes.map((a) => `-{${a.code}}`).join('');
  const [template, setTemplate] = useState(defaultTemplate);
  const [rows, setRows] = useState<DetailRow[]>(() =>
    combinations.map((combo) => ({
      key: canonicalVariantKey(combo),
      combo,
      sku: renderSkuTemplate(defaultTemplate, { sku: product.sku }, combo),
      barcode: '',
      cost: '',
      price: '',
      stock: '',
    })),
  );
  const [bulkCost, setBulkCost] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');

  const updateRow = (key: string, patch: Partial<DetailRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const reapplyTemplate = () => {
    setRows((prev) => prev.map((r) => ({ ...r, sku: renderSkuTemplate(template, { sku: product.sku }, r.combo) })));
  };

  const applyBarcodeFromSku = () => {
    setRows((prev) => prev.map((r) => ({ ...r, barcode: autoBarcodeFromSku(r.sku) })));
  };

  const applyBulkCost = () => {
    if (!bulkCost.trim()) return;
    setRows((prev) => prev.map((r) => ({ ...r, cost: bulkCost })));
  };
  const applyBulkPrice = () => {
    if (!bulkPrice.trim()) return;
    setRows((prev) => prev.map((r) => ({ ...r, price: bulkPrice })));
  };
  const applyBulkStock = () => {
    if (!bulkStock.trim()) return;
    setRows((prev) => prev.map((r) => ({ ...r, stock: bulkStock })));
  };

  const save = async () => {
    const details = new Map<string, VariantDetails>();
    for (const r of rows) {
      if (!r.sku.trim()) {
        return; // boş SKU'lu satır varken kaydetme — sessizce engelle, kullanıcı doldurmalı
      }
      const cost = Number(r.cost.replace(',', '.'));
      const price = Number(r.price.replace(',', '.'));
      const stock = Number(r.stock.replace(',', '.'));
      details.set(r.key, {
        sku: r.sku.trim(),
        barcode: r.barcode.trim() || null,
        cost_price_minor: r.cost.trim() && !Number.isNaN(cost) ? Math.round(cost * 100) : null,
        price_minor: r.price.trim() && !Number.isNaN(price) ? Math.round(price * 100) : null,
        opening_stock: r.stock.trim() && !Number.isNaN(stock) && stock > 0 ? Math.round(stock) : undefined,
      });
    }
    await onSave(details);
  };

  const allSkusFilled = rows.every((r) => r.sku.trim().length > 0);

  return (
    <View style={styles.stepGap}>
      <Field label="SKU şablonu">
        <View style={styles.footerRow}>
          <View style={{ flex: 1 }}>
            <Input value={template} onChangeText={setTemplate} autoCapitalize="none" />
          </View>
          <Button label="Uygula" variant="secondary" onPress={reapplyTemplate} />
        </View>
      </Field>

      <View style={styles.bulkBox}>
        <Text style={styles.presetLabel}>Tümüne uygula</Text>
        <View style={styles.bulkRow}>
          <View style={styles.bulkField}>
            <Input value={bulkCost} onChangeText={setBulkCost} keyboardType="decimal-pad" placeholder="Maliyet" />
          </View>
          <Button label="Uygula" variant="ghost" disabled={!bulkCost.trim()} onPress={applyBulkCost} />
        </View>
        <View style={styles.bulkRow}>
          <View style={styles.bulkField}>
            <Input value={bulkPrice} onChangeText={setBulkPrice} keyboardType="decimal-pad" placeholder="Satış fiyatı" />
          </View>
          <Button label="Uygula" variant="ghost" disabled={!bulkPrice.trim()} onPress={applyBulkPrice} />
        </View>
        <View style={styles.bulkRow}>
          <View style={styles.bulkField}>
            <Input value={bulkStock} onChangeText={setBulkStock} keyboardType="number-pad" placeholder="Açılış stoğu" />
          </View>
          <Button label="Uygula" variant="ghost" disabled={!bulkStock.trim()} onPress={applyBulkStock} />
        </View>
        <Button label="Barkodu tümüne SKU'dan ata" variant="ghost" onPress={applyBarcodeFromSku} />
      </View>

      <Divider />

      {rows.map((r) => (
        <View key={r.key} style={styles.detailRow}>
          <Heading level={6}>{comboLabel(r.combo)}</Heading>
          <Field label="SKU">
            <Input value={r.sku} onChangeText={(v) => updateRow(r.key, { sku: v })} autoCapitalize="characters" />
          </Field>
          <Field label="Barkod (opsiyonel)">
            <Input value={r.barcode} onChangeText={(v) => updateRow(r.key, { barcode: v })} autoCapitalize="characters" />
          </Field>
          <View style={styles.detailFieldRow}>
            <View style={styles.detailField}>
              <Field label="Maliyet">
                <Input value={r.cost} onChangeText={(v) => updateRow(r.key, { cost: v })} keyboardType="decimal-pad" />
              </Field>
            </View>
            <View style={styles.detailField}>
              <Field label="Satış fiyatı">
                <Input value={r.price} onChangeText={(v) => updateRow(r.key, { price: v })} keyboardType="decimal-pad" />
              </Field>
            </View>
            <View style={styles.detailField}>
              <Field label="Açılış stoğu">
                <Input value={r.stock} onChangeText={(v) => updateRow(r.key, { stock: v })} keyboardType="number-pad" />
              </Field>
            </View>
          </View>
          <Divider />
        </View>
      ))}

      <Button label={busy ? 'Kaydediliyor…' : `Kaydet (${rows.length} varyant)`} variant="primary" disabled={busy || !allSkusFilled} onPress={() => void save()} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 520 },
  scrollContent: { gap: space[3], paddingBottom: space[2] },
  stepGap: { gap: space[3] },
  error: { color: color.accentRamp[700] },
  footer: { gap: space[2], marginTop: space[2] },
  footerRow: { flexDirection: 'row', gap: space[2], alignItems: 'center' },

  lockedHint: { fontSize: 11.5 },

  convertBox: { gap: space[2], borderWidth: 1, borderColor: color.text, padding: space[2] },
  convertChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  convertChip: { paddingHorizontal: 10, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.text },
  convertChipOn: { backgroundColor: color.text },
  convertChipText: { fontSize: 12.5, color: color.text },
  convertChipTextOn: { color: color.bg, fontFamily: font.heading },

  axisBlock: { gap: space[2], borderWidth: 1, borderColor: color.divider, padding: space[2] },
  axisHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  removeAxis: { fontSize: 12, color: color.accentRamp[700] },

  addAxisPanel: { gap: space[2], borderWidth: 1, borderColor: color.divider, padding: space[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },

  presetSection: { gap: space[1] },
  presetLabel: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.dim },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },

  counterBox: { gap: 2 },
  counterText: { fontSize: 13, fontFamily: font.bodySemiBold, color: color.text },
  warnText: { fontSize: 11.5, color: color.accentRamp[700] },

  comboRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 8 },
  comboRowLocked: { opacity: 0.7 },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: color.divider, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: color.accent, borderColor: color.accent },
  checkboxLocked: { backgroundColor: color.dimmer, borderColor: color.dimmer },
  checkboxMark: { color: color.bg, fontSize: 13, fontWeight: '700' },

  matrixRow: { flexDirection: 'row' },
  matrixCorner: { width: 72, height: 40 },
  matrixHeadCell: { width: 56, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  matrixHeadText: { fontSize: 11, color: color.text, textAlign: 'center' },
  matrixRowHead: { width: 72, height: 44, alignItems: 'flex-start', justifyContent: 'center', paddingRight: 4 },
  matrixCell: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },

  bulkBox: { gap: space[1], borderWidth: 1, borderColor: color.divider, padding: space[2] },
  bulkRow: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  bulkField: { flex: 1 },

  detailRow: { gap: space[2] },
  detailFieldRow: { flexDirection: 'row', gap: space[2] },
  detailField: { flex: 1 },
});
