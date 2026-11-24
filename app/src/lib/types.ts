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
  online: boolean;
  lastSeenAt: string | null;
  // hanya untuk profil sendiri
  email?: string | null;
  birthDate?: string | null;
  coins?: number;
  diamonds?: number;
  status?: string;
}

export interface Host extends User {
  chatPrice: number;
  waAvailable: boolean;
  waUnlockThreshold: number | null;
}

export interface Photo {
  id: number;
  url: string;
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
  gifts: { id: number; name: string; imageUrl: string | null; price: number; count: number }[];
  topSenders: { user: User; total: number }[];
}

export interface Conversation {
  id: number;
  userId: number;
  hostId: number;
  role: 'user' | 'host';
  peer?: { id: number; displayName: string; avatarUrl: string | null; lastSeenAt: string | null };
  giftTotal: number;
  waUnlocked: boolean;
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
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
