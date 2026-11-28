import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { Text } from '@/components/I18nText';
import { AuthShell } from '@/components/AuthShell';
import { RecoveryCodeModal } from '@/components/RecoveryCodeModal';
import { Field, GhostButton, GradientButton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';

// Lupa password: ID + kode pemulihan + password baru. Tanpa kode: hubungi admin.
export default function Forgot() {
  const [userId, setUserId] = useState('');
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState('');

  useEffect(() => {
    api
      .get<{ whatsapp: string }>('/api/auth/support')
      .then((r) => setWhatsapp(r.whatsapp))
      .catch(() => {});
  }, []);

  const submit = async () => {
    setError(null);
    if (next.length < 6) return setError('Password baru minimal 6 karakter');
    if (next !== again) return setError('Konfirmasi password tidak sama');
    setLoading(true);
    try {
      const r = await api.post<{ recoveryCode: string }>('/api/auth/forgot/reset', { login: userId, code, newPassword: next });
      setNewCode(r.recoveryCode); // kode lama diganti kode baru
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const contactAdmin = () => {
    const text = encodeURIComponent(`Halo admin, saya lupa password akun Amora${userId ? ` dengan ID ${userId}` : ''} dan tidak punya kode pemulihan. Mohon bantuannya.`);
    Linking.openURL(`https://wa.me/${whatsapp}?text=${text}`).catch(() => {});
  };

  const ready = !!userId && code.replace(/[^A-Za-z0-9]/g, '').length >= 12 && !!next && !!again;

  return (
    <AuthShell title="Lupa password" subtitle="Masukkan ID pengguna dan kode pemulihan yang kamu simpan">
      <Field label="ID pengguna" value={userId} onChangeText={(t) => setUserId(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Contoh: 12345678" maxLength={15} />
      <Field label="Kode pemulihan" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX" maxLength={20} />
      <Field label="Password baru" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
      <Field label="Ulangi password baru" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} error={error} />
      <GradientButton title="Atur password baru" onPress={submit} loading={loading} disabled={!ready} />

      <Text style={{ textAlign: 'center', color: colors.textSub, lineHeight: 20, marginTop: 6 }}>
        Tidak punya kode pemulihan? Admin bisa mengatur ulang password akunmu setelah memastikan kamu pemiliknya.
      </Text>
      {whatsapp ? <GhostButton title="Hubungi admin lewat WhatsApp" onPress={contactAdmin} /> : null}

      <RecoveryCodeModal
        code={newCode}
        onClose={() => {
          setNewCode(null);
          router.replace('/account');
        }}
      />
    </AuthShell>
  );
}
