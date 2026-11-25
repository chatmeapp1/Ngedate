import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import { UpdateWatcher } from '@/components/UpdateWatcher';
import { AuthProvider, useAuth } from '@/context/auth';
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
    const needsVerification =
      user.role === 'host' && !user.verified && ['none', 'rejected'].includes(user.verificationStatus ?? 'none');
    if (needsProfile) {
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
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <AuthGate />
        <UpdateWatcher />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
