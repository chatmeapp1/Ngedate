import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, Coin } from '@/components/ui';
import { countryName, flag } from '@/lib/countries';
import { compact } from '@/lib/format';
import { colors, gradients, radius } from '@/lib/theme';
import type { Host } from '@/lib/types';

function HostCardBase({ host, onPress, onMessage }: { host: Host; onPress: () => void; onMessage: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.98 }] }]}>
      {host.avatarUrl ? (
        <Image source={{ uri: host.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <LinearGradient colors={gradients.soft} style={[StyleSheet.absoluteFill, s.placeholder]}>
          <Avatar name={host.displayName} size={72} />
        </LinearGradient>
      )}
      <LinearGradient colors={gradients.photoFade} style={s.fade} />

      <View style={s.top}>
        {host.online ? (
          <View style={s.online}>
            <View style={s.dot} />
            <Text style={s.onlineText}>Online</Text>
          </View>
        ) : (
          <View />
        )}
        {host.countryCode ? (
          <View style={s.country}>
            <Text style={{ fontSize: 13 }}>{flag(host.countryCode)}</Text>
            <Text style={s.countryText} numberOfLines={1}>
              {countryName(host.countryCode)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={s.bottom}>
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={1}>
            {host.displayName}
            {host.age ? <Text style={s.age}>  {host.age}</Text> : null}
          </Text>
          <View style={s.price}>
            {host.chatPrice > 0 ? (
              <>
                <Coin size={15} />
                <Text style={s.priceText}>{compact(host.chatPrice)}/pesan</Text>
              </>
            ) : (
              <Text style={s.priceText}>Gratis</Text>
            )}
          </View>
        </View>
        <Pressable onPress={onMessage} hitSlop={8}>
          <LinearGradient colors={gradients.brand} style={s.msgBtn}>
            <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>
    </Pressable>
  );
}

export const HostCard = memo(HostCardBase);

const s = StyleSheet.create({
  card: {
    flex: 1,
    aspectRatio: 0.72,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, gap: 6 },
  online: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.online },
  onlineText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  country: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
    maxWidth: '62%',
  },
  countryText: { color: '#fff', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  bottom: { position: 'absolute', left: 12, right: 10, bottom: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  name: { color: '#fff', fontSize: 17, fontWeight: '800' },
  age: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  price: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  priceText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  msgBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
