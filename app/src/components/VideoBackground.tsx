import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';

// Video latar 3 detik yang berulang tanpa suara.
// Ganti file assets/login-bg.mp4 untuk memakai video sendiri (disarankan portrait, < 2 MB).
const SOURCE = require('../../assets/login-bg.mp4');

export function VideoBackground() {
  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Warna dasar saat video belum siap */}
      <LinearGradient colors={['#4C1D95', '#BE1878']} style={StyleSheet.absoluteFill} />
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
      {/* Gelapkan bagian bawah supaya tombol & teks mudah dibaca */}
      <LinearGradient
        colors={['rgba(10,4,24,0.15)', 'rgba(10,4,24,0.05)', 'rgba(10,4,24,0.55)', 'rgba(10,4,24,0.85)']}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
