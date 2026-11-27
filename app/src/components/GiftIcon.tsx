import { Image } from 'expo-image';
import { Text } from '@/components/I18nText';

/** Gambar gift dari admin, atau ikon emoji jika tidak ada gambar. */
export function GiftIcon({ icon, imageUrl, size = 40 }: { icon?: string | null; imageUrl?: string | null; size?: number }) {
  if (imageUrl) return <Image source={{ uri: imageUrl }} style={{ width: size, height: size }} contentFit="contain" />;
  return <Text style={{ fontSize: size * 0.82, lineHeight: size, textAlign: 'center' }}>{icon || '🎁'}</Text>;
}
