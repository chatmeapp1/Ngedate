import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '@/lib/theme';

const W = 210;
const H = 260;

// Pemutar layar penuh (dipasang hanya saat dibuka supaya video tidak dimuat sebelum diketuk)
function FullVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={s.full} contentFit="contain" nativeControls />;
}

/** Gelembung foto/video di chat. Ketuk untuk membuka layar penuh. */
export function MediaBubble({ type, url }: { type: 'image' | 'video'; url: string }) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={s.thumb}>
        {type === 'image' ? (
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <LinearGradient colors={['#2B2040', '#17121F']} style={[StyleSheet.absoluteFill, s.center]}>
            <View style={s.play}>
              <Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 3 }} />
            </View>
            <View style={s.badge}>
              <Ionicons name="videocam" size={12} color="#fff" />
            </View>
          </LinearGradient>
        )}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={s.backdrop}>
          {type === 'image' ? (
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)}>
              <Image source={{ uri: url }} style={s.full} contentFit="contain" />
            </Pressable>
          ) : open ? (
            <FullVideo url={url} />
          ) : null}
          <Pressable onPress={() => setOpen(false)} hitSlop={12} style={[s.close, { top: insets.top + 10 }]}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  thumb: { width: W, height: H, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#E9E1F2' },
  center: { alignItems: 'center', justifyContent: 'center' },
  play: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, height: 22, borderRadius: 11 },
  backdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', right: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
