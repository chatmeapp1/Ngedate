import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Empty, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import type { Conversation } from '@/lib/types';
import { colors } from '@/lib/theme';

// Sementara: layar chat lengkap dibuat di Job 3
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [conv, setConv] = useState<Conversation | null>(null);

  useEffect(() => {
    api.get<Conversation>(`/api/conversations/${id}`).then(setConv).catch(() => {});
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={conv?.peer?.displayName ?? 'Chat'} />
      <Empty icon="chatbubbles-outline" title="Ruang chat segera hadir" subtitle="Kirim pesan, gift, dan buka WhatsApp akan tersedia di update berikutnya." />
    </View>
  );
}
