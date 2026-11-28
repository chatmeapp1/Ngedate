import { Ionicons } from '@expo/vector-icons';
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

export default function AccountPassword() {
  const { user, refreshMe } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordSet = user?.passwordSet !== false;

  // --- password ---
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  // --- kode pemulihan (lupa password)
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPass, setRecoveryPass] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const makeRecovery = async () => {
    setRecoveryError(null);
    setRecoveryBusy(true);
    try {
      const r = await api.post<{ recoveryCode: string }>('/api/account/recovery-code', { password: recoveryPass });
      setRecoveryOpen(false);
      setRecoveryPass('');
      await refreshMe();
      setShownCode(r.recoveryCode);
    } catch (e) {
      setRecoveryError(errorMessage(e));
    } finally {
      setRecoveryBusy(false);
    }
  };

  if (!user) return null;

  const savePassword = async () => {
    setPassError(null);
    if (next.length < 6) return setPassError('Password baru minimal 6 karakter');
    if (next !== again) return setPassError('Konfirmasi password tidak sama');
    setSavingPass(true);
    try {
      const r = await api.post<SessionTokens>('/api/account/password', {
        currentPassword: passwordSet ? current : undefined,
        newPassword: next,
      });
      // Sesi lain keluar; sesi ini memakai token baru
      await setSession({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      await refreshMe();
      setCurrent('');
      setNext('');
      setAgain('');
      // Password pertama kali diatur: kode pemulihan ditampilkan sekali
      if (r.recoveryCode) setShownCode(r.recoveryCode);
      else Alert.alert(passwordSet ? 'Password diubah' : 'Password diatur', `Sekarang kamu bisa masuk di HP lain lewat Login via Akun dengan ID ${user.id} dan password ini. Perangkat lain yang memakai akun ini otomatis keluar.`);
    } catch (e) {
      setPassError(errorMessage(e));
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={passwordSet ? 'Ganti kata sandi' : 'Atur kata sandi'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {user.mustChangePassword ? (
            <View style={[s.note, { backgroundColor: '#FEF3C7', marginBottom: 12 }]}>
              <Ionicons name="alert-circle-outline" size={18} color="#B45309" />
              <Text style={[s.noteText, { color: '#92400E' }]}>Password kamu diatur ulang oleh admin. Ganti dengan password baru di bawah, memakai password sementara sebagai password saat ini.</Text>
            </View>
          ) : null}

          <Section title={passwordSet ? 'Ubah password' : 'Atur password'}>
            {passwordSet ? <Field label="Password saat ini" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" /> : null}
            <Field label="Password baru" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
            <Field label="Ulangi password baru" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" error={passError} />
            <GradientButton
              title={passwordSet ? 'Ubah password' : 'Atur password'}
              onPress={savePassword}
              loading={savingPass}
              disabled={!next || !again || (passwordSet && !current)}
            />
          </Section>

          {passwordSet ? (
            <Section title="Kode pemulihan">
              <Text style={s.hintLang}>
                {user.hasRecoveryCode
                  ? 'Kode pemulihan dipakai untuk masuk lagi jika kamu lupa password. Membuat kode baru membuat kode lama tidak berlaku.'
                  : 'Kamu belum punya kode pemulihan. Buat sekarang supaya bisa masuk lagi jika lupa password.'}
              </Text>
              <View style={{ marginTop: 10 }}>
                <GradientButton title={user.hasRecoveryCode ? 'Buat kode baru' : 'Buat kode pemulihan'} onPress={() => setRecoveryOpen(true)} />
              </View>
            </Section>
          ) : null}

        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={recoveryOpen} transparent animationType="fade" onRequestClose={() => setRecoveryOpen(false)}>
        <View style={s.rBackdrop}>
          <View style={s.rCard}>
            <Text style={s.rTitle}>Buat kode pemulihan</Text>
            <Text style={s.hintLang}>Masukkan password kamu untuk membuat kode baru.</Text>
            <Field label="Password" value={recoveryPass} onChangeText={setRecoveryPass} secureTextEntry autoCapitalize="none" error={recoveryError} />
            <GradientButton title="Buat kode" onPress={makeRecovery} loading={recoveryBusy} disabled={!recoveryPass} />
            <Pressable onPress={() => setRecoveryOpen(false)} style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ color: colors.textSub, fontWeight: '600' }}>Batal</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <RecoveryCodeModal code={shownCode} onClose={() => setShownCode(null)} />
    </View>
  );
}

const s = StyleSheet.create({
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
