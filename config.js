// 石門國小電腦財產盤點系統 - 設定
// API Keys 可以直接改這裡，或在介面輸入後會自動存到 localStorage
window.SMES_CONFIG = {
  SUPABASE_URL: 'https://xcnmmaayrtiklntvhdhc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_nDPdupsm5wZI20iddtf12w_iV82XILn',
  STORAGE_BUCKET: 'inventory-photos',
  GEMINI_MODEL: 'gemini-2.5-flash',
  // Gemini API Key 留空，會在首次使用時彈出輸入框存到本機
  GEMINI_API_KEY: '',
  SCHOOL_NAME: '桃園市石門國小',
  SCHOOL_YEAR: 114
};
