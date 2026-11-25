import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { number } from '@/lib/format';
import { REGION_INFO } from '@/lib/regions';
import { radius } from '@/lib/theme';
import type { RegionCount } from '@/lib/types';

// Kartu wilayah: gradien + nama + jumlah host + foto host teratas di sisi kanan
export function RegionCard({ region, onPress }: { region: RegionCount; onPress: () => void }) {
  const info = REGION_INFO[region.key];
  const [from, to] = info.colors;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.97 }] }]}>
      <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      {region.coverUrl ? (
        <View style={s.photoWrap}>
          <Image source={{ uri: region.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
          {/* Foto memudar ke warna kartu di sisi kiri */}
          <LinearGradient colors={[from, `${from}00`]} start={{ x: 0, y: 0.5 }} end={{ x: 0.6, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </View>
      ) : (
        <Text style={s.emoji}>{info.emoji}</Text>
      )}

      <View style={s.text}>
        <Text style={s.title} numberOfLines={1}>
          {info.label}
        </Text>
        <View style={s.count}>
          <Ionicons name="people" size={13} color="rgba(255,255,255,0.92)" />
          <Text style={s.countText}>{number(region.count)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { height: 92, borderRadius: radius.md, overflow: 'hidden' },
  photoWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '58%' },
  emoji: { position: 'absolute', right: 6, bottom: 2, fontSize: 44, opacity: 0.9 },
  text: { flex: 1, padding: 12, justifyContent: 'space-between' },
  title: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countText: { color: 'rgba(255,255,255,0.95)', fontWeight: '700', fontSize: 14 },
});
