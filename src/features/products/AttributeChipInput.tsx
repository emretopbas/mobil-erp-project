import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BodyText, Button, Field, Input, Tag, color, space } from '@/design-system';
import { generateNumericRange, type AxisValue } from '@/lib/variantAxes';
import type { AttributeDataType } from '@/models';

/** Adım A'nın çoklu değer girişi — chip'ler + virgülle toplu yapıştırma +
 * (sadece `number` tipinde) aralık üreteci. `resolveValue` her tek değeri
 * (chip veya virgülle ayrılmış parçalardan biri) bir `AxisValue`'ya çevirir —
 * `option` tipinde bunun arkasında gerçek bir `AttributeService.addOption`
 * çağrısı olabilir (mevcutsa yeniden kullanılır, yoksa oluşturulur), `text`/
 * `number` tipinde saf/yerel bir dönüşümdür. Bu bileşen hangisi olduğunu
 * bilmez — DB'ye dokunmaz, tamamen çağıranın (VariantAxisWizard) verdiği
 * `resolveValue`'ya devreder. */
export function AttributeChipInput({
  dataType,
  unitLabel,
  values,
  onChange,
  suggestions = [],
  resolveValue,
}: {
  dataType: AttributeDataType;
  unitLabel?: string | null;
  values: AxisValue[];
  onChange: (values: AxisValue[]) => void;
  suggestions?: AxisValue[];
  resolveValue: (raw: string) => Promise<AxisValue | null>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [rangeStep, setRangeStep] = useState('1');

  const chosenCanonical = new Set(values.map((v) => v.canonicalValue));

  const addRaw = async (raw: string) => {
    const parts = raw.includes(',') ? raw.split(',') : [raw];
    const trimmed = parts.map((p) => p.trim()).filter(Boolean);
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const resolved: AxisValue[] = [];
      for (const part of trimmed) {
        const v = await resolveValue(part);
        if (v && !chosenCanonical.has(v.canonicalValue) && !resolved.some((r) => r.canonicalValue === v.canonicalValue)) {
          resolved.push(v);
        }
      }
      if (resolved.length > 0) onChange([...values, ...resolved]);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addRange = async () => {
    const from = Number(rangeFrom.replace(',', '.'));
    const to = Number(rangeTo.replace(',', '.'));
    const step = Number(rangeStep.replace(',', '.'));
    if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(step)) {
      setError('Aralık için geçerli sayılar girin.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const range = generateNumericRange(from, to, step);
      const resolved: AxisValue[] = [];
      for (const n of range) {
        const v = await resolveValue(String(n));
        if (v && !chosenCanonical.has(v.canonicalValue) && !resolved.some((r) => r.canonicalValue === v.canonicalValue)) {
          resolved.push(v);
        }
      }
      onChange([...values, ...resolved]);
      setRangeFrom('');
      setRangeTo('');
      setShowRange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (canonicalValue: string) => {
    onChange(values.filter((v) => v.canonicalValue !== canonicalValue));
  };

  const unchosenSuggestions = suggestions.filter((s) => !chosenCanonical.has(s.canonicalValue));

  return (
    <View style={styles.wrap}>
      {values.length > 0 && (
        <View style={styles.chipRow}>
          {values.map((v) => (
            <View key={v.canonicalValue} style={styles.chip}>
              <Text style={styles.chipText}>{v.label}</Text>
              <Pressable onPress={() => remove(v.canonicalValue)} hitSlop={6}>
                <Text style={styles.chipRemove}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {!!error && <BodyText style={styles.error}>{error}</BodyText>}

      <View style={styles.addRow}>
        <View style={{ flex: 1 }}>
          <Input
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => void addRaw(text)}
            placeholder={dataType === 'number' ? `Tek değer${unitLabel ? ` (${unitLabel})` : ''} veya virgülle birkaçı` : 'Değer yazın veya virgülle birkaçını yapıştırın'}
            editable={!busy}
          />
        </View>
        <Button label="Ekle" variant="secondary" disabled={busy || !text.trim()} onPress={() => void addRaw(text)} />
      </View>

      {dataType === 'number' && (
        <View style={styles.rangeSection}>
          <Button label={showRange ? 'Aralığı kapat' : '+ Aralıktan üret'} variant="ghost" onPress={() => setShowRange((s) => !s)} />
          {showRange && (
            <View style={styles.rangeRow}>
              <View style={styles.rangeField}>
                <Field label="Başlangıç">
                  <Input value={rangeFrom} onChangeText={setRangeFrom} keyboardType="decimal-pad" placeholder="36" />
                </Field>
              </View>
              <View style={styles.rangeField}>
                <Field label="Bitiş">
                  <Input value={rangeTo} onChangeText={setRangeTo} keyboardType="decimal-pad" placeholder="46" />
                </Field>
              </View>
              <View style={styles.rangeField}>
                <Field label="Artış">
                  <Input value={rangeStep} onChangeText={setRangeStep} keyboardType="decimal-pad" placeholder="1" />
                </Field>
              </View>
              <Button label={busy ? '…' : 'Üret'} variant="primary" disabled={busy || !rangeFrom.trim() || !rangeTo.trim()} onPress={() => void addRange()} />
            </View>
          )}
        </View>
      )}

      {unchosenSuggestions.length > 0 && (
        <View style={styles.suggestSection}>
          <Text style={styles.suggestLabel}>Önceden kullanılanlar</Text>
          <View style={styles.chipRow}>
            {unchosenSuggestions.map((s) => (
              <Tag key={s.canonicalValue} label={s.label} variant="outline" onPress={() => onChange([...values, s])} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: color.accentRamp[100],
  },
  chipText: { fontSize: 12.5, color: color.accentRamp[800] },
  chipRemove: { fontSize: 14, color: color.accentRamp[800], fontWeight: '700', paddingHorizontal: 2 },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  error: { color: '#ae1800' },
  rangeSection: { gap: space[2] },
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space[2] },
  rangeField: { width: 90 },
  suggestSection: { gap: 4 },
  suggestLabel: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted },
});
