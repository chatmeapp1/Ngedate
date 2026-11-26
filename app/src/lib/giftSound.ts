import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

let modeSet = false;

/** Putar suara gift sekali (dari admin). Gagal diam-diam supaya tidak mengganggu animasi. */
export function playGiftSound(url: string | null | undefined) {
  if (!url) return;
  try {
    if (!modeSet) {
      modeSet = true;
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    }
    const player = createAudioPlayer({ uri: url });
    player.volume = 1;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        sub.remove();
        player.release();
      } catch {
        /* sudah dilepas */
      }
    };
    const sub = player.addListener('playbackStatusUpdate', (st) => {
      if (st.didJustFinish) cleanup();
    });
    player.play();
    setTimeout(cleanup, 12_000); // jaga-jaga jika event selesai tidak datang
  } catch {
    /* abaikan */
  }
}
