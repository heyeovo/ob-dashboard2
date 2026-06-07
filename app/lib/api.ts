const BASE_URL = process.env.OMBRE_BASE_URL || process.env.NEXT_PUBLIC_OMBRE_BASE_URL!;
const PASSWORD = process.env.OMBRE_SESSION || process.env.NEXT_PUBLIC_OMBRE_SESSION!;

// 自动登录并获取 Cookie
async function getSessionCookie(): Promise<string> {
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
    return setCookieHeader;
}

export async function getBuckets() {
    const cookie = await getSessionCookie();
    const res = await fetch(`${BASE_URL}/api/buckets`, {
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
