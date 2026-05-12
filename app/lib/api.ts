const BASE_URL = process.env.NEXT_PUBLIC_OMBRE_BASE_URL!; // 前端这里建议用 NEXT_PUBLIC_ 前缀的变量
const PASSWORD = process.env.NEXT_PUBLIC_OMBRE_SESSION!;

// 这个函数负责拿着密码去后端登录，并获取认证需要的 Cookie
async function getSessionCookie(): Promise<string> {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
    });
    if (!loginRes.ok) {
        throw new Error('登录后端失败，请检查 OMBRE_SESSION 变量中的密码是否正确');
    }
    // 从登录成功的响应头里把 Cookie“拿”出来
    const setCookieHeader = loginRes.headers.get('set-cookie');
    if (!setCookieHeader) {
        throw new Error('登录后端成功，但未收到会话 Cookie，请联系后端开发者');
    }
    return setCookieHeader;
}

// 这是修改后的 getBuckets，它会先登录再拿数据
export async function getBuckets() {
    // 1. 先登录
    const cookie = await getSessionCookie();
    // 2. 拿着登录后得到的 Cookie 去请求数据
    const res = await fetch(`${BASE_URL}/api/buckets`, {
        headers: { 'Cookie': cookie },
    });
    if (!res.ok) throw new Error('Failed to fetch buckets');
    return res.json();
}