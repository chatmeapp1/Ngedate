import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthShell } from '@/components/AuthShell';
import { CountryPicker } from '@/components/CountryPicker';
import { Field, GradientButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function Register() {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState<string>('ID');
  const [adult, setAdult] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^[a-zA-Z0-9_.]{3,30}$/.test(username) && password.length >= 6 && adult;

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await register({ username: username.trim(), displayName: displayName.trim() || username.trim(), password, countryCode: country });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Buat akun" subtitle="Gratis, hanya butuh beberapa detik">
      <Field
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        placeholder="huruf, angka, titik, garis bawah"
      />
      <Field label="Nama tampilan" value={displayName} onChangeText={setDisplayName} placeholder="Nama yang dilihat orang lain" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Minimal 6 karakter" />
      <CountryPicker value={country} onChange={setCountry} />

      <Pressable onPress={() => setAdult((v) => !v)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Ionicons name={adult ? 'checkbox' : 'square-outline'} size={22} color={adult ? colors.primary : colors.textDim} />
        <Text style={{ flex: 1, color: colors.textSub, fontSize: 13 }}>
          Saya berusia 18 tahun ke atas dan setuju dengan aturan penggunaan Amora
        </Text>
      </Pressable>

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <GradientButton title="Daftar" onPress={submit} loading={loading} disabled={!valid} />
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: colors.textSub }}>
          Sudah punya akun?{' '}
          <Link href="/login" style={{ color: colors.primary, fontWeight: '800' }}>
            Masuk
          </Link>
        </Text>
      </View>
    </AuthShell>
  );
}
