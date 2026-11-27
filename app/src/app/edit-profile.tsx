import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CountryPicker } from '@/components/CountryPicker';
import { BirthDatePicker, LANGUAGES, LanguagePicker, TagEditor, TextEditor } from '@/components/Editors';
import { Avatar, ScreenHeader } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { useAuth } from '@/context/auth';
import { api, errorMessage, imageForm } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { pickImage } from '@/lib/pickImage';
import { colors, radius } from '@/lib/theme';
import type { Photo, User } from '@/lib/types';

const GENDER_LABEL: Record<string, string> = { male: 'Laki-laki', female: 'Perempuan', other: 'Lainnya' };

type Editor = 'nickname' | 'bio' | 'tags' | 'language' | null;

export default function EditProfile() {
  const { user, setUser } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState<'avatar' | 'photo' | null>(null);
  const [editor, setEditor] = useState<Editor>(null);

  const loadPhotos = useCallback(() => {
    api.get<Photo[]>('/api/me/photos').then(setPhotos).catch(() => {});
  }, []);
  useEffect(loadPhotos, [loadPhotos]);

  if (!user) return null;
  const isHost = user.role === 'host';

  const save = async (patch: Record<string, unknown>) => {
    try {
      setUser(await api.patch<User>('/api/me', patch));
    } catch (e) {
      Alert.alert('Gagal menyimpan', errorMessage(e));
      throw e;
    }
  };

  const changeAvatar = async () => {
    const asset = await pickImage([1, 1]);
    if (!asset) return;
    setUploading('avatar');
    try {
      const me = await api.post<User>('/api/me/avatar', imageForm(asset.uri, asset.mimeType));
      setUser(me);
      if (isHost) Alert.alert('Foto dikirim', 'Foto profil baru akan tampil setelah dicek admin.');
    } catch (e) {
      Alert.alert('Gagal mengunggah', errorMessage(e));
    } finally {
      setUploading(null);
    }
  };

  const addPhoto = async () => {
    if (photos.length >= 12) return Alert.alert('Album penuh', 'Maksimal 12 foto.');
    const asset = await pickImage([4, 5]);
    if (!asset) return;
    setUploading('photo');
    try {
      const p = await api.post<Photo>('/api/me/photos', imageForm(asset.uri, asset.mimeType));
      setPhotos((list) => [...list, p]);
    } catch (e) {
      Alert.alert('Gagal mengunggah', errorMessage(e));
    } finally {
      setUploading(null);
    }
  };

  const photoMenu = (p: Photo) =>
    Alert.alert(
      p.status === 'rejected' ? 'Foto ditolak' : p.status === 'pending' ? 'Menunggu dicek' : 'Foto album',
      p.status === 'rejected' ? `Alasan: ${p.rejectReason ?? '-'}` : p.status === 'pending' ? 'Foto akan tampil setelah disetujui admin.' : '',
      [
        { text: 'Tutup', style: 'cancel' },
        {
          text: 'Hapus foto',
          style: 'destructive',
          onPress: async () => {
            await api.del(`/api/me/photos/${p.id}`).catch(() => {});
            setPhotos((list) => list.filter((x) => x.id !== p.id));
          },
        },
      ]
    );

  const copyId = async () => {
    await Clipboard.setStringAsync(String(user.id));
    if (Platform.OS === 'android') ToastAndroid.show('ID disalin', ToastAndroid.SHORT);
  };

  const props: LayoutProps = { user, photos, uploading, changeAvatar, addPhoto, photoMenu, copyId, setEditor, save };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {isHost ? <HostLayout {...props} /> : <UserLayout {...props} />}

      <TextEditor
        visible={editor === 'nickname'}
        title="Nickname"
        initial={user.displayName}
        maxLength={30}
        minLength={2}
        onClose={() => setEditor(null)}
        onSave={(v) => save({ displayName: v })}
      />
      <TextEditor
        visible={editor === 'bio'}
        title="Bio"
        initial={user.bio ?? ''}
        maxLength={500}
        minLength={0}
        multiline
        onClose={() => setEditor(null)}
        onSave={(v) => save({ bio: v })}
      />
      <TagEditor visible={editor === 'tags'} initial={user.tags} onClose={() => setEditor(null)} onSave={(tags) => save({ tags })} />
      <LanguagePicker
        visible={editor === 'language'}
        value={user.language}
        onClose={() => setEditor(null)}
        onPick={(language) => save({ language }).catch(() => {})}
      />
    </View>
  );
}

interface LayoutProps {
  user: User;
  photos: Photo[];
  uploading: 'avatar' | 'photo' | null;
  changeAvatar: () => void;
  addPhoto: () => void;
  photoMenu: (p: Photo) => void;
  copyId: () => void;
  setEditor: (e: Editor) => void;
  save: (patch: Record<string, unknown>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Versi pria / user biasa (model daftar)
// ---------------------------------------------------------------------------
function UserLayout({ user, photos, uploading, changeAvatar, addPhoto, photoMenu, copyId, setEditor, save }: LayoutProps) {
  const insets = useSafeAreaInsets();
  return (
    <>
      <ScreenHeader title="Edit Informasi" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}>
        <Pressable style={u.avatar} onPress={changeAvatar}>
          <Avatar uri={user.avatarUrl} name={user.displayName} size={110} />
          <View style={u.camera}>
            {uploading === 'avatar' ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={18} color="#fff" />}
          </View>
        </Pressable>

        <Text style={u.section}>Album</Text>
        <View style={u.albumBox}>
          <AlbumStrip photos={photos} size={78} uploading={uploading === 'photo'} onAdd={addPhoto} onPress={photoMenu} />
        </View>

        <Text style={u.section}>Biografi</Text>
        <Row value={user.bio || '…'} onPress={() => setEditor('bio')} multiline />
        <View style={u.divider} />

        <Text style={u.section}>Informasi Dasar</Text>
        <Row label="ID" value={String(user.id)} onPress={copyId} icon="copy-outline" />
        <Row label="Nickname" value={user.displayName} onPress={() => setEditor('nickname')} />
        <Row label="Jenis kelamin" value={GENDER_LABEL[user.gender ?? ''] ?? '-'} locked />
        <BirthDatePicker value={user.birthDate ?? null} onChange={(d) => save({ birthDate: d }).catch(() => {})}>
          {(open) => <Row label="Hari ulang tahun" value={user.birthDate ?? ''} onPress={open} />}
        </BirthDatePicker>
        <CountryPicker value={user.countryCode} onChange={(c) => save({ countryCode: c }).catch(() => {})}>
          {(open) => <Row label="Negara" value={`${flag(user.countryCode)} ${countryName(user.countryCode)}`} onPress={open} />}
        </CountryPicker>
        <View style={u.divider} />

        <Text style={u.section}>Bahasa</Text>
        <Row label="Bahasa" value={LANGUAGES[user.language] ?? user.language} onPress={() => setEditor('language')} />
        <Row label="Tag saya" value={user.tags.length ? user.tags.map((t) => `#${t}`).join(' ') : 'Tambahkan'} onPress={() => setEditor('tags')} />
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Versi host / wanita (model kartu, Edit & Pratinjau)
// ---------------------------------------------------------------------------
function HostLayout({ user, photos, uploading, changeAvatar, addPhoto, photoMenu, copyId, setEditor, save }: LayoutProps) {
  const insets = useSafeAreaInsets();
  const avatar = user.pendingAvatarUrl ?? user.avatarUrl;
  return (
    <>
      <ScreenHeader title="Lengkapi informasi" />
      <View style={h.tabs}>
        <View style={h.tab}>
          <Text style={[h.tabText, h.tabOn]}>Edit</Text>
          <View style={h.tabLine} />
        </View>
        <Pressable style={h.tab} onPress={() => router.push({ pathname: '/host/[id]', params: { id: String(user.id) } })}>
          <Text style={h.tabText}>Pratinjau</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 32 }}>
        <Card onPress={changeAvatar}>
          <View style={h.avatarRow}>
            <View>
              {avatar ? (
                <Image source={{ uri: avatar }} style={h.avatarImg} contentFit="cover" />
              ) : (
                <View style={[h.avatarImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name="camera" size={32} color={colors.primary} />
                </View>
              )}
              {uploading === 'avatar' ? (
                <View style={[StyleSheet.absoluteFill, h.dim]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
              {user.pendingAvatarUrl ? <StatusBadge status="pending" /> : null}
            </View>
            <Text style={h.cardTitle}>Avatar saya</Text>
            <Ionicons name="arrow-forward" size={22} color={colors.textDim} />
          </View>
        </Card>

        <VerificationBanner user={user} />

        <Card>
          <View style={h.cardHead}>
            <Text style={h.cardTitle}>Album saya</Text>
            <Text style={h.count}>{photos.length}/12</Text>
          </View>
          <AlbumStrip photos={photos} size={110} uploading={uploading === 'photo'} onAdd={addPhoto} onPress={photoMenu} showStatus />
        </Card>

        <Card>
          <Text style={[h.cardTitle, { marginBottom: 4 }]}>Profil</Text>
          <Row label="Nickname saya" value={user.displayName} onPress={() => setEditor('nickname')} arrow />
          <Row label="Id pengguna" value={String(user.id)} onPress={copyId} icon="copy-outline" />
          <Row label="Jenis kelamin" value={GENDER_LABEL[user.gender ?? ''] ?? '-'} locked />
          <BirthDatePicker value={user.birthDate ?? null} onChange={(d) => save({ birthDate: d }).catch(() => {})}>
            {(open) => <Row label="Tanggal lahir" value={user.birthDate ?? ''} onPress={open} arrow />}
          </BirthDatePicker>
          <Row label="Bahasa" value={LANGUAGES[user.language] ?? user.language} onPress={() => setEditor('language')} arrow />
          <CountryPicker value={user.countryCode} onChange={(c) => save({ countryCode: c }).catch(() => {})}>
            {(open) => <Row label="Negara" value={`${flag(user.countryCode)} ${countryName(user.countryCode)}`} onPress={open} arrow />}
          </CountryPicker>
          {user.agencyName ? <Row label="Agency" value={user.agencyName} locked /> : null}
        </Card>

        <Card onPress={() => setEditor('bio')}>
          <View style={h.cardHead}>
            <Text style={h.cardTitle}>Bio saya</Text>
            <Ionicons name="arrow-forward" size={22} color={colors.textDim} />
          </View>
          <Text style={h.muted}>{user.bio || 'Ceritakan dirimu supaya orang tertarik mengobrol~'}</Text>
        </Card>

        <Card onPress={() => setEditor('tags')}>
          <View style={h.cardHead}>
            <Text style={h.cardTitle}>Tag saya</Text>
            <Ionicons name="arrow-forward" size={22} color={colors.textDim} />
          </View>
          {user.tags.length ? (
            <View style={h.tags}>
              {user.tags.map((t) => (
                <View key={t} style={h.tag}>
                  <Text style={h.tagText}>#{t}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={h.muted}>Tambahkan tag untuk mencocokkan orang yang lebih cocok~</Text>
          )}
        </Card>
      </ScrollView>
    </>
  );
}

function VerificationBanner({ user }: { user: User }) {
  const st = user.verified ? 'approved' : user.verificationStatus ?? 'none';
  const cfg = {
    approved: { bg: '#E8F7EE', fg: '#15803D', icon: <Verified size={22} outline={false} />, text: 'Verifikasi orang nyata selesai' },
    pending: { bg: '#FFF7E0', fg: '#A16207', icon: <Ionicons name="hourglass" size={20} color="#A16207" />, text: 'Verifikasi wajah sedang ditinjau' },
    rejected: { bg: '#FEE2E2', fg: colors.danger, icon: <Ionicons name="alert-circle" size={20} color={colors.danger} />, text: 'Verifikasi ditolak, ketuk untuk ulangi' },
    none: { bg: '#EEF2FF', fg: colors.primary, icon: <Ionicons name="scan" size={20} color={colors.primary} />, text: 'Belum verifikasi wajah, ketuk untuk mulai' },
  }[st];
  const tappable = st === 'rejected' || st === 'none';
  return (
    <Pressable disabled={!tappable} onPress={() => router.push('/verification')} style={[h.banner, { backgroundColor: cfg.bg }]}>
      {cfg.icon}
      <Text style={{ flex: 1, color: cfg.fg, fontWeight: '700', fontSize: 15 }}>{cfg.text}</Text>
      {tappable ? <Ionicons name="chevron-forward" size={18} color={cfg.fg} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Komponen bersama
// ---------------------------------------------------------------------------
function AlbumStrip({
  photos,
  size,
  uploading,
  onAdd,
  onPress,
  showStatus,
}: {
  photos: Photo[];
  size: number;
  uploading: boolean;
  onAdd: () => void;
  onPress: (p: Photo) => void;
  showStatus?: boolean;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      <Pressable onPress={onAdd} style={[sh.addTile, { width: size, height: size }]}>
        {uploading ? <ActivityIndicator color={colors.textDim} /> : <Ionicons name="add" size={size * 0.4} color={colors.textDim} />}
      </Pressable>
      {photos.map((p) => (
        <Pressable key={p.id} onPress={() => onPress(p)}>
          <Image source={{ uri: p.url }} style={{ width: size, height: size, borderRadius: 16, backgroundColor: colors.surfaceAlt }} contentFit="cover" />
          {showStatus && p.status && p.status !== 'approved' ? <StatusBadge status={p.status} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'rejected' }) {
  const rejected = status === 'rejected';
  return (
    <View style={[sh.badge, { backgroundColor: rejected ? colors.danger : 'rgba(0,0,0,0.6)' }]}>
      <Ionicons name={rejected ? 'alert-circle' : 'time-outline'} size={12} color="#fff" />
      <Text style={sh.badgeText}>{rejected ? 'Ditolak »' : 'Menunggu'}</Text>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  locked,
  icon,
  arrow,
  multiline,
}: {
  label?: string;
  value: string;
  onPress?: () => void;
  locked?: boolean;
  icon?: 'copy-outline';
  arrow?: boolean;
  multiline?: boolean;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [sh.row, pressed && { opacity: 0.6 }]}>
      {label ? <Text style={sh.rowLabel}>{label}</Text> : null}
      <Text style={[sh.rowValue, !label && { textAlign: 'left', color: colors.textSub }]} numberOfLines={multiline ? 3 : 1}>
        {value}
      </Text>
      {locked ? (
        <Ionicons name="lock-closed" size={14} color={colors.textDim} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={colors.textDim} />
      ) : onPress ? (
        <Ionicons name={arrow ? 'arrow-forward' : 'chevron-forward'} size={arrow ? 20 : 18} color={colors.textDim} />
      ) : null}
    </Pressable>
  );
}

function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={h.card}>
      {children}
    </Pressable>
  );
}

const sh = StyleSheet.create({
  addTile: { borderRadius: 16, backgroundColor: '#EDEAF2', alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 11,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 15, paddingHorizontal: 2 },
  rowLabel: { color: colors.text, fontSize: 16 },
  rowValue: { flex: 1, textAlign: 'right', color: colors.textDim, fontSize: 15 },
});

const u = StyleSheet.create({
  avatar: { alignSelf: 'center', marginVertical: 16 },
  camera: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(31,20,48,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 18, marginBottom: 6 },
  albumBox: { padding: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  divider: { height: 1, backgroundColor: colors.border, marginTop: 8 },
});

const h = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 17, fontWeight: '700', color: colors.textDim },
  tabOn: { color: colors.primary },
  tabLine: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 3, backgroundColor: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text },
  count: { color: colors.textDim, fontWeight: '700' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarImg: { width: 96, height: 96, borderRadius: 20 },
  dim: { borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md },
  muted: { color: colors.textSub, fontSize: 14, lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 12, height: 30, borderRadius: radius.pill, backgroundColor: '#F3E8FF', justifyContent: 'center' },
  tagText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
