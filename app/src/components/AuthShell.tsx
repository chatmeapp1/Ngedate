import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getServerUrl } from '@/lib/api';
import { colors, gradients } from '@/lib/theme';

// Kerangka halaman masuk & daftar: logo, judul, isi form, dan tautan server
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const server = getServerUrl();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={gradients.header} style={StyleSheet.absoluteFill} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}
      >
        <View style={s.brand}>
          <LinearGradient colors={gradients.brand} style={s.logo}>
            <Ionicons name="heart" size={34} color="#fff" />
          </LinearGradient>
          <Text style={s.appName}>Amora</Text>
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.subtitle}>{subtitle}</Text>
        <View style={{ gap: 14, marginTop: 24 }}>{children}</View>

        <Link href="/server" style={s.server}>
          <Ionicons name="server-outline" size={13} color={colors.textDim} />
          {'  '}
          {server ? `Server: ${server.replace(/^https?:\/\//, '')}` : 'Atur alamat server'}
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  brand: { alignItems: 'center', gap: 10, marginBottom: 28 },
  logo: { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  appName: { fontSize: 30, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textSub, marginTop: 4 },
  server: { textAlign: 'center', color: colors.textDim, fontSize: 12, marginTop: 28 },
});
