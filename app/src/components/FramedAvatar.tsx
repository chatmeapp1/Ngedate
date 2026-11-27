import { Image } from 'expo-image';
import { View } from 'react-native';
import { Avatar } from '@/components/ui';

/** Bingkai VIP 1-5 (gambar dari desain). `hole` = diameter lubang foto sebagai pecahan dari lebar gambar. */
const FRAMES = [
  { src: require('../../assets/vip/frame1.png'), hole: 0.5 },
  { src: require('../../assets/vip/frame2.png'), hole: 0.55 },
  { src: require('../../assets/vip/frame3.png'), hole: 0.53 },
  { src: require('../../assets/vip/frame4.png'), hole: 0.66 },
  { src: require('../../assets/vip/frame5.png'), hole: 0.48 },
];

/** Bingkai hadiah check-in (sementara). Dipakai hanya jika pengguna belum punya bingkai VIP. */
const CHECKIN_FRAMES = [
  { src: require('../../assets/vip/ci1.png'), hole: 0.58 },
  { src: require('../../assets/vip/ci2.png'), hole: 0.62 },
];

/**
 * Avatar bulat dengan bingkai VIP yang terpasang otomatis. Tanpa VIP tampil sebagai avatar biasa.
 * `size` = ukuran foto; bingkai menyesuaikan dan sedikit keluar dari kotak (tidak mengubah tata letak banyak).
 */
export function FramedAvatar({ uri, name, size = 40, vip = 0, checkinFrame = 0 }: { uri?: string | null; name?: string; size?: number; vip?: number; checkinFrame?: number }) {
  const frame =
    vip > 0 ? FRAMES[Math.min(vip, FRAMES.length) - 1] : checkinFrame > 0 ? CHECKIN_FRAMES[Math.min(checkinFrame, CHECKIN_FRAMES.length) - 1] : null;
  if (!frame) return <Avatar uri={uri} name={name} size={size} />;

  const outer = (size / frame.hole) * 0.97; // foto sedikit masuk di bawah cincin
  const bleed = (outer - size) / 2;
  const margin = bleed * 0.55; // ruang tambahan supaya tidak menabrak teks di sebelahnya

  return (
    <View style={{ width: size, height: size, margin, alignItems: 'center', justifyContent: 'center' }}>
      <Avatar uri={uri} name={name} size={size} />
      <Image
        source={frame.src}
        pointerEvents="none"
        contentFit="contain"
        style={{ position: 'absolute', width: outer, height: outer, left: -bleed, top: -bleed }}
      />
    </View>
  );
}
