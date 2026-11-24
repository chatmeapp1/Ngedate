import { PolicyPage } from '@/components/PolicyPage';

// CATATAN untuk pemilik aplikasi: ini draf awal. Sesuaikan & minta tinjauan ahli hukum sebelum rilis.
export default function Terms() {
  return (
    <PolicyPage
      title="Ketentuan Layanan"
      updated="24 November 2026"
      intro="Dengan memakai Amora, Anda menyetujui ketentuan berikut."
      sections={[
        { title: 'Usia', body: 'Anda wajib berusia minimal 18 tahun untuk membuat akun dan memakai Amora.' },
        {
          title: 'Koin & pesan berbayar',
          body: 'Koin dipakai untuk mengirim pesan dan gift. Koin untuk pesan ditahan sampai host membalas; bila host tidak membalas dalam 24 jam, koin dikembalikan. Koin yang sudah dipakai untuk gift tidak dapat dikembalikan. Koin tidak dapat ditukar kembali menjadi uang oleh pengguna.',
        },
        {
          title: 'Perilaku yang dilarang',
          body: 'Dilarang: konten seksual eksplisit, prostitusi atau penawaran jasa seksual, penipuan, pemerasan, ujaran kebencian, pelecehan, berbagi data pribadi orang lain, serta membagikan nomor telepon, link, atau akun media sosial lewat chat untuk menghindari sistem aplikasi.',
        },
        {
          title: 'Host',
          body: 'Host bertanggung jawab atas profil, foto, dan percakapannya. Foto wajib milik sendiri. Penghasilan host dapat ditahan bila ditemukan pelanggaran.',
        },
        {
          title: 'Penangguhan akun',
          body: 'Kami dapat menangguhkan atau menghapus akun yang melanggar ketentuan ini, termasuk saldo koin atau penghasilan yang diperoleh dari pelanggaran.',
        },
        {
          title: 'Perubahan',
          body: 'Ketentuan ini dapat diperbarui. Perubahan penting akan diberitahukan di dalam aplikasi.',
        },
      ]}
    />
  );
}
