export type Role = 'user' | 'host' | 'admin';

export interface User {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  gender: 'male' | 'female' | 'other' | null;
  age: number | null;
  role: Role;
  countryCode: string | null;
  verified: boolean;
  language: string;
  tags: string[];
  online: boolean;
  lastSeenAt: string | null;
  // hanya untuk profil sendiri
  email?: string | null;
  birthDate?: string | null;
  coins?: number;
  diamonds?: number;
  status?: string;
  profileCompleted?: boolean;
  hostStatus?: 'pending' | 'approved' | 'rejected' | null;
  pendingAvatarUrl?: string | null;
  agencyName?: string | null;
  verificationStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  /** false = akun Login cepat yang belum pernah mengatur password */
  passwordSet?: boolean;
}

export interface Host extends User {
  chatPrice: number;
  waAvailable: boolean;
  waUnlockThreshold: number | null;
}

export interface Photo {
  id: number;
  url: string;
  status?: 'pending' | 'approved' | 'rejected';
  rejectReason?: string | null;
}

export interface VerificationChallenge {
  challengeId: number;
  steps: { key: string; text: string }[];
  expiresAt: string;
}

export interface HostProfile extends Host {
  followers: number;
  following: number;
  likes: number;
  isFollowing: boolean;
  isLiked: boolean;
  photos: Photo[];
  avgReplyMinutes: number | null;
  conversation: { id: number; giftTotal: number; waUnlocked: boolean } | null;
}

export interface CountryCount {
  code: string;
  count: number;
}

export interface GiftWall {
  gifts: { id: number; name: string; icon: string | null; imageUrl: string | null; price: number; count: number }[];
  topSenders: { user: User; total: number }[];
}

export interface Conversation {
  id: number;
  userId: number;
  hostId: number;
  role: 'user' | 'host';
  peer?: {
    id: number;
    displayName: string;
    avatarUrl: string | null;
    lastSeenAt: string | null;
    verified?: boolean;
    role?: Role;
    online?: boolean;
  };
  giftTotal: number;
  waUnlocked: boolean;
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface Message {
  id: number;
  conversationId: number;
  senderId: number | null;
  type: 'text' | 'gift' | 'system';
  body: string | null;
  gift: {
    id: number;
    name: string;
    icon: string | null;
    category: string | null;
    price: number | null;
    imageUrl: string | null;
    animationUrl: string | null;
    animationBlend: boolean;
    soundUrl: string | null;
    count: number;
  } | null;
  price: number;
  paymentStatus: 'free' | 'held' | 'paid' | 'refunded';
  createdAt: string;
  /** hanya di aplikasi: pesan yang sedang dikirim */
  pending?: boolean;
}

export interface WhatsappStatus {
  enabled: boolean;
  threshold: number | null;
  giftTotal: number;
  unlocked: boolean;
  number: string | null;
  link: string | null;
}

export interface Wallet {
  coins: number;
  diamonds: number;
  heldCoins: number;
}

export interface LedgerEntry {
  id: number;
  currency: 'coin' | 'diamond';
  amount: number;
  balanceAfter: number;
  reason: string;
  note: string | null;
  createdAt: string;
}

export interface HostSettings {
  chatPrice: number;
  waEnabled: boolean;
  waNumber: string | null;
  waUnlockThreshold: number;
  limits: { chatPriceMin: number; chatPriceMax: number; waThresholdMin: number; waThresholdMax: number };
}

export type HostTab = 'all' | 'popular' | 'new' | 'online';

export type RegionKey = 'asia' | 'arab' | 'india' | 'latino' | 'afrika' | 'barat';

export interface RegionCount {
  key: RegionKey;
  count: number;
  coverUrl: string | null;
}

export interface Gift {
  id: number;
  name: string;
  price: number;
  icon: string | null;
  imageUrl: string | null;
  animationUrl: string | null;
  animationBlend: boolean;
  soundUrl: string | null;
  category: string;
  sortOrder: number;
  active: boolean;
}

export interface SendGiftResult {
  message: Message;
  systemMessage: Message | null;
  giftTotal: number;
  waUnlocked: boolean;
}

export interface Withdrawal {
  id: number;
  diamonds: number;
  currency: 'IDR' | 'USD';
  diamondsPerUsd: number;
  usdIdr: number;
  /** satuan terkecil: Rupiah utuh (IDR) atau sen (USD) */
  gross: number;
  fee: number;
  net: number;
  kind: 'bank' | 'ewallet' | 'crypto';
  provider: string;
  accountNumber: string;
  accountName: string | null;
  status: 'pending' | 'paid' | 'rejected' | 'cancelled';
  adminNote: string | null;
  transferRef: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface WithdrawOptions {
  diamonds: number;
  /** idr = bank/e-wallet dalam Rupiah (Indonesia); usdt = USDT TRC20 dalam USD (negara lain) */
  method: 'idr' | 'usdt';
  currency: 'IDR' | 'USD';
  countryCode: string | null;
  diamondsPerUsd: number;
  usdIdr: number;
  minDiamonds: number;
  feePercent: number;
  usdtFeeUsd: number;
  passwordSet: boolean;
  cooldownHours: number;
  providers: { kind: 'bank' | 'ewallet' | 'crypto'; name: string }[];
  account: { kind: 'bank' | 'ewallet' | 'crypto'; provider: string; accountNumber: string; accountName: string | null; cooldownUntil: string | null } | null;
  pending: Withdrawal | null;
}

export interface CoinPackage {
  id: number;
  coins: number;
  priceIdr: number;
  priceUsdCents: number;
  badge: string | null;
}

export interface TopupInfo {
  /** IDR untuk pengguna di Indonesia, USD untuk negara lain */
  currency: 'IDR' | 'USD';
  /** nomor WhatsApp admin (angka saja), null jika belum diatur */
  contact: string | null;
  note: string;
  packages: CoinPackage[];
}
