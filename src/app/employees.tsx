import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BodyText, Button, Card, CardBody, CardMeta, CardTitle, Divider, Field, Input, Radio, space, Tag } from '@/design-system';
import { ModuleScreen } from '@/components/module-screen';
import type { Employee, EmployeeRole } from '@/models';
import { employeeService, hasPermission, useActorContext, useSession, type ActorContext } from '@/services';
import { roleLabel } from '@/lib/roleLabels';
import { useReloadOnMount } from '@/hooks/use-reload';

const ROLES: EmployeeRole[] = ['owner', 'manager', 'production', 'sales', 'viewer'];
/** Owner is never invited — only the founder starts as owner (firestore.rules). */
const INVITABLE_ROLES = ROLES.filter((r) => r !== 'owner');

/** Personel yönetimi (CLAUDE.md §5.2). Every write goes through
 * `employeeService`, which enforces RBAC + the last-owner guard — this
 * screen just renders what the service allows and surfaces its errors. */
export default function EmployeesScreen() {
  const ctx = useActorContext();
  const { employee: me } = useSession();
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<EmployeeRole>('sales');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ctx) return;
    setEmployees(await employeeService.list(ctx, { includeInactive: true }));
  }, [ctx]);

  useReloadOnMount(reload);

  if (!ctx) return null;
  const canManage = hasPermission(ctx.employee.role, 'employee', 'create');

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await employeeService.create(ctx, { display_name: name.trim(), role, email: email.trim() || null });
      setName('');
      setEmail('');
      setRole('sales');
      setShowForm(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id: string) => {
    setError(null);
    try {
      await employeeService.deactivate(ctx, id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ModuleScreen title="Personel" subtitle="Ekip üyeleri ve rolleri">
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}

      {canManage && (
        <Button
          label={showForm ? 'Formu kapat' : '+ Yeni personel'}
          variant={showForm ? 'secondary' : 'primary'}
          onPress={() => setShowForm((s) => !s)}
        />
      )}

      {showForm && canManage && (
        <Card style={styles.formCard}>
          <Field label="Ad Soyad">
            <Input value={name} onChangeText={setName} placeholder="Örn. Ayşe Yılmaz" />
          </Field>
          <Field label="E-posta (opsiyonel — girilirse davet gönderilir, internet gerekir)">
            <Input value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="ayse@business.com" />
          </Field>
          <View style={styles.roles}>
            <BodyText muted>Rol</BodyText>
            {INVITABLE_ROLES.map((r) => (
              <Radio key={r} label={roleLabel[r]} checked={role === r} onPress={() => setRole(r)} />
            ))}
          </View>
          <Button label={busy ? '…' : 'Ekle'} variant="primary" disabled={busy || !name.trim()} onPress={submit} />
        </Card>
      )}

      <Divider />

      {employees === null && <BodyText muted>Yükleniyor…</BodyText>}
      {employees?.length === 0 && <BodyText muted>Henüz personel eklenmedi.</BodyText>}

      <View style={styles.list}>
        {employees?.map((e) => (
          <Card key={e.id} style={!e.is_active && styles.inactiveCard}>
            <CardMeta>
              <Tag label={roleLabel[e.role]} variant={e.role === 'owner' ? 'accent' : 'neutral'} />
              {!e.is_active && <Tag label="Pasif" variant="outline" />}
              {e.id === me?.id && <Tag label="Siz" variant="accent2" />}
            </CardMeta>
            <CardTitle>{e.display_name}</CardTitle>
            {!!e.email && <CardBody>{e.email}</CardBody>}
            {canManage && e.is_active === 1 && editingId !== e.id && e.id !== me?.id && (e.role !== 'owner' || me?.role === 'owner') && (
              <View style={styles.rowActions}>
                <Button label="Rolünü değiştir" variant="secondary" onPress={() => setEditingId(e.id)} />
                <Button label="Pasifleştir" variant="secondary" onPress={() => void deactivate(e.id)} />
              </View>
            )}
            {canManage && editingId === e.id && (
              <RoleEditor ctx={ctx} employee={e} onDone={() => setEditingId(null)} onSaved={reload} />
            )}
          </Card>
        ))}
      </View>
    </ModuleScreen>
  );
}

/** "Rolünü değiştir" için satır içi form — `employeeService.update(role)`
 * son-owner korumasını, owner-yetkisi kurallarını ve bulut üyelik aynasını
 * kendi içinde uygular; burası sadece sonucu gösterir. */
function RoleEditor({
  ctx,
  employee,
  onDone,
  onSaved,
}: {
  ctx: ActorContext;
  employee: Employee;
  onDone: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState<EmployeeRole>(employee.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (role === employee.role) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await employeeService.update(ctx, employee.id, { role });
      onDone();
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.roleEditor}>
      <View style={styles.roles}>
        {(ctx.employee.role === 'owner' ? ROLES : INVITABLE_ROLES).map((r) => (
          <Radio key={r} label={roleLabel[r]} checked={role === r} onPress={() => setRole(r)} />
        ))}
      </View>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}
      <View style={styles.rowActions}>
        <Button label={busy ? '…' : 'Kaydet'} variant="primary" disabled={busy} onPress={() => void save()} />
        <Button label="Vazgeç" variant="ghost" disabled={busy} onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: '#ae1800' },
  formCard: { gap: space[3] },
  roles: { gap: space[1] },
  list: { gap: space[3] },
  inactiveCard: { opacity: 0.5 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  roleEditor: { gap: space[2] },
});
