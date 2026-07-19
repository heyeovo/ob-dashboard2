export const BASE_URL = process.env.OMBRE_BASE_URL || process.env.NEXT_PUBLIC_OMBRE_BASE_URL!;
const PASSWORD = process.env.OMBRE_SESSION || process.env.NEXT_PUBLIC_OMBRE_SESSION!;

// --- Session cookie cache: avoid re-login on every request / 缓存 cookie 避免重复登录 ---
// getSessionCookie() was called once per fetch. Opening the bucket drawer
// triggered 2+ parallel fetches, each POSTing /auth/login → 4+ roundtrips.
let _cookieCache: { value: string; ts: number } | null = null;
const COOKIE_TTL = 5 * 60 * 1000; // 5 minutes

function _cookieExpired() {
    return !_cookieCache || (Date.now() - _cookieCache.ts) > COOKIE_TTL;
}

// 自动登录并获取 Cookie（5 分钟缓存）
export async function getSessionCookie(): Promise<string> {
    if (_cookieCache && !_cookieExpired()) {
        return _cookieCache.value;
    }
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
    });
    if (!loginRes.ok) {
        throw new Error('登录后端失败，请检查 OMBRE_SESSION 变量中的密码是否正确');
    }
    const setCookieHeader = loginRes.headers.get('set-cookie');
    if (!setCookieHeader) {
        throw new Error('登录后端成功，但未收到会话 Cookie，请联系后端开发者');
    }
    _cookieCache = { value: setCookieHeader, ts: Date.now() };
    return setCookieHeader;
}

// Force refresh on 401 (cookie expired mid-session)
export function clearSessionCookie() {
    _cookieCache = null;
}

export async function getBuckets(full?: boolean) {
    const cookie = await getSessionCookie();
    const url = full ? `${BASE_URL}/api/buckets?full=1` : `${BASE_URL}/api/buckets`;
    const res = await fetch(url, {
        headers: { 'Cookie': cookie },
    });
    if (!res.ok) throw new Error('Failed to fetch buckets');
    return res.json();
}

export interface PaginatedBuckets {
    buckets: any[];
    count: number;
    limit: number;
    offset: number;
}

export async function getBucketsPaginated(limit: number, offset: number, full?: boolean): Promise<PaginatedBuckets> {
    const cookie = await getSessionCookie();
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (full) params.set('full', '1');
    const url = `${BASE_URL}/api/buckets?${params.toString()}`;
    const res = await fetch(url, {
        headers: { 'Cookie': cookie },
    });
    if (!res.ok) throw new Error('Failed to fetch buckets');
    return res.json();
}

export async function getBucket(id: string) {
    const cookie = await getSessionCookie();
    const res = await fetch(`${BASE_URL}/api/bucket/${id}`, {
        headers: { 'Cookie': cookie },
    });
    if (!res.ok) throw new Error('Failed to fetch bucket');
    return res.json();
}

export async function searchBuckets(q: string, includeArchived: boolean = false) {
    const cookie = await getSessionCookie();
    const url = `${BASE_URL}/api/search?q=${encodeURIComponent(q)}${includeArchived ? "&include_archive=true" : ""}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: { 'Cookie': cookie }
    });
    
    if (!res.ok) throw new Error('Failed to search');
    return res.json();
}
