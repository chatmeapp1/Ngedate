import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AuthShell } from '@/components/AuthShell';
import { Field, GradientButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';

// Login via Akun: ID pengguna + password (ID ada di menu Saya)
export default function AccountLogin() {
  const { login } = useAuth();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!userId || !password || loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(userId, password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Masuk dengan akun" subtitle="Pakai ID pengguna dan password yang sudah kamu atur">
      <Field
        label="ID pengguna"
        value={userId}
        onChangeText={(t) => setUserId(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder="Contoh: 12345678"
        maxLength={15}
      />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <GradientButton title="Masuk" onPress={submit} loading={loading} disabled={!userId || !password} />
      <Text style={{ textAlign: 'center', color: colors.textSub, lineHeight: 20 }}>
        ID pengguna ada di menu Saya. Akun baru dibuat otomatis lewat{' '}
        <Link href="/login" style={{ color: colors.primary, fontWeight: '800' }}>
          Login cepat
        </Link>
        , lalu atur password di Saya &gt; Pengaturan akun.
      </Text>
    </AuthShell>
  );
}
