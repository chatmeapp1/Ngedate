// Pemberitahuan ringan: daftar host/pengguna perlu dimuat ulang setelah blokir diubah
const listeners = new Set<() => void>();

export function emitBlockChange() {
  listeners.forEach((fn) => fn());
}

export function onBlockChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
