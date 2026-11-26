import { PolicyPage } from '@/components/PolicyPage';

// CATATAN untuk pemilik aplikasi: ini draf awal. Sesuaikan dengan cara kerja layanan Anda
// dan minta tinjauan ahli hukum sebelum rilis (Google Play mewajibkan kebijakan privasi).
export default function Privacy() {
  return (
    <PolicyPage
      title="Kebijakan Privasi"
      updated="24 November 2026"
      intro="Kebijakan ini menjelaskan data apa yang dikumpulkan Amora, untuk apa, dan bagaimana kami melindunginya."
      sections={[
        {
          title: 'Data yang kami kumpulkan',
          body: 'Data akun (username, nama tampilan, email bila diisi, negara, jenis kelamin, tanggal lahir), foto profil dan album yang Anda unggah, isi pesan dan gift di dalam aplikasi, riwayat transaksi koin, serta kode perangkat acak untuk Login cepat.',
        },
        {
          title: 'Penggunaan data',
          body: 'Data dipakai untuk menjalankan layanan (menampilkan profil, mengirim pesan, memproses koin dan gift), mencegah penipuan dan penyalahgunaan, serta menegakkan Ketentuan Layanan.',
        },
        {
          title: 'Nomor WhatsApp host',
          body: 'Nomor WhatsApp yang dimasukkan host hanya ditampilkan kepada pengguna yang sudah memenuhi syarat yang ditetapkan host tersebut, dan tidak pernah ditampilkan di profil atau daftar host.',
        },
        {
          title: 'Laporan & blokir',
          body: 'Saat Anda melaporkan pengguna dari dalam chat, beberapa pesan terakhir di percakapan itu disalin dan hanya dapat dilihat tim moderasi kami untuk menilai laporan. Laporan bersifat rahasia dan tidak diberitahukan kepada pengguna yang dilaporkan. Pengguna yang Anda blokir tidak dapat melihat atau mengirim pesan kepada Anda.',
        },
        {
          title: 'Berbagi data',
          body: 'Kami tidak menjual data pribadi. Data hanya dibagikan kepada penyedia layanan yang membantu menjalankan Amora (misalnya penyimpanan server dan pembayaran) atau bila diwajibkan hukum.',
        },
        {
          title: 'Penyimpanan & keamanan',
          body: 'Password disimpan dalam bentuk hash. Token login disimpan terenkripsi di perangkat Anda. Koneksi ke server sebaiknya memakai HTTPS.',
        },
        {
          title: 'Hak Anda',
          body: 'Anda dapat mengubah profil kapan saja. Anda juga dapat menghapus akun beserta data pribadinya langsung dari aplikasi lewat Saya > Pengaturan akun > Hapus akun. Penghapusan berlaku permanen: saldo koin dan diamond hangus, sedangkan catatan transaksi tanpa identitas dan laporan pelanggaran dipertahankan untuk pembukuan dan moderasi. Jika tidak bisa membuka aplikasi, ikuti petunjuk di halaman hapus-akun pada alamat server Anda atau hubungi kami.',
        },
        {
          title: 'Usia minimum',
          body: 'Amora hanya untuk pengguna berusia 18 tahun ke atas. Akun milik anak di bawah umur akan dihapus.',
        },
      ]}
    />
  );
}
