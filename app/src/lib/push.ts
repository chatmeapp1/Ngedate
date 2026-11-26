import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/lib/api';

/**
 * Notifikasi push (Android, lewat Firebase Cloud Messaging).
 * Butuh google-services.json saat build APK; tanpa itu pendaftaran token gagal dengan tenang
 * dan aplikasi tetap berjalan normal (hanya tanpa notifikasi saat aplikasi tertutup).
 */
let currentToken: string | null = null;

// Saat aplikasi terbuka, pesan sudah tampil lewat realtime, jadi notifikasi sistem tidak ditampilkan
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function registerPush(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Pesan & gift',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#8B5CF6',
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof token !== 'string' || token.length < 20) return;
    currentToken = token;
    await api.post('/api/me/push-token', { token });
  } catch {
    /* google-services.json belum ada / layanan Google tidak tersedia: abaikan */
  }
}

/** Lepas token perangkat ini dari akun (dipanggil sebelum keluar). */
export async function unregisterPush(): Promise<void> {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  await api.del(`/api/me/push-token?token=${encodeURIComponent(token)}`).catch(() => {});
}
