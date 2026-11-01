/**
 * Tema (koyu / açık): seçim bu cihazda saklanır, uygulama yeniden açıldığında korunur.
 * Sayfa ilk açılırken (index.html içindeki küçük betik) kayıtlı tema renkler çizilmeden
 * uygulanır; böylece açık temada bir an koyu ekran görünmez.
 */
export const THEME_KEY = 'repertuvarim:theme';
const THEME_COLORS = { dark: '#1a1523', light: '#f7f7fa' };

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Temayı uygular ve saklar; değişince 'themechange' olayı gönderilir. */
export function setTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[value]);
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    /* saklanamazsa yalnızca bu oturumda geçerli */
  }
  document.dispatchEvent(new CustomEvent('themechange', { detail: value }));
  return value;
}

export function toggleTheme() {
  return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}
