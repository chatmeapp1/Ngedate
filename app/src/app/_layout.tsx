import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CheckinModal } from '@/components/CheckinModal';
import { GiftOverlay } from '@/components/GiftOverlay';
import { PushBridge } from '@/components/PushBridge';
import { Loading } from '@/components/ui';
import { UpdateWatcher } from '@/components/UpdateWatcher';
import { AuthProvider, useAuth } from '@/context/auth';
import { RealtimeProvider } from '@/context/realtime';
import { loadLang, onLangChange, patchAlert, type Lang } from '@/lib/i18n';
import { colors } from '@/lib/theme';

// Arahkan ke halaman login jika belum masuk, dan sebaliknya
function AuthGate() {
  const { ready, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const first = segments[0] ?? '';
    const inAuth = first === '(auth)';
    // Halaman yang boleh dibuka kapan saja
    const isPublic = ['server', 'privacy', 'terms'].includes(first);
    if (!user) {
      if (!inAuth && !isPublic) router.replace('/login');
      return;
    }
    // Wajib lengkapi profil dulu setelah login pertama
    const needsProfile = !user.profileCompleted && user.role !== 'admin';
    // Host baru wajib verifikasi wajah (kecuali sedang ditinjau)
    // (host yang sudah disetujui admin, mis. dijadikan host langsung oleh admin, tidak dipaksa)
    const needsVerification =
      user.role === 'host' &&
      !user.verified &&
      user.hostStatus !== 'approved' &&
      ['none', 'rejected'].includes(user.verificationStatus ?? 'none');
    // Password sementara dari admin: wajib diganti dulu
    if (user.mustChangePassword) {
      if (first !== 'account-password' && !isPublic) router.replace('/account-password');
    } else if (needsProfile) {
      if (first !== 'onboarding' && !isPublic) router.replace('/onboarding');
    } else if (needsVerification) {
      if (first !== 'verification' && !isPublic) router.replace('/verification');
    } else if (inAuth || first === 'onboarding') {
      router.replace('/');
    }
  }, [ready, user, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <Loading />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Bahasa: dimuat sekali di awal; saat diganti, layar dibuat ulang (key) supaya semua teks memakai bahasa baru
  const [lang, setLangState] = useState<Lang | null>(null);
  useEffect(() => {
    patchAlert();
    loadLang().then(setLangState);
    return onLangChange(setLangState);
  }, []);
  if (!lang) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RealtimeProvider>
          <StatusBar style="dark" />
          <View key={lang} style={{ flex: 1 }}>
            <AuthGate />
            <GiftOverlay />
            <CheckinModal />
            <UpdateWatcher />
          </View>
          <PushBridge />
        </RealtimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
