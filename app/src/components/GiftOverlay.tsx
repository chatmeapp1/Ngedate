import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GiftIcon } from '@/components/GiftIcon';
import { number } from '@/lib/format';
import { setGiftFxListener, type GiftFx } from '@/lib/giftFx';
import { colors } from '@/lib/theme';

const ND = true; // useNativeDriver

/** Lapisan animasi gift di atas semua layar. Dipasang sekali di root layout. */
export function GiftOverlay() {
  const [queue, setQueue] = useState<GiftFx[]>([]);

  useEffect(() => {
    setGiftFxListener((fx) => setQueue((q) => (q.length > 20 ? q : [...q, fx])));
    return () => setGiftFxListener(null);
  }, []);

  // Stabil, supaya animasi tidak diulang saat antrean bertambah
  const done = useCallback((key: string) => setQueue((q) => (q[0]?.key === key ? q.slice(1) : q)), []);

  const current = queue[0];
  if (!current) return null;

  if (current.kind === 'wa') return <WaCelebration key={current.key} fx={current} onDone={done} />;
  if (current.luxury) return <LuxuryGift key={current.key} fx={current} onDone={done} />;
  return <NormalGift key={current.key} fx={current} onDone={done} />;
}

type GiftItem = Extract<GiftFx, { kind: 'gift' }>;

// ---------- Gift biasa: muncul memantul lalu melayang ke atas ----------
function NormalGift({ fx, onDone }: { fx: GiftItem; onDone: (key: string) => void }) {
  const scale = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const countPop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: ND }),
      Animated.spring(countPop, { toValue: 1, friction: 3, tension: 160, useNativeDriver: ND }),
      Animated.delay(800),
      Animated.timing(rise, { toValue: 1, duration: 800, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
    ]).start(() => onDone(fx.key));
    const safety = setTimeout(() => onDone(fx.key), 5000); // pengaman jika animasi tersendat
    return () => clearTimeout(safety);
  }, [scale, rise, countPop, onDone, fx.key]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -220] });
  const opacity = rise.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.6, 0] });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.center, { paddingTop: 120 }]}>
      <Animated.View style={{ alignItems: 'center', opacity, transform: [{ translateY }, { scale }] }}>
        <View style={s.normalGlow}>
          <GiftIcon icon={fx.icon} imageUrl={fx.imageUrl} size={96} />
        </View>
        <View style={s.pill}>
          <Text style={s.pillText} numberOfLines={1}>
            {fx.from ? `${fx.from} · ` : ''}
            {fx.name}
          </Text>
          <Animated.Text style={[s.pillCount, { transform: [{ scale: countPop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
            x{fx.count}
          </Animated.Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ---------- Gift mewah: layar penuh, zoom, berputar, ledakan partikel ----------
const SPARKS = ['✨', '💖', '⭐', '💫', '💜', '🌟'];

function LuxuryGift({ fx, onDone }: { fx: GiftItem; onDone: (key: string) => void }) {
  const { width } = useWindowDimensions();
  const backdrop = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const banner = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;

  const particles = useMemo(
    () =>
      Array.from({ length: 20 }, (_, i) => {
        const angle = (i / 20) * Math.PI * 2 + Math.random() * 0.3;
        const dist = width * (0.32 + Math.random() * 0.22);
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          char: i % 4 === 0 ? null : SPARKS[i % SPARKS.length],
          size: 18 + Math.random() * 16,
        };
      }),
    [width]
  );

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: 300, useNativeDriver: ND }),
        Animated.spring(zoom, { toValue: 1, friction: 5, tension: 60, useNativeDriver: ND }),
        Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.out(Easing.back(2)), useNativeDriver: ND }),
        Animated.sequence([
          Animated.delay(250),
          Animated.parallel([
            Animated.timing(burst, { toValue: 1, duration: 1300, easing: Easing.out(Easing.cubic), useNativeDriver: ND }),
            Animated.sequence([
              Animated.timing(ring, { toValue: 1, duration: 900, useNativeDriver: ND }),
              Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: ND }),
              Animated.timing(ring, { toValue: 1, duration: 900, useNativeDriver: ND }),
            ]),
            Animated.spring(banner, { toValue: 1, friction: 6, useNativeDriver: ND }),
          ]),
        ]),
      ]),
      Animated.delay(1100),
      Animated.timing(out, { toValue: 1, duration: 450, useNativeDriver: ND }),
    ]).start(() => onDone(fx.key));
    const safety = setTimeout(() => onDone(fx.key), 7000);
    return () => clearTimeout(safety);
  }, [backdrop, zoom, spin, burst, ring, banner, out, onDone, fx.key]);

  const fade = out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const iconScale = Animated.multiply(
    zoom.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }),
    out.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] })
  );
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['-200deg', '0deg'] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(backdrop, fade) }]}>
        <LinearGradient colors={['rgba(46,16,101,0.82)', 'rgba(131,24,67,0.72)', 'rgba(17,10,30,0.85)']} style={StyleSheet.absoluteFill} />
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, s.center, { opacity: fade }]}>
        {/* Cincin cahaya */}
        <Animated.View
          style={[
            s.ring,
            {
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.6] }) }],
            },
          ]}
        />
        {/* Partikel */}
        {particles.map((p, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              opacity: burst.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.x] }) },
                { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.y] }) },
                { scale: burst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1.2, 0.7] }) },
              ],
            }}
          >
            {p.char ? (
              <Text style={{ fontSize: p.size }}>{p.char}</Text>
            ) : (
              <GiftIcon icon={fx.icon} imageUrl={fx.imageUrl} size={p.size + 6} />
            )}
          </Animated.View>
        ))}
        {/* Gift utama */}
        <Animated.View style={{ transform: [{ scale: iconScale }, { rotate }] }}>
          <GiftIcon icon={fx.icon} imageUrl={fx.imageUrl} size={170} />
        </Animated.View>
        {/* Spanduk */}
        <Animated.View
          style={{
            marginTop: 26,
            opacity: banner,
            transform: [{ translateY: banner.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
          }}
        >
          <LinearGradient colors={['#FDE68A', '#F59E0B', '#EC4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.luxBanner}>
            <Text style={s.luxName}>
              {fx.name} x{fx.count}
            </Text>
            <Text style={s.luxSub}>
              {fx.from ? `dari ${fx.from} · ` : ''}
              {number(fx.price * fx.count)} koin
            </Text>
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ---------- Perayaan WhatsApp terbuka ----------
const CONFETTI = ['🎉', '🎊', '💚', '✨', '💖', '🥳'];

function WaCelebration({ fx, onDone }: { fx: Extract<GiftFx, { kind: 'wa' }>; onDone: (key: string) => void }) {
  const { width, height } = useWindowDimensions();
  const show = useRef(new Animated.Value(0)).current;
  const fall = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const confetti = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        x: Math.random() * width,
        drift: (Math.random() - 0.5) * 80,
        delay: Math.random() * 0.35,
        char: CONFETTI[i % CONFETTI.length],
        size: 18 + Math.random() * 14,
      })),
    [width]
  );

  useEffect(() => {
    Animated.parallel([
      Animated.spring(show, { toValue: 1, friction: 6, tension: 70, useNativeDriver: ND }),
      Animated.timing(fall, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: ND }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: ND }),
          Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: ND }),
        ])
      ),
    ]).start();
  }, [show, fall, pulse]);

  const close = () => {
    Animated.timing(show, { toValue: 0, duration: 200, useNativeDriver: ND }).start(() => onDone(fx.key));
  };

  const open = () => {
    if (fx.link) Linking.openURL(fx.link).catch(() => {});
    close();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: show }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      {confetti.map((c, i) => (
        <Animated.Text
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: c.x,
            top: -40,
            fontSize: c.size,
            opacity: fall.interpolate({ inputRange: [0, c.delay, 0.85, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.9] }) },
              { translateX: fall.interpolate({ inputRange: [0, 1], outputRange: [0, c.drift] }) },
              { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${i % 2 ? 360 : -360}deg`] }) },
            ],
          }}
        >
          {c.char}
        </Animated.Text>
      ))}

      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, s.center]}>
        <Animated.View
          style={[
            s.waCard,
            { opacity: show, transform: [{ scale: show.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
          ]}
        >
          <Animated.View
            style={[s.waIcon, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }]}
          >
            <Ionicons name="logo-whatsapp" size={46} color="#fff" />
          </Animated.View>
          <Text style={s.waTitle}>WhatsApp terbuka! 🎉</Text>
          <Text style={s.waSub}>
            {fx.hostName ? `Nomor WhatsApp ${fx.hostName}` : 'Nomor WhatsApp host'} sekarang bisa kamu lihat. Terima kasih atas
            hadiahmu!
          </Text>
          {fx.link ? (
            <Pressable onPress={open} style={s.waBtn}>
              <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              <Text style={s.waBtnText}>Buka WhatsApp</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={close} hitSlop={8} style={{ paddingVertical: 10 }}>
            <Text style={s.waLater}>Nanti saja</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  normalGlow: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.65)',
    shadowColor: colors.pink,
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 12,
  },
  pill: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(31,20,48,0.78)',
    maxWidth: 300,
  },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14, flexShrink: 1 },
  pillCount: { color: '#FDE68A', fontWeight: '900', fontSize: 22, fontStyle: 'italic' },
  ring: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 6, borderColor: '#FDE68A' },
  luxBanner: { paddingHorizontal: 26, paddingVertical: 12, borderRadius: 999, alignItems: 'center' },
  luxName: { color: '#fff', fontWeight: '900', fontSize: 22, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 4 },
  luxSub: { color: '#FFF7ED', fontWeight: '700', fontSize: 13, marginTop: 2 },
  waCard: {
    width: '84%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  waIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#25D366', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  waTitle: { fontSize: 22, fontWeight: '900', color: colors.text },
  waSub: { fontSize: 14, color: colors.textSub, textAlign: 'center', lineHeight: 20 },
  waBtn: {
    marginTop: 10,
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    paddingVertical: 14,
    borderRadius: 999,
  },
  waBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  waLater: { color: colors.textDim, fontWeight: '700' },
});
