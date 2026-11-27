import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { emitBlockChange } from '@/lib/blockEvents';
import { colors, radius } from '@/lib/theme';

interface Reason {
  key: string;
  label: string;
}

// Cadangan jika daftar alasan dari server belum bisa dimuat
const FALLBACK_REASONS: Reason[] = [
  { key: 'spam', label: 'Spam / promosi' },
  { key: 'harassment', label: 'Kasar / pelecehan' },
  { key: 'scam', label: 'Penipuan / minta uang' },
  { key: 'sexual', label: 'Konten tidak pantas' },
  { key: 'underage', label: 'Diduga di bawah umur' },
  { key: 'other', label: 'Lainnya' },
];

/**
 * Tombol ⋯ dengan menu Laporkan / Blokir untuk pengguna lain.
 * conversationId: jika dilaporkan dari chat, pesan terakhir ikut disertakan sebagai bukti.
 */
export function SafetyMenu({
  userId,
  name,
  conversationId,
  onBlocked,
  light = false,
}: {
  userId: number;
  name: string;
  conversationId?: number;
  onBlocked?: () => void;
  /** ikon putih (di atas foto) */
  light?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);

  const doBlock = async () => {
    try {
      const r = await api.post<{ refunded: number }>('/api/blocks', { userId });
      emitBlockChange();
      Alert.alert(
        `${name} diblokir`,
        r.refunded > 0 ? `${r.refunded.toLocaleString('id-ID')} koin yang masih ditahan sudah dikembalikan.` : 'Kamu bisa membuka blokir dari menu Saya.',
        [{ text: 'OK', onPress: onBlocked }]
      );
      onBlocked?.();
    } catch (e) {
      Alert.alert('Gagal memblokir', errorMessage(e));
    }
  };

  const confirmBlock = () => {
    setMenu(false);
    Alert.alert(
      `Blokir ${name}?`,
      'Kalian tidak akan saling melihat dan tidak bisa saling mengirim pesan atau gift. Koin yang masih ditahan dikembalikan. Kamu bisa membuka blokir kapan saja dari menu Saya.',
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Blokir', style: 'destructive', onPress: doBlock },
      ]
    );
  };

  return (
    <>
      <Pressable hitSlop={10} onPress={() => setMenu(true)} style={[s.btn, light && s.btnLight]}>
        <Ionicons name="ellipsis-horizontal" size={22} color={light ? '#fff' : colors.text} />
      </Pressable>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)} statusBarTranslucent>
        <Pressable style={s.backdrop} onPress={() => setMenu(false)}>
          <View style={s.menu}>
            <Text style={s.menuTitle} numberOfLines={1}>
              {name}
            </Text>
            <Pressable
              style={s.menuItem}
              onPress={() => {
                setMenu(false);
                setReporting(true);
              }}
            >
              <Ionicons name="flag-outline" size={22} color={colors.text} />
              <Text style={s.menuText}>Laporkan</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={confirmBlock}>
              <Ionicons name="ban-outline" size={22} color={colors.danger} />
              <Text style={[s.menuText, { color: colors.danger }]}>Blokir</Text>
            </Pressable>
            <Pressable style={[s.menuItem, { justifyContent: 'center' }]} onPress={() => setMenu(false)}>
              <Text style={[s.menuText, { color: colors.textSub }]}>Batal</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <ReportSheet
        visible={reporting}
        onClose={() => setReporting(false)}
        userId={userId}
        name={name}
        conversationId={conversationId}
        onBlockAlso={confirmBlock}
      />
    </>
  );
}

function ReportSheet({
  visible,
  onClose,
  userId,
  name,
  conversationId,
  onBlockAlso,
}: {
  visible: boolean;
  onClose: () => void;
  userId: number;
  name: string;
  conversationId?: number;
  onBlockAlso: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [reasons, setReasons] = useState<Reason[]>(FALLBACK_REASONS);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails('');
    api.get<Reason[]>('/api/reports/reasons').then(setReasons).catch(() => {});
  }, [visible]);

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    try {
      await api.post('/api/reports', { targetId: userId, reason, details: details.trim() || undefined, conversationId });
      onClose();
      Alert.alert('Laporan terkirim', 'Terima kasih. Tim kami akan meninjau laporanmu. Mau sekalian memblokir akun ini?', [
        { text: 'Tidak perlu', style: 'cancel' },
        { text: 'Blokir juga', style: 'destructive', onPress: onBlockAlso },
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOO_MANY_REPORTS') Alert.alert('Batas laporan tercapai', e.message);
      else Alert.alert('Laporan gagal dikirim', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={s.handle} />
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>Laporkan {name}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.textSub} />
            </Pressable>
          </View>
          <Text style={s.sheetSub}>Pilih alasan laporan. Laporanmu bersifat rahasia.</Text>
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            {reasons.map((r) => {
              const on = reason === r.key;
              return (
                <Pressable key={r.key} onPress={() => setReason(r.key)} style={[s.reason, on && s.reasonOn]}>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.textDim} />
                  <Text style={[s.reasonText, on && { color: colors.primaryDark, fontWeight: '800' }]}>{r.label}</Text>
                </Pressable>
              );
            })}
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Keterangan tambahan (opsional)"
              placeholderTextColor={colors.textDim}
              multiline
              maxLength={500}
              style={s.input}
            />
          </ScrollView>
          {conversationId ? <Text style={s.note}>Beberapa pesan terakhir di chat ini ikut dikirim ke tim kami sebagai bukti.</Text> : null}
          <GradientButton onPress={submit} disabled={!reason} loading={sending}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={s.send}>Kirim laporan</Text>}
          </GradientButton>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  btnLight: { backgroundColor: 'rgba(0,0,0,0.35)' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 24 },
  menu: { backgroundColor: colors.surface, borderRadius: 22, paddingVertical: 8, overflow: 'hidden' },
  menuTitle: { textAlign: 'center', fontWeight: '800', color: colors.textSub, paddingVertical: 10, paddingHorizontal: 16 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, height: 54 },
  menuText: { fontSize: 16, fontWeight: '700', color: colors.text },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text, flexShrink: 1 },
  sheetSub: { color: colors.textSub, marginTop: 4, marginBottom: 10 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md },
  reasonOn: { backgroundColor: '#F3E8FF' },
  reasonText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  input: { marginTop: 8, minHeight: 70, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: 12, color: colors.text, textAlignVertical: 'top' },
  note: { color: colors.textDim, fontSize: 12, marginVertical: 8 },
  send: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
