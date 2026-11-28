import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecoveryCodeModal } from '@/components/RecoveryCodeModal';
import { Field, GradientButton, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage, setSession } from '@/lib/api';
import { number } from '@/lib/format';
import { colors, radius } from '@/lib/theme';

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  recoveryCode?: string | null;
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Row({ label, value, valueColor, danger, onPress }: { label: string; value?: string; valueColor?: string; danger?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.listRow, pressed && { opacity: 0.7 }]}>
      <Text style={[s.listLabel, danger && { color: colors.danger }]}>{label}</Text>
      {value ? <Text style={[s.listValue, valueColor ? { color: valueColor } : null]}>{value}</Text> : onPress ? <Ionicons name="arrow-forward" size={18} color={colors.textDim} /> : null}
    </Pressable>
  );
}

/** Pengaturan akun: daftar menu; tiap menu membuka halamannya sendiri. */
export default function AccountSettings() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!user) return null;
  const passwordSet = user.passwordSet !== false;

  const copyId = async () => {
    await Clipboard.setStringAsync(String(user.id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const logoutAll = () => {
    Alert.alert('Keluar dari semua perangkat?', 'Semua perangkat, termasuk ini, akan keluar. Kamu bisa masuk lagi kapan saja.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Keluar semua',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post('/api/account/logout-all');
            await logout();
          } catch (e) {
            Alert.alert('Gagal', errorMessage(e));
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Pengaturan akun" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}>
        <Row label="ID pengguna" value={copied ? 'Tersalin ✓' : String(user.id)} valueColor={colors.primaryDark} onPress={copyId} />
        <Row label={passwordSet ? 'Ganti kata sandi' : 'Atur kata sandi'} onPress={() => router.push('/account-password')} />
        <Row label="Keluar dari semua perangkat" onPress={logoutAll} />
        <Row label="Hapus akun" danger onPress={() => setDeleting(true)} />
      </ScrollView>
      <DeleteSheet visible={deleting} onClose={() => setDeleting(false)} passwordSet={passwordSet} coins={user.coins ?? 0} diamonds={user.diamonds ?? 0} onDeleted={logout} />
    </View>
  );
}

function DeleteSheet({
  visible,
  onClose,
  passwordSet,
  coins,
  diamonds,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  passwordSet: boolean;
  coins: number;
  diamonds: number;
  onDeleted: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = word.trim().toUpperCase() === 'HAPUS' && (!passwordSet || password.length > 0);

  const remove = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/account/delete', { confirm: word.trim(), password: passwordSet ? password : undefined });
      onClose();
      await onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={[s.sheet, { maxHeight: 640 }]} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
          <View style={s.handle} />
          <Text style={s.sheetTitle}>Hapus akun selamanya?</Text>
          <View style={s.warnBox}>
            <Text style={s.warnLine}>• Profil, foto, dan data pribadimu dihapus.</Text>
            <Text style={s.warnLine}>• Saldo <Text style={s.bold}>{number(coins)} koin</Text> dan <Text style={s.bold}>{number(diamonds)} diamond</Text> hangus dan tidak bisa dikembalikan.</Text>
            <Text style={s.warnLine}>• Koin yang masih ditahan di percakapan dikembalikan ke pengirimnya.</Text>
            <Text style={s.warnLine}>• Pesan yang sudah terkirim tetap ada di chat lawan bicara, tanpa namamu.</Text>
            <Text style={s.warnLine}>• Tindakan ini <Text style={s.bold}>tidak bisa dibatalkan</Text>.</Text>
          </View>
          <View style={{ gap: 12, marginTop: 14 }}>
            <Field label="Ketik HAPUS untuk melanjutkan" value={word} onChangeText={setWord} autoCapitalize="characters" />
            {passwordSet ? <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" /> : null}
            {error ? <Text style={s.errorText}>{error}</Text> : null}
            <Pressable onPress={remove} disabled={!ready || busy} style={[s.deleteBtn, (!ready || busy) && { opacity: 0.45 }]}>
              <Text style={s.deleteText}>{busy ? 'Menghapus…' : 'Hapus akun saya'}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: colors.textSub, fontWeight: '700' }}>Batal</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 18 },
  listLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  listValue: { fontSize: 16, fontWeight: '700', color: colors.textSub },
  rBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  rCard: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: radius.lg, padding: 20, gap: 12 },
  rTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  hintLang: { color: colors.textSub, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textSub, marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 12 },
  kv: { flexDirection: 'row', justifyContent: 'space-between' },
  k: { color: colors.textSub },
  v: { color: colors.text, fontWeight: '700' },
  idBox: { backgroundColor: '#F6F1FA', borderRadius: radius.md, padding: 12, gap: 4 },
  idRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  idText: { fontSize: 30, fontWeight: '900', color: colors.text, letterSpacing: 1 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, backgroundColor: '#EDE3FF' },
  copyText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  note: { flexDirection: 'row', gap: 8, backgroundColor: '#F3E8FF', borderRadius: radius.sm, padding: 10 },
  noteText: { flex: 1, color: colors.textSub, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: colors.text, marginBottom: 10 },
  warnBox: { backgroundColor: '#FEF2F2', borderRadius: radius.md, padding: 12, gap: 6 },
  warnLine: { color: '#7F1D1D', fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '800' },
  errorText: { color: colors.danger, fontWeight: '600' },
  deleteBtn: { height: 52, borderRadius: radius.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
