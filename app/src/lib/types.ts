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
  /** punya kode pemulihan untuk lupa password */
  hasRecoveryCode?: boolean;
  /** password sementara dari admin: wajib diganti */
  mustChangePassword?: boolean;
  membership?: Membership;
}

/** Level (0-10) dan VIP (1-5) dari total top up koin */
export interface Membership {
  /** 'host': level dari total pendapatan diamond (topupTotal = pendapatan); 'user': dari total top up koin */
  kind?: 'user' | 'host';
  /** host: penghasilan diamond hari ini (WIB) */
  earnedToday?: number;
  topupTotal: number;
  level: number;
  maxLevel: number;
  levelThresholds: number[];
  nextLevelAt: number | null;
  levelProgress: number;
  vip: number;
  maxVip: number;
  vipThresholds: number[];
  nextVipAt: number | null;
  vipProgress: number;
  freeCardsPerDay: number;
  freeCardsLeft: number;
  /** sisa pesan gratis dari hadiah check-in */
  checkinCards?: number;
  /** model bingkai avatar hadiah check-in yang masih aktif (0 = tidak ada) */
  checkinFrame?: number;
  checkinFrameUntil?: string | null;
}

/** pengguna yang dilihat host: level & VIP dari total top up */
export interface Member extends User {
  level?: number;
  vip?: number;
  /** bingkai avatar hadiah check-in yang aktif (0 = tidak ada) */
  checkinFrame?: number;
  /** hanya pada profil lengkap (GET /api/members/:id) */
  followers?: number;
  following?: number;
  likes?: number;
  isFollowing?: boolean;
  isLiked?: boolean;
}

export interface Host extends User {
  /** level host (0-10) dari total pendapatan */
  level?: number;
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
  type: 'text' | 'gift' | 'system' | 'image' | 'video';
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
  /** gift: diamond yang diterima host (host melihat ini, bukan harga gift) */
  hostIncome?: number | null;
  /** media privat dari host: dibuka pengguna dengan koin (mediaUrl berupa path API terproteksi) */
  mediaPrivate?: boolean;
  mediaPrice?: number;
  mediaUnlocked?: boolean;
  /** media privat: status review admin (hanya host pengirim yang melihat yang belum disetujui) */
  mediaReview?: 'pending' | 'approved' | 'rejected' | null;
  mediaReviewReason?: string | null;
  /** foto/video di chat (VIP) */
  mediaUrl?: string | null;
  /** pesan memakai kartu gratis VIP */
  freeCard?: boolean;
  /** sumber pesan gratis: 'vip' atau 'checkin' */
  freeSource?: 'vip' | 'checkin' | null;
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

export interface Moment {
  id: number;
  body: string | null;
  imageUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  liked: boolean;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string | null;
  host: { id: number; displayName: string; avatarUrl: string | null; verified: boolean };
}

export interface MomentComment {
  id: number;
  body: string;
  createdAt: string;
  user: { id: number; displayName: string; avatarUrl: string | null; verified: boolean; role: Role; level: number | null };
}

export interface AppNotification {
  id: number;
  type: 'topup' | 'photo' | 'avatar' | 'moment' | 'agency' | 'withdraw' | string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export type CheckinReward = { type: 'coins'; amount: number } | { type: 'cards'; amount: number } | { type: 'frame'; frame: number; days: number };

export interface CheckinStatus {
  claimedToday: boolean;
  /** hari (1-7) yang sedang / baru saja diklaim */
  currentDay: number;
  /** jumlah kotak yang sudah bercentang pada siklus ini */
  claimedDays: number;
  rewards: CheckinReward[];
  reward: CheckinReward;
  /** hadiah yang baru diterima (hanya pada respons klaim) */
  granted?: CheckinReward;
}

export interface HostTask {
  key: 'moment' | 'photos' | 'checkin' | 'like' | string;
  group: 'beginner' | 'daily';
  title: string;
  reward: number;
  progress: number;
  target: number;
  go: 'moment' | 'photos' | 'checkin' | 'like' | string;
  state: 'todo' | 'claimable' | 'done';
}

export interface SalaryStatus {
  enrolled: boolean;
  minutesPerDay?: number;
  daysRequired?: number;
  incomeTarget?: number;
  reward?: number;
  todayMinutes?: number;
  validDays?: number;
  income?: number;
  weekEndsIn?: number;
  /** detik sampai 00:00 WIB berikutnya */
  dayEndsIn?: number;
  paid?: boolean;
  met?: boolean;
}
