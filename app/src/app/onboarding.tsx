import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BirthDatePicker } from '@/components/Editors';
import { GradientButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage, imageForm } from '@/lib/api';
import { pickImage } from '@/lib/pickImage';
import { colors, gradients, radius } from '@/lib/theme';
import type { User } from '@/lib/types';

type Gender = 'male' | 'female';

// Lengkapi profil setelah login pertama. Wajib diisi, tidak bisa dilewati.
export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { user, setUser, logout } = useAuth();
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<Gender | null>(null);
  const [uploading, setUploading] = useState(false);
  const [nickname, setNickname] = useState('');
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [agency, setAgency] = useState<{ state: 'idle' | 'checking' | 'ok' | 'bad'; name?: string }>({ state: 'idle' });
  const [saving, setSaving] = useState(false);

  // Cek kode undangan agency saat diketik
  useEffect(() => {
    const c = code.trim();
    if (gender !== 'female' || c.length < 4) {
      setAgency({ state: 'idle' });
      return;
    }
    setAgency({ state: 'checking' });
    const t = setTimeout(() => {
      api
        .get<{ name: string }>(`/api/onboarding/agency/${encodeURIComponent(c)}`)
        .then((r) => setAgency({ state: 'ok', name: r.name }))
        .catch(() => setAgency({ state: 'bad' }));
    }, 500);
    return () => clearTimeout(t);
  }, [code, gender]);

  if (!user) return null;

  const female = gender === 'female';
  const total = 3;

  const choosePhoto = async () => {
    const asset = await pickImage([1, 1]);
    if (!asset) return;
    setUploading(true);
    try {
      setUser(await api.post<User>('/api/me/avatar', imageForm(asset.uri, asset.mimeType)));
    } catch (e) {
      Alert.alert('Gagal mengunggah', errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const me = await api.post<User>('/api/onboarding/complete', {
        gender,
        displayName: nickname.trim(),
        birthDate,
        ...(female ? { inviteCode: code.trim() } : {}),
      });
      setUser(me);
    } catch (e) {
      Alert.alert('Gagal menyimpan', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const canNext = [
    !!gender,
    !!user.avatarUrl,
    nickname.trim().length >= 2 && !!birthDate && (!female || agency.state === 'ok'),
  ][step];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={gradients.header} style={StyleSheet.absoluteFill} />
      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        {step > 0 ? (
          <Pressable hitSlop={10} onPress={() => setStep(step - 1)}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
        ) : (
          <View style={{ width: 26 }} />
        )}
        <View style={s.progress}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[s.bar, i <= step && { backgroundColor: colors.primary }]} />
          ))}
        </View>
        <Pressable
          hitSlop={10}
          onPress={() =>
            Alert.alert('Keluar', 'Keluar dari akun ini?', [
              { text: 'Batal', style: 'cancel' },
              { text: 'Keluar', style: 'destructive', onPress: logout },
            ])
          }
        >
          <Text style={{ color: colors.textDim, fontWeight: '700' }}>Keluar</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 120, gap: 18 }} keyboardShouldPersistTaps="handled">
        {step === 0 ? (
          <>
            <Text style={s.title}>Siapa kamu?</Text>
            <Text style={s.sub}>Pilihan ini tidak bisa diubah lagi setelah disimpan.</Text>
            <GenderCard
              selected={gender === 'male'}
              icon="male"
              color="#3B82F6"
              title="Pria"
              desc="Cari teman ngobrol dan kenalan baru"
              onPress={() => setGender('male')}
            />
            <GenderCard
              selected={gender === 'female'}
              icon="female"
              color={colors.pink}
              title="Wanita"
              desc="Jadi host dan dapatkan penghasilan. Butuh kode undangan agency & verifikasi wajah."
              onPress={() => setGender('female')}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Text style={s.title}>Foto profil</Text>
            <Text style={s.sub}>
              {female
                ? 'Gunakan foto wajahmu sendiri yang jelas. Foto ini akan dicocokkan dengan verifikasi wajah.'
                : 'Pilih foto yang menampilkan dirimu.'}
            </Text>
            <Pressable onPress={choosePhoto} style={s.photo}>
              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="camera" size={44} color={colors.primary} />
              )}
              {uploading ? (
                <View style={[StyleSheet.absoluteFill, s.photoLoading]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
              <View style={s.photoBadge}>
                <Ionicons name={user.avatarUrl ? 'refresh' : 'add'} size={20} color="#fff" />
              </View>
            </Pressable>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text style={s.title}>Tentang kamu</Text>
            <Field label="Nickname">
              <TextInput
                value={nickname}
                onChangeText={setNickname}
                maxLength={30}
                placeholder="Nama yang dilihat orang lain"
                placeholderTextColor={colors.textDim}
                style={s.input}
              />
            </Field>
            <Field label="Tanggal lahir (minimal 18 tahun)">
              <BirthDatePicker value={birthDate} onChange={setBirthDate}>
                {(open) => (
                  <Pressable onPress={open} style={[s.input, s.inputRow]}>
                    <Text style={{ color: birthDate ? colors.text : colors.textDim, fontSize: 15 }}>
                      {birthDate ?? 'Pilih tanggal'}
                    </Text>
                    <Ionicons name="calendar-outline" size={20} color={colors.textDim} />
                  </Pressable>
                )}
              </BirthDatePicker>
            </Field>
            {female ? (
              <Field label="Kode undangan agency">
                <View style={[s.input, s.inputRow, agency.state === 'bad' && { borderColor: colors.danger }, agency.state === 'ok' && { borderColor: colors.online }]}>
                  <TextInput
                    value={code}
                    onChangeText={(t) => setCode(t.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={16}
                    placeholder="Minta kode ke agency kamu"
                    placeholderTextColor={colors.textDim}
                    style={{ flex: 1, color: colors.text, fontSize: 15, letterSpacing: 1 }}
                  />
                  {agency.state === 'checking' ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                  {agency.state === 'ok' ? <Ionicons name="checkmark-circle" size={22} color={colors.online} /> : null}
                  {agency.state === 'bad' ? <Ionicons name="close-circle" size={22} color={colors.danger} /> : null}
                </View>
                {agency.state === 'ok' ? <Text style={{ color: colors.online, fontWeight: '700' }}>{agency.name}</Text> : null}
                {agency.state === 'bad' ? <Text style={{ color: colors.danger }}>Kode tidak ditemukan</Text> : null}
              </Field>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <GradientButton
          title={step < total - 1 ? 'Lanjut' : female ? 'Lanjut ke verifikasi wajah' : 'Selesai'}
          disabled={!canNext}
          loading={saving}
          onPress={() => (step < total - 1 ? setStep(step + 1) : submit())}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function GenderCard({
  selected,
  icon,
  color,
  title,
  desc,
  onPress,
}: {
  selected: boolean;
  icon: 'male' | 'female';
  color: string;
  title: string;
  desc: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.gender, selected && { borderColor: color, backgroundColor: `${color}12` }]}>
      <View style={[s.genderIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={30} color="#fff" />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.genderTitle}>{title}</Text>
        <Text style={s.genderDesc}>{desc}</Text>
      </View>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={24} color={selected ? color : colors.textDim} />
    </Pressable>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.textSub, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  progress: { flex: 1, flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  sub: { color: colors.textSub, fontSize: 14, lineHeight: 20, marginTop: -8 },
  gender: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  genderIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  genderTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  genderDesc: { color: colors.textSub, fontSize: 13, lineHeight: 18 },
  photo: {
    alignSelf: 'center',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 12,
  },
  photoLoading: { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  photoBadge: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 15,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 12, backgroundColor: 'rgba(255,247,251,0.95)' },
});
