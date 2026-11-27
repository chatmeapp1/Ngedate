import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostLevelBadge } from '@/components/Badges';
import { Coin, Empty, Loading } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { api } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { colors, gradients } from '@/lib/theme';
import type { Host } from '@/lib/types';

type Card = Host & { photos?: string[] };

const SWIPE = 110;

/** Match: geser kartu host ke kanan = suka, ke kiri = lewati. */
export default function Match() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [deck, setDeck] = useState<Card[] | null>(null);
  const [liked, setLiked] = useState<number | null>(null);
  const fetching = useRef(false);
  const seen = useRef(new Set<number>());
  const pos = useRef(new Animated.ValueXY()).current;
  const dragged = useRef(false); // geseran tidak dihitung sebagai ketukan
  const deckRef = useRef<Card[]>([]);
  deckRef.current = deck ?? [];

  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const more = await api.get<Card[]>('/api/match/deck?limit=10');
      const fresh = more.filter((h) => !seen.current.has(h.id));
      fresh.forEach((h) => seen.current.add(h.id));
      setDeck((d) => [...(d ?? []), ...fresh]);
    } catch {
      setDeck((d) => d ?? []);
    } finally {
      fetching.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (deck === null) load();
    }, [deck, load])
  );

  const decide = useCallback(
    (dir: 1 | -1) => {
      const top = deckRef.current[0];
      if (!top) return;
      Animated.timing(pos, { toValue: { x: dir * width * 1.3, y: 0 }, duration: 200, useNativeDriver: false }).start(() => {
        pos.setValue({ x: 0, y: 0 });
        setDeck((d) => (d ? d.slice(1) : d));
        if (deckRef.current.length <= 4) load();
      });
      if (dir === 1) {
        api.post(`/api/users/${top.id}/like`).catch(() => {});
        setLiked(top.id);
      } else {
        api.post(`/api/match/${top.id}/skip`).catch(() => {});
      }
    },
    [pos, width, load]
  );
  const decideRef = useRef(decide);
  decideRef.current = decide;

  useEffect(() => {
    if (liked === null) return;
    const t = setTimeout(() => setLiked(null), 900);
    return () => clearTimeout(t);
  }, [liked]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        dragged.current = false;
      },
      onPanResponderMove: (e, g) => {
        if (Math.abs(g.dx) > 6) dragged.current = true;
        pos.setValue({ x: g.dx, y: g.dy });
      },
      onPanResponderRelease: (_, g) => {
        setTimeout(() => {
          dragged.current = false;
        }, 150);
        if (g.dx > SWIPE) decideRef.current(1);
        else if (g.dx < -SWIPE) decideRef.current(-1);
        else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6 }).start();
      },
    })
  ).current;

  const cardW = width - 32;
  const cardH = Math.min(height - insets.top - insets.bottom - 230, cardW * 1.55);
  const rotate = pos.x.interpolate({ inputRange: [-width, 0, width], outputRange: ['-14deg', '0deg', '14deg'] });
  const likeOp = pos.x.interpolate({ inputRange: [0, SWIPE], outputRange: [0, 1], extrapolate: 'clamp' });
  const skipOp = pos.x.interpolate({ inputRange: [-SWIPE, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  const top = deck?.[0];
  const next = deck?.[1];
  const photoOf = (h: Card) => h.avatarUrl ?? h.photos?.[0] ?? null;

  const body = (h: Card) => (
    <>
      {photoOf(h) ? <Image source={{ uri: photoOf(h)! }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : <LinearGradient colors={gradients.brand} style={StyleSheet.absoluteFill} />}
      <LinearGradient colors={gradients.photoFade} style={s.fade} />
      <View style={s.info}>
        <View style={s.row}>
          <Text style={s.name} numberOfLines={1}>
            {h.displayName}
          </Text>
          {h.verified ? <Verified size={18} /> : null}
        </View>
        <View style={s.row}>
          {h.age ? <Text style={s.sub}>{h.age}</Text> : null}
          {h.countryCode ? <Text style={s.sub}>{`${flag(h.countryCode)} ${countryName(h.countryCode)}`}</Text> : null}
          {h.level != null ? <HostLevelBadge level={h.level} size={17} /> : null}
        </View>
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: h.online ? colors.online : '#9CA3AF' }]} />
          <Text style={s.sub}>{h.online ? 'Online' : 'Offline'}</Text>
          <View style={{ flex: 1 }} />
          <Coin size={13} />
          <Text style={s.sub}>{h.chatPrice}/pesan</Text>
        </View>
      </View>
    </>
  );

  return (
    <LinearGradient colors={gradients.header} style={{ flex: 1, paddingTop: insets.top + 14 }}>
      <Text style={s.title}>Match</Text>

      {deck === null ? (
        <Loading />
      ) : !top ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Empty icon="heart-circle-outline" title="Kartu habis" subtitle="Kamu sudah melihat semua host untuk saat ini. Coba lagi nanti." />
          <Pressable
            onPress={() => {
              seen.current.clear();
              setDeck(null);
              load();
            }}
            style={s.reload}
          >
            <Text style={s.reloadText}>Muat ulang</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ alignItems: 'center', marginTop: 14 }}>
          <View style={{ width: cardW, height: cardH }}>
            {next ? (
              <View style={[s.card, { width: cardW, height: cardH, transform: [{ scale: 0.95 }], top: 10 }]}>{body(next)}</View>
            ) : null}
            <Animated.View
              {...pan.panHandlers}
              style={[s.card, { width: cardW, height: cardH, transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }] }]}
            >
              <Pressable style={StyleSheet.absoluteFill} onPress={() => !dragged.current && router.push({ pathname: '/host/[id]', params: { id: String(top.id) } })} />
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {body(top)}
              </View>
              <Animated.View pointerEvents="none" style={[s.stamp, s.stampLike, { opacity: likeOp }]}>
                <Text style={[s.stampText, { color: colors.online }]}>SUKA</Text>
              </Animated.View>
              <Animated.View pointerEvents="none" style={[s.stamp, s.stampSkip, { opacity: skipOp }]}>
                <Text style={[s.stampText, { color: colors.danger }]}>LEWATI</Text>
              </Animated.View>
            </Animated.View>
          </View>

          <View style={[s.actions, { width: cardW }]}>
            <Pressable onPress={() => decide(-1)} style={s.pill}>
              <Ionicons name="close" size={34} color="#fff" />
            </Pressable>
            <Pressable onPress={() => decide(1)} style={s.pill}>
              <Ionicons name="heart" size={32} color="#FF3B5C" />
            </Pressable>
          </View>
        </View>
      )}

      {liked !== null ? (
        <View pointerEvents="none" style={s.toast}>
          <Ionicons name="heart" size={16} color="#fff" />
          <Text style={s.toastText}>Disukai</Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  card: { position: 'absolute', left: 0, top: 0, borderRadius: 26, overflow: 'hidden', backgroundColor: colors.surfaceAlt, elevation: 4 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 200 },
  info: { position: 'absolute', left: 18, right: 18, bottom: 18, gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, color: '#fff', fontSize: 26, fontWeight: '600' },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: '500' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  stamp: { position: 'absolute', top: 28, borderWidth: 3, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 3 },
  stampLike: { left: 22, borderColor: colors.online, transform: [{ rotate: '-12deg' }] },
  stampSkip: { right: 22, borderColor: colors.danger, transform: [{ rotate: '12deg' }] },
  stampText: { fontSize: 26, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 14, marginTop: 16 },
  pill: { flex: 1, height: 58, borderRadius: 29, backgroundColor: 'rgba(60,45,80,0.55)', alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', alignSelf: 'center', top: 110, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(17,10,30,0.75)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  toastText: { color: '#fff', fontWeight: '600' },
  reload: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 22, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  reloadText: { color: '#fff', fontWeight: '600' },
});
