import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AuthShell } from '@/components/AuthShell';
import { Field, GradientButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Selamat datang" subtitle="Masuk untuk mulai ngobrol dengan host favoritmu">
      <Field label="Username atau email" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry onSubmitEditing={submit} />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <GradientButton title="Masuk" onPress={submit} loading={loading} disabled={!username || !password} />
      <Text style={{ textAlign: 'center', color: colors.textSub }}>
        Belum punya akun?{' '}
        <Link href="/register" style={{ color: colors.primary, fontWeight: '800' }}>
          Daftar
        </Link>
      </Text>
    </AuthShell>
  );
}
