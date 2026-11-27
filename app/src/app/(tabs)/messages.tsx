import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Empty, Loading } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { onBlockChange } from '@/lib/blockEvents';
import { countryName, flag } from '@/lib/countries';
import { openChatWithMember } from '@/lib/openChat';
import { useRealtime } from '@/context/realtime';
import { onRealtime, onRealtimeConnect } from '@/lib/realtime';
import { colors, gradients, radius } from '@/lib/theme';
import type { Conversation, Host, Message, User } from '@/lib/types';

function time(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toTimeString().slice(0, 5);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// Barisan host yang sedang online (hanya untuk user): bulat dengan cincin gradien & titik hijau
function OnlineStrip({ hosts }: { hosts: Host[] }) {
  if (!hosts.length) return null;
  return (
    <View style={s.stripWrap}>
      <View style={s.stripHead}>
        <View style={s.liveDot} />
        <Text style={s.stripTitle}>Host online</Text>
        <Text style={s.stripCount}>{hosts.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {hosts.map((h) => (
          <Pressable
            key={h.id}
            style={s.stripItem}
            onPress={() => router.push({ pathname: '/host/[id]', params: { id: String(h.id) } })}
          >
            <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.ring}>
              <View style={s.ringInner}>
                <Avatar uri={h.avatarUrl} name={h.displayName} size={56} />
              </View>
            </LinearGradient>
            <View style={s.stripDot} />
            <Text style={s.stripName} numberOfLines={1}>
              {h.displayName}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

type Visitor = User & { views: number; viewedAt: string };

function agoText(iso: string) {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return 'baru saja';
  if (m < 60) return `${Math.round(m)} mnt lalu`;
  if (m < 1440) return `${Math.round(m / 60)} jam lalu`;
  return `${Math.round(m / 1440)} hari lalu`;
}

export default function Messages() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { notifUnread } = useRealtime();
  const [online, setOnline] = useState<Host[]>([]);
  const isUser = user?.role === 'user';
  const isHost = user?.role === 'host';
  const [tab, setTab] = useState<'chats' | 'strangers'>('chats');
  const [visitors, setVisitors] = useState<Visitor[] | null>(null);

  const loadOnline = useCallback(() => {
    if (!isUser) return;
    api
      .get<Host[]>('/api/hosts?tab=online&page=1')
      .then((h) => setOnline(h.slice(0, 20)))
      .catch(() => {});
  }, [isUser]);

  // Status online berubah-ubah: segarkan tiap 30 detik selama layar terbuka
  useFocusEffect(
    useCallback(() => {
      loadOnline();
      const t = setInterval(loadOnline, 30_000);
      return () => clearInterval(t);
    }, [loadOnline])
  );
  // Host: orang asing = pengguna yang melihat profilnya tetapi belum pernah chat
  const loadVisitors = useCallback(async () => {
    if (!isHost) return;
    try {
      setVisitors(await api.get<Visitor[]>('/api/members/visitors'));
    } catch {
      setVisitors((v) => v ?? []);
    }
  }, [isHost]);
  useFocusEffect(
    useCallback(() => {
      if (tab === 'strangers') loadVisitors();
    }, [tab, loadVisitors])
  );

  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.get<Conversation[]>('/api/conversations'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setList((l) => l ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => onBlockChange(() => load()), [load]);

  // Socket tersambung ulang (mis. kembali dari latar belakang): muat ulang daftar supaya tidak ada pesan yang terlewat
  useEffect(() => onRealtimeConnect(() => load()), [load]);

  // Pesan baru: perbarui percakapan itu & pindahkan ke paling atas
  useEffect(
    () =>
      onRealtime<{ conversation: Conversation; message: Message }>('message:new', (e) => {
        if (!e.conversation) return;
        setList((cur) => [e.conversation, ...(cur ?? []).filter((c) => c.id !== e.conversation.id)]);
      }),
    []
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={gradients.header} style={[s.hero, { paddingTop: insets.top + 12 }]}>
        <Text style={s.title}>Pesan</Text>
        <OnlineStrip hosts={online} />
      </LinearGradient>
      {isHost ? (
        <View style={s.chips}>
          {(
            [
              ['chats', 'chatbubbles', 'Obrolan'],
              ['strangers', 'heart-circle', 'Orang asing'],
            ] as const
          ).map(([k, icon, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[s.chip, tab === k && s.chipOn]}>
              <Ionicons name={icon} size={18} color={tab === k ? '#fff' : colors.pink} />
              <Text style={[s.chipText, tab === k && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={s.tabRow}>
          <Text style={s.tabOn}>Obrolan</Text>
          <View style={s.tabBar} />
        </View>
      )}
      {isHost && tab === 'strangers' ? (
        visitors === null ? (
          <Loading />
        ) : (
          <FlatList
            data={visitors}
            keyExtractor={(u) => String(u.id)}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  await loadVisitors();
                  setRefreshing(false);
                }}
                colors={[colors.primary]}
              />
            }
            ListEmptyComponent={<Empty icon="eye-outline" title="Belum ada orang asing" subtitle="Pengguna yang melihat profilmu dan belum pernah chat akan muncul di sini" />}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]}
                onPress={() => router.push({ pathname: '/member/[id]', params: { id: String(item.id) } })}
              >
                <View>
                  <Avatar uri={item.avatarUrl} name={item.displayName} size={52} />
                  <View style={[s.statusDot, { backgroundColor: item.online ? colors.online : '#9CA3AF' }]} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={s.nameText} numberOfLines={1}>
                      {item.displayName}
                    </Text>
                    {item.verified ? <Verified size={13} /> : null}
                  </View>
                  <Text style={s.preview} numberOfLines={1}>
                    {item.countryCode ? `${flag(item.countryCode)} ${countryName(item.countryCode)} · ` : ''}melihat profilmu {agoText(item.viewedAt)}
                    {item.views > 1 ? ` · ${item.views}x` : ''}
                  </Text>
                </View>
                <Pressable onPress={() => openChatWithMember(item.id)} hitSlop={8} style={s.sapaBtn}>
                  <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
                </Pressable>
              </Pressable>
            )}
          />
        )
      ) : list === null ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => String(c.id)}
          ListHeaderComponent={
            <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]} onPress={() => router.push('/notifications')}>
              <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sysIcon}>
                <Ionicons name="notifications" size={24} color="#fff" />
              </LinearGradient>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.nameText}>Notifikasi</Text>
                <Text style={s.preview} numberOfLines={1}>
                  {notifUnread > 0 ? `${notifUnread} pemberitahuan baru` : 'Top up, persetujuan foto, penarikan'}
                </Text>
              </View>
              {notifUnread > 0 ? (
                <View style={s.sysBadge}>
                  <Text style={s.sysBadgeText}>{notifUnread > 99 ? '99+' : notifUnread}</Text>
                </View>
              ) : null}
            </Pressable>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                loadOnline();
                await load();
                setRefreshing(false);
              }}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            error ? (
              <Empty icon="cloud-offline-outline" title={error} />
            ) : (
              <Empty
                icon="chatbubbles-outline"
                title="Belum ada pesan"
                subtitle={isUser ? 'Ketuk host online di atas atau cari dari Beranda' : 'Pesan dari pengguna akan muncul di sini'}
              />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: String(item.id) } })}
            >
              <View>
                <Avatar uri={item.peer?.avatarUrl} name={item.peer?.displayName} size={52} />
                {item.peer?.online ? <View style={s.onlineDot} /> : null}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={s.line}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={s.nameText} numberOfLines={1}>
                      {item.peer?.displayName ?? 'Pengguna'}
                    </Text>
                    {item.peer?.verified ? <Verified size={14} /> : null}
                  </View>
                  <Text style={s.time}>{time(item.lastMessageAt)}</Text>
                </View>
                <View style={s.line}>
                  <Text style={[s.preview, item.unread > 0 && { color: colors.text, fontWeight: '700' }]} numberOfLines={1}>
                    {item.lastMessagePreview ?? ''}
                  </Text>
                  {item.unread > 0 ? (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { paddingBottom: 6 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3, paddingHorizontal: 16, marginBottom: 10 },
  stripWrap: { marginBottom: 6 },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.online },
  stripTitle: { fontSize: 13, fontWeight: '800', color: colors.textSub },
  stripCount: { fontSize: 12, fontWeight: '800', color: colors.primary },
  strip: { paddingHorizontal: 12, gap: 6 },
  stripItem: { width: 74, alignItems: 'center' },
  ring: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  stripDot: {
    position: 'absolute',
    top: 48,
    right: 8,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: colors.online,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  stripName: { marginTop: 5, fontSize: 12, fontWeight: '700', color: colors.text, maxWidth: 70 },
  sysIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  sysBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  sysBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: '#F1EEF6' },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  statusDot: { position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  sapaBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tabRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  tabOn: { fontSize: 16, fontWeight: '800', color: colors.text },
  tabBar: { marginTop: 5, width: 26, height: 4, borderRadius: 2, backgroundColor: colors.pink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  time: { fontSize: 11, color: colors.textDim },
  preview: { flex: 1, color: colors.textSub, fontSize: 13 },
  onlineDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: colors.online,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
