import { router } from 'expo-router';
import { Alert } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import type { Conversation } from '@/lib/types';

// Buka (atau buat) percakapan dengan host lalu pindah ke layar chat
export async function openChat(hostId: number) {
  try {
    const conv = await api.post<Conversation>('/api/conversations', { hostId });
    router.push({ pathname: '/chat/[id]', params: { id: String(conv.id) } });
  } catch (e) {
    Alert.alert('Tidak bisa membuka chat', errorMessage(e));
  }
}

// Host menyapa pengguna pria lebih dulu (pesan host gratis)
export async function openChatWithMember(userId: number) {
  try {
    const conv = await api.post<Conversation>('/api/conversations', { userId });
    router.push({ pathname: '/chat/[id]', params: { id: String(conv.id) } });
  } catch (e) {
    Alert.alert('Tidak bisa membuka chat', errorMessage(e));
  }
}
