import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { connectRealtime, disconnectRealtime, onRealtime, onRealtimeConnect } from '@/lib/realtime';
import { playGiftMessage, replayMissedGifts } from '@/lib/giftFx';
import type { Conversation, Message } from '@/lib/types';

interface RealtimeState {
  unread: number;
  refreshUnread: () => void;
}

const RealtimeContext = createContext<RealtimeState>({ unread: 0, refreshUnread: () => {} });

/** Menyambungkan socket saat login, memperbarui saldo & jumlah pesan belum dibaca secara realtime. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const [unread, setUnread] = useState(0);
  const active = !!user && (user.profileCompleted || user.role === 'admin');
  const userId = user?.id;
  const isHost = user?.role === 'host';

  const refreshUnread = useCallback(() => {
    api
      .get<{ total: number }>('/api/conversations/unread-count')
      .then((r) => setUnread(r.total))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) {
      disconnectRealtime();
      setUnread(0);
      return;
    }
    connectRealtime();
    refreshUnread();

    const offs = [
      onRealtime<{ message: Message; conversation?: Conversation }>('message:new', (e) => {
        if (e.message.senderId !== userId) refreshUnread();
        // Efek gift tampil di layar mana pun (dobel dengan layar chat dicegah lewat key pesan)
        if (e.message.senderId !== userId) playGiftMessage(e.message, isHost, e.conversation?.peer?.displayName);
      }),
      onRealtimeConnect(() => {
        refreshUnread();
        replayMissedGifts(userId, isHost);
      }),
      onRealtime<{ coins: number; diamonds: number }>('wallet:update', (b) => {
        setUser((u) => (u ? { ...u, coins: b.coins, diamonds: b.diamonds } : u));
      }),
    ];
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        connectRealtime();
        refreshUnread();
        replayMissedGifts(userId, isHost);
      } else if (s === 'background') {
        // Putus saat di latar belakang supaya server mengirim notifikasi push
        disconnectRealtime();
      }
    });
    return () => {
      offs.forEach((off) => off());
      sub.remove();
    };
  }, [active, userId, refreshUnread, setUser]);

  // Putus saat logout / ganti akun
  useEffect(() => () => disconnectRealtime(), [userId]);

  const value = useMemo(() => ({ unread, refreshUnread }), [unread, refreshUnread]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
