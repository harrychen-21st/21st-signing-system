export const authFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('jwt');
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    // 登入超時或無效，強制登出
    localStorage.removeItem('jwt');
    window.dispatchEvent(new Event('auth-expired'));
  }
  
  return response;
};
