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
