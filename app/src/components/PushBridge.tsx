import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/context/auth';
import { registerPush } from '@/lib/push';

// Daftarkan token push setelah masuk, dan buka chat saat notifikasi diketuk
function AndroidPushBridge() {
  const { user } = useAuth();
  const ready = !!user && (user.profileCompleted || user.role === 'admin');
  const userId = user?.id;
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (ready) registerPush();
  }, [ready, userId]);

  useEffect(() => {
    if (!ready || !last) return;
    const data = last.notification.request.content.data as { type?: string; conversationId?: string } | undefined;
    if (data?.type === 'chat' && data.conversationId) {
      router.push({ pathname: '/chat/[id]', params: { id: String(data.conversationId) } });
      Notifications.clearLastNotificationResponse();
    }
  }, [last, ready]);

  return null;
}

// Notifikasi push hanya untuk Android (di web/iOS pratinjau tidak dipakai)
export function PushBridge() {
  return Platform.OS === 'android' ? <AndroidPushBridge /> : null;
}
