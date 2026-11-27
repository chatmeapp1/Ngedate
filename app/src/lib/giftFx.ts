import { playGiftSound } from './giftSound';

/**
 * Antrean animasi gift. Layar mana pun bisa memanggil playGift / playWaUnlocked,
 * lapisan <GiftOverlay /> di root akan memutarnya satu per satu.
 */
export const LUXURY_PRICE = 10_000;

export type GiftFx =
  | {
      kind: 'gift';
      key: string;
      giftId: number;
      name: string;
      icon: string | null;
      imageUrl: string | null;
      /** efek MP4 layar penuh (dari admin), diputar maksimal 6 detik */
      videoUrl: string | null;
      /** diamond yang diterima host (tampil di layar host sebagai pengganti harga) */
      hostIncome: number | null;
      /** suara gift (dari admin), diputar sekali saat gift tiba */
      soundUrl: string | null;
      /** video berlatar hitam: diputar dengan mode screen supaya tampak transparan */
      blend: boolean;
      count: number;
      price: number; // harga satuan
      luxury: boolean;
      from?: string;
    }
  | { kind: 'wa'; key: string; hostName?: string; link?: string | null };

type Listener = (fx: GiftFx) => void;
let listener: Listener | null = null;
const played = new Set<string>();

export function setGiftFxListener(fn: Listener | null) {
  listener = fn;
}

function push(fx: GiftFx) {
  // Hindari animasi ganda (respons HTTP + event realtime untuk pesan yang sama)
  if (played.has(fx.key)) return;
  played.add(fx.key);
  if (played.size > 300) played.delete(played.values().next().value as string);
  listener?.(fx);
  // Suara diputar setelah animasi dimulai dan tidak boleh mengganggunya
  if (fx.kind === 'gift' && fx.soundUrl) setTimeout(() => playGiftSound(fx.soundUrl), 50);
}

export function playGift(args: {
  messageId: number;
  giftId: number;
  name: string;
  icon?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  soundUrl?: string | null;
  hostIncome?: number | null;
  blend?: boolean;
  count: number;
  price?: number | null;
  category?: string | null;
  total?: number;
  from?: string;
}) {
  const unit = args.price ?? (args.total && args.count ? Math.round(args.total / args.count) : 0);
  push({
    kind: 'gift',
    key: `m${args.messageId}`,
    giftId: args.giftId,
    name: args.name,
    icon: args.icon ?? null,
    imageUrl: args.imageUrl ?? null,
    videoUrl: args.videoUrl ?? null,
    soundUrl: args.soundUrl ?? null,
    hostIncome: args.hostIncome ?? null,
    blend: !!args.blend,
    count: args.count,
    price: unit,
    luxury: args.category === 'luxury' || unit >= LUXURY_PRICE || unit * args.count >= LUXURY_PRICE * 5,
    from: args.from,
  });
}

export function playWaUnlocked(conversationId: number, hostName?: string, link?: string | null) {
  push({ kind: 'wa', key: `wa${conversationId}`, hostName, link });
}
