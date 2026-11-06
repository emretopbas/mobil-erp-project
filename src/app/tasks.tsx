import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BodyText, Button, Card, CardBody, CardMeta, CardTitle, DatePicker, Divider, Field, Heading, Input, Radio, SegmentedControl, space, Stepper, Tag } from '@/design-system';
import { ModuleScreen } from '@/components/module-screen';
import type { Employee, Shift, Task, TaskStatus } from '@/models';
import { employeeService, shiftService, taskService, useActorContext } from '@/services';
import { taskStatusLabel } from '@/lib/roleLabels';
import { useReloadOnMount } from '@/hooks/use-reload';

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: null,
};
const PREV_STATUS: Record<TaskStatus, TaskStatus | null> = {
  todo: null,
  in_progress: 'todo',
  done: 'in_progress',
};

/** Görev / mesai atama (CLAUDE.md §5.3). `taskService` already scopes
 * `list()` to "own tasks only" for production/sales — this screen doesn't
 * need to know who's allowed to see what, it just renders what comes back
 * and gates the assignee picker on whether the RBAC layer would accept it. */
export default function TasksScreen() {
  const ctx = useActorContext();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [shiftDate, setShiftDate] = useState(() => new Date());
  const [shiftHour, setShiftHour] = useState(9);
  const [shiftDuration, setShiftDuration] = useState<'8' | '4'>('8');
  const [shiftNote, setShiftNote] = useState('');
  const [shiftEmployeeId, setShiftEmployeeId] = useState<string | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!ctx) return;
    const isManagerTier = ctx.employee.role === 'owner' || ctx.employee.role === 'manager';
    const [t, e, s] = await Promise.all([
      taskService.list(ctx),
      employeeService.list(ctx),
      isManagerTier ? shiftService.listForBusiness(ctx) : shiftService.listForEmployee(ctx, ctx.employee.id),
    ]);
    setTasks(t);
    setEmployees(e.filter((x) => x.is_active));
    setShifts(s);
    setAssigneeId((prev) => prev ?? ctx.employee.id);
    setShiftEmployeeId((prev) => prev ?? ctx.employee.id);
  }, [ctx]);

  useReloadOnMount(reload);

  if (!ctx) return null;
  const isManagerTier = ctx.employee.role === 'owner' || ctx.employee.role === 'manager';

  const submit = async () => {
    if (!title.trim() || !assigneeId) return;
    setBusy(true);
    setError(null);
    try {
      await taskService.create(ctx, { title: title.trim(), assignee_id: assigneeId });
      setTitle('');
      setShowForm(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const move = async (task: Task, status: TaskStatus) => {
    setError(null);
    try {
      await taskService.updateStatus(ctx, task.id, status);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const nameFor = (id: string) => employees.find((e) => e.id === id)?.display_name ?? '—';

  const submitShift = async () => {
    if (!shiftEmployeeId) return;
    setShiftBusy(true);
    setError(null);
    try {
      const start = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate(), shiftHour, 0, 0, 0);
      await shiftService.create(ctx, {
        employee_id: shiftEmployeeId,
        date: start.toISOString(),
        duration_hours: Number(shiftDuration),
        note: shiftNote.trim() || null,
      });
      setShiftNote('');
      setShowShiftForm(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setShiftBusy(false);
    }
  };

  return (
    <ModuleScreen title="Görevler" subtitle={isManagerTier ? 'Tüm işletme görevleri' : 'Size atanan görevler'}>
      {!!error && <BodyText style={styles.error}>{error}</BodyText>}

      <Button label={showForm ? 'Formu kapat' : '+ Yeni görev'} variant={showForm ? 'secondary' : 'primary'} onPress={() => setShowForm((s) => !s)} />

      {showForm && (
        <Card style={styles.formCard}>
          <Field label="Başlık">
            <Input value={title} onChangeText={setTitle} placeholder="Örn. 42 numara siyah bot üretimi" />
          </Field>
          <View style={styles.assignees}>
            <BodyText muted>Atanan kişi</BodyText>
            {isManagerTier ? (
              employees.map((e) => (
                <Radio key={e.id} label={e.display_name} checked={assigneeId === e.id} onPress={() => setAssigneeId(e.id)} />
              ))
            ) : (
              <BodyText>Kendinize ({ctx.employee.display_name})</BodyText>
            )}
          </View>
          <Button label={busy ? '…' : 'Oluştur'} variant="primary" disabled={busy || !title.trim()} onPress={submit} />
        </Card>
      )}

      <Divider />

      {tasks === null && <BodyText muted>Yükleniyor…</BodyText>}
      {tasks?.length === 0 && <BodyText muted>Görev yok.</BodyText>}

      <View style={styles.list}>
        {tasks?.map((t) => {
          const next = NEXT_STATUS[t.status];
          const prev = PREV_STATUS[t.status];
          return (
            <Card key={t.id}>
              <CardMeta>
                <Tag label={taskStatusLabel[t.status]} variant={t.status === 'done' ? 'accent2' : 'neutral'} />
              </CardMeta>
              <CardTitle>{t.title}</CardTitle>
              {isManagerTier && <CardBody>{`Atanan: ${nameFor(t.assignee_id)}`}</CardBody>}
              <View style={styles.moveRow}>
                {prev && <Button label={`← ${taskStatusLabel[prev]}`} variant="secondary" onPress={() => void move(t, prev)} />}
                {next && <Button label={`${taskStatusLabel[next]} →`} variant="primary" onPress={() => void move(t, next)} />}
              </View>
            </Card>
          );
        })}
      </View>

      <Divider />
      <Heading level={5}>Mesai</Heading>
      <BodyText muted>{isManagerTier ? 'Tüm işletme mesai kayıtları' : 'Sizin mesai kayıtlarınız'}</BodyText>

      <Button label={showShiftForm ? 'Formu kapat' : '+ Mesai kaydı'} variant={showShiftForm ? 'secondary' : 'primary'} onPress={() => setShowShiftForm((s) => !s)} />

      {showShiftForm && (
        <Card style={styles.formCard}>
          <Field label="Tarih">
            <DatePicker value={shiftDate} onChange={setShiftDate} />
          </Field>
          <Field label="Başlangıç saati">
            <Stepper qty={shiftHour} onInc={() => setShiftHour((h) => (h + 1) % 24)} onDec={() => setShiftHour((h) => (h + 23) % 24)} />
          </Field>
          <Field label="Vardiya uzunluğu">
            <SegmentedControl
              options={[
                { label: 'Tam Mesai (8s)', value: '8' },
                { label: 'Yarım Mesai (4s)', value: '4' },
              ]}
              value={shiftDuration}
              onChange={(v) => setShiftDuration(v as '8' | '4')}
            />
          </Field>
          {isManagerTier && (
            <View style={styles.assignees}>
              <BodyText muted>Çalışan</BodyText>
              {employees.map((e) => (
                <Radio key={e.id} label={e.display_name} checked={shiftEmployeeId === e.id} onPress={() => setShiftEmployeeId(e.id)} />
              ))}
            </View>
          )}
          <Field label="Not (opsiyonel)">
            <Input value={shiftNote} onChangeText={setShiftNote} placeholder="Örn. sabah vardiyası" />
          </Field>
          <Button label={shiftBusy ? '…' : 'Kaydet'} variant="primary" disabled={shiftBusy} onPress={submitShift} />
        </Card>
      )}

      <View style={styles.list}>
        {shifts?.length === 0 && <BodyText muted>Mesai kaydı yok.</BodyText>}
        {shifts?.map((s) => (
          <Card key={s.id}>
            <CardTitle>
              {`${new Date(s.date).toLocaleDateString('tr-TR')} · ${new Date(s.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}
            </CardTitle>
            <CardBody>{s.duration_hours === 8 ? 'Tam Mesai (8s)' : s.duration_hours === 4 ? 'Yarım Mesai (4s)' : `${s.duration_hours} saat`}</CardBody>
            {isManagerTier && <CardBody>{nameFor(s.employee_id)}</CardBody>}
            {!!s.note && <CardBody>{s.note}</CardBody>}
          </Card>
        ))}
      </View>
    </ModuleScreen>
  );
}

const styles = StyleSheet.create({
  error: { color: '#ae1800' },
  formCard: { gap: space[3] },
  assignees: { gap: space[1] },
  list: { gap: space[3] },
  moveRow: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
});
