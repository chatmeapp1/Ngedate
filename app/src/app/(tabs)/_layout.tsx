import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import { useAuth } from '@/context/auth';
import { useRealtime } from '@/context/realtime';
import { colors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(active: IconName, inactive: IconName) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Ionicons name={focused ? active : inactive} size={26} color={color} />
  );
}

export default function TabsLayout() {
  const { unread } = useRealtime();
  const { user } = useAuth();
  const insets = useSafeAreaInsets(); // jangan mepet ke tombol navigasi Android
  const isUser = user?.role === 'user'; // pengguna: saldo ada di profil, ada menu Match
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 62 + insets.bottom, paddingTop: 6, paddingBottom: insets.bottom + 4 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Beranda', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="match" options={{ title: 'Match', href: isUser ? undefined : null, tabBarIcon: icon('heart', 'heart-outline') }} />
      <Tabs.Screen name="moments" options={{ title: 'Momen', tabBarIcon: icon('images', 'images-outline') }} />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Pesan',
          tabBarIcon: icon('chatbubbles', 'chatbubbles-outline'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.pink, fontSize: 10, fontWeight: '800' },
        }}
      />
      <Tabs.Screen name="wallet" options={{ title: 'Dompet', href: isUser ? null : undefined, tabBarIcon: icon('wallet', 'wallet-outline') }} />
      <Tabs.Screen name="me" options={{ title: 'Saya', tabBarIcon: icon('person', 'person-outline') }} />
    </Tabs>
  );
}
