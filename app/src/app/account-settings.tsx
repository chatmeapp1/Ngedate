import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, GradientButton, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage, setSession } from '@/lib/api';
import { number } from '@/lib/format';
import { colors, radius } from '@/lib/theme';

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

export default function AccountSettings() {
  const { user, refreshMe, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordSet = user?.passwordSet !== false;

  // --- username ---
  const [username, setUsername] = useState(user?.username ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // --- password ---
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  // --- hapus akun ---
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  const saveUsername = async () => {
    const value = username.trim().toLowerCase();
    if (value === user.username) return;
    setSavingName(true);
    setNameError(null);
    try {
      await api.post('/api/account/username', { username: value });
      await refreshMe();
      Alert.alert('Username diubah', `Kamu sekarang bisa masuk lewat "Login via Akun" dengan username ${value}.`);
    } catch (e) {
      setNameError(errorMessage(e));
    } finally {
      setSavingName(false);
    }
  };

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
      Alert.alert(passwordSet ? 'Password diubah' : 'Password diatur', 'Perangkat lain yang memakai akun ini otomatis keluar.');
    } catch (e) {
      setPassError(errorMessage(e));
    } finally {
      setSavingPass(false);
    }
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <Section title="Akun">
            <View style={s.kv}>
              <Text style={s.k}>ID</Text>
              <Text style={s.v}>{user.id}</Text>
            </View>
            <View style={s.kv}>
              <Text style={s.k}>Cara masuk</Text>
              <Text style={s.v}>{passwordSet ? 'Username & password' : 'Login cepat (HP ini)'}</Text>
            </View>
            {!passwordSet ? (
              <View style={s.note}>
                <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                <Text style={s.noteText}>
                  Akunmu terikat ke HP ini. Atur password di bawah supaya bisa masuk dari HP lain lewat Login via Akun.
                </Text>
              </View>
            ) : null}
          </Section>

          <Section title="Username">
            <Field
              label="Username untuk Login via Akun"
              value={username}
              onChangeText={(t) => setUsername(t.replace(/\s/g, ''))}
              autoCapitalize="none"
              maxLength={30}
              error={nameError}
            />
            <Text style={s.hint}>3–30 karakter: huruf, angka, titik, atau garis bawah.</Text>
            <GradientButton title="Simpan username" onPress={saveUsername} loading={savingName} disabled={username.trim().toLowerCase() === user.username || username.trim().length < 3} />
          </Section>

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

          <Section title="Keamanan">
            <Pressable onPress={logoutAll} style={s.row}>
              <Ionicons name="phone-portrait-outline" size={22} color={colors.text} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Keluar dari semua perangkat</Text>
                <Text style={s.rowSub}>Berguna jika HP hilang atau akun dipakai orang lain</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </Pressable>
          </Section>

          <Section title="Zona berbahaya">
            <Pressable onPress={() => setDeleting(true)} style={s.row}>
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={[s.rowTitle, { color: colors.danger }]}>Hapus akun</Text>
                <Text style={s.rowSub}>Menghapus akun dan data pribadimu secara permanen</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </Pressable>
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

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
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textSub, marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 12 },
  kv: { flexDirection: 'row', justifyContent: 'space-between' },
  k: { color: colors.textSub },
  v: { color: colors.text, fontWeight: '700' },
  note: { flexDirection: 'row', gap: 8, backgroundColor: '#F3E8FF', borderRadius: radius.sm, padding: 10 },
  noteText: { flex: 1, color: colors.textSub, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: -4 },
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
