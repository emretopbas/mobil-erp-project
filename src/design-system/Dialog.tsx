import { Modal, StyleSheet, Text, View } from 'react-native';

import { color, font, shadow, space } from './tokens';

/** `.dialog-backdrop` + `.dialog` (+ `-title`/`-body`/`-actions`) — a modal
 * at the top elevation. */
export function Dialog({
  visible,
  onRequestClose,
  title,
  children,
  actions,
}: {
  visible: boolean;
  onRequestClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, shadow.lg]}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.body}>{children}</View>
          {actions && <View style={styles.actions}>{actions}</View>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[4],
    backgroundColor: 'rgba(45, 43, 43, 0.5)', // neutral-900 @ 50%
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    gap: space[3],
    padding: space[4],
    backgroundColor: color.surface,
  },
  title: { fontFamily: font.heading, fontSize: 20, color: color.text },
  body: { fontSize: 14, opacity: 0.85, color: color.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], marginTop: space[2] },
});
