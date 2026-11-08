"use client";

/**
 * Helper API klien.
 *
 * Mengapa perlu? Cookie sesi bisa DIBLOKIR browser saat aplikasi dibuka di
 * dalam iframe lintas situs (preview) atau saat cookie pihak ketiga diblokir.
 * Kalau itu terjadi, permintaan ke /api/orders terlihat "belum login" padahal
 * sesi di UI aktif. Solusinya: selain cookie, token sesi juga dikirim via
 * header Authorization: Bearer <token> yang diterima server sebagai fallback.
 */

const TOKEN_KEY = "agsi_token";

/** Event global saat sesi kedaluwarsa / tidak valid (status 401 dari API) */
export const SESSION_EXPIRED_EVENT = "agsi:session-expired";

export function setAuthToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage tidak tersedia (mode privat dsb.) — biarkan cookie saja
  }
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // abaikan
  }
}

/** fetch() + token sesi otomatis; deteksi sesi kedaluwarsa (401) */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(input, { ...init, headers });

  // Sesi tidak valid lagi (mis. sudah reset password / kedaluwarsa 30 hari)
  if (res.status === 401 && token) {
    clearAuthToken();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  return res;
}
