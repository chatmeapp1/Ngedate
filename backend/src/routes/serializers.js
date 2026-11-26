const realtime = require('../realtime');

function age(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a -= 1;
  return a;
}

function publicUser(u, { self = false } = {}) {
  const out = {
    id: Number(u.id),
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    bio: u.bio,
    gender: u.gender,
    age: age(u.birth_date),
    role: u.role,
    countryCode: u.country_code ? u.country_code.trim() : null,
    verified: !!u.verified,
    language: u.language || 'id',
    tags: u.tags || [],
    online: realtime.isOnline(Number(u.id)),
    lastSeenAt: u.last_seen_at,
  };
  if (self) {
    out.email = u.email;
    out.birthDate = u.birth_date;
    out.coins = Number(u.coins);
    out.diamonds = Number(u.diamonds);
    out.status = u.status;
    out.profileCompleted = !!u.profile_completed;
    out.hostStatus = u.host_status || null;
    out.pendingAvatarUrl = u.pending_avatar_url || null;
    out.agencyName = u.agency_name || null;
    out.verificationStatus = u.verification_status || 'none';
    out.passwordSet = u.password_set !== false;
  }
  return out;
}

function hostCard(r, levelThresholds) {
  const { levelOf } = require('../services/membership');
  return {
    ...publicUser(r),
    // level host dari total pendapatan (pendapatan sendiri tidak dibuka ke pengguna)
    level: levelThresholds ? levelOf(Number(r.income_total || 0), levelThresholds) : undefined,
    chatPrice: r.chat_price === null || r.chat_price === undefined ? 0 : Number(r.chat_price),
    waAvailable: !!(r.wa_enabled && r.wa_number),
    waUnlockThreshold: r.wa_unlock_threshold === null || r.wa_unlock_threshold === undefined ? null : Number(r.wa_unlock_threshold),
  };
}

module.exports = { publicUser, hostCard };
